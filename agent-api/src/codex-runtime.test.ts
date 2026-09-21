import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CanvasBridge } from "./canvas-bridge.js";
import { CodexRuntimeAdapter, type CodexSpawnContext } from "./codex/runtime.js";
import type { CodexTransport } from "./codex/client.js";
import { AppError } from "./errors.js";
import { EventHub } from "./event-hub.js";
import { InMemoryResearchStore } from "./in-memory-store.js";
import { projectKey, projectRuntimePaths, sanitizeUserId } from "./project-paths.js";
import { RuntimeManager } from "./runtime-manager.js";
import { RuntimeTokenService } from "./runtime-token.js";

test("运行时 token 只能用密钥解开，篡改或跨 Project 字段缺失都会失败", () => {
    const tokens = new RuntimeTokenService("secret-a");
    const claims = { userId: "alice", projectId: "p1", canvasWorkspaceId: "w1", runtimeId: "alice:p1" };
    const token = tokens.create(claims);
    assert.equal(token.split(".").length, 3);
    assert.deepEqual(tokens.parse(token), claims);
    assert.throws(() => new RuntimeTokenService("secret-b").parse(token), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
    const [header, payload] = token.split(".");
    assert.throws(() => tokens.parse(`${header}.${payload}.deadbeef`), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
    assert.throws(() => tokens.parse("not-a-token"), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
});

test("Project 运行目录把 workspace 和 codex-home 分开，路径 key 不是权限", () => {
    const paths = projectRuntimePaths("/srv/runtime", { userId: "alice", projectId: "project-a" });
    assert.equal(sanitizeUserId("alice"), "alice");
    assert.equal(projectKey("project-a").length, 24);
    assert.equal(paths.workspace, path.join("/srv/runtime", "users", "alice", "projects", projectKey("project-a"), "workspace"));
    assert.equal(paths.codexHome, path.join("/srv/runtime", "users", "alice", "projects", projectKey("project-a"), "codex-home"));
    assert.notEqual(paths.workspace, paths.codexHome);
    assert.notEqual(projectRuntimePaths("/srv/runtime", { userId: "alice", projectId: "project-b" }).codexHome, paths.codexHome);
    assert.notEqual(projectRuntimePaths("/srv/runtime", { userId: "bob", projectId: "project-a" }).workspace, paths.workspace);
});

test("Conversation 绑定 Codex thread，画布 snapshot 随 revision 持久化，跨 Project 读不到", async () => {
    const store = new InMemoryResearchStore();
    const projectA = await store.createProject("alice", "A");
    const projectB = await store.createProject("alice", "B");
    const ctxA = { userId: "alice", projectId: projectA.id, canvasWorkspaceId: projectA.canvasWorkspaceId };
    const ctxB = { userId: "alice", projectId: projectB.id, canvasWorkspaceId: projectB.canvasWorkspaceId };
    const conversation = await store.createConversation(ctxA, "Explore");
    assert.equal(conversation.codexThreadId, null);
    assert.equal((await store.bindCodexThread(ctxA, conversation.id, "thr_1")).codexThreadId, "thr_1");
    assert.equal((await store.readConversation(ctxA, conversation.id)).codexThreadId, "thr_1");
    await assert.rejects(() => store.bindCodexThread(ctxB, conversation.id, "thr_x"), (error) => error instanceof AppError && error.code === "conversation_not_found");

    const saved = await store.saveCanvasState(ctxA, 2, { nodes: [{ id: "seed" }] });
    assert.equal(saved.revision, 2);
    assert.equal((saved.snapshot as { nodes: Array<{ id: string }> }).nodes[0]?.id, "seed");
    assert.equal((await store.readCanvas(ctxB)).snapshot, null);
});

test("Codex adapter 每个 Project 一个 Runtime，第二次 turn 走 resume，事件映射成产品事件", async () => {
    const { adapter, store, ctxA, ctxB, conversationA, conversationA2, conversationB, spawns, transports, runtime } = await harness();

    const first = await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "hello" });
    await settled(store, ctxA, conversationA.id, 1);
    const second = await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "again" });
    await settled(store, ctxA, conversationA.id, 2);
    await runtime.runTurn(store, ctxA, { conversationId: conversationA2.id, prompt: "other thread" });
    await settled(store, ctxA, conversationA2.id, 1);
    await runtime.runTurn(store, ctxB, { conversationId: conversationB.id, prompt: "bob project" });
    await settled(store, ctxB, conversationB.id, 1);

    assert.equal(spawns.length, 2);
    assert.ok(spawns[0]?.paths.workspace.endsWith(`${path.sep}workspace`));
    assert.ok(spawns[0]?.paths.codexHome.endsWith(`${path.sep}codex-home`));
    assert.notEqual(spawns[0]?.paths.codexHome, spawns[1]?.paths.codexHome);
    assert.equal((await store.readConversation(ctxA, conversationA.id)).codexThreadId, "thr_new");
    const methodsA = transports[0]?.calls.map((item) => item.method) || [];
    assert.ok(methodsA.includes("thread/start"));
    assert.ok(methodsA.includes("thread/resume"));
    assert.equal(methodsA.filter((method) => method === "thread/start").length, 2);
    const turnStart = transports[0]?.calls.find((item) => item.method === "turn/start")?.params as { sandboxPolicy?: unknown };
    assert.deepEqual(turnStart.sandboxPolicy, { type: "readOnly" });
    const threadStart = transports[0]?.calls.find((item) => item.method === "thread/start")?.params as { sandbox?: string; config?: Record<string, unknown> };
    assert.equal(threadStart.sandbox, "read-only");
    assert.equal(threadStart.config?.model_reasoning_summary, undefined);
    const events = await store.listEvents(ctxA, conversationA.id, 0);
    assert.ok(events.some((event) => event.type === "assistant.delta"));
    assert.ok(events.some((event) => event.type === "assistant.completed"));
    assert.equal(events.filter((event) => event.type === "run.completed").length, 2);
    assert.equal((await store.readRun(ctxA, conversationA.id, second.runId)).codexTurnId, "turn_2");
    void first;

    const live = adapter.parseLiveToken(spawns[0]!.token);
    assert.equal(live.projectId, ctxA.projectId);
    assert.throws(() => adapter.parseLiveToken(new RuntimeTokenService("test-secret").create({ ...live, runtimeId: "alice:other" })), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
    const snapshot = await adapter.readCanvas(spawns[0]!.token);
    assert.equal((snapshot.snapshot as { project: string }).project, "A");
    await assert.rejects(() => adapter.readCanvas(spawns[1]!.token), (error) => error instanceof AppError && error.code === "canvas_not_connected");
});

test("同一 Project 下不同 Conversation 可以并行跑 turn", async () => {
    const { store, ctxA, conversationA, conversationA2, spawns, transports, runtime } = await harness({ holdTurns: true });

    const first = await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "one" });
    const second = await runtime.runTurn(store, ctxA, { conversationId: conversationA2.id, prompt: "two" });
    await until(() => spawns.length === 1 && transports[0]?.held.length === 2);
    assert.equal(spawns.length, 1);
    assert.equal(transports[0]?.held.length, 2);
    transports[0]?.releaseTurns();
    await settled(store, ctxA, conversationA.id, 1);
    await settled(store, ctxA, conversationA2.id, 1);

    const eventsA = await store.listEvents(ctxA, conversationA.id, 0);
    const eventsB = await store.listEvents(ctxA, conversationA2.id, 0);
    assert.ok(eventsA.some((event) => event.type === "assistant.delta" && event.payload.delta === "hello"));
    assert.ok(eventsB.some((event) => event.type === "assistant.delta" && event.payload.delta === "hello"));
    assert.equal((await store.readConversation(ctxA, conversationA.id)).codexThreadId, "thr_new");
    assert.equal((await store.readConversation(ctxA, conversationA2.id)).codexThreadId, "thr_other");
    void first;
    void second;
});

test("Runtime 崩溃后下一 turn 重建进程并 resume 原 thread", async () => {
    const { adapter, store, ctxA, conversationA, spawns, transports, runtime } = await harness();
    await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "hello" });
    await settled(store, ctxA, conversationA.id, 1);
    const oldToken = spawns[0]!.token;
    transports[0]?.crash();
    assert.throws(() => adapter.parseLiveToken(oldToken), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
    await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "again" });
    await settled(store, ctxA, conversationA.id, 2);

    assert.equal(spawns.length, 2);
    assert.throws(() => adapter.parseLiveToken(oldToken), (error) => error instanceof AppError && error.code === "invalid_runtime_token");
    assert.equal((await store.readConversation(ctxA, conversationA.id)).codexThreadId, "thr_new");
    const methods = transports[1]?.calls.map((item) => item.method) || [];
    assert.ok(methods.includes("thread/resume"));
    assert.equal(methods.filter((method) => method === "thread/start").length, 0);
});

test("resume 失败时不改绑新 thread", async () => {
    const { store, ctxA, conversationA, transports, runtime } = await harness();
    await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "hello" });
    await settled(store, ctxA, conversationA.id, 1);
    transports[0]?.failNextResume();
    await runtime.runTurn(store, ctxA, { conversationId: conversationA.id, prompt: "again" });
    await settled(store, ctxA, conversationA.id, 1, "run.failed");
    assert.equal((await store.readConversation(ctxA, conversationA.id)).codexThreadId, "thr_new");
    assert.equal((transports[0]?.calls.filter((item) => item.method === "thread/start") || []).length, 1);
});

class ScriptedCodexTransport implements CodexTransport {
    readonly calls: Array<{ method: string; params: unknown }> = [];
    readonly held: Array<{ threadId: string; turnId: string }> = [];
    private dataHandler: ((chunk: string) => void) | null = null;
    private exitHandler: ((error?: Error) => void) | null = null;
    private started = 0;
    private turns = 0;
    private holding = false;
    private resumeFails = false;

    write(line: string) {
        const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown> };
        if (!message.method) return;
        this.calls.push({ method: message.method, params: message.params });
        if (message.method === "initialize") return this.reply(message.id, {});
        if (message.method === "thread/start") {
            this.started += 1;
            return this.reply(message.id, { thread: { id: this.started === 1 ? "thr_new" : "thr_other" } });
        }
        if (message.method === "thread/resume") {
            if (this.resumeFails) {
                this.resumeFails = false;
                return this.error(message.id, "thread missing");
            }
            return this.reply(message.id, { thread: { id: message.params?.threadId } });
        }
        if (message.method === "turn/start") {
            const threadId = String(message.params?.threadId || "");
            const turnId = `turn_${++this.turns}`;
            this.reply(message.id, { turn: { id: turnId } });
            if (this.holding) {
                this.held.push({ threadId, turnId });
                return;
            }
            setImmediate(() => this.complete(threadId, turnId));
        }
    }

    holdTurns() {
        this.holding = true;
    }

    releaseTurns() {
        this.holding = false;
        const pending = this.held.splice(0);
        for (const item of pending) this.complete(item.threadId, item.turnId);
    }

    failNextResume() {
        this.resumeFails = true;
    }

    crash() {
        this.exitHandler?.(new Error("Codex app-server exited: 1"));
    }

    onData(handler: (chunk: string) => void) {
        this.dataHandler = handler;
    }

    onExit(handler: (error?: Error) => void) {
        this.exitHandler = handler;
    }

    dispose() {}

    private complete(threadId: string, turnId: string) {
        this.notify("item/agentMessage/delta", { threadId, itemId: `${turnId}-m1`, delta: "hello" });
        this.notify("item/completed", { threadId, item: { id: `${turnId}-m1`, type: "agent_message", text: "hello" } });
        this.notify("turn/completed", { threadId, turn: { id: turnId } });
    }

    private reply(id: number | undefined, result: unknown) {
        this.dataHandler?.(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
    }

    private error(id: number | undefined, message: string) {
        this.dataHandler?.(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n");
    }

    private notify(method: string, params: unknown) {
        this.dataHandler?.(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }
}

async function harness(options: { holdTurns?: boolean } = {}) {
    const store = new InMemoryResearchStore();
    const canvas = new CanvasBridge();
    const tokens = new RuntimeTokenService("test-secret");
    const spawns: CodexSpawnContext[] = [];
    const transports: ScriptedCodexTransport[] = [];
    const adapter = new CodexRuntimeAdapter({
        bin: "codex",
        apiKey: "platform-key",
        runtimeRoot: path.join(os.tmpdir(), `coresearch-runtime-${Date.now()}-${Math.random()}`),
        tokens,
        canvas,
        mcp: { command: "node", args: ["mcp"], loopbackUrl: "http://127.0.0.1:4100/internal/runtime" },
        createTransport: (input) => {
            spawns.push(input);
            const transport = new ScriptedCodexTransport();
            if (options.holdTurns) transport.holdTurns();
            transports.push(transport);
            return transport;
        },
    });
    const runtime = new RuntimeManager(adapter, new EventHub());
    const projectA = await store.createProject("alice", "A");
    const projectB = await store.createProject("alice", "B");
    const ctxA = { userId: "alice", projectId: projectA.id, canvasWorkspaceId: projectA.canvasWorkspaceId };
    const ctxB = { userId: "alice", projectId: projectB.id, canvasWorkspaceId: projectB.canvasWorkspaceId };
    canvas.publishSnapshot(ctxA, "browser-a", 1, { project: "A" });
    const conversationA = await store.createConversation(ctxA, "A1");
    const conversationA2 = await store.createConversation(ctxA, "A2");
    const conversationB = await store.createConversation(ctxB, "B1");
    return { adapter, store, canvas, ctxA, ctxB, conversationA, conversationA2, conversationB, spawns, transports, runtime };
}

async function until(predicate: () => boolean) {
    for (let i = 0; i < 40; i += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("条件没有满足");
}

async function settled(store: InMemoryResearchStore, ctx: { userId: string; projectId: string; canvasWorkspaceId: string }, conversationId: string, terminals: number, type = "run.completed") {
    for (let i = 0; i < 40; i += 1) {
        const events = await store.listEvents(ctx, conversationId, 0);
        if (events.filter((event) => event.type === type).length >= terminals) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error("run 没有结束");
}
