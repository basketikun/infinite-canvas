# Reusable Canvas Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Let users explicitly save a completed canvas graph as a named reusable workflow and open it later as an independent project copy.

**Architecture:** Persist a small workflow-template collection alongside the existing browser-local app state. Templates contain graph nodes and connections only. Add a named save dialog to the active canvas and a template list to the canvas library; opening a template clones the graph and imports a new project through the existing Canvas store.

**Tech Stack:** React 19, TypeScript, Ant Design, Zustand persist, localForage, existing CanvasProject and CanvasNodeData models.

**Spec:** docs/superpowers/specs/2026-10-07-infinite-canvas-custom-feature-design.md

## Global Constraints

- A workflow is the active CanvasProject nodes and connections; do not add a workflow engine or runner.
- Saving requires an explicit user action, a name, and confirmation; disable it while generation is active.
- Templates store graph configuration only; never store API keys or duplicate media Blob data.
- A template keeps local media storageKey references so the existing browser media can be reused; garbage collection must retain referenced media while a template exists.
- Opening a template creates an independent project copy; preserve existing graph and local storage contracts.
- If a model channel reference no longer exists, ask before using the current configured connection; do not silently remap it.
- Keep a missing Agent Skill reference visible and repairable; never silently omit its instructions.
- Do not add cloud sync, broad migration machinery, or unrelated project changes.

## Review Focus

- Save while a generation is running: action is disabled and no partial workflow is stored.
- Empty or whitespace template name: block save and keep the dialog open.
- Reuse a template: node edits, moves, and connection edits do not change the saved template.
- Template retains media storageKey but no Blob copy: media remains accessible until the template is deleted.
- Missing model channel or Skill: show a repair/selection prompt before a run can use the template.

---

### Task 1: Define and persist graph-only workflow templates

**Files:**
- Create: web/src/types/canvas-workflow-template.ts
- Create: web/src/stores/canvas/use-canvas-workflow-template-store.ts
- Create: web/src/lib/canvas/workflow-template.ts
- Modify: web/src/stores/use-asset-store.ts

**Interfaces:**
- Produces: CanvasWorkflowTemplate { id: string; title: string; createdAt: string; nodes: CanvasNodeData[]; connections: CanvasConnection[] }.
- Produces: buildWorkflowTemplate(title, nodes, connections) -> CanvasWorkflowTemplate.
- Produces: instantiateWorkflowTemplate(template) -> Partial<CanvasProject> with fresh node IDs, remapped connection endpoints, empty chatSessions, null activeChatId, and no stored media Blobs or credentials.
- Produces: a persisted store with hydrated, templates, saveTemplate(template), and deleteTemplate(id).

- [x] Define the template as title, createdAt, nodes, and connections only. Preserve media storageKey references inside node metadata, but never serialize Blob/File values or config-store API keys.
- [x] Persist templates using the project's existing localForage-backed Zustand pattern under a new store key. Do not modify historical CanvasProject data.
- [x] Implement buildWorkflowTemplate and instantiateWorkflowTemplate. Generate fresh node IDs and remap connection endpoints and group membership IDs; deep-clone node metadata so later edits are independent.
- [x] Extend the existing unused-media collection input to include hydrated template nodes. Track template-store hydration; defer media collection until templates have rehydrated, then invoke the existing cleanup path once.
- [ ] Manually check persistence after reload, independent node/connection copies, media reference retention, and media cleanup after deleting the final project/template reference.

### Task 2: Add confirmed save-to-template action on the active canvas

**Files:**
- Create: web/src/components/canvas/canvas-save-workflow-dialog.tsx
- Modify: web/src/components/canvas/canvas-top-bar.tsx
- Modify: web/src/pages/canvas/project.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Consumes: saveTemplate(template) and buildWorkflowTemplate(title, nodes, connections) from Task 1.
- Produces: onSaveWorkflow and canSaveWorkflow props on CanvasTopBar.
- Produces: an explicit dialog with a required name field and a Save action.

- [x] Derive generation-active state from current node/request status. Disable the top-bar action whenever any canvas generation request is active.
- [x] Add a “Save as reusable workflow” action that opens the dialog; do not save automatically after generation.
- [x] Require a non-empty trimmed name and an explicit Save confirmation. Store the current nodes and connections only.
- [ ] Manually check the action disabled while text/image/audio/video generation is active, validation for a blank name, cancel without save, and successful named save.

### Task 3: List, open, and delete saved workflows

**Files:**
- Create: web/src/components/canvas/canvas-workflow-template-card.tsx
- Modify: web/src/pages/canvas/index.tsx
- Modify: web/src/i18n/locales/zh-CN.ts
- Modify: web/src/i18n/locales/en-US.ts

**Interfaces:**
- Consumes: persisted templates and instantiateWorkflowTemplate(template) from Task 1.
- Produces: a reusable-workflows section in the existing canvas library.
- Produces: opening a template imports a separate CanvasProject; deleting it removes only the template.

- [x] Add a compact template card showing its name and open/delete actions. Ask for confirmation before deleting a template.
- [x] On open, instantiate a fresh graph and call the existing importProject action; do not edit the source template.
- [x] Before opening, inspect node metadata.model using decodeChannelModel against configured channel IDs. If a referenced channel is missing, ask whether to use the current configured connection or cancel; after confirmation, resolve the node model through the existing resolveModelForCapability helper. Never persist the configured channel object or credentials in the template.
- [x] Preserve Agent Skill names in the graph. If a referenced Skill is missing, keep the node warning visible and block Agent execution until the user selects an available Skill.
- [ ] Manually check opening the same template twice, canceling a missing-channel prompt, choosing a configured connection, deleting a template, and resolving a missing Skill.
- [ ] Run the existing frontend typecheck and production build.
