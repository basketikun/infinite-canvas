import assert from "node:assert/strict";
import test from "node:test";

import { CodexAppClient } from "./codex-client.js";
import { assertDraftHasNoSensitiveValues, canvasSkillSource } from "./codex.js";

type TestClient = {
    currentThreadId: string;
    currentTurnId: string;
    skillDraftActive: boolean;
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

    testClient.currentThreadId = "draft-thread";
    testClient.currentTurnId = "draft-turn";
    const draftInterrupt = client.interruptCurrentTurn();
    const draftRequest = writes.at(-1);
    assert.deepEqual(draftRequest?.params, { threadId: "draft-thread", turnId: "draft-turn" });
    testClient.handle({ id: draftRequest?.id, result: {} });
    assert.equal(await draftInterrupt, true);
});

test("Skill 列表与启用配置使用 app-server 原生协议", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const listing = client.listSkills("D:\\site", true);
    const listRequest = writes.at(-1);
    assert.deepEqual(listRequest, { id: 1, method: "skills/list", params: { cwds: ["D:\\site"], forceReload: true } });
    testClient.handle({ id: listRequest?.id, result: { data: [{ cwd: "D:\\site", skills: [], errors: [] }] } });
    assert.equal((await listing).data[0]?.cwd, "D:\\site");

    const configuring = client.setSkillEnabled("D:\\site\\.agents\\skills\\demo\\SKILL.md", false);
    const configRequest = writes.at(-1);
    assert.deepEqual(configRequest, { id: 2, method: "skills/config/write", params: { path: "D:\\site\\.agents\\skills\\demo\\SKILL.md", enabled: false } });
    testClient.handle({ id: configRequest?.id, result: { effectiveEnabled: false } });
    assert.equal((await configuring).effectiveEnabled, false);
});

test("并发强制刷新同一工作空间时只扫描一次 Skill", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const first = client.listSkills("D:\\site", true);
    const second = client.listSkills("D:\\site", true);
    assert.equal(writes.length, 1);
    testClient.handle({ id: writes[0].id, result: { data: [{ cwd: "D:\\site", skills: [], errors: [] }] } });
    assert.deepEqual(await Promise.all([first, second]), [
        { data: [{ cwd: "D:\\site", skills: [], errors: [] }] },
        { data: [{ cwd: "D:\\site", skills: [], errors: [] }] },
    ]);

    const next = client.listSkills("D:\\site", true);
    assert.equal(writes.length, 2);
    testClient.handle({ id: writes[1].id, result: { data: [] } });
    await next;
});

test("显式 Skill 同时使用文本标记和结构化输入传给 turn/start", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    const skill = { name: "demo-skill", path: "D:\\site\\.agents\\skills\\demo-skill\\SKILL.md" };

    const running = client.startTurn("thread-1", "执行任务", [], "request", undefined, undefined, undefined, skill);
    const request = writes.find((item) => item.method === "turn/start");
    assert.deepEqual((request?.params as { input?: unknown[] })?.input, [
        { type: "text", text: "$demo-skill 执行任务", text_elements: [] },
        { type: "skill", ...skill },
    ]);
    testClient.handle({ id: request?.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await running;
});

test("显式 Skill 不重复已有的文本标记", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;
    const skill = { name: "demo-skill", path: "D:\\site\\.agents\\skills\\demo-skill\\SKILL.md" };

    const running = client.startTurn("thread-1", "Use $demo-skill: 执行任务", [], "request", undefined, undefined, undefined, skill);
    const request = writes.find((item) => item.method === "turn/start");
    assert.equal(((request?.params as { input?: Array<{ text?: string }> })?.input || [])[0]?.text, "Use $demo-skill: 执行任务");
    testClient.handle({ id: request?.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await running;
});

test("skills/changed 作为站点级事件单独广播", () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: () => true } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    (client as unknown as TestClient).handleNotification("skills/changed", {});
    assert.deepEqual(events, [{ type: "skills_changed", payload: {} }]);
});

test("MCP 启动状态区分空对话预热与正常 turn 运行", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startThread("D:\\site", "request", true);
    const request = writes.find((item) => item.method === "thread/start");
    assert.ok(request);
    testClient.handleNotification("mcpServer/startupStatus/updated", { threadId: "thread-1", name: "notion", status: "starting" });
    testClient.handle({ id: request.id, result: { thread: { id: "thread-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    const statusRequest = writes.find((item) => item.method === "mcpServerStatus/list");
    assert.ok(statusRequest);
    testClient.handleNotification("mcpServer/startupStatus/updated", { threadId: "thread-1", name: "notion", status: "failed" });
    testClient.handle({ id: statusRequest.id, result: { data: [{ name: "notion", authStatus: "notLoggedIn", tools: [], resources: [], resourceTemplates: [] }], nextCursor: null } });
    await starting;

    const running = client.startTurn("thread-1", "test", [], "request");
    const turnRequest = writes.find((item) => item.method === "turn/start");
    assert.ok(turnRequest);
    testClient.handleNotification("mcpServer/startupStatus/updated", { threadId: "thread-1", name: "notion", status: "ready" });
    testClient.handle({ id: turnRequest.id, result: { turn: { id: "turn-1" } } });
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } });
    await running;

    assert.deepEqual(events.filter((event) => event.type === "agent_bootstrap"), [
        { type: "agent_bootstrap", payload: { type: "mcp.startup", phase: "preheat", threadId: "thread-1", name: "notion", status: "starting", error: undefined, failureReason: undefined } },
        { type: "agent_bootstrap", payload: { type: "mcp.startup", phase: "preheat", threadId: "thread-1", name: "notion", status: "failed", error: undefined, failureReason: undefined } },
        { type: "agent_bootstrap", payload: { type: "mcp.complete", phase: "preheat", threadId: "thread-1", services: [{ name: "notion", authStatus: "notLoggedIn" }] } },
        { type: "agent_bootstrap", payload: { type: "mcp.startup", phase: "runtime", threadId: "thread-1", name: "notion", status: "ready", error: undefined, failureReason: undefined } },
    ]);
});

test("静默 Skill 草稿 turn 只返回结构化结果，不广播也不写历史", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const persistedItems: unknown[] = [];
    const persistedTurns: unknown[] = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const history = {
        record: (entry: unknown) => (persistedItems.push(entry), Promise.resolve()),
        recordTurn: (entry: unknown) => (persistedTurns.push(entry), Promise.resolve()),
    };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), history]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    const threadRequest = writes.find((item) => item.method === "thread/start");
    assert.ok(threadRequest);
    testClient.handleNotification("thread/started", { thread: { id: "draft-thread", ephemeral: true } });
    testClient.handle({ id: threadRequest.id, result: { thread: { id: "draft-thread", ephemeral: true } } });
    await starting;

    const schema = { type: "object", properties: { name: { type: "string" } } };
    const output = JSON.stringify({ name: "product-image-flow" });
    const generating = client.generateSkillDraft("draft-thread", "提炼流程", schema);
    const turnRequest = writes.find((item) => item.method === "turn/start");
    assert.deepEqual(turnRequest?.params, {
        threadId: "draft-thread",
        input: [{ type: "text", text: "提炼流程", text_elements: [] }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        outputSchema: schema,
    });
    testClient.handle({ id: turnRequest?.id, result: { turn: { id: "draft-turn" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/started", { threadId: "draft-thread", turn: { id: "draft-turn", status: "inProgress" } });
    testClient.handleNotification("item/reasoning/summaryTextDelta", { threadId: "draft-thread", turnId: "draft-turn", itemId: "reasoning-1", delta: "正在提炼" });
    testClient.handleNotification("item/completed", { threadId: "draft-thread", turnId: "draft-turn", item: { id: "reasoning-1", type: "reasoning", summary: ["正在提炼"] } });
    testClient.handleNotification("item/agentMessage/delta", { threadId: "draft-thread", turnId: "draft-turn", itemId: "assistant-1", delta: output });
    testClient.handleNotification("item/completed", { threadId: "draft-thread", turnId: "draft-turn", item: { id: "assistant-1", type: "agentMessage", text: "" } });
    testClient.handleNotification("turn/completed", { threadId: "draft-thread", turn: { id: "draft-turn", status: "completed" } });

    assert.equal(await generating, output);
    assert.deepEqual(events, []);
    assert.deepEqual(persistedItems, []);
    assert.deepEqual(persistedTurns, []);

    assert.equal(testClient.skillDraftActive, true);
    const closing = client.closeSkillDraftThread("draft-thread");
    const unsubscribe = writes.find((item) => item.method === "thread/unsubscribe");
    assert.ok(unsubscribe);
    testClient.handle({ id: unsubscribe.id, result: { status: "unsubscribed" } });
    await closing;
    assert.equal(testClient.skillDraftActive, false);
});

test("静默线程创建期间只隐藏响应返回的线程", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    const request = writes.find((item) => item.method === "thread/start");
    assert.ok(request);

    testClient.handleNotification("thread/started", { thread: { id: "normal-thread" } });
    testClient.handleNotification("thread/started", { thread: { id: "draft-thread", ephemeral: true } });
    assert.deepEqual(events, []);

    testClient.handle({ id: request.id, result: { thread: { id: "draft-thread", ephemeral: true } } });
    await starting;

    assert.deepEqual(events, [{
        type: "agent_event",
        payload: { agent: "codex", type: "thread.started", thread_id: "normal-thread" },
    }]);

    testClient.handleNotification("thread/started", { thread: { id: "draft-thread", ephemeral: true } });
    assert.equal(events.length, 1);
});

test("静默 Skill 草稿不吞掉全局 Skill 变更通知", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    const request = writes.find((item) => item.method === "thread/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { thread: { id: "draft-thread", ephemeral: true } } });
    await starting;

    testClient.handleNotification("thread/started", { thread: { id: "draft-thread", ephemeral: true } });
    testClient.handleNotification("skills/changed", {});

    assert.deepEqual(events, [{ type: "skills_changed", payload: {} }]);
});

test("静默 Skill 草稿自动拒绝未携带线程 ID 的权限请求", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    const request = writes.find((item) => item.method === "thread/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { thread: { id: "draft-thread", ephemeral: true } } });
    await starting;
    testClient.handleNotification("turn/started", { threadId: "draft-thread", turn: { id: "draft-turn", status: "inProgress" } });

    testClient.answerServerRequest({ id: 17, method: "item/permissions/requestApproval", params: { turnId: "draft-turn", permissions: { network: true } } });

    assert.deepEqual(writes.at(-1), { id: 17, result: { permissions: {}, scope: "turn" } });
    assert.deepEqual(events, []);
});

test("app-server 退出时清理尚未确认的静默线程", async () => {
    const events: Array<{ type: string; payload: unknown }> = [];
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, (type: string, payload: unknown) => events.push({ type, payload }), emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    testClient.handleNotification("thread/started", { thread: { id: "draft-thread", ephemeral: true } });
    assert.equal(testClient.skillDraftActive, true);

    testClient.failAll("Codex app-server exited: 1");

    assert.equal(testClient.skillDraftActive, false);
    assert.deepEqual(events, []);
    await assert.rejects(starting, /Codex app-server exited/);
});

test("app-server 在草稿运行中退出后不再等待线程取消订阅", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const child = { stdin: { write: (line: string) => (writes.push(JSON.parse(line)), true) } };
    const client = Reflect.construct(CodexAppClient, [child, () => undefined, emptyEventHistory]) as CodexAppClient;
    const testClient = client as unknown as TestClient;

    const starting = client.startSkillDraftThread("D:\\site");
    const threadRequest = writes.find((item) => item.method === "thread/start");
    assert.ok(threadRequest);
    testClient.handle({ id: threadRequest.id, result: { thread: { id: "draft-thread", ephemeral: true } } });
    await starting;

    const generating = client.generateSkillDraft("draft-thread", "提炼流程", { type: "object" });
    const turnRequest = writes.find((item) => item.method === "turn/start");
    assert.ok(turnRequest);
    testClient.handle({ id: turnRequest.id, result: { turn: { id: "draft-turn" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.failAll("Codex app-server exited: 1");

    await assert.rejects(generating, /Codex app-server exited/);
    const writeCount = writes.length;
    await client.closeSkillDraftThread("draft-thread");
    assert.equal(writes.length, writeCount);
    await assert.rejects(client.listModels(), /Codex app-server exited/);
    assert.equal(writes.length, writeCount);
});

test("画布 Skill 草稿源保留流程信息并移除媒体、本地路径、凭据和临时任务字段", () => {
    const source = canvasSkillSource({
        projectId: "private-project",
        clientId: "private-client",
        title: "商品图流程",
        viewport: { x: 100, y: 200, k: 1.5 },
        nodes: [{
            id: "prompt-node",
            type: "text",
            title: "提示词",
            position: { x: 20, y: 30 },
            width: 480,
            height: 240,
            metadata: {
                content: "保留这段可复用流程；API Key=secret-api-key；Bearer abcdefghijklmnop",
                sourceUrl: "https://example.com/reference.png",
                extensionlessMediaUrl: "https://cdn.example.com/private-media/abc123",
                sensitiveUrl: "https://example.com/reference.png?token=secret-value",
                signedUrl: "https://example.com/reference.png?X-Amz-Signature=secret-value",
                basicAuthUrl: "https://user:password@example.com/reference.png",
                dataUrl: "data:image/png;base64,c2VjcmV0",
                blobUrl: "blob:http://localhost/private-image",
                reference: "D:\\private\\reference.png",
                referenceNote: "本地文件 D:\\private\\reference.png 参考图 https://example.com/reference.png",
                unixReference: "/var/lib/private/reference.png",
                unixReferenceNote: "文件 /root/private.png 与 file:///opt/private.png",
                batchRootId: "output-node",
                batchChildIds: ["output-node", "missing-node"],
                primaryImageId: "output-node",
                groupId: "prompt-node",
                storageKey: "canvas-private-key",
                apiKey: "secret-api-key",
                credentials: { token: "secret-token" },
                status: "running",
                progress: 75,
                errorDetails: "temporary failure",
                taskId: "task-private",
                createdAt: "2026-08-03",
                nested: { keep: "保留", password: "secret-password", preview: "blob:http://localhost/nested" },
            },
        }, {
            id: "output-node",
            type: "image",
            title: "结果图片",
            position: { x: 600, y: 30 },
            width: 480,
            height: 480,
            metadata: { content: "data:image/png;base64,c2VjcmV0" },
        }],
        connections: [{ id: "connection-1", fromNodeId: "prompt-node", toNodeId: "output-node" }],
        selectedNodeIds: ["prompt-node"],
    });

    assert.deepEqual(source, {
        title: "商品图流程",
        nodes: [{
            ref: "node-1",
            type: "text",
            title: "提示词",
            metadata: {
                content: "保留这段可复用流程；[敏感凭证已移除]；[敏感凭证已移除]",
                referenceNote: "本地文件 [本地路径已移除] 参考图 [外部地址已移除]",
                unixReferenceNote: "文件 [本地路径已移除] 与 [本地路径已移除]",
                batchRootRef: "node-2",
                batchChildRefs: ["node-2"],
                primaryImageRef: "node-2",
                groupRef: "node-1",
                nested: { keep: "保留" },
            },
        }, {
            ref: "node-2",
            type: "image",
            title: "结果图片",
        }],
        connections: [{ from: "node-1", to: "node-2" }],
        selectedNodeRefs: ["node-1"],
    });
    assert.doesNotMatch(JSON.stringify(source), /prompt-node|output-node|connection-1|secret-value|secret-api-key|abcdefghijklmnop|D:\\\\private|\/var\/|\/root\/|\/opt\/|file:|https?:\/\//);
});

test("画布 Skill 草稿源保留普通中文斜杠文本和斜杠命令", () => {
    const source = canvasSkillSource({
        nodes: [{
            id: "prompt-node",
            type: "text",
            title: "提示词",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: {
                content: "故事概念/剧本圣经 → 配音/音效/音乐",
                prompt: "/imagine 商品图",
            },
        }],
        connections: [],
    });

    assert.deepEqual(source, {
        nodes: [{
            ref: "node-1",
            type: "text",
            title: "提示词",
            metadata: {
                content: "故事概念/剧本圣经 → 配音/音效/音乐",
                prompt: "/imagine 商品图",
            },
        }],
        connections: [],
    });
});

test("画布 Skill 草稿源匿名化任意字符串中的已知节点 ID", () => {
    const imageNodeId = "8f36ab15-30f1-4c73-b169-f12c36584ddb";
    const source = canvasSkillSource({
        nodes: [{
            id: "prompt-node",
            type: "text",
            title: "提示词",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { composerContent: `参考 @[node:${imageNodeId}] 生成商品图` },
        }, {
            id: imageNodeId,
            type: "image",
            title: "参考图",
            position: { x: 400, y: 0 },
            width: 320,
            height: 320,
            metadata: {},
        }],
        connections: [],
    });

    assert.equal(
        ((source.nodes as Array<Record<string, unknown>>)[0]?.metadata as Record<string, unknown>).composerContent,
        "参考 @[node:node-2] 生成商品图",
    );
    assert.doesNotMatch(JSON.stringify(source), new RegExp(imageNodeId));
});

test("画布 Skill 草稿源匿名化 metadata 对象键中的已知节点 ID", () => {
    const imageNodeId = "8f36ab15-30f1-4c73-b169-f12c36584ddb";
    const source = canvasSkillSource({
        nodes: [{
            id: "prompt-node",
            type: "text",
            title: "提示词",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { pluginState: { [`node:${imageNodeId}`]: { label: "参考图" } } },
        }, {
            id: imageNodeId,
            type: "image",
            title: "参考图",
            position: { x: 400, y: 0 },
            width: 320,
            height: 320,
            metadata: {},
        }],
        connections: [],
    });
    const metadata = (source.nodes as Array<Record<string, unknown>>)[0]?.metadata as Record<string, unknown>;

    assert.deepEqual(metadata.pluginState, { "node:node-2": { label: "参考图" } });
    assert.doesNotMatch(JSON.stringify(source), new RegExp(imageNodeId));
});

test("画布 Skill 草稿源为截断节点保留完整快照范围内的安全引用", () => {
    const targetNodeId = "target-node-id";
    const nodes = Array.from({ length: 301 }, (_, index) => ({
        id: index === 300 ? targetNodeId : `filler-node-${index + 1}`,
        type: "text" as const,
        title: index === 0 ? "提示词" : `节点 ${index + 1}`,
        position: { x: index * 10, y: 0 },
        width: 320,
        height: 180,
        metadata: index === 0 ? { composerContent: `参考 @[node:${targetNodeId}]` } : {},
    }));
    const source = canvasSkillSource({ nodes, connections: [] });
    const firstMetadata = (source.nodes as Array<Record<string, unknown>>)[0]?.metadata as Record<string, unknown>;

    assert.equal(firstMetadata.composerContent, "参考 @[node:node-301]");
    assert.equal(source.truncated, true);
    assert.doesNotMatch(JSON.stringify(source), new RegExp(targetNodeId));
});

test("画布 Skill 草稿源限制总长度并优先保留选中流程", () => {
    const nodes = Array.from({ length: 320 }, (_, index) => ({
        id: `node-${index + 1}`,
        type: "text" as const,
        title: index === 318 ? "关联节点" : index === 319 ? "选中节点" : `普通节点 ${index + 1}`,
        position: { x: index * 10, y: 0 },
        width: 320,
        height: 180,
        metadata: { content: "流程说明".repeat(2_000) },
    }));
    const source = canvasSkillSource({
        nodes,
        connections: [{ id: "private-connection", fromNodeId: "node-319", toNodeId: "node-320" }],
        selectedNodeIds: ["node-320"],
    });
    const sourceNodes = source.nodes as Array<Record<string, unknown>>;

    assert.ok(JSON.stringify(source).length <= 120_000);
    assert.equal(sourceNodes[0]?.title, "选中节点");
    assert.equal(sourceNodes[1]?.title, "关联节点");
    assert.deepEqual(source.connections, [{ from: "node-2", to: "node-1" }]);
    assert.deepEqual(source.selectedNodeRefs, ["node-1"]);
    assert.equal(source.truncated, true);
});

test("Skill 草稿拒绝普通外部 URL，避免对话内容泄露媒体地址", () => {
    const draft = {
        name: "product-image-flow",
        displayName: "Product image flow",
        description: "Reusable image generation workflow",
        instructions: "参考图地址：https://example.com/reference.png",
        shortDescription: "Generate product images from a reusable workflow",
        defaultPrompt: "$product-image-flow",
    };

    assert.throws(() => assertDraftHasNoSensitiveValues(draft, []), /外部地址/);
});

test("Skill 草稿允许普通动作名称，但拒绝任意本地绝对路径", () => {
    const draft = {
        name: "request-review",
        displayName: "Review request",
        description: "Use node-workflow-builder to review a reusable flow",
        instructions: "Run generation-status-check, then use job-application-helper.",
        shortDescription: "Review a reusable workflow",
        defaultPrompt: "$request-review",
    };

    assert.doesNotThrow(() => assertDraftHasNoSensitiveValues(draft, []));
    assert.throws(() => assertDraftHasNoSensitiveValues({ ...draft, instructions: "读取 /var/lib/private.png" }, []), /本地路径/);
    assert.throws(() => assertDraftHasNoSensitiveValues({ ...draft, instructions: "读取 file:///root/private.png" }, []), /本地路径/);
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

    const running = client.startTurn("thread-1", "$command-runner 执行 Get-Location", [], "request", undefined, undefined, undefined, undefined, "执行 Get-Location");
    const request = writes.find((item) => item.method === "turn/start");
    assert.ok(request);
    testClient.handle({ id: request.id, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.handleNotification("turn/completed", { threadId: "thread-1", turn: { id: "turn-1", status: "completed", durationMs: 120 } });
    await running;

    assert.deepEqual(persistedTurns, [{ threadId: "thread-1", turnId: "turn-1", turn: { id: "turn-1", status: "completed", durationMs: 120, input: "$command-runner 执行 Get-Location", messageText: "执行 Get-Location" } }]);
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

    const running = client.startTurn("thread-1", "$failure-check 执行失败任务", [], "request", undefined, undefined, undefined, undefined, "执行失败任务");
    testClient.handle({ id: 1, result: { turn: { id: "turn-1" } } });
    await new Promise((resolve) => setImmediate(resolve));
    testClient.failAll("Codex app-server exited: 1");
    await assert.rejects(running, /Codex app-server exited/);

    assert.deepEqual(persistedTurns, [{
        threadId: "thread-1",
        turnId: "turn-1",
        turn: { id: "turn-1", status: "failed", error: { message: "Codex app-server exited: 1" }, input: "$failure-check 执行失败任务", messageText: "执行失败任务" },
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
