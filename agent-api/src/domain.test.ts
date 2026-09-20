import assert from "node:assert/strict";
import test from "node:test";

import { CanvasBridge } from "./canvas-bridge.js";
import { AppError } from "./errors.js";
import { EventHub } from "./event-hub.js";
import { InMemoryResearchStore } from "./in-memory-store.js";
import { ProjectModule } from "./project-module.js";
import type { RuntimeAdapter } from "./runtime.js";
import { RuntimeManager } from "./runtime-manager.js";

test("每个用户只能读取自己的 Project，且每个 Project 有不同的唯一 Canvas Workspace", async () => {
    const store = new InMemoryResearchStore();
    const projects = new ProjectModule(store);
    const aliceA = await projects.create("alice", { name: "A" });
    const aliceB = await projects.create("alice", { name: "B" });
    const bob = await projects.create("bob", { name: "B" });

    assert.notEqual(aliceA.canvasWorkspaceId, aliceB.canvasWorkspaceId);
    assert.deepEqual((await projects.listMine("alice")).map((project) => project.id).sort(), [aliceA.id, aliceB.id].sort());
    assert.deepEqual((await projects.listMine("bob")).map((project) => project.id), [bob.id]);
    await assert.rejects(() => projects.readOwned("alice", bob.id), (error) => error instanceof AppError && error.code === "project_not_found");
});

test("伪造另一个 Project 的 Canvas Workspace 或 Conversation 会被拒绝", async () => {
    const store = new InMemoryResearchStore();
    const projectA = await store.createProject("alice", "A");
    const projectB = await store.createProject("alice", "B");
    const ctxA = { userId: "alice", projectId: projectA.id, canvasWorkspaceId: projectA.canvasWorkspaceId };
    const ctxB = { userId: "alice", projectId: projectB.id, canvasWorkspaceId: projectB.canvasWorkspaceId };
    const conversationA = await store.createConversation(ctxA, "A conversation");

    await assert.rejects(() => store.readCanvas({ ...ctxA, canvasWorkspaceId: projectB.canvasWorkspaceId }), (error) => error instanceof AppError && error.code === "canvas_scope_mismatch");
    await assert.rejects(() => store.readConversation(ctxB, conversationA.id), (error) => error instanceof AppError && error.code === "conversation_not_found");
});

test("Conversation session 使用 revision 比较并交换，避免覆盖并发历史", async () => {
    const store = new InMemoryResearchStore();
    const project = await store.createProject("alice", "A");
    const ctx = { userId: "alice", projectId: project.id, canvasWorkspaceId: project.canvasWorkspaceId };
    const conversation = await store.createConversation(ctx, "Conversation");
    const original = await store.loadConversationSession(ctx, conversation.id);

    assert.equal(await store.saveConversationSession(ctx, conversation.id, { ...original, entries: [{ type: "message" }] }), 1);
    await assert.rejects(() => store.saveConversationSession(ctx, conversation.id, original), (error) => error instanceof AppError && error.code === "session_revision_conflict");
});

test("Project Skill 和 Canvas 工具调用不能跨 Project", async () => {
    const store = new InMemoryResearchStore();
    const canvas = new CanvasBridge();
    const projectA = await store.createProject("alice", "A");
    const projectB = await store.createProject("alice", "B");
    const ctxA = { userId: "alice", projectId: projectA.id, canvasWorkspaceId: projectA.canvasWorkspaceId };
    const ctxB = { userId: "alice", projectId: projectB.id, canvasWorkspaceId: projectB.canvasWorkspaceId };

    await store.saveSkill(ctxA, { name: "A only", definition: "Only A", enabled: true });
    assert.equal((await store.listSkills(ctxA)).length, 1);
    assert.equal((await store.listSkills(ctxB)).length, 0);

    canvas.publishSnapshot(ctxA, "browser-a", 1, { project: "A" });
    assert.equal(canvas.readSnapshot(ctxA).snapshot.project, "A");
    assert.throws(() => canvas.readSnapshot(ctxB), (error) => error instanceof AppError && error.code === "canvas_not_connected");

    const controller = new AbortController();
    const mutation = canvas.requestMutation(ctxA, controller.signal);
    assert.throws(() => canvas.completeMutation(ctxB, mutation.callId, { approved: true }), (error) => error instanceof AppError && error.code === "canvas_tool_call_not_found");
    controller.abort();
    await assert.rejects(mutation.result, (error) => error instanceof AppError && error.code === "run_aborted");
});

test("同一 Conversation 拒绝并发 run，不同 Conversation 可以并行，abort 只有一个终态", async () => {
    const store = new InMemoryResearchStore();
    const adapter = new BlockingRuntime();
    const runtime = new RuntimeManager(adapter, new EventHub());
    const project = await store.createProject("alice", "A");
    const ctx = { userId: "alice", projectId: project.id, canvasWorkspaceId: project.canvasWorkspaceId };
    const firstConversation = await store.createConversation(ctx, "First");
    const secondConversation = await store.createConversation(ctx, "Second");

    await store.archiveConversation(ctx, secondConversation.id);
    await assert.rejects(() => runtime.runTurn(store, ctx, { conversationId: secondConversation.id, prompt: "archived" }), (error) => error instanceof AppError && error.code === "conversation_archived");
    const activeSecondConversation = await store.createConversation(ctx, "Active second");

    const first = await runtime.runTurn(store, ctx, { conversationId: firstConversation.id, prompt: "first" });
    await assert.rejects(() => runtime.runTurn(store, ctx, { conversationId: firstConversation.id, prompt: "conflict" }), (error) => error instanceof AppError && error.code === "conversation_busy");
    const second = await runtime.runTurn(store, ctx, { conversationId: activeSecondConversation.id, prompt: "parallel" });

    await runtime.abort(store, ctx, firstConversation.id, first.runId);
    adapter.complete(second.runId);
    await adapter.settled(first.runId);
    await adapter.settled(second.runId);
    await new Promise((resolve) => setImmediate(resolve));

    const firstEvents = await store.listEvents(ctx, firstConversation.id, 0);
    assert.equal(firstEvents.filter((event) => ["run.completed", "run.failed", "run.aborted"].includes(event.type)).length, 1);
    assert.equal(firstEvents.at(-1)?.type, "run.aborted");
    assert.equal((await store.readRun(ctx, firstConversation.id, first.runId)).status, "aborted");
    assert.equal((await store.readRun(ctx, activeSecondConversation.id, second.runId)).status, "completed");
});

class BlockingRuntime implements RuntimeAdapter {
    private readonly completions = new Map<string, () => void>();
    private readonly settlements = new Map<string, Promise<void>>();

    execute(input: Parameters<RuntimeAdapter["execute"]>[0]) {
        const promise = new Promise<void>((resolve) => {
            this.completions.set(input.runId, resolve);
            input.signal.addEventListener("abort", resolve, { once: true });
        });
        this.settlements.set(input.runId, promise);
        return promise;
    }

    complete(runId: string) {
        this.completions.get(runId)?.();
    }

    settled(runId: string) {
        return this.settlements.get(runId) || Promise.resolve();
    }
}
