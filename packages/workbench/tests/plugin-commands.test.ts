import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import localforage from "localforage";
import { z } from "zod";
import { defineCommand } from "@infinite-canvas/plugin-sdk";
import { canvasApply, canvasUndo, canvasRedo, commands, canvasSession } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginScope } from "@infinite-canvas/plugin-sdk/scope";
import { PluginError, type PluginPackage } from "@infinite-canvas/shared/plugins";
import { createMemoryCollection, createMemoryStorage } from "./helpers/storage";
import { initializeStorage } from "../src/services/storage/runtime";

const adapter = createMemoryStorage();
initializeStorage(adapter);
const { CanvasSession } = await import("../src/lib/canvas/canvas-session");
const { createCanvasStore, useCanvasStore } = await import("../src/stores/canvas/use-canvas-store");
const { executeCommand } = await import("../src/lib/plugins/commands");
const { activatePlugin, deactivatePlugin, getPluginContext, setPluginCanvas } = await import("../src/lib/plugins/runtime");
const { workspaceBinding } = await import("../src/lib/plugins/registry");
const node = (id: string) => ({ id, type: "text", title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} });

async function fixture() {
    const store = createCanvasStore(createMemoryCollection(), createMemoryCollection());
    await store.getState().load();
    const id = store.getState().importProject({ nodes: [node("one")], connections: [] });
    await store.getState().flush(id);
    const session = new CanvasSession({ project: store.getState().openProject(id)!, store: store.getState() });
    const scope = { ...workspaceBinding, kind: "project" as const, projectId: id, signal: session.signal };
    setPluginCanvas(session);
    return { session, scope, store };
}

async function activate(source: string, commandId?: string) {
    const pkg: PluginPackage = { name: "canvas-plugin-command-fixture", version: "1.0.0", infiniteCanvas: {
        id: "command-fixture", name: "命令测试", client: "client.js",
    } };
    const create = URL.createObjectURL;
    URL.createObjectURL = () => `data:text/javascript,${encodeURIComponent(source)}#${crypto.randomUUID()}`;
    try { await activatePlugin(pkg, "fixture"); }
    finally { URL.createObjectURL = create; }
    return getPluginContext("command-fixture")!;
}

test("UI、Agent和插件共用同一图命令，提交一次历史并保留真实来源", async (t) => {
    const { session, scope } = await fixture();
    t.after(async () => { await deactivatePlugin("command-fixture"); setPluginCanvas(null); await session.close(); });
    const ctx = await activate("export default {};");
    const sources: unknown[] = [];
    session.on("document.committed", event => { sources.push(event.source); });
    const input = { ops: [{ type: "add_node" as const, node: node("two") }, { type: "connect_nodes" as const, connection: { id: "edge", fromNodeId: "one", toNodeId: "two" } }] };
    const ui = await executeCommand(canvasApply, input, { scope, session, source: { kind: "ui" } });
    await executeCommand(canvasUndo, undefined, { scope, session });
    const agent = await executeCommand(canvasApply, input, { scope, session, source: { kind: "agent", id: "chat" } });
    await executeCommand(canvasUndo, undefined, { scope, session });
    const plugin = await ctx.commands.execute(canvasApply, input, { scope });
    assert.deepEqual(ui.nodes, agent.nodes);
    assert.deepEqual(ui.nodes, plugin.nodes);
    assert.deepEqual(plugin.connections, ui.connections);
    assert.deepEqual(sources.filter((_, index) => index % 2 === 0), [{ kind: "ui" }, { kind: "agent", id: "chat" }, { kind: "plugin", id: "command-fixture" }]);
    assert.equal(session.getHistory().past.length, 1);
    await ctx.commands.execute(canvasUndo, undefined, { scope });
    assert.equal(session.getSnapshot().nodes.length, 1);
    await ctx.commands.execute(canvasRedo, undefined, { scope });
    assert.equal(session.getSnapshot().nodes.length, 2);
    const before = session.getSnapshot();
    await assert.rejects(ctx.commands.execute(canvasApply, { ops: [{ type: "add_node", node: node("three") }, { type: "connect_nodes", connection: { id: "bad", fromNodeId: "three", toNodeId: "missing" } }] }, { scope }));
    assert.equal(session.getSnapshot(), before);
});

test("正式会话能力直接复用快照，修改事件记录调用插件而非输入伪造身份", async (t) => {
    const { session, scope } = await fixture();
    t.after(async () => { await deactivatePlugin("command-fixture"); setPluginCanvas(null); await session.close(); });
    const ctx = await activate("export default {};");
    const api = ctx.capabilities.get(canvasSession, scope)!;
    const before = api.snapshot(undefined);
    assert.equal(api.snapshot(undefined), before);
    let source;
    session.on("document.committed", event => { source = event.source; });
    await api.transact({ ops: [{ type: "add_node", node: node("two") }] });
    assert.deepEqual(source, { kind: "plugin", id: "command-fixture" });
    assert.equal(session.getSnapshot().nodes.length, 2);
});

test("真实项目 ID 配任意信号不能授权会话写入，明确签发的画布范围可用", async (t) => {
    const { session, scope } = await fixture();
    t.after(async () => { await deactivatePlugin("command-fixture"); setPluginCanvas(null); await session.close(); });
    const ctx = await activate("export default {};");
    const forged = { ...scope, signal: new AbortController().signal };
    const before = session.getSnapshot();
    const input = { ops: [{ type: "add_node" as const, node: node("two") }] };
    assert.throws(() => ctx.capabilities.get(canvasSession, forged), { code: "PLUGIN_PROJECT_CHANGED" });
    assert.equal(ctx.commands.canExecute(canvasApply, input, { scope: forged }), false);
    await assert.rejects(ctx.commands.execute(canvasApply, input, { scope: forged }), { code: "PLUGIN_PROJECT_CHANGED" });
    assert.equal(session.getSnapshot(), before);
    const actual = ctx.canvas().scope;
    await ctx.capabilities.get(canvasSession, actual)!.transact(input);
    assert.equal(session.getSnapshot().nodes.length, 2);
});

test("异步插件命令捕获原场景，切换项目后不修改新旧画布", async (t) => {
    const first = await fixture();
    const command = defineCommand({ id: "command-fixture:delayed", scope: "project", input: z.void(), output: z.void() });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    Object.assign(globalThis, { s4Command: command, s4CommandPoint: commands, s4Gate: gate });
    const ctx = await activate('export default { contributions: [{ point: globalThis.s4CommandPoint, id: globalThis.s4Command.id, value: { command: globalThis.s4Command, title: "延迟", run: async (_, { canvas }) => { await globalThis.s4Gate; await canvas.transact([{ type: "update_node", id: "one", patch: { title: "late" } }]); } } }] };', command.id);
    const pending = ctx.commands.execute(command, undefined, { scope: first.scope });
    const rejected = assert.rejects(pending, { code: "PLUGIN_PROJECT_CHANGED" });
    const second = await fixture();
    t.after(async () => {
        await deactivatePlugin("command-fixture"); setPluginCanvas(null);
        await Promise.all([first.session.close(), second.session.close()]);
        for (const key of ["s4Command", "s4CommandPoint", "s4Gate"]) Reflect.deleteProperty(globalThis, key);
    });
    release();
    await rejected;
    assert.equal(first.session.getSnapshot().nodes[0].title, "one");
    assert.equal(second.session.getSnapshot().nodes[0].title, "one");
});

test("命令准备和输入校验回调失败受固定错误边界约束，取消后不提交", async (t) => {
    const { session, scope } = await fixture();
    t.after(async () => { setPluginCanvas(null); await session.close(); });
    const before = session.getSnapshot();
    const throwing = defineCommand({ ...canvasApply, input: z.any().transform(() => { throw new Error("private-validation"); }) });
    await assert.rejects(executeCommand(throwing, {}, { scope, session }), error => {
        assert.equal((error as { code: string }).code, "PLUGIN_OPERATION_FAILED");
        assert.equal((error as Error).message.includes("private-validation"), false);
        return true;
    });
    const controller = new AbortController();
    const cancelling = defineCommand({ ...canvasApply, input: canvasApply.input.transform(value => { controller.abort("private-reason"); return value; }) });
    await assert.rejects(executeCommand(cancelling, { ops: [{ type: "add_node", node: node("two") }] }, { scope, session, signal: controller.signal }), { code: "PLUGIN_INACTIVE" });
    assert.equal(session.getSnapshot(), before);
});

test("命令双方分别校验原值，同一契约被独立打包也不会串联转换", async (t) => {
    t.after(async () => {
        await deactivatePlugin("command-fixture");
        for (const key of ["s4Command", "s4CommandPoint"]) Reflect.deleteProperty(globalThis, key);
    });
    const definition = () => defineCommand({ id: "command-fixture:transform", scope: "workspace", input: z.number().transform(value => value + 1), output: z.number().transform(value => value + 1) });
    for (const shared of [true, false]) {
        const actual = definition();
        const expected = shared ? actual : definition();
        Object.assign(globalThis, { s4Command: actual, s4CommandPoint: commands });
        const ctx = await activate('export default { contributions: [{ point: globalThis.s4CommandPoint, id: globalThis.s4Command.id, value: { command: globalThis.s4Command, title: "转换", run: value => value } }] };', actual.id);
        assert.equal(await ctx.commands.execute(expected, 2, { scope: ctx.scope }), 4);
        await deactivatePlugin("command-fixture");
    }
});

test("Agent 发现只绑定原项目和原命令，换代与停用不能交付迟到输出", async (t) => {
    const { agentTools } = await import("@infinite-canvas/plugin-sdk/builtin");
    const { discoverAgentTools, callDiscoveredAgentTool } = await import("../src/lib/agent/plugin-tools");
    const { session, store } = await fixture();
    const replacement = new CanvasSession({ project: store.getState().openProject(session.projectId)!, store: store.getState() });
    const id = "agent-test:shots";
    const command = defineCommand({ id, scope: "project", input: z.object({ n: z.number().int().positive() }).strict(), output: z.object({ n: z.number() }) });
    const workspace = defineCommand({ id: "agent-test:titles", scope: "workspace", input: z.object({}).strict(), output: z.object({ title: z.string() }) });
    const pkg: PluginPackage = { name: "agent-tools-test", version: "1.0.0", infiniteCanvas: {
        id: "agent-test", name: "工具", client: "client.js",
    } };
    await activatePlugin(pkg);
    const ctx = getPluginContext("agent-test")!;
    t.after(async () => { setPluginCanvas(null); await deactivatePlugin("agent-test"); await Promise.all([session.close(), replacement.close()]); });
    ctx.extensions.contribute(commands, { id: workspace.id, value: { command: workspace, title: "读取", run: () => ({ title: "公开" }) } });
    ctx.extensions.contribute(agentTools, { id: workspace.id, value: { description: "标题", command: workspace, readOnly: true } });
    ctx.extensions.contribute(agentTools, { id, value: { description: "镜头", command } });
    let count = 0;
    const enter = Promise.withResolvers<void>(), gate = Promise.withResolvers<void>();
    let callSignal: AbortSignal | undefined;
    function register() {
        return ctx.extensions.contribute(commands, { id, value: { command, title: "创建", run: async (input, context) => {
            count++; callSignal = context.signal;
            if (input.n === 3) { enter.resolve(); await gate.promise; }
            return { n: input.n, private: "工作区私有数据" };
        } } });
    }
    const release = register();
    const discover = async () => (await discoverAgentTools(session.projectId)).find(row => !row.descriptor.readOnly)!.descriptor;
    assert.deepEqual((await discoverAgentTools()).map(row => row.descriptor.name), ["plugin_read_agent-test_titles"]);
    const first = await discover();
    const invoke = (n: number, binding = first.binding) => callDiscoveredAgentTool(first.name, { binding, input: { n } }, session.projectId);
    await assert.rejects(invoke(0), /INVALID_ARGUMENTS/);
    assert.deepEqual(await invoke(2), { n: 2 });
    setPluginCanvas(replacement); // 相同项目 ID，旧会话仍活跃。
    assert.throws(() => invoke(2), /UNKNOWN_TOOL/);
    const second = await discover();
    assert.notEqual(first.binding, second.binding);
    release(); register();
    assert.throws(() => invoke(2, second.binding), /UNKNOWN_TOOL/);
    const last = await discover();
    const running = assert.rejects(invoke(3, last.binding));
    await enter.promise;
    let stopped = false;
    const stop = deactivatePlugin("agent-test").then(() => { stopped = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callSignal?.aborted, true);
    assert.equal(stopped, false);
    gate.resolve(); await Promise.all([running, stop]);
    assert.equal(count, 2);
});
