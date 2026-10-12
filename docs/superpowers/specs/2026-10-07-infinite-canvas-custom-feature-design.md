# Infinite Canvas Feature Design

## Status and target

This design applies to the public `cheserdenae527-glitch/infinite-canvas` fork. The fork is checked out separately from the `work-canvas` prototype; the prototype remains untouched.

The target project is browser-first, already has an infinite canvas, audio/video nodes and local media storage, OpenAI-compatible text generation, a Canvas Agent, and local Skill support. Its Canvas Agent Skill manager already creates, edits, and deletes managed Skills through `SkillStore`; reuse that path and add file import rather than building a second manager. Extend existing canvas and API paths where possible. Keep the feature set small and avoid a second workflow engine, a second Agent system, or an online Skill marketplace.

## User goal

Add four capabilities to the existing canvas:

1. Manage Skills by adding, replacing, and deleting them.
2. Trim audio and video at whole-second boundaries, export the result, and copy it to another app when the browser supports that clipboard format.
3. Save a completed workflow for reuse only after the user confirms.
4. Call an OpenAI-compatible Agent API and use its result as input to later workflow steps.

## Design

### Skill management

- Keep existing Skill creation, editing, deletion, and revision checks.
- Add a Skill by importing a `SKILL.md` file into the existing editor; the user reviews and confirms the parsed content before create or replace.
- Let an Agent workflow node select a managed local Skill and use its instructions for the request.
- Do not add web search, a marketplace, version history, dependency execution, or a separate Skill format in this change.
- Preserve the current `.agents/skills` storage/API contract and existing Skill resource-file behavior. External read-only Skills remain usable by the local Codex panel but are not injected into an API request unless the existing local API can safely supply their instructions.
- If a saved workflow references a Skill that was deleted, retain the reference, show a visible missing-Skill warning, and let the user choose an available Skill. Never silently run without the referenced Skill.

### Audio and video trimming

- Provide a trim action from an existing audio or video asset/node.
- Keep the editing surface to one source, one start point, one end point, preview, export, and copy.
- Start and end values are whole seconds. Scrubbing snaps to whole seconds.
- Reject an empty or reversed range and a range beyond the source duration.
- Process media in the browser; do not upload it to a new service.
- Show processing/loading state, progress when available, and cancellation. Clean up temporary object URLs and worker state after success, failure, or cancellation.
- Export one media file in a format supported by the selected local processing path. The implementation plan must confirm supported input/output formats from the repository and chosen library before implementation.
- Attempt clipboard copy only when the browser reports support for that media MIME type. If it is unavailable or rejected, offer the exported file as a one-click download. Do not claim that every destination app can paste audio/video.
- No multitrack timeline, transitions, effects, waveform editor, batch clipping, or codec settings.

### Reusable workflows

- Add an explicit “Save as reusable workflow” action to the existing workflow/canvas interface.
- In this project, a workflow is the active canvas project’s nodes and connections; there is no separate workflow runner. The save action is disabled while canvas generation is active. Saving always requires a user confirmation and a name.
- Store the graph structure and node configuration as a reusable template. Do not automatically save a workflow or freeze the active canvas.
- Reusing a template creates an independent copy; edits to the copy do not change the saved template.
- Do not copy API keys or generated media binaries into the template. Reuse existing local connection references; if a reference is unavailable, ask the user to select a configured connection when opening the template.

### Agent node and ChatGPT subscription

- Add an explicit Agent step to the existing canvas. Back it with the current text-node data and generation path so its output remains a normal text resource; do not add a second graph runtime.
- Keep the existing OpenAI-compatible endpoint configuration (base URL, API key, and model) as the default provider.
- Add an optional ChatGPT subscription provider for a locally hosted canvas. Use Sign in with ChatGPT through a loopback OAuth/PKCE flow in the local Canvas Agent; never read ChatGPT browser cookies or call private ChatGPT web endpoints.
- Keep OAuth credentials in protected local storage managed by Canvas Agent. The browser canvas receives account display information and model names, never access or refresh tokens.
- Discover account models from the public `/v1/models` endpoint. Send text requests through the public Responses API with `store: false` and `stream: true`; use its `instructions` field for Skill content and user input for the composed upstream text and prompt.
- ChatGPT subscription mode is for text Agent requests. It does not provide access to ChatGPT conversations, API keys, files, or audio/video input. Keep the existing OpenAI-compatible provider available for other capabilities.
- The node receives connected upstream text, optionally applies a saved Skill, and returns text as a canvas result that can be connected to downstream nodes.
- Build the OpenAI-compatible request with the selected Skill instructions as the `system` message. For ChatGPT subscription requests, send those instructions in the Responses API `instructions` field. In both cases, send connected upstream text and the node prompt as user input.
- Use a single API request per run. Do not add tool execution, autonomous loops, multi-Agent orchestration, or a new backend.
- Keep OpenAI-compatible requests and their credentials in the browser; keep ChatGPT OAuth and subscription requests in the local Canvas Agent.
- Show a loading state and a stop action while the request runs; use the existing `AbortSignal` request pattern. A cancelled call must not be saved as a successful result.

## Persistence and compatibility

- Keep user data in the existing browser/local storage path used by the target project.
- Do not add cloud synchronization or cross-device Skill/workflow synchronization.
- This fork is in active development and its README says historical data compatibility is not guaranteed. Follow the current repository's data model; do not add broad migration machinery for this change.
- Preserve the upstream author attribution and existing frontend identity as required by the repository README.
- Do not add arbitrary size, duration, timeout, or retry limits. Any proposed limit and its default behavior requires a separate user decision.

## Acceptance criteria

- Existing managed Skill create/edit/delete behavior remains in use; a managed `SKILL.md` file can be imported, reviewed, and used to create a new Skill or replace an existing one.
- A missing/deleted Skill referenced by a saved workflow is visible and can be reassigned before the Agent request runs.
- A user can trim an audio/video asset with integer-second start/end points, preview it, and export a playable file.
- Copying the exported media works when the current browser supports its MIME type; otherwise the user can download it in one action.
- Saving a completed workflow requires an explicit confirmation; a saved workflow can be reopened as a separate copy.
- An Agent node can call the configured OpenAI-compatible API, show its text result on the canvas, and pass that result to a downstream node.
- A user can authorize a ChatGPT account from the local canvas, see the account’s available models, and use the subscription for a text Agent request without exposing OAuth tokens to the browser.
- The Agent request visibly separates Skill system instructions from upstream user content, shows loading, and can be cancelled.
- The user can tell whether media is being processed locally, whether clipboard copy succeeded, and whether an Agent request failed or was cancelled.

## Implementation constraints and unresolved repository details

- Implement only in the checked-out fork; leave the separate `work-canvas` prototype untouched.
- The app already uses Vite and stores media blobs in browser local storage. No video/audio trimming library is present. Compare browser recording APIs with a lazily loaded WebAssembly FFmpeg core; if using FFmpeg, verify Vite asset packaging and actual MIME/codec support. The current deployment configs do not set cross-origin isolation headers, so avoid a multi-thread core unless the user approves the required deployment changes.
- The current ffmpeg.wasm usage guide shows a core download around 31 MB and recommends the ESM core for Vite. Load the core on demand from the app bundle, not on the initial page load. If local trimming needs a materially larger bundle or deployment changes beyond that, show the concrete impact before changing scope. [Usage guide](https://ffmpegwasm.netlify.app/docs/getting-started/usage/)
- During planning, verify the existing Skill CRUD/storage interface, canvas project/connection model, media storage keys, and text request format. Prefer their current contracts. The repository is MIT licensed, while the official `@ffmpeg/core` package is GPL-2.0-or-later; treat that dependency as an explicit review gate before implementation, and do not add it until the maintainer confirms it fits the intended distribution.
- Do not add arbitrary file-size, duration, timeout, or retry limits without first presenting their impact and default behavior to the user.
