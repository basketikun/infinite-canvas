# Canvas Skill Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class Skill nodes that run the selected local Skill on connected text, support branching and chaining, and do not require users to restate the Skill's task in a prompt field.

**Architecture:** Add `CanvasNodeType.Skill` as a built-in text-resource node. Reuse the canvas connection/reference system, Canvas Agent Skill API, current Agent/model configuration, text rendering, and workflow-template store. Route Skill-node runs through the existing text Agent request path while writing the result into the Skill node itself.

**Tech Stack:** React, TypeScript, Vite, Zustand, Canvas Agent HTTP API, existing canvas node and workflow-template code.

**Spec:** `docs/superpowers/specs/2026-10-09-canvas-skill-nodes-design.md`

## Global Constraints

- Keep the implementation within the existing canvas and Canvas Agent. Do not add another Agent runtime, workflow engine, or Skill marketplace.
- A Skill node calls the currently configured Canvas Agent provider and model. Reuse the existing provider/model selection and defaults; do not add another credential or model configuration system.
- A Skill node has no task prompt field. Text from incoming connections is sent as content to process according to the selected Skill, whose instructions are fetched from Canvas Agent and used as system instructions.
- Store only the selected Skill name and existing Agent provider/model settings on the node. Fetch Skill instructions at generation time through the existing Canvas Agent API; do not duplicate Skill bodies or credentials in canvas data.
- Multiple Skill nodes may connect to the same source text. Each node executes independently with its own selected Skill and provider/model settings.
- A Skill node may connect to another Skill node. The downstream node processes the upstream node's generated text according to its selected Skill.
- Existing saved Agent text nodes with a Skill assignment continue to use that stored assignment. Do not automatically convert or migrate them.
- A saved workflow keeps Skill selection, provider/model settings, and graph connections, while clearing generated text content when reopened, consistent with existing text-node template behavior.
- Do not stage or overwrite unrelated pre-existing changes in the shared worktree.
- The repository asks not to run tests or builds after changes; use the manual verification steps below unless the user requests automated verification.

## Review Focus

- A selected Skill is deleted, disabled, or the local Canvas Agent disconnects: the node warns, generation is blocked, and the user can reselect an available Skill. (Task 2 manual check.)
- A Skill node has no incoming text: it can still run according to its selected Skill instructions using available context, without treating an empty reference as an error. (Task 3 manual check.)
- Two Skill nodes share an upstream article: running or editing one must not overwrite the other node or the source. (Task 3 manual check.)
- A Skill node is chained after another Skill node: the connected upstream result is supplied as content to process according to the downstream Skill, without requiring an additional prompt. (Task 3 manual check.)
- A saved workflow contains a Skill node whose Skill later disappears: the template retains the selection and opens with a visible warning rather than silently removing it. (Task 4 manual check.)

---

### Task 1: Register Skill as a built-in text resource node

**Files:**
- Modify: `web/src/types/canvas.ts`
- Modify: `web/src/constant/canvas.ts`
- Modify: `web/src/components/canvas/nodes/builtin-nodes.tsx`
- Modify: `web/src/components/canvas/canvas-node.tsx`
- Modify: `web/src/components/canvas/canvas-create-menus.tsx`
- Modify: `web/src/pages/canvas/project.tsx`
- Modify: `web/src/lib/canvas/canvas-resource-references.ts`
- Modify: `web/src/components/canvas/canvas-node-hover-toolbar.tsx`
- Modify: `web/src/components/canvas/canvas-side-panel.tsx`
- Modify: `web/src/lib/canvas/canvas-export.ts`

**Interfaces:**
- Consumes: existing `CanvasNodeData`, `CanvasNodeDefinition.resource`, and `CanvasConnection` contracts.
- Produces: `CanvasNodeType.Skill = "skill"`, `CanvasNodeMetadata.skillName?: string`, and a built-in Skill node definition whose text resource contains generated `metadata.content` only. Any legacy or optional prompt metadata remains separate and is never exposed as generated output.

- [x] Add the Skill node type, its text-sized default dimensions, and built-in definition with a Skill icon/title and text resource.
- [x] Route Skill nodes through the existing text renderer, scrolling, copy action, reference bar, left-panel text display/filter, and text export behavior.
- [x] Add Skill to both node creation menus and open its lower settings panel when created; omit the task prompt input and keep it connectable from either side.
- [ ] Manually create a Skill node from the blank-canvas menu and from a connection menu; connect a text node to it and confirm the upstream text appears in its reference bar.

### Task 2: Add Skill selection and Agent settings to the node panel

**Files:**
- Modify: `web/src/components/canvas/canvas-agent-step-settings.tsx`
- Modify: `web/src/components/canvas/canvas-node-prompt-panel.tsx`
- Modify: `web/src/pages/canvas/project.tsx`
- Modify: `web/src/i18n/locales/zh-CN.ts`
- Modify: `web/src/i18n/locales/en-US.ts`

**Interfaces:**
- Consumes: `CanvasNodeMetadata.skillName`, `CanvasAgentProvider`, `canvasAgentDefaults`, `fetchCodexSkills`, and the existing model-picker APIs.
- Produces: a Skill-node settings view that selects one enabled, managed local Skill and updates `{ skillName?, agentProvider?, model? }`; ordinary newly created Agent text nodes do not show a Skill selector.

- [x] Reuse the existing provider/model selection and defaults for Skill nodes; keep the existing Agent toggle for ordinary Agent text nodes.
- [x] Show a Skill selector on Skill nodes using enabled, managed results from `fetchCodexSkills`; store only the selected Skill name.
- [x] Show a visible missing/unavailable warning for a saved selection and allow replacement. Block generation while the selected Skill cannot be resolved.
- [x] Preserve execution of existing text nodes with `agentSkillName` metadata without converting their node type; new ordinary Agent text nodes should not offer Skill selection.
- [ ] Manually select a Skill and provider/model, reload the canvas, and confirm the settings persist; then disconnect the local Agent or remove the selected Skill and confirm the warning appears.

### Task 3: Execute Skill-node generation through the existing Agent path

**Files:**
- Modify: `web/src/components/canvas/canvas-node-generation.ts`
- Modify: `web/src/pages/canvas/project.tsx`
- Modify: `web/src/components/canvas/canvas-node-prompt-panel.tsx`

**Interfaces:**
- Consumes: `NodeGenerationContext.referenceTexts`, `fetchCodexSkill`, `requestImageQuestion`, `requestChatGPTPlanResponse`, the existing `AbortSignal` request lifecycle, and Task 2's `{ skillName, agentProvider, model }` settings.
- Produces: `buildSkillNodeResponseMessages(userInstruction: string, skillInstructions: string, references: Array<{ title: string; text: string }>): AiTextMessage[]`; a Skill-node run writes successful text to that node's `metadata.content`. Its prompt is optional and omitted from the Skill node UI.

- [x] Add a Skill-node message builder that places Skill instructions in the system message and connected text in a labeled user-content message. Do not require a separate user instruction. Keep the existing multi-box Agent message format unchanged.
- [x] Route Skill nodes through text generation with the node's selected provider/model and selected Skill; fetch current Skill instructions at run time and stop before the request if the Skill is unavailable.
- [x] Keep incoming text separate from Skill instructions. Permit an empty reference list so the selected Skill can still run without connected text.
- [x] Write the response into the same Skill node; reuse loading, cancellation, error, and retry behavior without creating an extra result node. Preserve the existing legacy Agent text-node Skill path.
- [ ] Manually verify OpenAI-compatible and ChatGPT-subscription providers; test one article branching into two Skill nodes, one Skill node chained to another, no incoming text, cancellation, and source/result isolation.

### Task 4: Preserve Skill-node settings in reusable workflows and document acceptance

**Files:**
- Modify: `web/src/lib/canvas/workflow-template.ts`
- Modify: `CHANGELOG.md`
- Review: `docs/content/docs/progress/todo.mdx`
- Modify: `docs/content/docs/progress/pending-test.mdx`

**Interfaces:**
- Consumes: `CanvasNodeType.Skill`, `CanvasNodeMetadata.skillName`, and the existing graph-only workflow-template serialization.
- Produces: saved Skill nodes that retain `skillName`, provider/model, and connections while clearing generated content and transient status on reopen.

- [x] Extend graph-only template handling so Skill nodes keep their settings and have generated `content`, `status`, and `errorDetails` cleared, matching Text-node behavior.
- [x] Check whether TODO already lists this feature; it does not. Add one concise Unreleased changelog entry and a manual acceptance checklist for branching, chaining, missing Skills, provider/model behavior, and workflow reopen.
- [ ] Manually save and reopen a workflow containing branched and chained Skill nodes; confirm settings and edges persist, result text is empty, and a missing Skill remains selected with a warning.
