import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { RuntimeDatabase } from "./database.js";

test("runtime database persists task state and events", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "infinite-canvas-runtime-"));
    const file = path.join(dir, "runtime.sqlite");
    try {
        const database = new RuntimeDatabase(file);
        const task = database.createTask("test", { input: "x" }, { seed: 1 });
        database.updateTask(task.id, { status: "succeeded", progress: 1, result: { path: "out.png" } });
        database.addEvent(task.id, "result", { path: "out.png" });
        database.setSetting("comfyui.url", "http://127.0.0.1:8188");
        assert.equal(database.getTask(task.id)?.status, "succeeded");
        assert.equal(database.getTask(task.id)?.result?.path, "out.png");
        assert.equal(database.listEvents(task.id).length, 1);
        database.close();
        const reopened = new RuntimeDatabase(file);
        assert.equal(reopened.getTask(task.id)?.params.seed, 1);
        assert.equal(reopened.getSetting("comfyui.url"), "http://127.0.0.1:8188");
        assert.deepEqual(reopened.listCanvasProjects(), []);
        reopened.replaceCanvasProjects([{ id: "canvas-1", title: "测试画布", nodes: [{ id: "node-1" }], connections: [] }]);
        assert.equal(reopened.listCanvasProjects()[0]?.title, "测试画布");
        reopened.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("generation logs persist, filter, and delete without base64 media", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "infinite-canvas-generation-log-"));
    const file = path.join(dir, "runtime.sqlite");
    try {
        const database = new RuntimeDatabase(file);
        const log = database.createGenerationLog({ projectId: "p1", nodeId: "n1", segmentId: "clip-1", status: "queued", platform: "ComfyUI", taskMode: "r2v", prompt: "test", references: [{ url: "runtime-file:ref.png" }], inputCounts: { image: 1, video: 1, audio: 0 }, startedAt: new Date().toISOString(), durationMs: 0, outputs: [], params: {} });
        database.updateGenerationLog(log.id, { status: "success", durationMs: 1234, outputs: [{ url: "runtime-file:out.mp4", type: "video" }] });
        assert.equal(database.listGenerationLogs({ projectId: "p1", status: "success" })[0]?.segmentId, "clip-1");
        assert.equal(database.deleteGenerationLogs({ id: log.id }), 1);
        assert.equal(database.getGenerationLog(log.id), null);
        database.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
