import assert from "node:assert/strict";
import test from "node:test";

import { AgentRegistry } from "./registry.js";

const codex = { kind: "codex" as const, name: "Codex", instanceId: "codex-1" };

test("tracks independent agent instances and activities", () => {
    const events: string[] = [];
    const registry = new AgentRegistry((type) => events.push(type));
    registry.touch(codex);
    registry.touch({ kind: "trae", name: "TraeCode", instanceId: "trae-1" });
    const activity = registry.begin(codex, "canvas_get_state");
    registry.finish(activity.activityId, { resultRevision: 3 });
    assert.equal(registry.snapshot().length, 2);
    assert.equal(registry.activitySnapshot()[0].resultRevision, 3);
    assert.ok(events.includes("agents_changed"));
    assert.ok(events.includes("agent_activity"));
});

test("keeps an agent busy until all concurrent activities finish", () => {
    const registry = new AgentRegistry(() => undefined);
    const first = registry.begin(codex, "canvas_get_state");
    const second = registry.begin(codex, "canvas_create_text_node");
    registry.finish(first.activityId);
    assert.equal(registry.snapshot()[0].status, "running");
    assert.equal(registry.snapshot()[0].currentTool, "canvas_create_text_node");
    registry.finish(second.activityId);
    assert.equal(registry.snapshot()[0].status, "idle");
    assert.equal(registry.snapshot()[0].currentTool, undefined);
});

test("marks stale agents offline", async () => {
    const registry = new AgentRegistry(() => undefined, 1);
    registry.touch(codex);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(registry.snapshot()[0].status, "offline");
    assert.equal(registry.touch(codex).status, "idle");
});
