import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CollaborationCoordinator } from "./coordinator.js";
import { CollaborationStore } from "./store.js";

const codex = { kind: "codex" as const, name: "Codex", instanceId: "codex-1" };
const zcode = { kind: "zcode" as const, name: "ZCode", instanceId: "zcode-1" };

test("broadcast tasks are claimed and completed independently", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Review", goal: "Review the canvas", mode: "broadcast", targetKinds: ["zcode"] }, codex) as { id: string; tasks: Array<{ id: string }> };
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        const claimed = await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode) as { task: { id: string }; claim: { attempt: number } };
        assert.equal(claimed.task.id, session.tasks[0].id);
        const first = await fixture.coordinator.handle("collaboration_submit_result", { sessionId: session.id, taskId: claimed.task.id, summary: "done" }, zcode);
        const duplicate = await fixture.coordinator.handle("collaboration_submit_result", { sessionId: session.id, taskId: claimed.task.id, summary: "duplicate" }, zcode);
        assert.equal((duplicate as { summary: string }).summary, (first as { summary: string }).summary);
        assert.equal((duplicate as { attempt: number }).attempt, (first as { attempt: number }).attempt);
        const results = await fixture.coordinator.handle("collaboration_get_results", { sessionId: session.id }, zcode) as { status: string };
        assert.equal(results.status, "completed");
    } finally {
        await fixture.cleanup();
    }
});

test("leaving releases the last claim and terminal tasks cannot be reclaimed", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Review", goal: "Review", mode: "broadcast", targetKinds: ["zcode"] }, codex) as { id: string; tasks: Array<{ id: string }> };
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_leave", { sessionId: session.id }, zcode);
        assert.equal((await fixture.store.read()).sessions[0].tasks[0].status, "open");
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_submit_result", { sessionId: session.id, taskId: session.tasks[0].id, summary: "done" }, zcode);
        await assert.rejects(() => fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id, taskId: session.tasks[0].id }, zcode), /会话已结束|任务已结束/);
    } finally {
        await fixture.cleanup();
    }
});

test("an agent cannot reclaim a task after submitting its result", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Review", goal: "Review", mode: "broadcast", targetKinds: ["zcode", "trae"] }, codex) as { id: string; tasks: Array<{ id: string }> };
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_submit_result", { sessionId: session.id, taskId: session.tasks[0].id, summary: "done" }, zcode);
        await assert.rejects(() => fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id, taskId: session.tasks[0].id }, zcode), /已提交/);
        assert.equal((await fixture.store.read()).sessions[0].tasks[0].claims.length, 0);
    } finally {
        await fixture.cleanup();
    }
});

test("expired claims cannot submit results", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Review", goal: "Review", mode: "broadcast", targetKinds: ["zcode"] }, codex) as { id: string; tasks: Array<{ id: string }> };
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode);
        await fixture.store.mutate((data) => {
            data.sessions[0].tasks[0].claims[0].leaseUntil = Date.now() - 1;
        });
        await assert.rejects(() => fixture.coordinator.handle("collaboration_submit_result", { sessionId: session.id, taskId: session.tasks[0].id, summary: "late" }, zcode), /未领取/);
    } finally {
        await fixture.cleanup();
    }
});

test("collaboration results receive stable operation ids", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Build", goal: "Build", mode: "broadcast", targetKinds: ["zcode"] }, codex) as { id: string; tasks: Array<{ id: string }> };
        await fixture.coordinator.handle("collaboration_join", { sessionId: session.id }, zcode);
        await fixture.coordinator.handle("collaboration_claim_task", { sessionId: session.id }, zcode);
        const result = await fixture.coordinator.handle("collaboration_submit_result", {
            sessionId: session.id,
            taskId: session.tasks[0].id,
            summary: "done",
            data: { projectId: "project-1", baseRevision: 1, ops: [{ type: "add_node", nodeType: "text" }] },
        }, zcode) as { data: { ops: Array<{ id?: string }> } };
        assert.match(result.data.ops[0].id || "", /^[a-f0-9-]{36}$/);
    } finally {
        await fixture.cleanup();
    }
});

test("orchestrated sessions enforce coordinator and depth limits", async () => {
    const fixture = await createFixture();
    try {
        const session = await fixture.coordinator.handle("collaboration_create_plan", { title: "Build", goal: "Build", mode: "orchestrated", maxDepth: 1 }, codex) as { id: string };
        await assert.rejects(() => fixture.coordinator.handle("collaboration_delegate_task", { sessionId: session.id, title: "Denied", instructions: "x", targetKinds: ["trae"] }, zcode), /主 Agent/);
        const parent = await fixture.coordinator.handle("collaboration_delegate_task", { sessionId: session.id, title: "Parent", instructions: "x", targetKinds: ["trae"] }, codex) as { id: string };
        const child = await fixture.coordinator.handle("collaboration_delegate_task", { sessionId: session.id, parentTaskId: parent.id, title: "Child", instructions: "x", targetKinds: ["trae"] }, codex) as { id: string };
        await assert.rejects(() => fixture.coordinator.handle("collaboration_delegate_task", { sessionId: session.id, parentTaskId: child.id, title: "Too deep", instructions: "x", targetKinds: ["trae"] }, codex), /最大委派深度/);
        await fixture.coordinator.handle("collaboration_cancel_task", { sessionId: session.id, taskId: parent.id }, codex);
        const stored = (await fixture.store.read()).sessions[0];
        assert.deepEqual(stored.tasks.map((task) => task.status), ["cancelled", "cancelled"]);
    } finally {
        await fixture.cleanup();
    }
});

test("cancelling active Codex work interrupts the adapter and terminal sessions stay terminal", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-cancel-"));
    const store = new CollaborationStore(path.join(directory, "sessions.json"));
    let release!: () => void;
    let interrupts = 0;
    const running = new Promise<void>((resolve) => {
        release = resolve;
    });
    const coordinator = new CollaborationCoordinator(store, undefined, {
        codex: {
            capabilities: { streaming: true, interrupt: true },
            dispatch: async () => {
                await running;
                return { summary: "stopped" };
            },
            interrupt: async () => {
                interrupts += 1;
                release();
                return true;
            },
            status: () => "running",
        },
    });
    try {
        const session = await coordinator.handle("collaboration_create_plan", { title: "Active", goal: "Run", mode: "broadcast", targetKinds: ["codex"], codexDispatch: "active" }, codex) as { id: string };
        for (let index = 0; index < 20 && !(await store.read()).sessions[0]?.tasks[0]?.claims.length; index += 1) await new Promise((resolve) => setTimeout(resolve, 5));
        await coordinator.handle("collaboration_cancel_session", { sessionId: session.id }, codex);
        assert.equal(interrupts, 1);
        await assert.rejects(() => coordinator.handle("collaboration_complete_session", { sessionId: session.id }, codex), /已结束/);
        assert.equal((await store.read()).sessions[0].status, "cancelled");
    } finally {
        release();
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test("active Codex dispatch writes the same result envelope as mailbox workers", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-active-"));
    const store = new CollaborationStore(path.join(directory, "sessions.json"));
    const coordinator = new CollaborationCoordinator(store, undefined, {
        codex: {
            capabilities: { streaming: true, interrupt: true },
            dispatch: async () => ({ summary: "active result" }),
            interrupt: async () => true,
            status: () => "idle",
        },
    });
    try {
        const session = await coordinator.handle("collaboration_create_plan", { title: "Active", goal: "Run", mode: "broadcast", targetKinds: ["codex"], codexDispatch: "active" }, codex) as { id: string };
        for (let index = 0; index < 20; index += 1) {
            const stored = (await store.read()).sessions.find((item) => item.id === session.id);
            if (stored?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const stored = (await store.read()).sessions.find((item) => item.id === session.id)!;
        assert.equal(stored.status, "completed");
        assert.equal(stored.tasks[0].results[0].summary, "active result");
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

async function createFixture() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-collaboration-"));
    const store = new CollaborationStore(path.join(directory, "sessions.json"));
    const coordinator = new CollaborationCoordinator(store);
    return { coordinator, store, cleanup: () => fs.rm(directory, { recursive: true, force: true }) };
}
