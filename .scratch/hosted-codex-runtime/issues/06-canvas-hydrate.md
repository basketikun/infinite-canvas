# GET /canvas restores confirmed snapshot on refresh

Status: resolved
Type: task
Blocked by:

## Spec

Story 13: confirmed ops persist with a new revision so refresh restores the same canvas. Server snapshot is durable; browser is editing truth. Do not document this as cloud sync.

## Work

- `hostedAgentApi.readCanvas` → `GET /v1/projects/:id/canvas` (route already exists).
- Hosted project hook: GET before PUT. If server revision is ahead, or local canvas is empty, apply nodes/connections and the server revision via `useCanvasStore.setState` (do not increment revision). Then existing PUT republishes to CanvasBridge.

## Test

Observable via hook order: no PUT until GET settles. Restore sets revision rather than incrementing it.

## Answer

`hostedAgentApi.readCanvas` plus `useHostedAgentProject` GET-before-PUT. Local-ahead canvases are not overwritten. Not documented as cloud sync.

