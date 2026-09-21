# Route parallel notifications only by threadId

Status: resolved
Type: task
Blocked by:

## Spec

Story 9: different Conversations run in parallel. Notifications must not leak across threads.

## Work

`turnForNotification` in `agent-api/src/codex/runtime.ts`: return the turn for `params.threadId` only. Remove `turns.size === 1` fallback.

## Test

Existing parallel-turn test already sends `threadId`. Add a case: notification without `threadId` is dropped even if exactly one turn is active.

## Answer

`turnForNotification` only looks up `params.threadId`. Covered by “缺少 threadId 的通知不会落到唯一活跃 turn”.

