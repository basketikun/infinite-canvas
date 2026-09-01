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
        reopened.close();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
