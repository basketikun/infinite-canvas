import assert from "node:assert/strict";
import test from "node:test";
import { openSession, saveAndClose } from "../src/studio/editor/io/session";

test("读取节点场景失败后关闭不会写入空场景", async (t) => {
    const channel = new MessageChannel();
    t.after(() => { channel.port1.close(); channel.port2.close(); });
    const actions: string[] = [];
    channel.port1.onmessage = ({ data }) => {
        actions.push(data.action);
        channel.port1.postMessage({ id: data.id, ok: data.action === "close" });
    };
    await assert.rejects(openSession(channel.port2));
    await saveAndClose();
    assert.deepEqual(actions, ["load", "close"]);
});

test("正常关闭等待保存回执；失败保留编辑器，重试保存成功才关闭", async (t) => {
    const channel = new MessageChannel();
    t.after(() => { channel.port1.close(); channel.port2.close(); });
    const actions: string[] = [];
    const saving = Promise.withResolvers<void>();
    const saved = Promise.withResolvers<void>();
    channel.port1.onmessage = async ({ data }) => {
        if (data.ready) return;
        actions.push(data.action);
        if (data.action === "load") channel.port1.postMessage({ id: data.id, ok: true, value: { scene: null, files: [], sceneId: "canvas:one:desk" } });
        else if (data.action === "save" && actions.length === 2) channel.port1.postMessage({ id: data.id, ok: false });
        else {
            if (data.action === "save") { saving.resolve(); await saved.promise; }
            channel.port1.postMessage({ id: data.id, ok: true });
        }
    };
    await openSession(channel.port2);
    await saveAndClose();
    assert.deepEqual(actions, ["load", "save"]);
    const closing = saveAndClose();
    await saving.promise;
    assert.deepEqual(actions, ["load", "save", "save"]);
    saved.resolve();
    await closing;
    assert.deepEqual(actions, ["load", "save", "save", "close"]);
});
