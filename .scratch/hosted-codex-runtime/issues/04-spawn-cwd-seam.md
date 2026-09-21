# spawnCodexProcess records cwd and CODEX_HOME

Status: resolved
Type: task
Blocked by:

## Spec

Testing Decisions seam 2: replaceable transport that records cwd and `CODEX_HOME`. Do not start a real Codex binary.

## Work

`agent-api/src/codex/process.ts`: inject spawn so tests can record `cwd` and `env.CODEX_HOME` (and API key env) without a binary.

## Test

In `codex-runtime.test.ts`, fake child process; assert spawn options.

## Answer

`spawnCodexProcess` accepts an injectable spawn. Covered by “spawnCodexProcess 把 cwd 和 CODEX_HOME 交给子进程”.

