import { useThemeStore } from "../src/stores/use-theme-store";
import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import localforage from "localforage";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { packTar } from "modern-tar";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import * as points from "@infinite-canvas/plugin-sdk/builtin";
import { defineCapability, defineExtensionPoint, contribute, type ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { z } from "zod";
import { defineCommand, type CanvasNodeContext, type CanvasPluginHost, type PluginMenuItem, type PluginMenuTarget, type ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import type { CanvasDocument, CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { NodeInfoRecord } from "../src/pages/canvas/hooks/use-node-info";
import type { OpenNodePanel } from "../src/pages/canvas/hooks/use-plugin-host";
import { PLUGIN_PACKAGE_MAX_BYTES, getPluginErrorMessage, PluginError, pluginErrorMessages, pluginPackageSchema, type InstalledPlugin, type PluginPackage } from "@infinite-canvas/shared/plugins";
import { createMemoryCollection, createMemoryStorage, createMemoryWorkspaceConfig } from "./helpers/storage";
import { initializeWorkspaceConfig } from "../src/services/workspace-config/runtime";
import { initializeStorage } from "../src/services/storage/runtime";
import { initializeNetwork } from "../src/services/network/runtime";
import { createBrowserPlugins } from "../src/services/plugins/browser";
import { initializePlugins } from "../src/services/plugins/runtime";
import { usePluginStore } from "../src/stores/use-plugin-store";
import { pluginRegistry, workspaceBinding } from "../src/lib/plugins/registry";
import React from "react";
import { renderToString } from "react-dom/server";

initializeStorage(createMemoryStorage());
const { CanvasSession } = await import("../src/lib/canvas/canvas-session");
initializeWorkspaceConfig(createMemoryWorkspaceConfig());
initializeNetwork({ kind: "browser", url: (url) => url });
const imagePreviews = createMemoryCollection();
const createInstance = localforage.createInstance;
localforage.createInstance = (options) => options?.storeName === "image_previews" ? imagePreviews as ReturnType<typeof createInstance> : createInstance.call(localforage, options);
after(() => { localforage.createInstance = createInstance; });
const { activatePlugin, deactivatePlugin, emitPluginEvent, getPluginContext, getPluginContributions, runPluginCallback, setPluginCanvas } = await import("../src/lib/plugins/runtime");
const { getSelectedLayout } = await import("../src/lib/plugins/layout");
const { resolvePluginMenu } = await import("../src/lib/plugins/menus");
const adapter = createBrowserPlugins();
initializePlugins(adapter);
const pkg: PluginPackage = { name: "canvas-plugin-test", version: "1.0.0", infiniteCanvas: { id: "test", name: "测试", client: "dist/client.js" } };
Object.assign(globalThis, { pluginTestPoints: points });

function canvasFixture(id: string, nodes: CanvasNodeData[] = [], selected: string[] = []) {
    const project = { schemaVersion: 1 as const, id, title: "测试画布", nodes, connections: [], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "lines" as const, showImageInfo: false, chatSessions: [], activeChatId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const session = new CanvasSession({ project, store: { openProject: (projectId) => projectId === id ? project : null, updateProject() {}, flush: async () => {}, subscribeSaves: () => () => {} } });
    session.setSelection({ nodeIds: selected, connectionId: null }, { kind: "ui" });
    return session;
}

test("构建后的插件共享宿主 React、Hooks 和标准 JSX 运行时", async (t) => {
    const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { buildPlugin } = await import("@infinite-canvas/plugin-sdk/build");
    const directory = await mkdtemp(join(tmpdir(), "canvas-plugin-react-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, "package.json"), JSON.stringify({ infiniteCanvas: { client: "client.js" } }));
    await writeFile(join(directory, "entry.tsx"), `import React, { useState } from "react";
import { jsxDEV } from "react/jsx-dev-runtime";
export const shared = React;
export const dev = jsxDEV("span", { children: "dev" }, undefined, false);
export default function Content() { const [value] = useState("shared"); return <div><span>{value}</span><span>jsx</span></div>; }`);
    await buildPlugin(pathToFileURL(join(directory, "build.mjs")).href, { entries: { client: "entry.tsx" } });
    const target = globalThis as unknown as { InfiniteCanvasRuntime?: unknown };
    const previous = target.InfiniteCanvasRuntime;
    target.InfiniteCanvasRuntime = { React, jsxRuntime: await import("react/jsx-runtime"), jsxDevRuntime: await import("react/jsx-dev-runtime") };
    try {
        const source = await readFile(join(directory, "client.js"), "utf8");
        const plugin = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
        assert.equal(plugin.shared, React);
        assert.match(renderToString(React.createElement(plugin.default)), /shared/);
        assert.equal(renderToString(plugin.dev), "<span>dev</span>");
    } finally { target.InfiniteCanvasRuntime = previous; }
});

// Node 不加载 blob 模块，测试把同一份浏览器入口映射为 data 模块。
async function activate(source: string, value = pkg) {
    const original = URL.createObjectURL;
    URL.createObjectURL = () => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${Math.random()}`;
    try { await activatePlugin(value, source); } finally { URL.createObjectURL = original; }
}

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

async function projectDataFixture(t: TestContext) {
    const { useCanvasStore, createCanvasStore } = await import("../src/stores/canvas/use-canvas-store");
    const { storage } = await import("../src/services/storage/runtime");
    await useCanvasStore.getState().load();
    const owner = "scene-data";
    const foreign = { owner: "retired-plugin", domain: "private-artwork", dataVersion: 7, value: { preserved: ["opaque", 42], storageKey: "foreign:logical-id", content: "blob:opaque-plugin-text" }, resources: [{ slot: "background", collection: "plugin-files" as const, owner: "retired-plugin", key: "unrelated-file" }] };
    const foreignFiles = storage.pluginFiles(foreign.owner);
    await foreignFiles.setItem(foreign.resources[0].key, new Blob(["original background"]));
    const first = useCanvasStore.getState().importProject({ title: "第一个项目", pluginDomains: [foreign] });
    const second = useCanvasStore.getState().createProject("第二个项目");
    await useCanvasStore.getState().flush();
    const files = storage.pluginFiles(owner);
    const sourceOf = (version: number) => `export default {contributions:[{point:globalThis.pluginTestPoints.pages,id:"scene-data:page",value:{id:"scene-data:page",title:"场景",Content(){return null}}},{point:globalThis.pluginTestPoints.projectData,id:"scene-data:scene",value:{id:"scene",dataVersion:${version}}},{point:globalThis.pluginTestPoints.projectData,id:"scene-data:notes",value:{id:"notes",dataVersion:1}}]}`;
    const sessions: CanvasSession[] = [];
    const views: PluginScope[] = [];
    const beforeClose: (() => void)[] = [];
    t.after(async () => {
        for (const release of beforeClose) release();
        await Promise.all(views.map((view) => view.close()));
        await deactivatePlugin(owner);
        setPluginCanvas(null);
        await Promise.all(sessions.map((session) => session.close()));
        await useCanvasStore.getState().deleteProjects([first, second]);
        await foreignFiles.removeItem(foreign.resources[0].key);
        await files.clear();
    });
    const load = (version = 1) => activate(sourceOf(version), { ...pkg, name: "canvas-plugin-scene-data", infiniteCanvas: { ...pkg.infiniteCanvas, id: owner } });
    await load();
    function open(projectId: string) {
        const session = new CanvasSession({ project: useCanvasStore.getState().openProject(projectId)!, store: useCanvasStore.getState() });
        const view = new PluginScope();
        sessions.push(session); views.push(view);
        setPluginCanvas(session);
        const binding: ScopeBinding = { ...workspaceBinding, kind: "view", viewId: "scene-data:panel", projectId, signal: AbortSignal.any([session.signal, view.signal]) };
        const ctx = getPluginContributions(points.pages, binding, view).find(({ entry }) => entry.pluginId === owner)!.ctx;
        return { ctx, view, session };
    }
    return { storage, files, foreign, foreignFiles, first, second, load, open, owner, useCanvasStore, createCanvasStore, beforeClose };
}

function pluginStatus(id: string, status: string) {
    if (usePluginStore.getState().states[id]?.status === status) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const unsubscribe = usePluginStore.subscribe((state) => {
            if (state.states[id]?.status === status) { unsubscribe(); resolve(); }
        });
    });
}

test("同项目重开时旧视图与尚未使用的会话能力仍只认原会话", async (t) => {
    const { first, open, owner } = await projectDataFixture(t);
    const original = open(first);
    const workspace = getPluginContext(owner)!;
    const oldScope = original.ctx.canvas().scope;
    const api = workspace.capabilities.get(points.canvasSession, oldScope)!;
    const oldViewApi = original.ctx.capabilities.get(points.canvasSession, original.ctx.scope)!;
    const reopened = open(first);
    const before = reopened.session.getSnapshot(), originalBefore = original.session.getSnapshot();
    const ops = [{ type: "add_node" as const, node: { id: "late", type: "text", title: "旧编辑", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} } }];
    assert.equal(original.session.signal.aborted, false);
    const changed = { code: "PLUGIN_PROJECT_CHANGED" };
    await assert.rejects(async () => api.transact({ ops }), changed);
    await assert.rejects(async () => oldViewApi.transact({ ops }), changed);
    assert.throws(() => original.ctx.canvas(), changed);
    assert.throws(() => workspace.capabilities.get(points.canvasSession, oldScope), changed);
    assert.throws(() => original.ctx.capabilities.get(points.canvasSession, reopened.ctx.scope), changed);
    await assert.rejects(original.ctx.commands.execute(points.canvasApply, { ops }, { scope: reopened.ctx.scope }), changed);
    assert.equal(original.session.getSnapshot(), originalBefore);
    assert.equal(reopened.session.getSnapshot(), before);
    await reopened.ctx.capabilities.get(points.canvasSession, reopened.ctx.scope)!.transact({ ops });
    assert.equal(reopened.session.getSnapshot().nodes[0].id, "late");
});

test("项目场景及同名附件按项目隔离，停启插件和重开文档后保留未知域与可读字节", async (t) => {
    const { storage, first, second, foreign, foreignFiles, owner, load, open, createCanvasStore } = await projectDataFixture(t);
    const declared = pluginRegistry.getSnapshot(points.projectData).find((entry) => entry.id === "scene-data:scene")!;
    assert.equal(declared.pluginId, owner);
    const a = open(first);
    const original = { title: "A原场景", cameras: ["camera-1"] };
    assert.equal(await a.ctx.projectData.read("scene"), null);
    const file = new Blob(["project A model"]);
    await a.ctx.projectData.save("scene", original, ["model"], [{ key: "model", file }]);
    const firstRead = (await a.ctx.projectData.read<typeof original>("scene"))!;
    assert.deepEqual(firstRead.value, original);
    const aResources = a.ctx.capabilities.get(points.resources, a.ctx.scope)!;
    const model = structuredClone(firstRead.resources[0]);
    assert.equal(model.slot, "model");
    assert.equal(await (await aResources.read(model)).text(), "project A model");
    await assert.rejects(aResources.read({ ...model, slot: "unlisted" }), { code: "PLUGIN_NOT_FOUND" });
    const document = () => storage.projects.getItem<CanvasDocument>(first);
    const firstRecord = (await document())!.pluginDomains!.find((record) => record.owner === owner)!;
    const attachment = firstRecord.resources[0];
    assert.match(attachment.sha256!, /^[a-f0-9]{64}$/);
    assert.deepEqual({ ...attachment, key: undefined, sha256: undefined }, { sha256: undefined, slot: "model", owner, collection: "plugin-files", key: undefined });
    await a.ctx.projectData.save("scene", { ...original, title: "A再保存" }, ["model"], [{ key: "model", file }]);
    assert.deepEqual((await document())!.pluginDomains!.find((record) => record.owner === owner)!.resources, [attachment]);
    await a.ctx.projectData.save("scene", { title: "A新场景" }, ["replacement"], [{ key: "replacement", file: new Blob(["replacement A"]) }]);
    await assert.rejects(aResources.read(model), { code: "PLUGIN_NOT_FOUND" });
    await a.view.close();
    assert.throws(() => aResources.read(model), { code: "PLUGIN_SCOPE_CLOSED" });
    await a.session.close();
    const b = open(second);
    assert.equal(await b.ctx.projectData.read("scene"), null);
    await b.ctx.projectData.save("scene", { title: "B场景" }, ["model"], [{ key: "model", file: new Blob(["project B model"]) }]);
    const secondDoc = (await storage.projects.getItem<CanvasDocument>(second))!;
    assert.notEqual(secondDoc.pluginDomains![0].resources[0].key, attachment.key);
    const oldB = (await b.ctx.projectData.read("scene"))!;
    const bResources = b.ctx.capabilities.get(points.resources, b.ctx.scope)!;
    await assert.rejects(bResources.read(model), { code: "PLUGIN_NOT_FOUND" });
    assert.equal(await (await bResources.read(oldB.resources[0])).text(), "project B model");
    await deactivatePlugin(owner);
    assert.equal(declared.signal.aborted, true);
    assert.equal(pluginRegistry.getSnapshot(points.projectData).some((entry) => entry.id === declared.id), false);
    assert.throws(() => bResources.read(oldB.resources[0]), { code: "PLUGIN_SCOPE_CLOSED" });
    await b.session.close();
    const reopened = createCanvasStore(storage.projects, storage.preferences);
    await reopened.getState().load();
    assert.equal(reopened.getState().loadError, "");
    assert.deepEqual(reopened.getState().openProject(first)!.pluginDomains!.find((record) => record.owner === foreign.owner), foreign);
    assert.equal(await (await foreignFiles.getItem<Blob>(foreign.resources[0].key))!.text(), "original background");
    await load();
    const replacement = pluginRegistry.getSnapshot(points.projectData).find((entry) => entry.id === declared.id)!;
    assert.notEqual(replacement.instanceId, declared.instanceId);
    const activeA = open(first);
    const restored = (await activeA.ctx.projectData.read("scene"))!;
    assert.deepEqual(restored.value, { title: "A新场景" });
    assert.equal(restored.resources[0].slot, "replacement");
    assert.equal(await (await activeA.ctx.capabilities.get(points.resources, activeA.ctx.scope)!.read(restored.resources[0])).text(), "replacement A");
    const activeB = open(second);
    await assert.rejects(activeA.ctx.projectData.read("scene"), { code: "PLUGIN_PROJECT_CHANGED" });
    assert.deepEqual((await activeB.ctx.projectData.read("scene"))!.value, { title: "B场景" });
});

test("项目域拒绝工作区调用、未声明的域与不支持的版本，旧代码不能静默写坏记录", async (t) => {
    const { storage, first, owner, load, open } = await projectDataFixture(t);
    const root = getPluginContext(owner)!;
    await assert.rejects(root.projectData.read("scene"), { code: "PLUGIN_PROJECT_CHANGED" });
    await assert.rejects(root.projectData.save("scene", {}, [], []), { code: "PLUGIN_PROJECT_CHANGED" });
    const a = open(first);
    await assert.rejects(a.ctx.projectData.read("private"), { code: "PLUGIN_INVALID" });
    await assert.rejects(a.ctx.projectData.save("private", {}, [], []), { code: "PLUGIN_INVALID" });
    await a.ctx.projectData.save("scene", { title: "原数据" }, ["key"], [{ key: "key", file: new Blob(["v1"]) }]);
    const saved = await storage.projects.getItem(first);
    await deactivatePlugin(owner);
    await load(2);
    const incompatible = open(first);
    await assert.rejects(incompatible.ctx.projectData.read("scene"), { code: "PLUGIN_CONTRACT_MISMATCH" });
    await assert.rejects(incompatible.ctx.projectData.save("scene", { title: "不得覆盖" }, [], []), { code: "PLUGIN_CONTRACT_MISMATCH" });
    assert.deepEqual(await storage.projects.getItem(first), saved);
    await deactivatePlugin(owner);
    await load(1);
    const supported = open(first).ctx;
    const restored = (await supported.projectData.read("scene"))!;
    assert.deepEqual(restored.value, { title: "原数据" });
    assert.equal(await (await supported.capabilities.get(points.resources, supported.scope)!.read(restored.resources[0])).text(), "v1");
});

test("域保存失败可显式重试，每次成功都有包含本次值的回执，并保留同时写入的图和其他域", async (t) => {
    const { first, storage, files, useCanvasStore, open, foreign, owner, beforeClose } = await projectDataFixture(t);
    const { ctx, session } = open(first);
    const scene = (document: CanvasDocument | null) => document?.pluginDomains?.find((record) => record.owner === owner && record.domain === "scene");
    const failure = t.mock.method(storage.projects, "setItem", async () => { throw new Error("project write failed"); });
    await assert.rejects(ctx.projectData.save("scene", "retry", ["model"], [{ key: "model", file: new Blob(["retry file"]) }]));
    assert.equal(useCanvasStore.getState().saveStatus[first], "error");
    assert.equal(scene(await storage.projects.getItem(first)), undefined);
    const dirty = scene(useCanvasStore.getState().openProject(first))!;
    assert.equal(dirty.value, "retry");
    assert.equal(await (await files.getItem<Blob>(dirty.resources[0].key))!.text(), "retry file");
    failure.mock.restore();
    await useCanvasStore.getState().flush(first);
    assert.deepEqual(scene(await storage.projects.getItem(first)), dirty);

    const started = Promise.withResolvers<void>();
    const firstReceipt = Promise.withResolvers<void>();
    const secondStarted = Promise.withResolvers<void>();
    const secondReceipt = Promise.withResolvers<void>();
    beforeClose.push(() => { firstReceipt.resolve(); secondReceipt.resolve(); });
    const acknowledged: CanvasDocument[] = [];
    const save = storage.projects.setItem.bind(storage.projects);
    const write = t.mock.method(storage.projects, "setItem", async <T>(key: string, value: T) => {
        const document = value as CanvasDocument;
        if (scene(document)?.value === "first") { started.resolve(); await firstReceipt.promise; }
        if (scene(document)?.value === "second") { secondStarted.resolve(); await secondReceipt.promise; }
        const result = await save(key, value);
        acknowledged.push(structuredClone(document));
        return result;
    });
    const one = ctx.projectData.save("scene", "first", ["model"], []).then(() => { assert.ok(acknowledged.some((document) => scene(document)?.value === "first")); });
    await Promise.race([started.promise, one.then(() => assert.fail("第一份场景应已进入真实写入"))]);
    session.transact([{ type: "add_node", node: { id: "edited", type: "text", title: "图编辑", position: { x: 0, y: 0 }, width: 100, height: 80 } }], { source: { kind: "ui" } });
    let secondDone = false;
    const two = ctx.projectData.save("scene", "second", ["model"], []).then(() => {
        assert.ok(acknowledged.some((document) => scene(document)?.value === "second"));
        secondDone = true;
    });
    const notes = ctx.projectData.save("notes", "同时保存的注释", [], []).then(() => {
        assert.ok(acknowledged.some((document) => document.pluginDomains?.some((record) => record.domain === "notes" && record.value === "同时保存的注释")));
    });
    assert.equal(acknowledged.length, 0);
    firstReceipt.resolve();
    await Promise.race([secondStarted.promise, two.then(() => assert.fail("第二份场景必须有自己的实际回执"))]);
    assert.equal(secondDone, false);
    secondReceipt.resolve();
    await Promise.all([one, two, notes]);
    write.mock.restore();
    const final = (await storage.projects.getItem<CanvasDocument>(first))!;
    assert.equal(scene(final)?.value, "second");
    assert.deepEqual(scene(final)?.resources, dirty.resources);
    assert.deepEqual(final.pluginDomains?.find((record) => record.owner === foreign.owner), foreign);
    assert.equal(final.pluginDomains?.find((record) => record.domain === "notes")?.value, "同时保存的注释");
    assert.deepEqual(final.nodes.map((node) => node.id), ["edited"]);
});

test("清理逆序等待；重复调用与单项失败不重复执行或遗漏其他资源", async () => {
    const scope = new PluginScope();
    const calls: number[] = [];
    scope.add(() => { calls.push(1); });
    scope.add(async () => { await Promise.resolve(); calls.push(2); throw new Error("fixture"); });
    const release = scope.add(async () => { await Promise.resolve(); calls.push(3); });
    const early = release();
    assert.equal(release(), early);
    const closed = scope.close();
    assert.equal(scope.signal.aborted, true);
    assert.equal(scope.close(), closed);
    await assert.rejects(closed, AggregateError);
    assert.deepEqual(calls, [3, 2, 1]);
});

test("菜单扩展读取完整列表，跨插件稳定排序并随停用恢复", async (t) => {
    const session = canvasFixture("menu");
    setPluginCanvas(session);
    t.after(() => session.close());
    t.after(async () => { await deactivatePlugin("test"); await deactivatePlugin("second"); setPluginCanvas(null); });
    const first = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas } };
    const second = { ...pkg, name: "canvas-plugin-second", infiniteCanvas: { ...pkg.infiniteCanvas, id: "second" } };
    const target: PluginMenuTarget = { location: "canvas.create", position: { x: 120, y: 80 } };
    const defaults: PluginMenuItem[] = [
        { id: "create:text", type: "action", title: "文本", run() {} },
        { id: "create:audio", type: "action", title: "音频", hidden: true, run() {} },
    ];
    await activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.menus, id: "test:menu", value: { id: "test:menu", locations: ["canvas.create"], transform({ items }) {
        return [...items.filter(item => item.id !== "second:new"), ...items.filter(item => item.id === "second:new")];
    } } }] };`, first);
    await activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.menus, id: "second:menu", value: { id: "second:menu", locations: ["canvas.create"], transform({ items, target }) {
        if (!items.some(item => item.id === "create:audio" && item.hidden) || target.position.x !== 120) throw new Error("missing context");
        return [{ id: "second:new", type: "action", title: "新增", run() {} }, ...items.map(item => ({ ...item, hidden: item.id === "create:text" }))];
    } } }] };`, second);
    const resolved = resolvePluginMenu(target, defaults);
    assert.deepEqual(resolved.items.map(item => item.id), ["create:audio", "second:new"]);
    assert.equal(resolved.renderer, undefined);
    assert.equal(defaults[0].hidden, undefined);
    assert.equal(defaults[1].hidden, true);
    assert.deepEqual(resolvePluginMenu({ location: "canvas.connectionCreate", position: target.position, nodeId: "one", handleType: "source" }, defaults).items.map(item => item.id), ["create:text"]);
    await deactivatePlugin("test");
    assert.deepEqual(resolvePluginMenu(target, defaults).items.map(item => item.id), ["second:new", "create:audio"]);
    assert.equal(resolvePluginMenu(target, defaults).renderer, undefined);
    await deactivatePlugin("second");
    assert.deepEqual(resolvePluginMenu(target, defaults).items, [defaults[0]]);
    assert.equal(resolvePluginMenu(target, defaults).renderer, undefined);
});

test("菜单命令与自定义动作绑定目标画布，停用和切换项目取消旧动作", async (t) => {
    const writes: unknown[] = [];
    const canvas = canvasFixture("menu", ["selected", "right-clicked"].map(id => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 100, height: 100 })), ["selected"]);
    const transact = canvas.transactWithMedia.bind(canvas);
    t.mock.method(canvas, "transactWithMedia", (...args: Parameters<typeof transact>) => { writes.push(args[0]); return transact(...args); });
    Object.assign(globalThis, { pluginTestCommand: defineCommand({ id: "test:command", scope: "project", input: z.void(), output: z.void() }) });
    t.after(() => { Reflect.deleteProperty(globalThis, "pluginTestCommand"); return canvas.close(); });
    setPluginCanvas(canvas);
    t.after(async () => { await deactivatePlugin("test"); setPluginCanvas(null); });
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas } };
    await activate(`export default {
        contributions: [{ point: globalThis.pluginTestPoints.commands, id: "test:command", value: { command: globalThis.pluginTestCommand, title: "命令", locations: ["canvas.contextMenu"], enabled: (_, {canvas}) => canvas.getSelectedIds().length > 0, async run(_, {canvas}) { await canvas.transact([]); } } },
        { point: globalThis.pluginTestPoints.menus, id: "test:menu", value: { id: "test:menu", locations: ["canvas.nodeContext"], transform({ items, target, canvas }) {
            return [{ id: "test:target", type: "action", title: "目标", async run() { await canvas.transact([{ type: "delete_node", ids: [target.nodeId] }]); } }, ...items];
        } } }]
    };`, metadata);
    const defaults: PluginMenuItem[] = [{ id: "builtin:delete", type: "action", title: "删除", run() { writes.push("delete"); } }];
    const target: PluginMenuTarget = { location: "canvas.nodeContext", position: { x: 0, y: 0 }, nodeId: "right-clicked" };
    const menu = resolvePluginMenu(target, defaults);
    assert.deepEqual(menu.items.map(item => item.id), ["test:target", "test:command", "builtin:delete"]);
    for (const item of menu.items) {
        assert.equal(item.type, "action");
        if (item.type === "action") await item.run();
    }
    assert.deepEqual(writes, [[{ type: "delete_node", ids: ["right-clicked"] }], [], "delete"]);
    await canvas.close();
    const other = canvasFixture("other");
    setPluginCanvas(other);
    t.after(() => other.close());
    for (const item of menu.items) if (item.type === "action") assert.throws(() => item.run());
    const current = resolvePluginMenu(target, defaults);
    await deactivatePlugin("test");
    for (const item of current.items) if (item.type === "action") assert.throws(() => item.run());
    assert.equal(writes.length, 3);
});

test("菜单动作先关闭，失败仅通过 Sonner 提示固定文案，其他菜单和失效动作各自处理", async (t) => {
    const { usePluginMenu } = await import("../src/hooks/use-plugin-menu");
    const { toast } = await import("sonner");
    const { getPluginErrorMessage } = await import("@infinite-canvas/shared/plugins");
    const errors: unknown[] = [], events: string[] = [];
    t.mock.method(toast, "error", (message, options) => { errors.push([message, options?.className, React.isValidElement(options?.icon)]); return "toast"; });
    t.mock.method(console, "error", () => {});
    const session = canvasFixture("sonner-menu");
    setPluginCanvas(session);
    t.after(async () => { setPluginCanvas(null); await session.close(); });
    const defaults: PluginMenuItem[] = [
        { type: "action", id: "failed", title: "失败", async run() { events.push("failed"); throw new Error("private detail"); } },
        { type: "action", id: "ok", title: "继续", run() { events.push("ok"); } },
        { type: "action", id: "closed", title: "失效", run() { throw new PluginError("PLUGIN_SCOPE_CLOSED"); } },
    ];
    let menu!: ReturnType<typeof usePluginMenu>;
    function Menu() { menu = usePluginMenu({ location: "canvas.projectMenu" }, defaults, () => events.push("close")); return null; }
    renderToString(React.createElement(Menu));
    for (const item of menu.items) menu.execute(item);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["close", "failed", "close", "ok", "close"]);
    assert.deepEqual(errors, [[getPluginErrorMessage(new Error()), "workbench-message", true]]);
});

test("工具栏统一排列内置动作、命令与侧栏，保留禁用和选中状态", async (t) => {
    let runs = 0;
    const session = canvasFixture("toolbar", [{ id: "node", type: "text", title: "节点", position: { x: 0, y: 0 }, width: 100, height: 100 }], ["node"]);
    setPluginCanvas(session);
    Object.assign(globalThis, { pluginTestCommand: defineCommand({ id: "test:action", scope: "project", input: z.void(), output: z.void() }) });
    t.after(() => { Reflect.deleteProperty(globalThis, "pluginTestCommand"); return session.close(); });
    t.after(async () => { await deactivatePlugin("test"); setPluginCanvas(null); });
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas } };
    await activate(`export default {
        contributions: [{ point: globalThis.pluginTestPoints.commands, id: "test:action", value: { command: globalThis.pluginTestCommand, title: "命令", locations: ["canvas.toolbar"], enabled: (_, {canvas}) => canvas.getSelectedIds().length > 0, run() {} } },
        { point: globalThis.pluginTestPoints.panels, id: "test:action", value: { id: "business-panel", title: "侧栏", Content() { return null; } } },
        { point: globalThis.pluginTestPoints.menus, id: "test:toolbar", value: { id: "test:toolbar", locations: ["canvas.toolbar"], transform({ items }) {
            return [...items.filter(item => item.id === "test:action"), ...items.filter(item => item.id !== "test:action").map(item => item.id === "create:audio" ? { ...item, hidden: true } : item)];
        } } }]
    };`, metadata);
    const defaults: PluginMenuItem[] = [
        { id: "builtin:undo", type: "action", title: "撤销", disabled: true, run() { runs++; } },
        { id: "builtin:create:separator", type: "separator" },
        { id: "create:audio", type: "action", title: "音频", run() {} },
    ];
    const target: PluginMenuTarget = { location: "canvas.toolbar" };
    const first = resolvePluginMenu(target, defaults);
    assert.deepEqual(first.items.map(item => item.id), ["test:action", "builtin:undo"]);
    const undo = first.items.find(item => item.id === "builtin:undo")!;
    assert.equal(undo.type === "action" && undo.disabled, true);
    const extensions = () => resolvePluginMenu({ location: "canvas.extensions" }, []).items;
    const panel = extensions().find(item => item.id === "panel:test:action")!;
    assert.equal(panel.type, "action");
    if (panel.type === "action") await panel.run();
    const original = usePluginStore.getState().panel!;
    assert.equal(original.id, "test:action");
    session.setSelection({ nodeIds: [], connectionId: null }, { kind: "ui" });
    const second = resolvePluginMenu(target, defaults);
    assert.equal(second.items[0].type === "action" && second.items[0].disabled, true);
    const activePanel = extensions().find(item => item.id === "panel:test:action")!;
    assert.equal(activePanel.type === "action" && activePanel.active, true);
    const next = canvasFixture("next-toolbar");
    t.after(() => next.close());
    setPluginCanvas(next);
    assert.equal(original.signal.aborted, true);
    assert.equal(usePluginStore.getState().panel, null);
    if (panel.type === "action") await assert.rejects(async () => panel.run(), (error: unknown) => error instanceof PluginError);
    const nextAction = extensions().find((item) => item.id === "panel:test:action");
    assert.ok(nextAction?.type === "action");
    await nextAction.run();
    const replacement = usePluginStore.getState().panel!;
    assert.equal(replacement.project.projectId, next.projectId);
    original.close();
    assert.equal(original.canRestoreFocus(), false);
    assert.equal(usePluginStore.getState().panel, replacement);
    replacement.close();
    await session.close();
    if (panel.type === "action") assert.throws(() => panel.run());
    assert.equal(usePluginStore.getState().panel, null);
    assert.equal(runs, 0);
    await deactivatePlugin("test");
    assert.deepEqual(resolvePluginMenu(target, defaults).items.map(item => item.id), ["builtin:undo", "builtin:create:separator", "create:audio"]);
});

test("无节点插件启动、业务事件、失败回收和重复停用", async () => {
    const source = `export default { setup(ctx) { ctx.on("selection.changed", () => ctx.storage.set("event", true)); ctx.onDispose(() => Promise.resolve()); } };`;
    await activate(source);
    assert.equal(usePluginStore.getState().states.test.status, "active");
    const context = getPluginContext("test")!;
    emitPluginEvent("selection.changed", { projectId: "one", nodeIds: [] });
    await Promise.resolve();
    assert.equal(await context.storage.get("event"), true);
    await deactivatePlugin("test");
    await deactivatePlugin("test");
    assert.equal(context.signal.aborted, true);
    await assert.rejects(activate(`export default { setup(ctx) { ctx.on("document.committed", () => { throw new Error("should be removed"); }); throw new Error("fixture"); } }`));
    assert.equal(getPluginContext("test"), undefined);
    assert.equal(getPluginContributions(points.commands).some(({ ctx }) => ctx.id === "test"), false);
    assert.equal(usePluginStore.getState().states.test.status, "failed");
});

test("跨项目操作不能写回；订阅自动清理，模型响应不能跨项目返回", async (t) => {
    await activate("export default {};");
    const { initializeModels } = await import("../src/services/api/models/runtime");
    const { defaultConfig, useConfigStore } = await import("../src/stores/use-config-store");
    const { callScriptsReady } = await import("../src/stores/use-call-script-store");
    await callScriptsReady;
    const previousConfig = useConfigStore.getState().config;
    useConfigStore.setState({ config: { ...defaultConfig, textModel: "group::writer", channels: [{ id: "channel", name: "测试", baseUrl: "https://model.invalid", groups: [{ id: "group", name: "组", apiKey: "test", models: [{ name: "writer", capability: "text", scriptId: "openai-chat-text" }] }] }] } });
    const entered = deferred();
    const finish = deferred<string>();
    initializeModels({ generateText: async () => { entered.resolve(); return finish.promise; }, generateImages: async () => [], generateAudio: async () => new Blob(), createVideoTask: async () => { throw new Error("UNUSED"); }, queryVideoTask: async () => { throw new Error("UNUSED"); }, fetchText: async () => { throw new Error("UNUSED"); } });
    const canvas = canvasFixture("one");
    const other = canvasFixture("two");
    t.after(async () => { finish.resolve("late"); await deactivatePlugin("test"); setPluginCanvas(null); await Promise.all([canvas.close(), other.close()]); useConfigStore.setState({ config: previousConfig }); });
    setPluginCanvas(canvas);
    const bound = getPluginContext("test")!.canvas();
    let events = 0;
    bound.on("document.committed", () => { events++; });
    emitPluginEvent("document.committed", { projectId: "one", revision: 1, source: { kind: "ui" }, operation: "transact" });
    const generation = assert.rejects(bound.models.generateText({ prompt: "hello" }));
    await entered.promise;
    await canvas.close();
    setPluginCanvas(other);
    emitPluginEvent("document.committed", { projectId: "one", revision: 2, source: { kind: "ui" }, operation: "transact" });
    assert.equal(events, 1);
    await assert.rejects(bound.transact([]));
    finish.resolve("late");
    await generation;
    assert.equal(other.getSnapshot().revision, 0);
});

test("浏览器从 npm 解析版本、验证包与完整性；失败保留原安装", async (t) => {
    assert.equal(pluginPackageSchema.safeParse({ ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "plugin-manager" } }).success, false);
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, icon: "icon.svg", readme: "GUIDE.md" } };
    const guide = "# 使用说明\n\n测试教程";
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const source = "export default {};";
    const files = { "package/package.json": JSON.stringify(metadata), "package/dist/client.js": source, "package/icon.svg": icon, "package/GUIDE.md": guide };
    const tar = gzipSync(await packTar(Object.entries(files).map(([name, body]) => ({ header: { name, size: Buffer.byteLength(body), type: "file" }, body }))));
    let integrity = `sha512-${createHash("sha512").update(tar).digest("base64")}`;
    t.mock.method(globalThis, "fetch", async (url: string) => url.endsWith("test.tgz") ? new Response(tar) : Response.json({ version: 1, plugins: [{ name: pkg.name, title: "测试", versions: { "1.0.0": { tarball: "test.tgz", integrity, host: ">=1.0.0", pluginApi: 3 } } }] }));
    await adapter.configure({ registry: "https://registry.example/index.json" });
    await adapter.install({ name: pkg.name, version: "^1", host: "1.0.0" });
    assert.equal(await adapter.source("test", "1.0.0"), source);
    await assert.rejects(adapter.source("test", "2.0.0"));
    assert.equal(await adapter.asset("test", "1.0.0", "readme"), guide);
    assert.equal(await adapter.asset("test", "1.0.0", "icon"), `data:image/svg+xml;base64,${Buffer.from(icon).toString("base64")}`);
    await assert.rejects(adapter.asset("test", "2.0.0", "readme"));
    integrity = "sha512-invalid";
    await assert.rejects(adapter.install({ name: pkg.name, version: "latest", host: "1.0.0" }));
    assert.equal((await adapter.list()).find((item) => item.package.name === pkg.name)?.package.version, "1.0.0");
    await adapter.enable("test", false);
    assert.equal((await adapter.list()).find((item) => item.package.name === pkg.name)?.enabled, false);
    assert.equal(await adapter.asset("test", "1.0.0", "readme"), guide);
    await adapter.remove("test");
    await assert.rejects(adapter.source("test", "1.0.0"));
    await assert.rejects(adapter.asset("test", "1.0.0", "readme"));
});

test("浏览器可安装上传的 npm 插件包，识别清单并拒绝损坏或超大的包", async (t) => {
    const bundle = { ...pkg, name: "canvas-plugin-upload", infiniteCanvas: { ...pkg.infiniteCanvas, id: "upload", icon: "icon.svg", readme: "GUIDE.md" } };
    const guide = "# 上传安装";
    const icon = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const source = "export default {};";
    const files = { "package/package.json": JSON.stringify(bundle), "package/dist/client.js": source, "package/icon.svg": icon, "package/GUIDE.md": guide };
    const archive = gzipSync(await packTar(Object.entries(files).map(([name, body]) => ({ header: { name, size: Buffer.byteLength(body), type: "file" }, body }))));
    t.after(() => adapter.remove("upload"));
    assert.deepEqual(await adapter.inspectPackage(archive), { id: "upload", name: bundle.name, version: "1.0.0" });
    const installed = await adapter.installPackage(archive);
    assert.equal(installed.uploaded, true);
    assert.equal(installed.registry, "");
    assert.equal(await adapter.source("upload", "1.0.0"), source);
    assert.equal(await adapter.asset("upload", "1.0.0", "readme"), guide);
    assert.match(await adapter.asset("upload", "1.0.0", "icon"), /^data:image\/svg\+xml;base64,/);
    await assert.rejects(adapter.inspectPackage(new Uint8Array([1, 2, 3])), { code: "PLUGIN_PACKAGE_INVALID" });
    await assert.rejects(adapter.installPackage(new Uint8Array([1, 2, 3])), { code: "PLUGIN_PACKAGE_INVALID" });
    await assert.rejects(adapter.installPackage(new Uint8Array(PLUGIN_PACKAGE_MAX_BYTES + 1)), { code: "PLUGIN_PACKAGE_TOO_LARGE" });
    assert.equal((await adapter.list()).find((item) => item.package.infiniteCanvas.id === "upload")?.package.version, "1.0.0");
});

test("上传插件包按清单识别同 ID 替换，保留启停选择且不写入软件源", async (t) => {
    const { installPluginPackage, refreshPlugins, uninstallPlugin } = await import("../src/lib/plugins/manager");
    const manifest = { ...pkg, name: "canvas-plugin-upload-manager", infiniteCanvas: { ...pkg.infiniteCanvas, id: "upload-manager" } };
    const archive = async (version: string) => gzipSync(await packTar(Object.entries({
        "package/package.json": JSON.stringify({ ...manifest, version }),
        "package/dist/client.js": "export default {};",
    }).map(([name, body]) => ({ header: { name, size: Buffer.byteLength(body), type: "file" as const }, body }))));
    t.mock.method(URL, "createObjectURL", () => `data:text/javascript;base64,${Buffer.from("export default {};").toString("base64")}#${Math.random()}`);
    t.after(async () => { await uninstallPlugin("upload-manager").catch(() => {}); await refreshPlugins(); });
    const first = await installPluginPackage(await archive("1.0.0"));
    assert.equal(first.package.version, "1.0.0");
    assert.equal(first.uploaded, true);
    assert.equal(usePluginStore.getState().plugins.find((item) => item.package.infiniteCanvas.id === "upload-manager")?.uploaded, true);
    await adapter.enable("upload-manager", false);
    await refreshPlugins();
    const next = await installPluginPackage(await archive("1.1.0"));
    assert.equal(next.package.version, "1.1.0");
    assert.equal(next.enabled, false);
    assert.equal((await adapter.list()).find((item) => item.package.infiniteCanvas.id === "upload-manager")?.package.version, "1.1.0");
});

test("取消订阅和停用立即阻止同一轮事件回调", async () => {
    await activate(`export default { setup(ctx) {
        let release;
        ctx.on("model.call.started", () => release());
        release = ctx.on("model.call.started", () => { throw new Error("released handler executed"); });
    } };`);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args) => { errors.push(args); };
    try {
        emitPluginEvent("model.call.started", {} as never);
        const closing = deactivatePlugin("test");
        emitPluginEvent("model.call.started", {} as never);
        await closing;
        await Promise.resolve();
        assert.deepEqual(errors, []);
    } finally { console.error = original; await deactivatePlugin("test"); }
});

test("独立页面登记与主题覆盖随插件停用清理，旧上下文不能重新应用", async () => {
    const pagePackage = structuredClone(pkg);
    const previousTheme = useThemeStore.getState().theme;
    await activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.pages, id: "test:themes", value: { id: "test:themes", title: "主题", Content() { return null; } } }] };`, pagePackage);
    assert.equal(getPluginContributions(points.pages)[0].item.id, "test:themes");
    const context = getPluginContext("test")!;
    const preset = { id: "test:blue", name: "蓝", description: "测试", mode: "light" as const, background: "#fff", panel: "#fff", surface: "#eee", text: "#111", muted: "#777", border: "#ccc", accent: "#123", accentText: "#fff" };
    context.extensions.contribute(points.themes, { id: preset.id, value: preset });
    context.appearance.select(preset.id);
    assert.deepEqual(context.appearance.getSnapshot(), preset);
    assert.equal(useThemeStore.getState().theme, "light");
    await deactivatePlugin("test");
    assert.equal(getPluginContributions(points.pages).length, 0);
    assert.equal(useThemeStore.getState().appearance, null);
    assert.equal(useThemeStore.getState().theme, previousTheme);
    assert.throws(() => context.appearance.select(preset.id), { code: "PLUGIN_INACTIVE" });
    assert.throws(() => context.appearance.getSnapshot(), { code: "PLUGIN_INACTIVE" });
});

test("工作台布局明确选择，其他提供者登记不抢占，停用回落并保留选择意愿", async () => {
    usePluginStore.setState({ layoutSelection: null });
    for (const id of ["test", "other"]) {
        const layout = id + ":layout";
        const manifest = { ...pkg.infiniteCanvas, id };
        await activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.layouts, id: "${layout}", value: { id: "${layout}", name: "布局", description: "说明", Frame() { return null; } } }] };`, { ...pkg, infiniteCanvas: manifest });
    }
    const context = getPluginContext("other")!;
    try {
        assert.equal(getSelectedLayout(), null);
        context.layout.select("other:layout");
        assert.equal(getSelectedLayout()?.id, "other:layout");
        assert.throws(() => context.layout.select("missing:layout"), { code: "PLUGIN_INVALID" });
        await deactivatePlugin("other");
        assert.equal(getSelectedLayout(), null);
        assert.equal(usePluginStore.getState().layoutSelection, "other:layout");
        assert.throws(() => context.layout.select(null), { code: "PLUGIN_INACTIVE" });
        getPluginContext("test")!.layout.select(null);
        assert.equal(getSelectedLayout(), null);
        assert.equal(usePluginStore.getState().layoutSelection, null);
    } finally { await deactivatePlugin("other"); await deactivatePlugin("test"); }
});


test("导演台和同步插件可分别停用，旧实例不能读写文件，另一个插件继续工作", async (t) => {
    const director = { ...pkg, name: "canvas-plugin-director-desk", infiniteCanvas: { ...pkg.infiniteCanvas, id: "director-desk" } };
    const sync = { ...pkg, name: "canvas-plugin-webdav-sync", infiniteCanvas: { ...pkg.infiniteCanvas, id: "webdav-sync" } };
    const studio = 'export default {contributions:[{point:globalThis.pluginTestPoints.panels,id:"director-desk:studio",value:{id:"director-desk:studio",title:"工作室",Content(){return null}}}]}';
    const { webdavTransport } = await import("../../../plugins/webdav-sync/src/transports/webdav");
    Object.assign(globalThis, { testWebdavTransport: webdavTransport });
    t.after(() => Reflect.deleteProperty(globalThis, "testWebdavTransport"));
    const syncSource = 'export default {contributions:[{point:globalThis.pluginTestPoints.syncTransports,id:"webdav-sync:transport",value:globalThis.testWebdavTransport}]}';
    await activate(studio, director);
    await activate(syncSource, sync);
    const desk = getPluginContext("director-desk")!;
    const dav = getPluginContext("webdav-sync")!;
    const session = canvasFixture("director-panel");
    setPluginCanvas(session);
    t.after(async () => { setPluginCanvas(null); await session.close(); });
    try {
        const entry = pluginRegistry.query(points.syncTransports, workspaceBinding).find((item) => item.pluginId === dav.id)!;
        await desk.files.write("same-key", new Blob(["scene"]));
        assert.equal(await dav.files.read("same-key"), null);
        const action = resolvePluginMenu({ location: "canvas.extensions" }, []).items.find((item) => item.id === "panel:director-desk:studio");
        assert.ok(action?.type === "action");
        await action.run();
        const opened = usePluginStore.getState().panel!;
        assert.equal(opened.id, "director-desk:studio");
        let started!: () => void;
        const startedRequest = new Promise<void>(resolve => { started = resolve; });
        t.mock.method(globalThis, "fetch", async (_url, init) => new Promise<Response>((_, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
            started();
        }));
        const { openSyncSettings } = await import("../src/lib/plugins/sync-transport");
        const settingsView = new PluginScope();
        t.after(() => settingsView.close());
        const ui = openSyncSettings(entry, settingsView);
        const config = { ...await ui.load(), url: "https://example.test/dav" };
        const cancelled = assert.rejects(ui.run("test", config), { code: "PLUGIN_INACTIVE" });
        await startedRequest;
        await deactivatePlugin("webdav-sync");
        await cancelled;
        assert.equal(usePluginStore.getState().panel, opened);
        assert.equal(desk.signal.aborted, false);
        assert.equal(await (await desk.files.read("same-key"))!.text(), "scene");
        await assert.rejects(dav.files.remove("same-key"), { code: "PLUGIN_INACTIVE" });
        await activate(syncSource, sync);
        const reopened = getPluginContext("webdav-sync")!;
        await deactivatePlugin("director-desk");
        assert.equal(opened.signal.aborted, true);
        assert.equal(usePluginStore.getState().panel, null);
        await assert.rejects(desk.files.write("same-key", new Blob()), { code: "PLUGIN_INACTIVE" });
        assert.equal(reopened.signal.aborted, false);
        assert.equal(getPluginContributions(points.syncTransports).some(entry => entry.ctx === reopened), true);
        await activate(studio, director);
        assert.equal(await (await getPluginContext("director-desk")!.files.read("same-key"))!.text(), "scene");
    } finally { await deactivatePlugin("director-desk"); await deactivatePlugin("webdav-sync"); }
});

test("手动清理失败保留真实失败，固定错误文案不使用可变message", async () => {
    const scope = new PluginScope();
    let calls = 0;
    const release = scope.add(() => { calls++; throw new Error("fixture"); });
    await assert.rejects(release());
    await assert.rejects(scope.close(), AggregateError);
    assert.equal(calls, 1);
    const error = new PluginError("PLUGIN_OPERATION_FAILED");
    error.message = "private upstream detail";
    assert.equal(getPluginErrorMessage(error), pluginErrorMessages.PLUGIN_OPERATION_FAILED);
});

test("启动卡住时可保存停用意愿和管理其他插件，迟到setup清理后才能重启", async (t) => {
    const { setPluginEnabled, refreshPlugins } = await import("../src/lib/plugins/manager");
    const started = deferred();
    const finish = deferred();
    let cleanups = 0;
    const fixture = { setup: async (ctx: { id: string }) => { if (ctx.id === "slow") { started.resolve(); await finish.promise; return () => { cleanups++; }; } } };
    Object.assign(globalThis, { lifecycleFixture: fixture });
    const records: InstalledPlugin[] = ["slow", "independent"].map((id) => ({ package: { ...pkg, name: `canvas-plugin-${id}`, infiniteCanvas: { ...pkg.infiniteCanvas, id } }, registry: "", installedAt: "", enabled: false }));
    const source = "export default { setup(ctx) { return globalThis.lifecycleFixture.setup(ctx); } };";
    t.mock.method(adapter, "list", async () => records.map((record) => ({ ...record })));
    t.mock.method(adapter, "enable", async (id: string, enabled: boolean) => { records.find((item) => item.package.infiniteCanvas.id === id)!.enabled = enabled; });
    t.mock.method(adapter, "source", async () => source);
    t.mock.method(URL, "createObjectURL", () => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    t.after(async () => { finish.resolve(); await deactivatePlugin("slow"); await deactivatePlugin("independent"); Reflect.deleteProperty(globalThis, "lifecycleFixture"); });
    await refreshPlugins();
    const starting = setPluginEnabled(records[0], true);
    const cancelled = starting;
    await started.promise;
    const old = getPluginContext("slow")!;
    await setPluginEnabled(records[0], false);
    assert.equal(records[0].enabled, false);
    assert.equal(old.signal.aborted, true);
    assert.equal(usePluginStore.getState().states.slow.status, "disabled");
    await setPluginEnabled(records[1], true);
    assert.equal(usePluginStore.getState().states.independent.status, "active");
    await assert.rejects(old.storage.set("late", true), { code: "PLUGIN_INACTIVE" });
    finish.resolve();
    await cancelled;
    await deactivatePlugin("slow");
    assert.equal(cleanups, 1);
    assert.equal(usePluginStore.getState().states.slow.status, "disabled");
    await setPluginEnabled(records[0], true);
    assert.notEqual(getPluginContext("slow"), old);
});

test("画布读取深冻结并复用未变分支，写入与事件隔离原对象", async (t) => {
    const node: CanvasNodeData = { id: "node", type: "text", title: "节点", width: 100, height: 100, position: { x: 1, y: 2 }, metadata: { images: [{ id: "image", status: "success", content: "original", naturalWidth: 100, naturalHeight: 100, bytes: 1, mimeType: "image/png" }] } };
    const nodes = [node, { ...node, id: "other" }];
    const connections = [{ id: "connection", fromNodeId: "node", toNodeId: "other" }];
    const selected = ["node"];
    const session = canvasFixture("snapshot", nodes, selected);
    session.transact([{ type: "connect_nodes", connection: connections[0] }], { source: { kind: "ui" } });
    setPluginCanvas(session);
    await activate("export default {};");
    const canvas = getPluginContext("test")!.canvas();
    try {
        const snapshot = canvas.getNodes() as unknown as typeof nodes;
        assert.equal(canvas.getNodes(), snapshot);
        assert.throws(() => snapshot.push(node), TypeError);
        assert.throws(() => { snapshot[0].position.x = 99; }, TypeError);
        assert.throws(() => { snapshot[0].metadata!.images![0].content = "changed"; }, TypeError);
        assert.throws(() => (canvas.getSelectedIds() as string[]).push("other"), TypeError);
        assert.throws(() => { (canvas.getConnections() as unknown as typeof connections)[0].fromNodeId = "other"; }, TypeError);
        assert.throws(() => (canvas.models.listModels({ capability: "image" }) as unknown[]).push({ value: "model", label: "模型" }), TypeError);
        const ops = [{ type: "update_node" as const, id: "node", patch: { position: { x: 2, y: 3 } } }];
        const written = canvas.transact(ops);
        ops[0].patch.position.x = 99;
        assert.deepEqual((await written).nodes[0].position, { x: 2, y: 3 });
        assert.deepEqual(canvas.getNodes()[0].position, { x: 2, y: 3 });
        assert.equal(canvas.getNodes()[0].metadata, snapshot[0].metadata);
        let event: unknown;
        canvas.on("selection.changed", (payload) => { event = payload; });
        emitPluginEvent("selection.changed", { projectId: "snapshot", nodeIds: selected });
        assert.throws(() => (event as { nodeIds: string[] }).nodeIds.push("other"), TypeError);
        assert.deepEqual(selected, ["node"]);
        assert.equal(node.metadata!.images![0].content, "original");
    } finally { await deactivatePlugin("test"); setPluginCanvas(null); await session.close(); }
});

test("主题仅恢复明确选择的提供者，停用保留选择且基础主题可覆盖意愿", async () => {
    const preset = { id: "theme-a:theme", name: "主题", description: "说明", mode: "light" as const, background: "#fff", panel: "#fff", surface: "#eee", text: "#111", muted: "#777", border: "#ccc", accent: "#123", accentText: "#fff" };
    useThemeStore.getState().setTheme("dark");
    for (const id of ["theme-a", "theme-b"]) await activate("export default {};", { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id } });
    const first = getPluginContext("theme-a")!;
    const second = getPluginContext("theme-b")!;
    first.extensions.contribute(points.themes, { id: preset.id, value: preset });
    assert.equal(useThemeStore.getState().appearance, null);
    first.appearance.select(preset.id);
    preset.accent = "changed";
    assert.equal(useThemeStore.getState().appearance?.accent, "#123");
    const selected = first.appearance.getSnapshot();
    second.extensions.contribute(points.themes, { id: "theme-b:theme", value: { ...preset, id: "theme-b:theme", mode: "dark" } });
    assert.equal(useThemeStore.getState().appearance, selected);
    await deactivatePlugin("theme-b");
    assert.equal(useThemeStore.getState().appearance, selected);
    await deactivatePlugin("theme-a");
    assert.equal(useThemeStore.getState().theme, "dark");
    assert.equal(useThemeStore.getState().selection, "theme-a:theme");
    await activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.themes, id: "theme-a:theme", value: ${JSON.stringify(preset)} }] };`, { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "theme-a" } });
    assert.equal(useThemeStore.getState().theme, "light");
    useThemeStore.getState().setTheme("dark");
    assert.equal(useThemeStore.getState().appearance, null);
    assert.equal(useThemeStore.getState().selection, null);
    await deactivatePlugin("theme-a");
});

test("下载不阻塞配置和停用，提交保留最新意愿，卸载取消迟到安装", async (t) => {
    const { installPlugin, uninstallPlugin, refreshPlugins } = await import("../src/lib/plugins/manager");
    const manifest = { ...pkg, name: "canvas-plugin-download", infiniteCanvas: { ...pkg.infiniteCanvas, id: "download" } };
    const bytes = gzipSync(await packTar(Object.entries({ "package/package.json": JSON.stringify(manifest), "package/dist/client.js": "export default {};" }).map(([name, body]) => ({ header: { name, size: Buffer.byteLength(body), type: "file" }, body }))));
    const index = { version: 1, plugins: [{ name: manifest.name, title: "下载", versions: { "1.0.0": { tarball: "download.tgz", integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`, host: ">=1.0.0", pluginApi: 3 } } }] };
    let pause = false;
    let requested = deferred();
    let finish = deferred();
    t.mock.method(globalThis, "fetch", async (url: string) => {
        if (!url.endsWith(".tgz")) return Response.json(index);
        if (pause) { requested.resolve(); await finish.promise; }
        return new Response(bytes);
    });
    const request = { name: manifest.name, version: "latest", host: "1.0.0" };
    await adapter.install(request);
    pause = true;
    const updating = adapter.install(request);
    await requested.promise;
    await adapter.configure({ registry: "https://updated.example/index.json" });
    await adapter.enable("download", false);
    assert.equal((await adapter.config()).registry, "https://updated.example/index.json");
    finish.resolve();
    assert.equal((await updating).enabled, false);
    requested = deferred();
    finish = deferred();
    await refreshPlugins();
    const pending = installPlugin(request);
    const cancelled = assert.rejects(pending, { code: "PLUGIN_INACTIVE" });
    await requested.promise;
    await uninstallPlugin("download");
    finish.resolve();
    await cancelled;
    assert.equal((await adapter.list()).some((item) => item.package.infiniteCanvas.id === "download"), false);
});

test("媒体资源采用正式贡献并精确选择槽位，提供者退出或项目取消后不继续解析", async (t) => {
    const { getNodeMediaResource } = await import("../src/lib/canvas/canvas-resource-references");
    const { getPluginNodeContext } = await import("../src/lib/plugins/runtime");
    const owner = { ...pkg, name: "canvas-plugin-media-owner", infiniteCanvas: { ...pkg.infiniteCanvas, id: "media-owner" } };
    const provider = { ...pkg, name: "canvas-plugin-media-source", infiniteCanvas: { ...pkg.infiniteCanvas, id: "media-source" } };
    const slot = { status: "success" as const, naturalWidth: 100, naturalHeight: 100, bytes: 1, mimeType: "image/png" };
    const session = canvasFixture("media-project", [{ id: "image", type: "media-owner:image", title: "图片", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: {
        content: "https://media.example/metadata.png",
        storageKey: "image:metadata-must-not-leak",
        images: [{ ...slot, id: "ready", content: "https://media.example/slot.png" }, { ...slot, id: "empty", content: "" }],
    } }]);
    setPluginCanvas(session);
    t.after(async () => { await deactivatePlugin("media-source"); await deactivatePlugin("media-owner"); setPluginCanvas(null); await session.close(); });
    await activate("export default {};", owner);
    await activate("export default {};", provider);
    const definition = { type: "media-owner:image", title: "图片", icon: null, defaultSize: { width: 100, height: 100 } };
    getPluginContext("media-owner")!.extensions.contribute(points.nodes, { id: definition.type, value: definition });
    const calls: string[] = [];
    const resource = { resolve: (node: ReadonlyCanvasNode, slotId?: string) => {
        assert.ok(Object.isFrozen(node));
        assert.ok(Object.isFrozen(node.metadata!.images![0]));
        calls.push(`${node.id}:${slotId ?? "main"}`);
        if (slotId !== undefined) return slotId === "ready" ? { kind: "image" as const, storageKey: "image:formal-slot" } : null;
        return { kind: "image" as const, url: "https://media.example/contribution.png" };
    } };
    const release = getPluginContext("media-source")!.extensions.contribute(points.nodeResources, { id: "media-source:main", value: resource });
    const node = session.getSnapshot().nodes[0];
    const binding = getPluginNodeContext(node.type, session)!.ctx.scope;
    let previousSignal: AbortSignal | undefined;
    for (const mode of ["render", "execute"] as const) {
        const main = getNodeMediaResource(node, undefined, binding, mode)!;
        const slot = getNodeMediaResource(node, "ready", binding, mode)!;
        assert.deepEqual({ ...main, signal: undefined }, { kind: "image", url: "https://media.example/contribution.png", signal: undefined, contributionId: "media-source:main" });
        assert.deepEqual({ ...slot, signal: undefined }, { kind: "image", storageKey: "image:formal-slot", signal: undefined, contributionId: "media-source:main" });
        assert.equal(main.signal, slot.signal);
        assert.equal(main.signal.aborted, false);
        previousSignal = main.signal;
        assert.equal(getNodeMediaResource(node, "missing", binding, mode), null);
        assert.equal(getNodeMediaResource(node, "empty", binding, mode), null);
    }
    assert.deepEqual(calls, ["main", "ready", "missing", "empty", "main", "ready", "missing", "empty"].map((slot) => `${node.id}:${slot}`));
    release();
    assert.equal(previousSignal!.aborted, true);
    for (const mode of ["render", "execute"] as const) assert.equal(getNodeMediaResource(node, undefined, binding, mode), null);
    assert.equal(calls.length, 8);
    getPluginContext("media-source")!.extensions.contribute(points.nodeResources, { id: "media-source:main", value: resource });
    const replacement = getNodeMediaResource(node, undefined, binding, "render")!;
    assert.equal(replacement.url, "https://media.example/contribution.png");
    assert.notEqual(replacement.signal, previousSignal);
    assert.equal(replacement.signal.aborted, false);
    await deactivatePlugin("media-source");
    assert.equal(binding.signal.aborted, false);
    assert.equal(getNodeMediaResource(node, undefined, binding, "render"), null);
    assert.equal(getNodeMediaResource(node, undefined, binding, "execute"), null);
    assert.equal(calls.length, 9);
    await activate("export default {};", provider);
    getPluginContext("media-source")!.extensions.contribute(points.nodeResources, { id: "media-source:main", value: resource });
    await deactivatePlugin("media-owner");
    assert.equal(binding.signal.aborted, true);
    assert.ok(getPluginContext("media-source"));
    for (const slotId of [undefined, "ready", "missing", "empty"]) {
        assert.equal(getNodeMediaResource(node, slotId, binding, "render"), null);
        assert.throws(() => getNodeMediaResource(node, slotId, binding, "execute"), { code: "PLUGIN_INACTIVE" });
    }
    assert.equal(calls.length, 9);
    const projectBinding: ScopeBinding = { ...workspaceBinding, kind: "project", projectId: session.projectId, signal: session.signal };
    await session.close();
    for (const slotId of [undefined, "ready"]) {
        assert.equal(getNodeMediaResource(node, slotId, projectBinding, "render"), null);
        assert.throws(() => getNodeMediaResource(node, slotId, projectBinding, "execute"), { code: "PLUGIN_PROJECT_CHANGED" });
    }
    assert.equal(calls.length, 9);
});

test("停用等待持久写入、原图、预览与音视频读取的回执，旧调用结果不可继续使用", async (t) => {
    const { storage } = await import("../src/services/storage/runtime");
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "pending-write" } };
    const finish = deferred();
    const readEntered = deferred();
    const readFinish = deferred();
    const previewEntered = deferred();
    const previewFinish = deferred();
    const mediaEntered = deferred();
    const mediaFinish = deferred();
    let writes = 0;
    t.mock.method(storage.pluginData("pending-write"), "setItem", async (_key: string, value: unknown) => { await finish.promise; writes++; return value; });
    t.mock.method(storage.images, "getItem", async (key: string) => { assert.equal(key, "image:pending-read"); readEntered.resolve(); await readFinish.promise; return new Blob(["original"]); });
    t.mock.method(storage.previews, "getItem", async (key: string) => { assert.equal(key, "image:pending-preview"); previewEntered.resolve(); await previewFinish.promise; return new Blob(["preview"]); });
    t.mock.method(storage.media, "getItem", async (key: string) => { assert.equal(key, "video:pending-read"); mediaEntered.resolve(); await mediaFinish.promise; return new Blob(["video"], { type: "video/mp4" }); });
    await activate("export default {};", metadata);
    const ctx = getPluginContext("pending-write")!;
    const written = ctx.storage.set("value", true);
    const cancelled = assert.rejects(written, { code: "PLUGIN_INACTIVE" });
    const reading = ctx.images.read("image:pending-read", undefined, new AbortController().signal);
    const readCancelled = assert.rejects(reading, { code: "PLUGIN_INACTIVE" });
    const preview = ctx.images.preview("image:pending-preview", new AbortController().signal);
    const previewCancelled = assert.rejects(preview, { code: "PLUGIN_INACTIVE" });
    const media = ctx.media.read("video:pending-read", undefined, new AbortController().signal);
    const mediaCancelled = assert.rejects(media, { code: "PLUGIN_INACTIVE" });
    await Promise.all([readEntered.promise, previewEntered.promise, mediaEntered.promise]);
    let stoppedDone = false;
    const stopped = deactivatePlugin("pending-write").then(() => { stoppedDone = true; });
    assert.equal(usePluginStore.getState().states["pending-write"].status, "disabled");
    await assert.rejects(ctx.storage.set("late", true), { code: "PLUGIN_INACTIVE" });
    await assert.rejects(ctx.media.read("video:late", undefined, new AbortController().signal), { code: "PLUGIN_INACTIVE" });
    finish.resolve();
    await cancelled;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(stoppedDone, false);
    readFinish.resolve();
    await readCancelled;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(stoppedDone, false);
    previewFinish.resolve();
    await previewCancelled;
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    assert.equal(stoppedDone, false);
    mediaFinish.resolve();
    await mediaCancelled;
    await stopped;
    assert.equal(writes, 1);
    assert.equal(usePluginStore.getState().states["pending-write"].status, "disabled");
});

test("静态和setup贡献在成功后原子发布，失败不会暴露部分内容", async (t) => {
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "atomic" } };
    const entered = deferred();
    const finish = deferred();
    const changes: string[][] = [];
    const unsubscribe = pluginRegistry.subscribeAll(() => changes.push([
        ...pluginRegistry.getSnapshot(points.pages).filter((entry) => entry.pluginId === "atomic").map((entry) => entry.id),
        ...pluginRegistry.getSnapshot(points.panels).filter((entry) => entry.pluginId === "atomic").map((entry) => entry.id),
    ]));
    Object.assign(globalThis, { atomicFixture: { enter: entered.resolve, finish: finish.promise, fail: false } });
    const source = `export default {
        contributions: [{ point: globalThis.pluginTestPoints.pages, id: "atomic:page", value: { id: "atomic:page", title: "页面", Content() { return null; } } }],
        async setup(ctx) {
            ctx.extensions.contribute(globalThis.pluginTestPoints.panels, { id: "atomic:panel", value: { id: "atomic:panel", title: "面板", Content() { return null; } } });
            globalThis.atomicFixture.enter();
            await globalThis.atomicFixture.finish;
            if (globalThis.atomicFixture.fail) throw new Error("private setup failure");
        }
    };`;
    t.after(async () => { finish.resolve(); unsubscribe(); await deactivatePlugin("atomic"); Reflect.deleteProperty(globalThis, "atomicFixture"); });
    setPluginCanvas(null);
    const starting = activate(source, metadata);
    await entered.promise;
    assert.equal(usePluginStore.getState().states.atomic.status, "starting");
    finish.resolve();
    await starting;
    assert.deepEqual(changes.at(-1), ["atomic:page", "atomic:panel"]);
    await deactivatePlugin("atomic");
    changes.length = 0;
    Object.assign(globalThis, { atomicFixture: { enter() {}, finish: Promise.resolve(), fail: true } });
    await assert.rejects(activate(source, metadata), { code: "PLUGIN_LOAD_FAILED" });
    assert.deepEqual(changes.at(-1), []);
    assert.equal(getPluginContributions(points.panels).some(({ entry }) => entry.pluginId === "atomic"), false);
});

test("自定义视图点无需画布登记，真实视图上下文查询且关闭后立即失效", async (t) => {
    const point = defineExtensionPoint({ id: "view-owner:cards", schema: z.object({ label: z.string(), nested: z.object({ count: z.number() }) }) });
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "view-owner" } };
    Object.assign(globalThis, { viewFixture: { point, contribution: contribute(point, { id: "view-owner:first", value: { label: "首项", nested: { count: 1 } } }) } });
    t.after(async () => { await deactivatePlugin("view-owner"); Reflect.deleteProperty(globalThis, "viewFixture"); });
    setPluginCanvas(null);
    await activate("export default { extensionPoints: [globalThis.viewFixture.point], contributions: [globalThis.viewFixture.contribution] };", metadata);
    const root = getPluginContext("view-owner")!;
    assert.equal(root.scope.kind, "workspace");
    const controller = new AbortController();
    const binding: ScopeBinding = { ...workspaceBinding, kind: "view", viewId: "cards", signal: controller.signal };
    const first = getPluginContributions(point, binding)[0];
    assert.equal(first.ctx.scope.kind, "view");
    assert.equal(first.ctx.scope.viewId, "cards");
    assert.equal(first.ctx.scope.projectId, undefined);
    assert.ok(Object.isFrozen(first.ctx.scope));
    assert.ok(Object.isFrozen(first.item.nested));
    assert.equal(getPluginContributions(point, binding)[0].ctx, first.ctx);
    assert.equal(first.ctx.extensions.query(point, first.ctx.scope), first.ctx.extensions.query(point, first.ctx.scope));
    await runPluginCallback(first.ctx, point.id, "save", () => first.ctx.storage.set("view", true));
    controller.abort();
    assert.equal(first.ctx.signal.aborted, true);
    assert.throws(() => first.entry.assertActive(), { code: "PLUGIN_SCOPE_CLOSED" });
    await assert.rejects(first.ctx.storage.set("late-view", true), { code: "PLUGIN_INACTIVE" });
    assert.deepEqual(getPluginContributions(point, binding), []);
    assert.equal(root.signal.aborted, false);
    assert.equal(await root.storage.get("view"), true);
});

test("动态撤销同步移除消费者和旧上下文，旧释放句柄不撤销重登记内容", async (t) => {
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "dynamic" } };
    await activate("export default {};", metadata);
    t.after(() => deactivatePlugin("dynamic"));
    const root = getPluginContext("dynamic")!;
    const value = { id: "dynamic:page", title: "第一版", Content() { return null; } };
    const revision = usePluginStore.getState().revision;
    const firstRelease = root.extensions.contribute(points.pages, { id: value.id, value });
    const binding: ScopeBinding = { ...workspaceBinding, kind: "view", viewId: "dynamic", signal: new AbortController().signal };
    const first = getPluginContributions(points.pages, binding).find(({ entry }) => entry.pluginId === "dynamic")!;
    assert.ok(usePluginStore.getState().revision > revision);
    assert.throws(() => root.extensions.contribute(points.pages, { id: value.id, value }), { code: "PLUGIN_CONFLICT" });
    const work = deferred();
    const running = runPluginCallback(first.ctx, first.entry.id, "action", () => work.promise);
    const cancelled = assert.rejects(running, { code: "PLUGIN_INACTIVE" });
    firstRelease();
    assert.equal(getPluginContributions(points.pages, binding).some(({ entry }) => entry.pluginId === "dynamic"), false);
    assert.equal(first.ctx.signal.aborted, true);
    await assert.rejects(first.ctx.storage.set("late", true), { code: "PLUGIN_INACTIVE" });
    const secondRelease = root.extensions.contribute(points.pages, { id: value.id, value: { ...value, title: "第二版" } });
    firstRelease();
    const second = getPluginContributions(points.pages, binding).find(({ entry }) => entry.pluginId === "dynamic")!;
    assert.equal(second.item.title, "第二版");
    assert.notEqual(second.ctx, first.ctx);
    const stopped = deactivatePlugin("dynamic");
    assert.equal(usePluginStore.getState().states.dynamic.status, "disabled");
    work.resolve();
    await cancelled;
    await stopped;
    secondRelease();
    assert.equal(usePluginStore.getState().states.dynamic.status, "disabled");
});

test("节点静态和动态登记都约束类型身份，其他点值保留自己的业务ID", async (t) => {
    const { getNodeDefinition } = await import("../src/lib/canvas/node-registry");
    const metadata = { ...pkg, infiniteCanvas: { ...pkg.infiniteCanvas, id: "node-identity" } };
    await assert.rejects(activate(`export default { contributions: [{ point: globalThis.pluginTestPoints.nodes, id: "node-identity:first", value: { type: "text", title: "冲突", defaultSize: { width: 100, height: 100 } } }] };`, metadata), { code: "PLUGIN_LOAD_FAILED" });
    await activate("export default {};", metadata);
    t.after(() => deactivatePlugin("node-identity"));
    const ctx = getPluginContext("node-identity")!;
    const first = { type: "node-identity:first", title: "节点", icon: null, defaultSize: { width: 100, height: 100 } };
    const release = ctx.extensions.contribute(points.nodes, { id: first.type, value: first });
    assert.throws(() => ctx.extensions.contribute(points.nodes, { id: "node-identity:second", value: first }), { code: "PLUGIN_INVALID" });
    assert.equal(getNodeDefinition(first.type)?.title, "节点");
    ctx.extensions.contribute(points.pages, { id: "node-identity:page", value: { id: "business-page", title: "页面", Content() { return null; } } });
    assert.equal(getPluginContributions(points.pages).find(({ entry }) => entry.id === "node-identity:page")?.item.id, "business-page");
    release();
    assert.equal(getNodeDefinition(first.type), undefined);
});
