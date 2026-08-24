import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";

import { CanvasSession } from "./session.js";

test("MCP 读取当前激活网页的画布", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");

    session.activateClient("first");
    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-first");

    session.activateClient("second");
    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-second");
});

test("按精确 clientId 读取画布快照，不受当前焦点影响", (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.activateClient("second");

    assert.equal(field(session.canvasStateForClient("first"), "projectId"), "canvas-first");
    assert.equal(field(session.canvasStateForClient("second"), "projectId"), "canvas-second");
    assert.equal(session.canvasStateForClient("missing"), null);
    first.close();
    assert.equal(session.canvasStateForClient("first"), null);
});

test("画布写操作只发送给当前激活网页", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.activateClient("second");

    const result = session.callTool("canvas_create_text_node", { text: "只写入第二个画布" });
    const call = second.event("tool_call");
    assert.equal(first.event("tool_call"), undefined);
    assert.equal(field(call, "name"), "canvas_apply_ops");
    session.resolveResult("second", { requestId: String(field(call, "requestId")), result: { ok: true } });
    assert.deepEqual(await result, { ok: true });
});

test("当前 turn 的图片附件可在发起标签页画布创建图片节点", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    t.after(() => first.close());
    const dataUrl = "data:image/png;base64,aW1hZ2U=";
    session.setTurnAttachments("first", [{ id: "attachment-1", name: "商品.png", type: "image/png", size: 5, width: 1200, height: 600, dataUrl }]);
    session.bindClient("first");

    const result = session.callTool("canvas_create_attachment_nodes", { attachmentIds: ["attachment-1"], x: 100, y: 200 });
    const call = first.event("tool_call");
    const input = field(call, "input") as Record<string, unknown>;
    const nodes = input.nodes as Array<Record<string, unknown>>;
    assert.equal(field(call, "name"), "canvas_create_attachment_nodes");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].attachmentId, "attachment-1");
    assert.equal(nodes[0].title, "商品.png");
    assert.deepEqual(nodes[0].position, { x: 100, y: 200 });
    assert.equal(nodes[0].width, 640);
    assert.equal(nodes[0].height, 320);
    assert.equal("dataUrl" in nodes[0], false);
    assert.equal(session.getTurnAttachment("first", "attachment-1").dataUrl, dataUrl);

    session.resolveResult("first", { requestId: String(field(call, "requestId")), result: { ok: true } });
    const created = (await result) as { nodes: Array<{ id: string; attachmentId: string; title: string }> };
    assert.equal(created.nodes[0].id, nodes[0].id);
    assert.equal(created.nodes[0].attachmentId, "attachment-1");
    session.clearTurnAttachments("first");
    assert.throws(() => session.getTurnAttachment("first", "attachment-1"), /找不到/);
});

test("图片附件只允许发起 turn 的标签页读取和落入画布", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.setTurnAttachments("first", [{ id: "attachment-1", name: "商品.png", type: "image/png", dataUrl: "data:image/png;base64,aW1hZ2U=" }]);
    session.bindClient("second");

    await assert.rejects(session.callTool("canvas_create_attachment_nodes", { attachmentIds: ["attachment-1"] }), /发起标签页/);
    assert.throws(() => session.getTurnAttachment("second", "attachment-1"), /发起标签页/);
    assert.equal(first.event("tool_call"), undefined);
    assert.equal(second.event("tool_call"), undefined);
});

test("tool result is accepted only from the request client", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.activateClient("first");

    const result = session.callTool("canvas_create_text_node", { text: "first only" });
    const call = first.event("tool_call");
    const requestId = String(field(call, "requestId"));

    assert.equal(session.resolveResult("second", { requestId, result: { client: "second" } }), false);
    assert.equal(session.resolveResult("first", { requestId, result: { client: "first" } }), true);
    assert.deepEqual(await result, { client: "first" });
});

test("生成状态查询由当前激活网页返回", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.activateClient("second");

    const result = session.callTool("generation_get_status", { scope: "all" });
    const call = second.event("tool_call");
    assert.equal(first.event("tool_call"), undefined);
    assert.equal(field(call, "name"), "generation_get_status");
    session.resolveResult("second", { requestId: String(field(call, "requestId")), result: { total: 1, tasks: [{ id: "image-1", status: "running" }] } });
    assert.deepEqual(await result, { total: 1, tasks: [{ id: "image-1", status: "running" }] });
});

test("活动网页关闭后回退到仍连接的画布", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.activateClient("second");
    second.close();

    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-first");
});

test("closing the active client falls back to the most recently focused client", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    const third = connect(session, "third");
    t.after(() => {
        first.close();
        second.close();
        third.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.updateState(snapshot("canvas-third"), "third");
    session.activateClient("third");
    session.activateClient("second");
    second.close();

    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-third");
});

test("closing a client rejects its pending tool requests", async () => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const result = session.callTool("canvas_create_text_node", { text: "pending" });
    const call = first.event("tool_call");
    const requestId = String(field(call, "requestId"));
    first.close();

    const outcome = await Promise.race([
        result.then(() => "resolved", (error) => error instanceof Error ? error.message : String(error)),
        new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 20)),
    ]);
    if (outcome === "pending") session.resolveResult("first", { requestId, result: null });
    assert.match(outcome, /断开/);
});

test("shared thread events are broadcast with the active thread id", (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });

    session.emitThread("workspace_changed", "thread-2", { activeThreadId: "thread-2" });

    assert.deepEqual(first.event("workspace_changed"), { activeThreadId: "thread-2", threadId: "thread-2" });
    assert.deepEqual(second.event("workspace_changed"), { activeThreadId: "thread-2", threadId: "thread-2" });
});

test("new clients receive the current Codex state and later updates", (t) => {
    const session = new CanvasSession("thread-2");
    session.setCodexState({ busy: true, threadId: "thread-2", turnId: "turn-1" });
    session.trackCodexEvent("codex_approval", { requestId: "approval-1", threadId: "thread-2" });
    const client = connect(session, "first", "thread-2");
    t.after(() => client.close());

    const hello = client.event("hello");
    assert.equal(field(hello, "protocolVersion"), 6);
    assert.deepEqual(field(hello, "workspace"), { activeThreadId: "thread-2" });
    assert.deepEqual(field(hello, "conversation"), { revision: 1, conversationId: "thread-2", threadId: "thread-2", status: "ready", mcpStatuses: {} });
    assert.deepEqual(field(hello, "codex"), { busy: true, threadId: "thread-2", turnId: "turn-1" });
    assert.deepEqual(field(hello, "pendingApprovals"), [{ requestId: "approval-1", threadId: "thread-2" }]);

    session.trackCodexEvent("codex_approval_resolved", { requestId: "approval-1" });
    assert.deepEqual(session.codexPendingApprovals, []);
    session.trackCodexEvent("codex_approval", { requestId: "approval-2", threadId: "thread-2" });
    session.setCodexState({ busy: false });
    assert.deepEqual(session.codexPendingApprovals, [{ requestId: "approval-2", threadId: "thread-2" }]);
    session.trackCodexEvent("agent_error", { message: "app-server exited" });
    assert.deepEqual(session.codexPendingApprovals, []);
    assert.deepEqual(client.event("codex_state"), { busy: false, threadId: "thread-2", turnId: "turn-1" });
});

test("对话 revision 单调递增且 MCP 全部进入终态前保持 preparing", () => {
    const session = new CanvasSession();
    const revisions = [session.conversationStateSnapshot.revision];

    revisions.push(session.beginConversation({ sourceClientId: "first" }).revision);
    revisions.push(session.updateConversationMcp("late-service", "starting").revision);
    revisions.push(session.completeConversationMcpInventory([{ name: "infinite-canvas", authStatus: "unsupported" }]).revision);
    const pending = session.completeConversationPreparation("thread-1");
    revisions.push(pending.revision);
    assert.equal(pending.status, "preparing");

    const ready = session.updateConversationMcp("late-service", "ready");
    revisions.push(ready.revision);
    assert.equal(ready.status, "ready");
    assert.equal(ready.threadId, "thread-1");
    revisions.slice(1).forEach((revision, index) => assert.ok(revision > revisions[index]));
});

test("可选 MCP 失败进入 warning，画布 MCP 失败进入 failed", () => {
    const optionalFailure = new CanvasSession();
    optionalFailure.beginConversation();
    optionalFailure.completeConversationMcpInventory([
        { name: "infinite-canvas", authStatus: "unsupported" },
        { name: "notion", authStatus: "notLoggedIn" },
    ]);
    const warning = optionalFailure.completeConversationPreparation("thread-1");
    assert.equal(warning.status, "warning");
    assert.equal(warning.mcpStatuses.notion.status, "failed");

    const requiredFailure = new CanvasSession();
    requiredFailure.beginConversation();
    requiredFailure.completeConversationMcpInventory([{ name: "infinite-canvas", authStatus: "notLoggedIn" }]);
    const failed = requiredFailure.completeConversationPreparation("thread-2");
    assert.equal(failed.status, "failed");
    assert.match(failed.error || "", /Infinite Canvas MCP/);

    const requiredMissing = new CanvasSession();
    requiredMissing.beginConversation();
    requiredMissing.completeConversationMcpInventory([{ name: "notion", authStatus: "unsupported" }]);
    const missing = requiredMissing.completeConversationPreparation("thread-3");
    assert.equal(missing.status, "failed");
    assert.match(missing.error || "", /Infinite Canvas MCP/);
});

test("Codex 写操作在多窗口之间互斥且不能与运行 turn 并发", () => {
    const session = new CanvasSession();
    assert.equal(session.beginCodexMutation(), true);
    assert.equal(session.beginCodexMutation(), false);
    session.endCodexMutation();
    assert.equal(session.beginCodexMutation(), true);
    session.endCodexMutation();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    assert.equal(session.beginCodexMutation(), false);
});

test("Skill draft generation broadcasts shared busy state and restores the previous thread", (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.setCodexState({ threadId: "thread-1", turnId: "turn-previous" });
    const previous = session.codexStateSnapshot;

    assert.equal(session.beginCodexMutation(), true);
    session.setCodexState({ busy: true, threadId: previous.threadId, turnId: "" }, { preserveReplay: true });
    assert.deepEqual(first.events("codex_state").at(-1), { busy: true, threadId: "thread-1", turnId: "" });
    assert.deepEqual(second.events("codex_state").at(-1), { busy: true, threadId: "thread-1", turnId: "" });
    assert.equal(session.beginCodexMutation(), false);

    session.setCodexState(previous, { preserveReplay: true });
    session.endCodexMutation();
    assert.deepEqual(first.events("codex_state").at(-1), previous);
    assert.deepEqual(second.events("codex_state").at(-1), previous);
    assert.equal(session.beginCodexMutation(), true);
    session.endCodexMutation();
});

test("Skill draft busy state preserves the previous turn replay until history acknowledges it", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", text: "回答" } });
    session.setCodexState({ busy: false });
    const previous = session.codexStateSnapshot;

    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "" }, { preserveReplay: true });
    session.setCodexState(previous, { preserveReplay: true });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    assert.equal(client.events("agent_event").length, 1);
});

test("a bound client remains the tool target while focus changes", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.bindClient("first");
    session.activateClient("second");

    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-first");
    const result = session.callTool("canvas_create_text_node", { text: "bound" });
    const call = first.event("tool_call");
    assert.equal(second.event("tool_call"), undefined);
    session.resolveResult("first", { requestId: String(field(call, "requestId")), result: { ok: true } });
    assert.deepEqual(await result, { ok: true });

    session.releaseClient("first");
    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-second");
});

test("a disconnected bound client never falls back and can resume with the same client id", async (t) => {
    const session = new CanvasSession();
    const first = connect(session, "first");
    const second = connect(session, "second");
    t.after(() => {
        first.close();
        second.close();
    });
    session.updateState(snapshot("canvas-first"), "first");
    session.updateState(snapshot("canvas-second"), "second");
    session.bindClient("first");
    session.activateClient("second");
    first.close();

    await assert.rejects(session.callTool("canvas_get_state", {}), /当前没有已连接画布/);
    assert.equal(second.event("tool_call"), undefined);

    const reconnected = connect(session, "first");
    t.after(() => reconnected.close());
    session.updateState(snapshot("canvas-first-reconnected"), "first");
    assert.equal(field(await session.callTool("canvas_get_state", {}), "projectId"), "canvas-first-reconnected");

    const result = session.callTool("canvas_create_text_node", { text: "reconnected" });
    const call = reconnected.event("tool_call");
    assert.equal(second.event("tool_call"), undefined);
    session.resolveResult("first", { requestId: String(field(call, "requestId")), result: { ok: true } });
    assert.deepEqual(await result, { ok: true });
});

test("新连接会回放当前运行 turn 的最新事件快照", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("chat_message", "thread-1", { turnId: "turn-1", message: { id: "thread-1:turn-1:synthetic:user", itemId: "synthetic:user", clientMessageId: "local-message-1", role: "user", text: "问题" } });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "reasoning-1", type: "reasoning", text: "分析中" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());

    assert.deepEqual(client.events("chat_message"), [{ threadId: "thread-1", turnId: "turn-1", message: { id: "thread-1:turn-1:synthetic:user", itemId: "synthetic:user", clientMessageId: "local-message-1", role: "user", text: "问题" }, replayed: true }]);
    assert.deepEqual(client.events("agent_event"), [{ threadId: "thread-1", turnId: "turn-1", type: "item.updated", item: { id: "reasoning-1", type: "reasoning", text: "分析中" }, replayed: true }]);
});

test("同一 item 的多次增量只回放最新内容", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", text: "第一段" } });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", text: "第一段和第二段" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());

    const events = client.events("agent_event") as Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.equal(field(field(events[0], "item"), "text"), "第一段和第二段");
});

test("增量事件重放时转换为完整文本快照", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", delta: "第一段" } });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", delta: "第二段" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    const [event] = client.events("agent_event") as Array<Record<string, unknown>>;
    assert.deepEqual(field(event, "item"), { id: "assistant-1", type: "agent_message", text: "第一段第二段" });
});

test("并行 item 更新后重放仍保留开始顺序和命令字段", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.started", item: { id: "first", type: "command_execution", command: "first", cwd: "D:\\infinite-canvas" } });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.started", item: { id: "second", type: "command_execution", command: "second" } });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "first", type: "command_execution", delta: "output" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    const events = client.events("agent_event") as Array<Record<string, unknown>>;

    assert.deepEqual(events.map((event) => field(field(event, "item"), "id")), ["first", "second"]);
    assert.deepEqual(field(events[0], "item"), { id: "first", type: "command_execution", command: "first", cwd: "D:\\infinite-canvas", text: "output" });
});

test("长 turn 不会淘汰仍在更新的活动条目快照", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.started", item: { id: "active-item", type: "command_execution", command: "long-running" } });
    for (let index = 0; index < 260; index += 1) {
        session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.completed", item: { id: `completed-${index}`, type: "command_execution", command: `command-${index}` } });
    }

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    assert.equal((client.events("agent_event") as Array<Record<string, unknown>>).some((event) => field(field(event, "item"), "id") === "active-item"), true);
});

test("内置生图事件会回放展示但标记为不可重复执行", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.completed", item: { id: "image-1", type: "image_generation", savedPath: "D:/image.png" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());

    assert.deepEqual(client.events("agent_event"), [{
        threadId: "thread-1",
        turnId: "turn-1",
        type: "item.completed",
        item: { id: "image-1", type: "image_generation", savedPath: "D:/image.png" },
        replayed: true,
    }]);
});

test("turn 结束后保留实时快照，直到网页确认权威历史", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", text: "回答" } });
    session.setCodexState({ busy: false });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    assert.equal(client.events("agent_event").length, 1);

    session.acknowledgeCodexHistory("thread-1", ["turn-1"]);
    const next = connect(session, "second", "thread-1");
    t.after(() => next.close());
    assert.deepEqual(next.events("agent_event"), []);
});

test("开始下一 turn 时只回放当前 turn 的事件", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant", type: "agent_message", text: "第一轮" } });
    session.setCodexState({ busy: false, turnId: "turn-1" });
    session.setCodexState({ busy: true, turnId: "turn-2" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-2", type: "item.updated", item: { id: "assistant", type: "agent_message", text: "第二轮" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    const events = client.events("agent_event") as Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.deepEqual(events.map((event) => field(field(event, "item"), "text")), ["第二轮"]);
});

test("同一用户消息从 pending 绑定 turn 后只回放最终版本", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "" });
    session.emitThread("chat_message", "thread-1", { message: { id: "pending", itemId: "synthetic:user", clientMessageId: "message-1", role: "user", text: "问题" } });
    session.setCodexState({ turnId: "turn-1" });
    session.emitThread("chat_message", "thread-1", { turnId: "turn-1", message: { id: "final", itemId: "synthetic:user", clientMessageId: "message-1", role: "user", text: "问题" } });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    assert.deepEqual(client.events("chat_message"), [{
        threadId: "thread-1",
        turnId: "turn-1",
        message: { id: "final", itemId: "synthetic:user", clientMessageId: "message-1", role: "user", text: "问题" },
        replayed: true,
    }]);
});

test("切换活动线程会清除上一线程的实时快照", (t) => {
    const session = new CanvasSession();
    session.setCodexState({ busy: true, threadId: "thread-1", turnId: "turn-1" });
    session.emitThread("agent_event", "thread-1", { turnId: "turn-1", type: "item.updated", item: { id: "assistant-1", type: "agent_message", text: "回答" } });
    session.setCodexState({ busy: false, threadId: "thread-1", turnId: "turn-1" });
    session.setCodexState({ threadId: "thread-2", turnId: "" });
    session.setCodexState({ threadId: "thread-1", turnId: "" });

    const client = connect(session, "first", "thread-1");
    t.after(() => client.close());
    assert.deepEqual(client.events("agent_event"), []);
});

/** 创建用于测试的画布 SSE 连接。 */
function connect(session: CanvasSession, clientId: string, activeThreadId = "") {
    const response = new FakeSseResponse();
    session.openEvents(new URL(`http://127.0.0.1/events?clientId=${clientId}`), response as unknown as ServerResponse, activeThreadId);
    return response;
}

/** 创建最小画布快照。 */
function snapshot(projectId: string) {
    return { projectId, title: projectId, nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

/** 安全读取测试对象字段。 */
function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

/** 模拟 Node SSE 响应并提供事件读取能力。 */
class FakeSseResponse extends EventEmitter {
    private chunks: string[] = [];

    /** 模拟写入响应头。 */
    writeHead() {
        return this;
    }

    /** 保存写入的 SSE 文本块。 */
    write(chunk: string) {
        this.chunks.push(chunk);
        return true;
    }

    /** 读取指定类型的首个 SSE 事件数据。 */
    event(type: string) {
        return this.events(type)[0];
    }

    /** 读取指定类型的全部 SSE 事件数据。 */
    events(type: string) {
        return this.chunks.flatMap((chunk) => {
            if (!chunk.startsWith(`event: ${type}\n`)) return [];
            const data = chunk.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
            return data ? [JSON.parse(data) as unknown] : [];
        });
    }

    /** 触发连接关闭事件。 */
    close() {
        this.emit("close");
    }
}
