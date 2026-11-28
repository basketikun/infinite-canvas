import assert from "node:assert/strict";
import { test } from "node:test";
import { voxelEditInput } from "../src/lib/voxel-edit";
import { openSession } from "../src/studio/editor/io/session";
import { useDirectorStore } from "../src/studio/editor/store/directorStore";
import type { DirectorProject } from "../src/studio/editor/schema/directorProject";

const base = { sceneId: "voxel-test", objectId: "target", cell: [0, 0, 0] };

test("requires integer grid coordinates and color for paint and add only", () => {
    assert.equal(voxelEditInput.safeParse({ ...base, operation: "paint" }).success, false);
    assert.equal(voxelEditInput.safeParse({ ...base, operation: "add", color: "red" }).success, false);
    assert.equal(voxelEditInput.safeParse({ ...base, operation: "delete", color: "#ff0000" }).success, false);
    assert.equal(voxelEditInput.safeParse({ ...base, operation: "delete", cell: [0.5, 0, 0] }).success, false);
    assert.equal(voxelEditInput.safeParse({ ...base, operation: "add", color: "#ff0000", cell: [-1, 0, 0] }).success, true);
});

test("edits only the requested open scene and acknowledges after persistence", async () => {
    const project: DirectorProject = {
        ...useDirectorStore.getState().project, assets: [], cameras: [],
        objects: [{ id: "target", name: "Target", kind: "prop", visible: true, locked: false,
            transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            voxel: { origin: [0, 0, 0], dimensions: [1, 1, 1], voxelSize: 0.5, cells: { "0,0,0": "#ffffff" } },
        }],
    };
    project.objects.push({ ...project.objects[0], id: "locked", locked: true });
    const channel = new MessageChannel();
    const saved: DirectorProject[] = [];
    const replies = new Map<string, (value: { ok: boolean; value?: unknown; error?: string }) => void>();
    channel.port1.onmessage = ({ data }) => {
        if (data.action === "load") channel.port1.postMessage({ id: data.id, ok: true, value: { scene: { project, keys: [] }, files: [], sceneId: base.sceneId } });
        if (data.action === "save") {
            setTimeout(() => {
                saved.push(data.scene.project);
                channel.port1.postMessage({ id: data.id, ok: true });
            }, 5);
        }
        if (data.requestId) replies.get(data.requestId)?.(data);
    };
    function edit(input: object, sceneId = base.sceneId) {
        return new Promise<{ ok: boolean; value?: unknown; error?: string }>((resolve) => {
            const requestId = crypto.randomUUID();
            replies.set(requestId, result => { replies.delete(requestId); resolve(result); });
            channel.port1.postMessage({ action: "edit-voxel", input: { ...base, ...input }, sceneId, requestId });
        });
    }
    try {
        await openSession(channel.port2);
        const initialUndo = useDirectorStore.getState().undoStack.length;
        assert.equal((await edit({ operation: "delete" }, "other")).ok, false);
        assert.equal((await edit({ operation: "delete", sceneId: "other" })).ok, false);
        assert.equal((await edit({ operation: "delete", objectId: "missing" })).ok, false);
        assert.match((await edit({ operation: "delete", objectId: "locked" })).error || "", /锁定/);
        assert.equal((await edit({ operation: "add", color: "#123456" })).ok, false);
        assert.equal((await edit({ operation: "add", color: "#123456", cell: [100, 0, 0] })).ok, false);
        assert.equal(saved.length, 0);
        assert.equal((await edit({ operation: "paint", color: "#123456" })).ok, true);
        assert.equal(saved[0].objects[0].voxel?.cells["0,0,0"], "#123456");
        assert.equal((await edit({ operation: "paint", color: "#123456" })).ok, true);
        assert.equal(saved.length, 1);
        const added = await edit({ operation: "add", color: "#fedcba", cell: [-1, 0, 0] });
        assert.deepEqual(added.value, { ...base, changed: true });
        assert.deepEqual(saved[1].objects[0].voxel, { origin: [-0.5, 0, 0], dimensions: [2, 1, 1], voxelSize: 0.5, cells: { "0,0,0": "#fedcba", "1,0,0": "#123456" } });
        assert.equal((await edit({ operation: "delete" })).ok, true);
        assert.deepEqual(saved[2].objects[0].voxel?.cells, { "1,0,0": "#123456" });
        assert.equal(useDirectorStore.getState().undoStack.length, initialUndo + 3);
    } finally {
        channel.port1.close();
        channel.port2.close();
    }
});
