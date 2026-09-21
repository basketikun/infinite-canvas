# Dispose transport if Codex initialize fails

Status: resolved
Type: task
Blocked by:

## Spec

`docs/design/hosted-codex-runtime.md` — User×Project 1:1 Runtime; crashed/failed spawn must not leave a live child or a stuck map entry. Story 18.

## Work

In `agent-api/src/codex/runtime.ts` `spawn()`: if `initialize()` throws, call `runtime.dispose()` (which closes the JSON-RPC client and kills the transport) then rethrow. `getOrCreate` already deletes the map entry on catch.

## Test

`agent-api/src/codex-runtime.test.ts`: scripted transport that fails `initialize`; assert `dispose()` ran and a later turn can spawn again.

## Answer

`CodexRuntimeAdapter.spawn` now `dispose()`s on initialize failure. Covered by “initialize 失败会 dispose 子进程，下一 turn 可重建”.

