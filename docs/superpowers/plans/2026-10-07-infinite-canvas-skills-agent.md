# Skills and Canvas Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Import managed SKILL.md files and add a cancellable Agent step to the existing canvas text-node flow, using either the configured OpenAI-compatible API or a locally authorized ChatGPT subscription.

**Architecture:** Keep Skill CRUD in the existing Canvas Agent SkillStore and API. Add a read-only import preview, then save through existing create/update calls. Add Agent mode, provider selection, and a managed Skill reference to text-node metadata. Resolve Skills at execution time. Use the configured API for OpenAI-compatible requests; for ChatGPT plan usage, keep loopback OAuth, refresh tokens, and Responses API requests in the local Canvas Agent.

**Tech Stack:** React 19, TypeScript, Ant Design, Zustand, existing Vite frontend, existing Express Canvas Agent API, gray-matter parser, existing OpenAI-compatible text request helper.

**Spec:** docs/superpowers/specs/2026-10-07-infinite-canvas-custom-feature-design.md

## Global Constraints

- Implement only in this checked-out fork; leave the separate work-canvas prototype untouched.
- Reuse managed Skills under .agents/skills, the existing SkillStore, revision checks, and existing create/update/delete API.
- Do not create a second Skill manager, API key store, Agent runtime, or backend.
- ChatGPT plan mode uses the official open-source Sign in with ChatGPT flow, public `/v1/models` and `/v1/responses` endpoints, and protected local OAuth credentials. Do not read browser cookies or use private ChatGPT web endpoints.
- For OpenAI-compatible requests, use Skill instructions as a system message. For ChatGPT plan requests, use the Responses API `instructions` field; connected upstream text and the node prompt remain user input.
- A referenced Skill that is missing or unavailable must remain visible and block execution until the user repairs the reference.
- Use one API request per run; preserve the existing AbortSignal pattern; a cancelled request must not become a successful result.
- Do not add marketplace, tool execution, Agent loops, arbitrary request limits, or unrelated refactors.

## Review Focus

- Malformed or incomplete SKILL.md frontmatter: preview returns a clear error and does not write files.
- Name collision during import: require review and explicit replacement confirmation; preserve revision conflict protection.
- Deleted, disabled, or unreachable Skill: show a warning and prevent a run using stale or omitted instructions.
- Empty upstream text: preserve the node's own prompt as the user message.
- Cancellation during streaming: keep partial output from being marked successful.

---

### Task 1: Add a non-mutating SKILL.md import preview

**Files:**
- Modify: canvas-agent/src/skills/store.ts
- Modify: canvas-agent/src/server/http.ts
- Modify: web/src/services/api/canvas-agent.ts

**Interfaces:**
- Produces: SkillStore.previewImport(document: string) -> { name: string; description: string; instructions: string }
- Produces: POST /agent/codex/skills/import-preview with body { document: string }, returning the parsed fields without changing disk state.
- Produces: previewCodexSkillImport(endpoint, token, document) in the existing web API client.

- [x] Add SkillStore.previewImport(document) using the existing gray-matter parsing and SkillStore validation rules. Require valid name, description, and non-empty instructions; do not create or overwrite a Skill.
- [x] Add the authenticated preview route beside the existing managed Skill routes and return the validated preview fields.
- [x] Add the frontend API helper and response type.
- [ ] Manually check a valid SKILL.md preview, invalid frontmatter, a missing description, and a document whose name collides with an existing Skill; preview must not mutate the store.

### Task 2: Import through the existing Skill editor

**Files:**
- Modify: web/src/components/agent/agent-skills-view.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Consumes: previewCodexSkillImport(endpoint, token, document) from Task 1.
- Produces: the existing Skill editor opens with the imported name, description, and instructions prefilled; save uses existing createCodexSkill or updateCodexSkill.
- Preserve: update requests use the currently fetched expectedRevision.

- [x] Add a hidden markdown file input and an Import SKILL.md action beside the current create actions. Read file content locally and send it only to the configured local Canvas Agent API for preview.
- [x] Open the existing editor with preview fields. For a new name, use create mode. For an existing managed name, fetch its current revision and require an explicit replace confirmation before opening the edit form.
- [x] Keep the imported name stable in edit mode and save by the existing API; preserve all existing form validation and revision conflict behavior.
- [ ] Manually check import-create, import-replace, cancel replacement, invalid file, and a revision conflict. No invalid or cancelled import may write a Skill.

### Task 3: Add Agent mode and persisted Skill references to text nodes

**Files:**
- Modify: web/src/types/canvas.ts
- Modify: web/src/components/canvas/canvas-node-prompt-panel.tsx
- Create: web/src/components/canvas/canvas-agent-step-settings.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Produces: CanvasNodeMetadata.agentMode?: boolean and CanvasNodeMetadata.agentSkillName?: string.
- Produces: a small Agent settings control for a Text node: enable/disable Agent mode and select a managed local Skill or no Skill.
- Stores only the Skill name in node metadata; resolve current Skill content at run time.

- [x] Add the two optional metadata fields without changing CanvasNodeType.Text or the current text-resource output schema.
- [x] Add a settings control visible for text nodes. Load managed Skills through existing useAgentStore connection details and fetchCodexSkills; list managed enabled Skills only.
- [x] Preserve a selected name that no longer appears in the current Skill list and show a visible missing/unavailable warning. Do not clear it during hydration or template import.
- [ ] Manually check regular text mode, Agent mode without a Skill, Agent mode with a Skill, and a deleted Skill reference.

### Task 4: Build and run one Agent request through the existing text path

**Files:**
- Modify: web/src/components/canvas/canvas-node-generation.ts
- Modify: web/src/pages/canvas/project.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Produces: buildAgentResponseMessages(userPrompt: string, skillInstructions?: string) -> AiTextMessage[]; when instructions exist, return system followed by user; otherwise return only user.
- Consumes: existing fetchCodexSkill, existing useEffectiveConfig, requestImageQuestion(config, messages, onDelta, { signal}), and the current text-node output metadata.
- Output: the Agent result remains a normal CanvasNodeType.Text resource and can feed existing downstream connections.

- [x] Add buildAgentResponseMessages with the exact system/user separation above. The user message is the existing composed prompt, including connected upstream text; never append Skill instructions into it.
- [x] In the existing text generation branch, when agentMode is true, fetch the selected managed Skill detail immediately before the request. Refresh the managed Skill list and verify the selected Skill still exists, is enabled, and is managed before fetching its current detail. If it is missing, disabled, or cannot be fetched, show a node error and do not call the LLM. A stale reference may only be repaired by selecting an available Skill or explicitly turning Agent mode off.
- [x] Call the existing OpenAI-compatible request helper with the existing configured channel/model and AbortSignal. Keep streaming/loading UI and the existing stop action.
- [x] Ensure an AbortError does not write a successful result; retain the text node's ordinary output/resource behavior for completed runs.
- [ ] Manually check a prompt with connected upstream text, Skill system message separation, an unavailable Skill blocking the call, successful downstream text consumption, API failure, and cancellation.
- [ ] Run the existing frontend typecheck and Canvas Agent build; do not add a second runtime or credential store.
