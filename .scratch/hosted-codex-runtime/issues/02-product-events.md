# Product events without Codex JSON-RPC

Status: resolved
Type: task
Blocked by:

## Spec

Story 20 / Events: Browser sees only product events. Codex JSON-RPC stays inside the adapter.

## Work

`agent-api/src/codex/events.ts`: `tool.updated` must emit `{ toolName, update }` like Pi, never `{ update: <raw params> }`. Do not put `threadId`, `item`, or the notification envelope in `payload`.

## Test

Assert mapped `tool.updated` has `toolName` and product `update`, and does not contain the JSON-RPC params object.

## Answer

`mapCodexNotification` emits `{ toolName, update }` for `tool.updated`. Covered by “产品事件不含 Codex JSON-RPC 原文”.

