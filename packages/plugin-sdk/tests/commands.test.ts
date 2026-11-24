import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineCommand } from "../src/commands";
import { canvasApply, canvasRedo, canvasSelect, canvasSession, canvasSnapshotSchema, canvasUndo, canvasViewport, commands, models } from "../src/builtin";
import { ExtensionRegistry, PluginScope, contribute, type ScopeBinding } from "../src/runtime/index";
import { readonlySnapshot } from "../src/readonly-snapshot";
import type { CanvasSnapshot } from "../src/canvas";
import type { ModelsCapability, PluginCommand } from "../src/types";

const binding = (scope: PluginScope, project = false): ScopeBinding => ({ kind: project ? "project" : "workspace", workspaceId: "workspace", ...(project ? { projectId: "project" } : {}), signal: scope.signal });
const document = () => ({ projectId: "project", revision: 0, nodes: [{ id: "node", type: "text", title: "文本", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "初始" } }], connections: [], selection: { nodeIds: [], connectionId: null }, viewport: { x: 0, y: 0, k: 1 }, canUndo: false, canRedo: false });

test("公开命令只含稳定身份、作用域与schema，冻结描述并拒绝混入实现", () => {
    const definition = { id: "example:rename", scope: "project" as const, input: z.object({ title: z.string() }), output: z.object({ changed: z.boolean() }) };
    const command = defineCommand(definition);
    assert.ok(Object.isFrozen(command));
    assert.equal(command.input, definition.input);
    assert.equal(command.output, definition.output);
    definition.id = "example:changed";
    assert.equal(command.id, "example:rename");
    assert.throws(() => defineCommand({ ...definition, run: () => {} } as never));
    assert.throws(() => defineCommand({ ...definition, id: "without-namespace" }));
    assert.throws(() => defineCommand({ ...definition, input: {} } as never));
});

test("命令实现通过统一目录登记，无画布的工作区可发现，旧run签名外壳不再接受", () => {
    const registry = new ExtensionRegistry();
    const host = registry.createInstance({ id: "builtin", scope: new PluginScope() });
    host.register({ extensionPoints: [commands] });
    const command = defineCommand({ id: "example:work", scope: "workspace", input: z.string(), output: z.number() });
    const implementation: PluginCommand<string, number> = { command, title: "工作区操作", enabled: (input, context) => input.length > 0 && context.canvas === null, run: (input) => input.length };
    assert.equal(commands.scope, "application");
    assert.equal(commands.schema.safeParse(implementation).success, true);
    assert.equal(commands.schema.safeParse({ id: command.id, title: "旧入口", locations: ["canvas.toolbar"], run: () => {} }).success, false);
    const plugin = registry.createInstance({ id: "example", scope: new PluginScope() });
    plugin.register({ contributions: [contribute(commands, { id: command.id, value: implementation })] });
    const entries = registry.query({ ...commands }, binding(new PluginScope()));
    assert.equal(entries[0].id, command.id);
    assert.equal(entries[0].value.command.id, command.id);
    assert.equal(entries[0].value.run, implementation.run);
});

test("画布公共命令复用纯文档操作schema，图修改与选区视口以一个输入提交", () => {
    const input = { ops: [{ type: "update_node", id: "node", patch: { title: "更新" } }], selection: { nodeIds: ["node"], connectionId: null }, viewport: { x: 20, y: 30, k: 1 } };
    assert.deepEqual(canvasApply.input.parse(input), input);
    assert.equal(canvasApply.input.safeParse({ ops: [...input.ops, { type: "unknown" }] }).success, false);
    assert.equal(canvasApply.input.safeParse({ ops: input.ops, selection: { nodeIds: "node", connectionId: null } }).success, false);
    assert.equal(canvasApply.input.safeParse({ ops: [{ type: "run_generation", nodeId: "node" }] }).success, false);
    assert.equal(canvasSelect.input.safeParse(input.selection).success, true);
    assert.equal(canvasViewport.input.safeParse(input.viewport).success, true);
    for (const k of [0, -1, Infinity, Number.NaN]) {
        assert.equal(canvasViewport.input.safeParse({ ...input.viewport, k }).success, false);
        assert.equal(canvasApply.input.safeParse({ ...input, viewport: { ...input.viewport, k } }).success, false);
    }
    for (const command of [canvasApply, canvasUndo, canvasRedo, canvasSelect, canvasViewport]) {
        assert.equal(command.scope, "project");
        assert.equal(command.output, canvasSnapshotSchema);
    }
    assert.equal(canvasUndo.input.safeParse(undefined).success, true);
    assert.equal(canvasRedo.input.safeParse(undefined).success, true);
});

test("正式画布能力保留缓存快照身份，普通浅冻结结果仍与提供者可写数据隔离", async () => {
    const registry = new ExtensionRegistry();
    let current: CanvasSnapshot = readonlySnapshot(document());
    const host = registry.createInstance({ id: "builtin", scope: new PluginScope() });
    host.capabilities.provide(canvasSession, { snapshot: () => current, transact: () => current, undo: () => current, redo: () => current, select: () => {}, viewport: () => {}, flush: async () => {} });
    const caller = new PluginScope();
    assert.throws(() => registry.getCapability(canvasSession, binding(caller)), { code: "PLUGIN_CONTRACT_MISMATCH" });
    const handle = registry.getCapability(canvasSession, binding(caller, true), caller)!;
    assert.equal(handle.snapshot(undefined), current);
    assert.equal(handle.snapshot(undefined), handle.snapshot(undefined));
    const shallow = Object.freeze(document());
    current = shallow;
    const detached = handle.snapshot(undefined);
    assert.notEqual(detached, shallow);
    shallow.nodes[0].metadata.prompt = "外部修改";
    assert.equal(detached.nodes[0].metadata!.prompt, "初始");
    assert.ok(Object.isFrozen(detached.nodes[0].metadata));
    await caller.close();
    assert.throws(() => handle.snapshot(undefined), { code: "PLUGIN_SCOPE_CLOSED" });
});

test("工作区模型契约无需画布，单对象调用保留本次取消与流式回调", async () => {
    const registry = new ExtensionRegistry();
    const invocation = new AbortController();
    const deltas: string[] = [];
    const task = { token: crypto.randomUUID(), workId: "scene" };
    let receivedSignal: AbortSignal | undefined;
    const implementation: ModelsCapability = {
        listModels: () => [{ value: "configured", label: "已配置模型" }], defaultModel: () => "configured",
        generateImage: async () => ({ images: ["image"] }), generateVideo: async () => ({ url: "video", mimeType: "video/mp4" }),
        submitVideo: async (input) => { assert.equal(input.workId, task.workId); return { kind: "accepted", handle: task }; },
        generateText: async (input, context) => { receivedSignal = input.signal; assert.equal(context.scope.projectId, undefined); input.onDelta?.("增量"); return { text: input.prompt }; },
    };
    const host = registry.createInstance({ id: "builtin", scope: new PluginScope() });
    host.capabilities.provide(models, implementation);
    const handle = registry.getCapability(models, binding(new PluginScope()))!;
    assert.equal(handle.listModels({})[0].value, "configured");
    assert.equal(handle.defaultModel({ capability: "text" }), "configured");
    assert.deepEqual(await handle.submitVideo({ prompt: "镜头", workId: task.workId }), { kind: "accepted", handle: task });
    assert.deepEqual(await handle.generateText({ prompt: "问题", signal: invocation.signal, onDelta: (text) => { deltas.push(text); } }), { text: "问题" });
    assert.equal(receivedSignal, invocation.signal);
    assert.deepEqual(deltas, ["增量"]);
    assert.equal(models.methods.generateText.input.safeParse("旧多参数调用").success, false);
    assert.equal(models.methods.generateText.input.safeParse({ prompt: "问题", signal: {} }).success, false);
});

test("画布flush通过正式能力跟踪，调用者停止等待保存真实结束", async (context) => {
    context.mock.method(console, "error", () => {});
    const registry = new ExtensionRegistry();
    const current = readonlySnapshot(document());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const host = registry.createInstance({ id: "builtin", scope: new PluginScope() });
    host.capabilities.provide(canvasSession, { snapshot: () => current, transact: () => current, undo: () => current, redo: () => current, select: () => {}, viewport: () => {}, flush: () => gate });
    const caller = new PluginScope();
    const handle = registry.getCapability(canvasSession, binding(caller, true), caller)!;
    const pending = assert.rejects(handle.flush(undefined), { code: "PLUGIN_SCOPE_CLOSED" });
    let closed = false;
    const closing = caller.close().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    release();
    await Promise.all([pending, closing]);
    assert.equal(closed, true);
});
