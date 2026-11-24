import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ExtensionRegistry, PluginScope, contribute, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { cameraLayouts, defineCameraLayout } from "../src/api/camera-layouts";
import { orbit } from "../src/layouts/orbit";
import { createInitialDirectorState, useDirectorStore } from "../src/studio/editor/store/directorStore";
import { getSceneSummary } from "../src/studio/editor/schema/cameraLayouts";
import { getCameraViewSnapshotFromShot } from "../src/studio/editor/schema/cameraGeometry";

function reset() {
    useDirectorStore.setState({ ...createInitialDirectorState(), undoStack: [], undoBatchDepth: 0, undoBatchSnapshot: null, undoBatchHasTrackedChanges: false });
    const { project, selectedObjectIds } = useDirectorStore.getState();
    return getSceneSummary(project, selectedObjectIds, "standalone");
}
function generate() {
    const scene = reset();
    return orbit.generate({ scene, parameters: { targetObjectId: "char_default_a", distance: 8, height: 2, count: 4 } }, { signal: new AbortController().signal });
}

test("摘要仅公开布局业务数据，坐标保留场景局部变换", () => {
    reset();
    const project = structuredClone(useDirectorStore.getState().project);
    project.scene.position = [10, 20, 30];
    project.scene.scale = 2;
    project.cameras[0].lastCaptureUrl = "private-capture";
    project.assets.push({ id: "private", kind: "scene", sourceType: "model", fileName: "private.glb", url: "private-url" });
    const scene = getSceneSummary(project, ["char_default_a"], "canvas:project");
    assert.deepEqual(scene.transform, { position: [10, 20, 30], rotation: project.scene.rotation, scale: [2, 2, 2] });
    assert.deepEqual(scene.cameras[0].position, project.cameras[0].transform.position);
    assert.notDeepEqual(scene.cameras[0].position, getCameraViewSnapshotFromShot(project.cameras[0]).position);
    assert.equal(JSON.stringify(scene).includes("private"), false);
    assert.equal(scene.objects.find(object => object.kind === "camera")!.focusTarget, null);
});

test("环绕布局一次追加完整镜头结构并通知保存，一次撤销恢复原场景与选择", async () => {
    const result = await generate();
    const before = useDirectorStore.getState();
    let writes = 0;
    const unsubscribe = useDirectorStore.subscribe((state, previous) => { if (state.project !== previous.project) writes++; });
    before.applyCameraLayout(result);
    const after = useDirectorStore.getState();
    assert.equal(writes, 1);
    assert.equal(after.undoStack.length, 1);
    assert.equal(after.project.cameras.length, before.project.cameras.length + 4);
    assert.deepEqual(after.project.cameras[0], before.project.cameras[0]);
    for (const [index, camera] of after.project.cameras.slice(before.project.cameras.length).entries()) {
        const object = after.project.objects.find(item => item.linkedCameraId === camera.id)!;
        assert.equal(object.kind, "camera");
        assert.deepEqual(object.transform, camera.transform);
        assert.deepEqual(camera.transform.position, result.shots[index].position);
        assert.equal(camera.targetMode, "object");
        assert.equal(camera.targetObjectId, "char_default_a");
    }
    assert.equal(after.project.objects.find(item => item.id === after.selectedObjectId)!.linkedCameraId, after.project.activeCameraId);
    after.undo();
    assert.deepEqual(useDirectorStore.getState().project, before.project);
    assert.deepEqual(useDirectorStore.getState().selectedObjectIds, before.selectedObjectIds);
    unsubscribe();
});

test("失效目标与无效镜头整批拒绝，不产生半份场景或撤销记录", async () => {
    const result = await generate();
    const before = useDirectorStore.getState();
    result.shots[3].targetObjectId = "removed";
    assert.throws(() => before.applyCameraLayout(result), /CAMERA_TARGET_MISSING/);
    assert.equal(useDirectorStore.getState(), before);
    result.shots[3].targetObjectId = null;
    result.shots[3].fov = 121;
    assert.throws(() => before.applyCameraLayout(result));
    assert.equal(useDirectorStore.getState(), before);
    assert.equal(before.undoStack.length, 0);
});

test("应用前目标移动使用当前焦点，手动目标保留布局坐标", async () => {
    const result = await generate();
    const state = useDirectorStore.getState();
    state.updateObjectTransform("char_default_a", { position: [3, 4, 5] });
    const scene = getSceneSummary(useDirectorStore.getState().project, [], "standalone");
    result.shots[1].targetObjectId = null;
    result.shots[1].target = [7, 8, 9];
    useDirectorStore.getState().applyCameraLayout(result);
    const cameras = useDirectorStore.getState().project.cameras.slice(-4);
    assert.deepEqual(cameras[0].target, scene.objects.find(object => object.id === "char_default_a")!.focusTarget);
    assert.deepEqual(cameras[1].target, [7, 8, 9]);
    assert.equal(cameras[1].targetMode, "manual");
});

test("冻结导演台消费者后增加第二种布局，取消附属插件拒绝迟到结果", async () => {
    const registry = new ExtensionRegistry();
    const provider = registry.createInstance({ id: "director-desk", scope: new PluginScope() });
    provider.register({ extensionPoints: [cameraLayouts], contributions: [contribute(cameraLayouts, { id: "director-desk:orbit", value: orbit })] });
    const addon = registry.createInstance({ id: "third-party", scope: new PluginScope() });
    const fixed = defineCameraLayout({ title: "固定镜头", parametersSchema: z.object({}), generate: ({ scene }) => ({ sceneId: scene.sceneId, shots: [{ name: "固定", position: [1, 2, 3], target: [0, 0, 0], targetObjectId: null, fov: 50 }] }) });
    addon.register({ contributions: [contribute(cameraLayouts, { id: "third-party:fixed", value: fixed })] });
    const binding: ScopeBinding = { kind: "view", viewId: "director", workspaceId: "workspace", signal: new AbortController().signal };
    const entries = provider.extensions.query(cameraLayouts, binding);
    assert.equal(entries.length, 2);
    const entry = entries.find(item => item.id === "third-party:fixed")!;
    const scene = reset();
    let release!: () => void;
    const work = provider.extensions.track(entry, async () => {
        const result = await entry.value.generate({ scene, parameters: {} }, { signal: entry.signal });
        await new Promise<void>(resolve => { release = resolve; });
        entry.assertActive();
        useDirectorStore.getState().applyCameraLayout(result);
    });
    await new Promise(resolve => setImmediate(resolve));
    const failed = assert.rejects(work, { code: "PLUGIN_INACTIVE" });
    const stopping = addon.scope.close();
    assert.equal(entry.signal.aborted, true);
    release();
    await Promise.all([failed, stopping]);
    assert.equal(useDirectorStore.getState().undoStack.length, 0);
    assert.deepEqual(provider.extensions.query(cameraLayouts, binding).map(item => item.id), ["director-desk:orbit"]);
    await provider.scope.close();
});

test("导演台消息绑定当前场景，拒绝其他场景的结果且成功布局只保存一次", async () => {
    const result = await generate();
    const { openSession } = await import("../src/studio/editor/io/session");
    const channel = new MessageChannel();
    const replies = new Map<string, (value: { ok: boolean; value?: unknown }) => void>();
    let saves = 0;
    channel.port1.onmessage = ({ data }) => {
        if (data.action === "load") channel.port1.postMessage({ id: data.id, ok: true, value: { scene: null, files: [], canvas: false, sceneId: "standalone" } });
        if (data.action === "save") { saves++; channel.port1.postMessage({ id: data.id, ok: true }); }
        if (data.requestId) replies.get(data.requestId)?.(data);
    };
    const request = (sceneId: string, action: object) => new Promise<{ ok: boolean; value?: unknown }>(resolve => {
        const requestId = crypto.randomUUID();
        replies.set(requestId, value => { replies.delete(requestId); resolve(value); });
        channel.port1.postMessage({ ...action, requestId, sceneId });
    });
    try {
        await openSession(channel.port2);
        const before = useDirectorStore.getState();
        assert.equal((await request("other", { action: "apply-layout", result })).ok, false);
        assert.equal((await request("standalone", { action: "apply-layout", result: { ...result, sceneId: "other" } })).ok, false);
        assert.equal(useDirectorStore.getState(), before);
        assert.equal(saves, 0);
        assert.equal((await request("standalone", { action: "apply-layout", result })).ok, true);
        assert.equal(saves, 1);
        assert.equal(useDirectorStore.getState().undoStack.length, 1);
    } finally { channel.port1.close(); channel.port2.close(); }
});
