# Hosted Codex Runtime — map

## Notes

- Spec: `docs/design/hosted-codex-runtime.md`
- Work on `feat/hosted-codex-runtime`. Do not overwrite unrelated WIP.
- Canvas truth: server snapshot is durable; browser is editing truth. GET hydrate restores when local is empty or behind.

## Decisions-so-far

- Product Project Skills ≠ nine node Skills. Codex writes enabled skills into `workspace/.agents/skills/<name>/SKILL.md`.
- Product events: `tool.updated` payload is `{ toolName, update }`, never the Codex JSON-RPC envelope.
- Parallel routing is `threadId` only; no `turns.size === 1` fallback.
- `initialize` failure must `dispose()` the child before dropping the runtime map entry.
- `spawnCodexProcess` is the cwd/`CODEX_HOME` seam; tests inject spawn, never start a real Codex binary.
- Story 13 hydrate: GET `/v1/projects/:id/canvas` before PUT; restore when server is ahead or local is empty. Not cloud sync.


## Fog

- Idle recycle, max runtimes, timeouts, token TTL remain unset.
