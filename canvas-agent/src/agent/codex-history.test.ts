import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendReasoningDelta } from "./codex-client.js";
import { CodexEventHistory } from "./codex-event-history.js";
import { settledTurnIds, summarizeCodexThread, threadMessages } from "./codex-history.js";

test("线程摘要提取结构化状态类型", () => {
    assert.equal(summarizeCodexThread({ id: "thread-1", status: { type: "notLoaded" } }).status, "notLoaded");
    assert.equal(summarizeCodexThread({ id: "thread-1", status: "idle" }).status, "idle");
});

test("reasoning 增量按 summaryIndex 聚合", () => {
    const segments = new Map<number, string>();
    appendReasoningDelta(segments, 1, "第二");
    appendReasoningDelta(segments, 0, "第一");
    assert.equal(appendReasoningDelta(segments, 1, "段"), "第一\n第二段");
});

test("只有终态 turn 会交给历史快照作为权威内容", () => {
    assert.deepEqual(settledTurnIds({ turns: [
        { id: "completed", status: "completed" },
        { id: "failed", status: "failed" },
        { id: "interrupted", status: "interrupted" },
        { id: "running", status: "inProgress" },
    ] }), ["completed", "failed", "interrupted"]);
});

test("标准历史的运行中状态不会覆盖本地已经完成的 turn", () => {
    const supplemental = {
        items: [{ threadId: "thread-1", turnId: "turn-1", itemId: "assistant-1", sequence: 1, item: { id: "assistant-1", type: "agent_message", text: "完整回答" } }],
        turns: [{ threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed", input: "问题" } }],
    };
    const thread = { id: "thread-1", turns: [{ id: "turn-1", status: "inProgress", items: [] }] };

    assert.deepEqual(settledTurnIds(thread, supplemental), ["turn-1"]);
    assert.deepEqual(threadMessages(thread, [], supplemental).map((item) => item.text), ["问题", "完整回答"]);
});

test("标准历史进入终态后保持权威状态", () => {
    const supplemental = {
        items: [],
        turns: [{ threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed", input: "问题" } }],
    };
    const thread = { id: "thread-1", turns: [{ id: "turn-1", status: "failed", error: { message: "标准错误" }, items: [] }] };

    const messages = threadMessages(thread, [], supplemental);
    assert.deepEqual(settledTurnIds(thread, supplemental), ["turn-1"]);
    assert.equal(messages.at(-1)?.role, "error");
    assert.equal(messages.at(-1)?.text, "标准错误");
});

test("线程历史将多个 reasoning 条目投影为一张稳定卡片", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{
            id: "turn-1",
            status: "completed",
            items: [
                { id: "user-1", type: "userMessage", content: [{ type: "text", text: "问题" }] },
                { id: "reasoning-1", type: "reasoning", summary: ["第一段", "第二段"] },
                { id: "reasoning-2", type: "reasoning", summary: [{ text: "第三段" }] },
                { id: "assistant-1", type: "agentMessage", text: "回答" },
            ],
        }],
    });
    const reasoning = messages.filter((item) => item.itemId === "synthetic:reasoning");
    assert.equal(reasoning.length, 1);
    assert.equal(reasoning[0].id, "thread-1:turn-1:synthetic:reasoning");
    assert.equal(reasoning[0].text, "第一段\n第二段\n\n第三段");
    assert.deepEqual(reasoning[0].activityItems, { "reasoning-1": "第一段\n第二段", "reasoning-2": "第三段" });
});

test("空 reasoning 不进入完成后的线程历史", () => {
    const messages = threadMessages({ id: "thread-1", turns: [{ id: "turn-1", status: "completed", items: [{ id: "reasoning-1", type: "reasoning", summary: [] }] }] });
    assert.equal(messages.some((item) => item.itemId === "synthetic:reasoning"), false);
});

test("用户消息使用与实时消息一致的 turn 级稳定 ID", () => {
    const messages = threadMessages({ id: "thread-1", turns: [{ id: "turn-1", status: "completed", items: [{ id: "codex-user-1", type: "userMessage", content: [{ type: "text", text: "问题" }] }] }] });
    assert.equal(messages[0].id, "thread-1:turn-1:synthetic:user");
    assert.equal(messages[0].itemId, "synthetic:user");
});

test("显式用户正文优先于 Codex 自动补入的 Skill 前缀", () => {
    const messages = threadMessages({ id: "thread-1", turns: [{ id: "turn-1", status: "completed", items: [{
        id: "codex-user-1",
        type: "userMessage",
        content: [
            { type: "text", text: "$product-grid 生成产品图" },
            { type: "skill", name: "product-grid", path: "D:\\site\\.agents\\skills\\product-grid\\SKILL.md" },
        ],
    }] }] }, [], { items: [], turns: [{ threadId: "thread-1", turnId: "turn-1", turn: { messageText: "生成产品图" } }] });
    assert.equal(messages[0].text, "生成产品图");
});

test("没有显式用户正文时保留用户自行输入的 Skill 标记和正文", () => {
    const messages = threadMessages({ id: "thread-1", turns: [{ id: "turn-1", status: "completed", items: [{
        id: "codex-user-1",
        type: "userMessage",
        content: [
            { type: "text", text: "$product-grid 生成产品图" },
            { type: "skill", name: "product-grid", path: "D:\\site\\.agents\\skills\\product-grid\\SKILL.md" },
        ],
    }] }] });
    assert.equal(messages[0].text, "$product-grid 生成产品图");
});

test("Codex 历史省略命令时使用补充事件恢复完整命令卡片", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{
            id: "turn-1",
            status: "completed",
            items: [
                { id: "user-1", type: "userMessage", content: [{ type: "text", text: "执行命令" }] },
                { id: "assistant-1", type: "agentMessage", text: "完成" },
            ],
        }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        item: { id: "command-1", type: "command_execution", command: "Get-Location", status: "completed", exitCode: 0, aggregatedOutput: "D:\\infinite-canvas" },
    }], turns: [] });

    const command = messages.find((item) => item.itemId === "command-1");
    assert.equal(command?.text, "Get-Location");
    assert.deepEqual(command?.detail, {
        kind: "command",
        status: "completed",
        rows: [{ label: "退出状态", value: "0" }],
        output: "D:\\infinite-canvas",
    });
});

test("Codex 标准历史与补充事件重复时以标准历史为准", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "command-1", type: "commandExecution", command: "标准命令", status: "completed" }] }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        item: { id: "command-1", type: "command_execution", command: "补充命令", status: "completed" },
    }], turns: [] });

    assert.equal(messages.filter((item) => item.itemId === "command-1").length, 1);
    assert.equal(messages.find((item) => item.itemId === "command-1")?.text, "标准命令");
});

test("标准历史重写 item id 时仍与同一条实时事件合并", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [
            { id: "item-13", type: "userMessage", content: [{ type: "text", text: "执行命令" }] },
            { id: "item-14", type: "agentMessage", text: "我将仅查看当前路径。" },
            { id: "item-15", type: "agentMessage", text: "完成。" },
        ] }],
    }, [], { items: [
        { threadId: "thread-1", turnId: "turn-1", itemId: "msg-commentary", sequence: 2, item: { id: "msg-commentary", type: "agent_message", text: "我将仅查看当前路径。" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "command-1", sequence: 3, item: { id: "command-1", type: "command_execution", command: "Get-Location", status: "completed" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "msg-final", sequence: 4, item: { id: "msg-final", type: "agent_message", text: "完成。" } },
    ], turns: [] });

    assert.deepEqual(messages.map((item) => item.itemId), ["synthetic:user", "msg-commentary", "command-1", "msg-final"]);
});

test("标准历史正文损坏且重写 item id 时不会重复显示同一条回复", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "item-38", type: "agentMessage", text: "连接��" }] }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "msg-007367",
        sequence: 1,
        item: { id: "msg-007367", type: "agent_message", text: "连接服务" },
    }], turns: [] });

    const replies = messages.filter((item) => item.role === "assistant");
    assert.equal(replies.length, 1);
    assert.equal(replies[0].itemId, "msg-007367");
    assert.equal(replies[0].text, "连接服务");
});

test("标准历史同时保留损坏临时条目和稳定条目时移除损坏副本", () => {
    const cleanText = "目前能排除“网页没开”和“Canvas Agent 没连”：前端和 Agent 均正常。";
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [
            { id: "user-1", type: "userMessage", content: [{ type: "text", text: "检查连接" }] },
            { id: "item-38", type: "agentMessage", text: "目前能排除“网页没开”和“Canvas Agent 没连��：前端和 Agent 均正常。" },
            { id: "command-1", type: "commandExecution", command: "Get-NetTCPConnection", status: "completed" },
            { id: "msg-stable", type: "agentMessage", text: cleanText },
        ] }],
    }, [], { items: [
        { threadId: "thread-1", turnId: "turn-1", itemId: "command-1", sequence: 1, item: { id: "command-1", type: "command_execution", command: "Get-NetTCPConnection", status: "completed" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "msg-stable", sequence: 2, item: { id: "msg-stable", type: "agent_message", text: cleanText } },
    ], turns: [] });

    const replies = messages.filter((item) => item.role === "assistant");
    assert.equal(replies.length, 1);
    assert.equal(replies[0].itemId, "msg-stable");
    assert.equal(replies[0].text, cleanText);
});

test("标准历史条目稀疏时按字段补全补充事件", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "command-1", type: "commandExecution", command: "标准命令", status: "completed" }] }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        sequence: 1,
        item: { id: "command-1", type: "command_execution", command: "补充命令", cwd: "D:\\infinite-canvas", aggregatedOutput: "输出", exitCode: 0 },
    }], turns: [] });

    const command = messages.find((item) => item.itemId === "command-1");
    assert.equal(command?.text, "标准命令");
    assert.deepEqual(command?.detail, {
        kind: "command",
        status: "completed",
        rows: [{ label: "工作目录", value: "D:\\infinite-canvas" }, { label: "退出状态", value: "0" }],
        output: "输出",
    });
});

test("标准历史的 falsy 字段仍优先于补充事件", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "command-1", type: "commandExecution", command: "", cwd: null, status: "completed", exitCode: 0, success: false, aggregatedOutput: "" }] }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        sequence: 1,
        item: { id: "command-1", type: "command_execution", command: "补充命令", cwd: "补充目录", exitCode: 9, success: true, aggregatedOutput: "补充输出" },
    }], turns: [] });

    const command = messages.find((item) => item.itemId === "command-1");
    assert.equal(command?.text, "命令执行失败");
    assert.deepEqual(command?.detail, { kind: "command", status: "failed", rows: [{ label: "退出状态", value: "0" }], output: "" });
});

test("补充事件按 item 开始顺序插入标准历史锚点之间", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [
            { id: "user-1", type: "userMessage", content: [{ type: "text", text: "执行" }] },
            { id: "second", type: "commandExecution", command: "second", status: "completed" },
            { id: "assistant", type: "agentMessage", text: "完成" },
        ] }],
    }, [], { items: [
        { threadId: "thread-1", turnId: "turn-1", itemId: "first", sequence: 1, item: { id: "first", type: "command_execution", command: "first", status: "completed" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "second", sequence: 2, item: { id: "second", type: "command_execution", command: "补充 second", status: "completed" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "third", sequence: 3, item: { id: "third", type: "command_execution", command: "third", status: "completed" } },
        { threadId: "thread-1", turnId: "turn-1", itemId: "assistant", sequence: 4, item: { id: "assistant", type: "agent_message", text: "补充回答" } },
    ], turns: [] });

    assert.deepEqual(messages.map((item) => item.itemId), ["synthetic:user", "first", "second", "third", "assistant"]);
    assert.equal(messages.find((item) => item.itemId === "second")?.text, "second");
    assert.equal(messages.find((item) => item.itemId === "assistant")?.text, "完成");
});

test("补充事件写入本地 JSON 后可在 Agent 重启后恢复", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "codex-event-history.json");
    const entry = {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "command-1",
        item: { id: "command-1", type: "command_execution", command: "Get-Location", status: "completed" },
    };

    await new CodexEventHistory(file).record(entry);

    assert.deepEqual(await new CodexEventHistory(file).readThread("thread-1"), { items: [entry], turns: [] });
});

test("补充历史 JSON 损坏后会从空历史恢复并允许重新写入", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "codex-event-history.json");
    await fs.writeFile(file, "{\"version\":1,\"items\":[");
    const history = new CodexEventHistory(file);

    assert.deepEqual(await history.readThread("thread-1"), { items: [], turns: [] });
    await history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "item-1", item: { id: "item-1", type: "agent_message", text: "恢复成功" } });

    assert.deepEqual(await new CodexEventHistory(file).readThread("thread-1"), {
        items: [{ threadId: "thread-1", turnId: "turn-1", itemId: "item-1", item: { id: "item-1", type: "agent_message", text: "恢复成功" } }],
        turns: [],
    });
});

test("标准历史尚未物化 turn 时从本地终态事件恢复完整对话", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "codex-event-history.json");
    const history = new CodexEventHistory(file);
    await history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "command-1", sequence: 1, item: { id: "command-1", type: "command_execution", command: "Get-Location", status: "completed", exitCode: 0, aggregatedOutput: "D:\\infinite-canvas" } });
    await history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "assistant-1", sequence: 2, item: { id: "assistant-1", type: "agent_message", text: "完成" } });
    await history.recordTurn({ threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed", input: "执行 Get-Location" } });

    const supplemental = await new CodexEventHistory(file).readThread("thread-1");
    const thread = { id: "thread-1", turns: [] };
    const messages = threadMessages(thread, [], supplemental);

    assert.deepEqual(messages.map((message) => message.itemId), ["synthetic:user", "command-1", "assistant-1"]);
    assert.equal(messages[0].text, "执行 Get-Location");
    assert.equal(messages[1].text, "Get-Location");
    assert.equal(messages[2].text, "完成");
    assert.deepEqual(settledTurnIds(thread, supplemental), ["turn-1"]);
});

test("归档线程只清除该线程的补充事件", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const history = new CodexEventHistory(path.join(directory, "codex-event-history.json"));
    const entry = (threadId: string) => ({ threadId, turnId: "turn-1", itemId: "command-1", item: { id: "command-1", type: "command_execution" } });
    await history.record(entry("thread-1"));
    await history.record(entry("thread-2"));

    await history.removeThread("thread-1");

    assert.deepEqual(await history.readThread("thread-1"), { items: [], turns: [] });
    assert.deepEqual(await history.readThread("thread-2"), { items: [entry("thread-2")], turns: [] });
});

test("补充事件更新时保留已有字段并限制单项输出大小", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const history = new CodexEventHistory(path.join(directory, "codex-event-history.json"));
    await history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "command-1", sequence: 1, item: { id: "command-1", type: "command_execution", command: "Get-Location", cwd: "D:\\infinite-canvas" } });
    await history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "command-1", item: { id: "command-1", status: "completed", aggregatedOutput: "x".repeat(100_001) } });

    const [entry] = (await history.readThread("thread-1")).items;
    assert.equal(entry.sequence, 1);
    assert.equal(entry.item.command, "Get-Location");
    assert.equal(entry.item.cwd, "D:\\infinite-canvas");
    assert.equal(String(entry.item.aggregatedOutput).endsWith("[输出已截断]"), true);
});

test("补充事件落盘失败时不污染内存读取", async (context) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-history-"));
    context.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "history-target");
    const history = new CodexEventHistory(file);
    assert.deepEqual(await history.readThread("thread-1"), { items: [], turns: [] });
    await fs.mkdir(file);
    await assert.rejects(() => history.record({ threadId: "thread-1", turnId: "turn-1", itemId: "command-1", item: { id: "command-1", type: "command_execution" } }));
    assert.deepEqual(await history.readThread("thread-1"), { items: [], turns: [] });
});

test("turn 错误优先于条目错误且只生成一张错误卡片", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "failed", error: { message: "turn error" }, items: [{ id: "error-1", type: "error", message: "item error" }] }],
    });
    const errors = messages.filter((item) => item.role === "error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].id, "thread-1:turn-1:synthetic:error");
    assert.equal(errors[0].text, "turn error");
});

test("失败条目的状态与错误详情在历史中保持完整", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{
            id: "turn-1",
            status: "completed",
            items: [
                { id: "command-1", type: "commandExecution", command: "exit 1", status: "completed", exitCode: 1, aggregatedOutput: "failed" },
                { id: "image-1", type: "imageGeneration", status: "completed", success: false },
                { id: "context-1", type: "contextCompaction", status: "failed", error: { message: "compact failed" } },
                { id: "collab-1", type: "collabToolCall", status: "completed", success: false },
                { id: "reasoning-1", type: "reasoning", status: "failed", summary: ["分析失败"] },
            ],
        }],
    });
    const byId = new Map(messages.map((item) => [item.itemId, item]));
    assert.equal((byId.get("command-1")?.detail as { status?: string }).status, "failed");
    assert.equal((byId.get("image-1")?.detail as { status?: string }).status, "failed");
    assert.equal(byId.get("context-1")?.text, "compact failed");
    assert.equal((byId.get("context-1")?.detail as { output?: string }).output, "compact failed");
    assert.equal((byId.get("collab-1")?.detail as { status?: string }).status, "failed");
    assert.equal((byId.get("synthetic:reasoning")?.detail as { status?: string }).status, "failed");
});

test("新版协作工具条目在标准历史和补充历史中保持同一张卡片", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "collab-1", type: "collabAgentToolCall", status: "completed" }] }],
    }, [], { items: [{
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "collab-1",
        sequence: 1,
        item: { id: "collab-1", type: "collab_tool_call", status: "completed" },
    }], turns: [] });

    assert.equal(messages.filter((item) => item.itemId === "collab-1").length, 1);
    assert.equal(messages[0].title, "协作处理");
});

test("尚未完成的 turn 只由实时事件展示，不进入历史快照", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "inProgress", items: [{ id: "reasoning-1", type: "reasoning", status: "pending", summary: ["正在分析"] }] }],
    });
    assert.deepEqual(messages, []);
});

test("缺少稳定 item id 的历史条目不会生成无法对齐的临时消息", () => {
    const messages = threadMessages({ id: "thread-1", turns: [{ id: "turn-1", status: "completed", items: [{ type: "agentMessage", text: "回答" }] }] });
    assert.equal(messages.length, 0);
});

test("通用工具只由标题和结构化状态表达完成结果", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{ id: "turn-1", status: "completed", items: [{ id: "tool-1", type: "mcpToolCall", tool: "list_mcp_resources", status: "completed" }] }],
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].title, "调用工具：list_mcp_resources");
    assert.equal(messages[0].text, "");
    assert.equal((messages[0].detail as { status?: string }).status, "completed");
});

test("命令完成条目缺少 command 时仍保留历史卡片", () => {
    const messages = threadMessages({
        id: "thread-1",
        turns: [{
            id: "turn-1",
            status: "completed",
            items: [{ id: "command-1", type: "commandExecution", status: "completed", exitCode: 0, aggregatedOutput: "done" }],
        }],
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].itemId, "command-1");
    assert.equal(messages[0].title, "执行命令");
    assert.equal(messages[0].text, "命令已完成");
    assert.equal((messages[0].detail as { status?: string }).status, "completed");
});
