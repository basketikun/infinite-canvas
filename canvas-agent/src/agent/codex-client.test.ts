import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppClient } from "./codex-client.js";

type TestClient = {
    currentThreadId: string;
    currentTurnId: string;
    completedTurns: Map<string, Error | null>;
    plansByTurn: Map<string, unknown>;
    lastUsage: unknown;
    answerServerRequest(message: Record<string, unknown>): void;
    failAll(message: string): void;
    handle(message: Record<string, unknown>): void;
    handleNotification(method: string, params: Record<string, unknown>): void;
};

const emptyEventHistory = { record: () => Promise.resolve(), recordTurn: () => Promise.resolve() };

test("审批只在 app-server 确认 resolved 后清除", () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.answerServerRequest({ id: 17, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1" } });
    assert.equal(events.filter((item) => item.type === "codex_approval").length, 1);

    assert.equal(client.resolveApproval("17", "accept"), true);
    assert.equal(writes.length, 1);
    assert.equal(events.some((item) => item.type === "codex_approval_resolved"), false);
    assert.equal(client.resolveApproval("17", "accept"), true);
    assert.equal(writes.length, 1);

    testClient.handleNotification("serverRequest/resolved", { requestId: "17" });
    const resolved = events.find((item) => item.type === "codex_approval_resolved");
    assert.deepEqual(resolved?.payload, { threadId: "thread-1", turnId: "turn-1", requestId: "17", decision: "accept" });
    assert.equal(client.resolveApproval("17", "accept"), false);
});

test("中断请求只作用于当前运行线程", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    testClient.currentThreadId = "thread-1";
    testClient.currentTurnId = "turn-1";

    assert.equal(await client.interruptCurrentTurn("thread-2"), false);
    assert.equal(writes.length, 0);

    const interrupt = client.interruptCurrentTurn("thread-1");
    const request = writes.find((item) => item.method === "turn/interrupt");
    assert.ok(request);
    testClient.handle({ id: request.id, result: {} });
    assert.equal(await interrupt, true);
});

test("turn/started 早于 turn/start 响应时保持完整事件归属", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const turnIds: string[] = [];
    const running = client.startTurn("thread-1", "测试", [], "request", undefined, undefined, (turnId) => turnIds.push(turnId));
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);

    testClient.handleNotification("turn/started", { turn: { id: "turn-1", status: "inProgress" } });
    assert.deepEqual(turnIds, ["turn-1"]);
    testClient.handleNotification("item/started", { item: { id: "reasoning-1", type: "reasoning" } });
    testClient.handleNotification("turn/completed", { turn: { id: "turn-1", status: "completed" } });
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await running;

    assert.deepEqual(turnIds, ["turn-1"]);
    const scopedEvents = events.filter((item) => item.type === "agent_event");
    assert.deepEqual(scopedEvents.map((item) => eventScope(item.payload)), [
        { threadId: "thread-1", turnId: "turn-1" },
        { threadId: "thread-1", turnId: "turn-1" },
        { threadId: "thread-1", turnId: "turn-1" },
    ]);
    assert.deepEqual(eventScope(events.find((item) => item.type === "agent_done")?.payload), { threadId: "thread-1", turnId: "turn-1" });
});

test("turn/start 响应早于通知时 onTurn 仍只调用一次", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    const turnIds: string[] = [];

    const running = client.startTurn("thread-1", "测试", [], "request", undefined, undefined, (turnId) => turnIds.push(turnId));
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(turnIds, ["turn-1"]);

    testClient.handleNotification("turn/started", { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } });
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await running;

    assert.deepEqual(turnIds, ["turn-1"]);
    assert.equal(events.filter((item) => item.type === "agent_event" && eventType(item.payload) === "turn.started").length, 1);
});

test("turn/started 通知缺失时使用 turn/start 响应回调", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    const turnIds: string[] = [];

    const running = client.startTurn("thread-1", "测试", [], "request", undefined, undefined, (turnId) => turnIds.push(turnId));
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(turnIds, ["turn-1"]);
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await running;
    assert.deepEqual(turnIds, ["turn-1"]);
});

test("onTurn 按 threadId 和 turnId 去重", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    const turnIds: string[] = [];

    const first = client.startTurn("thread-1", "测试", [], "request", undefined, undefined, (turnId) => turnIds.push(`thread-1:${turnId}`));
    const firstRequest = writes.find((item) => item.method === "turn/start");
    assert.ok(firstRequest);
    testClient.handle({ id: firstRequest.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/started", { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } });
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await first;

    const second = client.startTurn("thread-2", "测试", [], "request", undefined, undefined, (turnId) => turnIds.push(`thread-2:${turnId}`));
    const secondRequest = writes.filter((item) => item.method === "turn/start").at(-1);
    assert.ok(secondRequest);
    testClient.handle({ id: secondRequest.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/started", { threadId: "thread-2", turn: { id: "turn-1", status: "inProgress" } });
    testClient.handleNotification("turn/completed", { threadId: "thread-2", turn: { id: "turn-1", status: "completed" } });
    await second;

    assert.deepEqual(turnIds, ["thread-1:turn-1", "thread-2:turn-1"]);
});

test("稀疏的命令完成通知会保留开始通知中的命令内容", () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const persisted: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: (entry: unknown) => (persisted.push(entry), Promise.resolve()) };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/started", { threadId: "thread-1", turnId: "turn-1", item: { id: "command-1", type: "commandExecution", command: "Get-Location", cwd: "D:\\infinite-canvas" } });
    testClient.handleNotification("item/commandExecution/outputDelta", { threadId: "thread-1", turnId: "turn-1", itemId: "command-1", delta: "D:\\infinite-canvas" });
    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "command-1", type: "commandExecution", status: "completed", exitCode: 0 } });

    const completed = events.find((event) => event.type === "agent_event" && eventType(event.payload) === "item.completed");
    const item = (completed?.payload as { item?: Record<string, unknown> })?.item;
    assert.equal(item?.command, "Get-Location");
    assert.equal(item?.cwd, "D:\\infinite-canvas");
    assert.equal(item?.status, "completed");
    assert.equal(item?.aggregatedOutput, "D:\\infinite-canvas");
    assert.deepEqual(persisted, [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        sequence: 1,
        item,
    }]);
});

test("稀疏的 plan 完成通知会保留流式正文", () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const persisted: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: (entry: unknown) => (persisted.push(entry), Promise.resolve()), recordTurn: () => Promise.resolve() };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/plan/delta", { threadId: "thread-1", turnId: "turn-1", itemId: "plan-1", delta: "第一步\n第二步" });
    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "plan-1", type: "plan", status: "completed" } });

    const completed = events.find((event) => event.type === "agent_event" && eventType(event.payload) === "item.completed");
    assert.equal((completed?.payload as { item?: { text?: string } })?.item?.text, "第一步\n第二步");
    assert.equal(((persisted[0] as { item?: { text?: string } })?.item?.text), "第一步\n第二步");
});

test("reasoning 完成通知缺少 summary 时保留流式摘要", () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const persisted: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: (entry: unknown) => (persisted.push(entry), Promise.resolve()), recordTurn: () => Promise.resolve() };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/reasoning/summaryTextDelta", { threadId: "thread-1", turnId: "turn-1", itemId: "reasoning-1", summaryIndex: 0, delta: "分析结果" });
    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "reasoning-1", type: "reasoning", status: "completed" } });

    const completed = events.find((event) => event.type === "agent_event" && eventType(event.payload) === "item.completed");
    assert.equal((completed?.payload as { item?: { summary?: string } })?.item?.summary, "分析结果");
    assert.equal(((persisted[0] as { item?: { summary?: string } })?.item?.summary), "分析结果");
});

test("流式更新只发送当前增量而不重复传输累计正文", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: () => true } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", itemId: "assistant-1", delta: "第一段" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    testClient.handleNotification("item/agentMessage/delta", { threadId: "thread-1", turnId: "turn-1", itemId: "assistant-1", delta: "第二段" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const updates = events.filter((event) => event.type === "agent_event" && eventType(event.payload) === "item.updated");
    assert.deepEqual(updates.map((event) => (event.payload as { item: { delta?: string; text?: string } }).item), [
        { id: "assistant-1", type: "agent_message", delta: "第一段" },
        { id: "assistant-1", type: "agent_message", delta: "第二段" },
    ]);
});

test("新版协作工具完成通知会归一化并写入补充历史", () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const persisted: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: (entry: unknown) => (persisted.push(entry), Promise.resolve()), recordTurn: () => Promise.resolve() };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "collab-1", type: "collabAgentToolCall", status: "completed" } });

    const completed = events.find((event) => event.type === "agent_event" && eventType(event.payload) === "item.completed");
    assert.equal((completed?.payload as { item?: { type?: string } })?.item?.type, "collab_tool_call");
    assert.equal(((persisted[0] as { item?: { type?: string } })?.item?.type), "collab_tool_call");
});

test("并行条目按开始顺序保存而不是完成顺序", () => {
    const persisted: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: (entry: unknown) => (persisted.push(entry), Promise.resolve()) };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("item/started", { threadId: "thread-1", turnId: "turn-1", item: { id: "first", type: "commandExecution", command: "first" } });
    testClient.handleNotification("item/started", { threadId: "thread-1", turnId: "turn-1", item: { id: "second", type: "commandExecution", command: "second" } });
    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "second", type: "commandExecution", status: "completed" } });
    testClient.handleNotification("item/completed", { threadId: "thread-1", turnId: "turn-1", item: { id: "first", type: "commandExecution", status: "completed" } });

    assert.deepEqual(persisted.map((entry) => ({ itemId: (entry as { itemId: string }).itemId, sequence: (entry as { sequence: number }).sequence })), [
        { itemId: "second", sequence: 2 },
        { itemId: "first", sequence: 1 },
    ]);
});

test("turn 完成通知会保存本轮输入与终态 turn", async () => {
    const persistedTurns: unknown[] = [];
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const history = { record: () => Promise.resolve(), recordTurn: (entry: unknown) => (persistedTurns.push(entry), Promise.resolve()) };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const running = client.startTurn("thread-1", "执行 Get-Location", [], "request");
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed", durationMs: 120 } });
    await running;

    assert.deepEqual(persistedTurns, [{ threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed", durationMs: 120, input: "执行 Get-Location" } }]);
});

test("turn 完成状态会等待补充历史落盘后再广播", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => { release = resolve; });
    const child = { stdin: { write: () => true } };
    const history = { record: () => Promise.resolve(), recordTurn: () => persisted };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    assert.equal(events.some((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed"), false);
    assert.equal(events.some((event) => event.type === "agent_done"), false);

    release();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(events.some((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed"), true);
    assert.equal(events.some((event) => event.type === "agent_done"), true);
});

test("app-server 失效时清除不能跨进程复用的 turn 状态", () => {
    const child = { stdin: { write: () => true } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    testClient.completedTurns.set("thread-1\0turn-1", null);
    testClient.plansByTurn.set("thread-1\0turn-1", { threadId: "thread-1" });
    testClient.lastUsage = { inputTokens: 1 };

    testClient.failAll("app-server stopped");

    assert.equal(testClient.completedTurns.size, 0);
    assert.equal(testClient.plansByTurn.size, 0);
    assert.equal(testClient.lastUsage, null);
});

test("app-server 在 turn 完成通知前退出时保存失败终态", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const persistedTurns: unknown[] = [];
    const child = { stdin: { write: () => true } };
    const history = { record: () => Promise.resolve(), recordTurn: (entry: unknown) => (persistedTurns.push(entry), Promise.resolve()) };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const running = client.startTurn("thread-1", "执行失败任务", [], "request");
    testClient.handle({ id: 1, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.failAll("Codex app-server exited: 1");
    await assert.rejects(running, /Codex app-server exited/);

    assert.deepEqual(persistedTurns, [{
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", status: "failed", error: { message: "Codex app-server exited: 1" }, input: "执行失败任务" },
    }]);
    const completed = events.find((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed");
    assert.equal((completed?.payload as { status?: string })?.status, "failed");
});

test("turn/started 已到达但 turn/start 尚未响应时退出仍保存失败终态", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const persistedTurns: unknown[] = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const history = { record: () => Promise.resolve(), recordTurn: (entry: unknown) => (persistedTurns.push(entry), Promise.resolve()) };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const running = client.startTurn("thread-1", "响应前退出", [], "request");
    assert.ok(writes.some((item) => item.method === "turn/start"));
    testClient.handleNotification("turn/started", { threadId: "thread-1", turn: { id: "turn-1", status: "inProgress" } });
    testClient.failAll("Codex app-server exited: 1");
    await assert.rejects(running, /Codex app-server exited/);

    assert.deepEqual(persistedTurns, [{
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", status: "failed", error: { message: "Codex app-server exited: 1" }, input: "响应前退出" },
    }]);
    assert.equal(events.some((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed"), true);
    assert.equal(events.some((event) => event.type === "agent_done"), true);
});

test("app-server 退出时等待失败历史落盘后再结束 turn", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => { release = resolve; });
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const history = { record: () => Promise.resolve(), recordTurn: () => persisted };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const running = client.startTurn("thread-1", "等待落盘", [], "request");
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    let settled = false;
    const outcome = running.then(() => { settled = true; }, () => { settled = true; });

    testClient.failAll("Codex app-server exited: 1");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(events.some((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed"), false);
    assert.equal(events.some((event) => event.type === "agent_done"), false);

    release();
    await outcome;
    assert.equal(settled, true);
    assert.equal(events.some((event) => event.type === "agent_event" && eventType(event.payload) === "turn.completed"), true);
    assert.equal(events.some((event) => event.type === "agent_done"), true);
});

function eventScope(payload: unknown) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    return { threadId: value.thread_id, turnId: value.turn_id };
}

function eventType(payload: unknown) {
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>).type : undefined;
}
