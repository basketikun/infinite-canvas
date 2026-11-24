import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { memo } from "react";
import { ExtensionRegistry, PluginScope, contribute, defineCapability, defineExtensionPoint, type ScopeBinding } from "../src/runtime/index";
import { nodes, menus, pages, themes, layouts, agentTools, syncTransports } from "../src/builtin";

const binding = (): ScopeBinding => ({ kind: "view", workspaceId: "workspace", projectId: "project", viewId: "view", signal: new AbortController().signal });
const point = defineExtensionPoint({ id: "provider:tools", schema: z.object({ title: z.string() }) });
const instance = (registry: ExtensionRegistry, id: string) => registry.createInstance({ id, scope: new PluginScope() });

test("登记即发布，快照稳定冻结，撤销与实例退出完整移除", async () => {
    const registry = new ExtensionRegistry();
    const owner = instance(registry, "provider");
    owner.register({ extensionPoints: [point] });
    const item = instance(registry, "one");
    const scope = binding();
    let notifications = 0;
    const unsubscribe = registry.subscribe(point, scope, () => { notifications++; });
    const remove = item.extensions.contribute(point, { id: "one:a", value: { title: "甲" } });
    assert.equal(notifications, 1);
    const snapshot = registry.query(point, scope);
    assert.equal(registry.query(point, scope), snapshot);
    assert.throws(() => { (snapshot[0].value as { title: string }).title = "改"; }, TypeError);
    item.extensions.contribute(point, { id: "one:b", value: { title: "乙" } });
    assert.equal(registry.query(point, scope)[0], snapshot[0]);
    remove();
    assert.deepEqual(registry.query(point, scope).map((entry) => entry.id), ["one:b"]);
    unsubscribe();
    await item.scope.close();
    assert.equal(registry.getSnapshot(point).length, 0);
    await owner.scope.close();
});

test("提供方未登记扩展点时贡献静置，登记后出现，退出后再静置", async () => {
    const registry = new ExtensionRegistry();
    const item = instance(registry, "one");
    item.register({ contributions: [contribute(point, { id: "one:a", value: { title: "甲" } })] });
    assert.equal(registry.getSnapshot(point).length, 0);
    const owner = instance(registry, "provider");
    owner.register({ extensionPoints: [point] });
    assert.equal(registry.getSnapshot(point).length, 1);
    await owner.scope.close();
    assert.equal(registry.getSnapshot(point).length, 0);
    await item.scope.close();
});

test("校验失败的贡献被跳过，其余照常发布；贡献必须使用自己的命名空间", async (t) => {
    t.mock.method(console, "error", () => {});
    const registry = new ExtensionRegistry();
    instance(registry, "provider").register({ extensionPoints: [point] });
    const item = instance(registry, "one");
    item.extensions.contribute(point, { id: "one:bad", value: { title: 1 } as never });
    item.extensions.contribute(point, { id: "one:ok", value: { title: "好" } });
    assert.deepEqual(registry.getSnapshot(point).map((entry) => entry.id), ["one:ok"]);
    assert.throws(() => item.extensions.contribute(point, { id: "other:x", value: { title: "x" } }), { code: "PLUGIN_INVALID" });
    assert.throws(() => item.extensions.define(defineExtensionPoint({ id: "other:point", schema: z.unknown() })), { code: "PLUGIN_INVALID" });
    assert.throws(() => item.extensions.contribute(point, { id: "one:ok", value: { title: "重复" } }), { code: "PLUGIN_CONFLICT" });
    await item.scope.close();
});

test("排序固定为内置在前、再按插件 id、再按登记顺序", () => {
    const registry = new ExtensionRegistry();
    instance(registry, "provider").register({ extensionPoints: [point] });
    for (const id of ["zeta", "alpha", "builtin"]) {
        const item = instance(registry, id);
        item.extensions.contribute(point, { id: `${id}:2`, value: { title: "二" } });
        item.extensions.contribute(point, { id: `${id}:1`, value: { title: "一" } });
    }
    assert.deepEqual(registry.getSnapshot(point).map((entry) => entry.id), ["builtin:2", "builtin:1", "alpha:2", "alpha:1", "zeta:2", "zeta:1"]);
});

test("track 等待贡献者与提供方，退出后拒绝迟到结果", async () => {
    const registry = new ExtensionRegistry();
    const owner = instance(registry, "provider");
    owner.register({ extensionPoints: [point] });
    const item = instance(registry, "one");
    item.extensions.contribute(point, { id: "one:a", value: { title: "甲" } });
    const [entry] = registry.query(point, binding());
    let finish!: () => void;
    const pending = item.extensions.track(entry, () => new Promise<string>((resolve) => { finish = () => resolve("完成"); }));
    const closing = item.scope.close();
    let closed = false;
    void closing.then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(closed, false);
    finish();
    await assert.rejects(pending, { code: "PLUGIN_INACTIVE" });
    await closing;
    await owner.scope.close();
});

test("能力句柄校验输入输出，调用方关闭后拒绝", async () => {
    const registry = new ExtensionRegistry();
    const host = instance(registry, "builtin");
    const contract = defineCapability<{ double(input: { value: number }): number }>({ id: "builtin:double", scope: "workspace", methods: { double: { input: z.object({ value: z.number() }), output: z.number() } } });
    host.capabilities.provide(contract, { double: ({ value }) => value * 2 });
    const caller = new PluginScope();
    const scope: ScopeBinding = { kind: "workspace", workspaceId: "workspace", signal: caller.signal };
    const handle = registry.getCapability(contract, scope, caller, "one")!;
    assert.equal(await handle.double({ value: 2 }), 4);
    assert.throws(() => handle.double({ value: "x" } as never), { code: "PLUGIN_CONTRACT_MISMATCH" });
    await caller.close();
    assert.throws(() => handle.double({ value: 1 }));
    await host.scope.close();
});

test("内置扩展点按固定作用域校验贡献", () => {
    assert.equal(nodes.scope, "project");
    assert.equal(themes.scope, "application");
    assert.equal(point.scope, "application");
    const Page = memo(() => null);
    assert.equal(pages.schema.safeParse({ id: "x:p", title: "页", navigation: true, Content: Page }).success, true);
    assert.equal(pages.schema.safeParse({ id: "x:p", title: "页", location: "navigation", Content: Page }).success, true);
    assert.equal(themes.schema.safeParse({ id: "x:t", name: "名", description: "说明", mode: "dark", background: "#000", panel: "#000", surface: "#000", text: "#fff", muted: "#999", border: "#333", accent: "#0af", accentText: "#000" }).success, true);
    assert.equal(themes.schema.safeParse({ id: "x:t", mode: "dark" }).success, false);
    assert.equal(layouts.schema.safeParse({ id: "x:l", name: "布局", description: "说明", Frame: Page }).success, true);
    assert.equal(menus.schema.safeParse({ id: "x:m", locations: ["canvas.toolbar"], transform: () => [] }).success, true);
    assert.equal(agentTools.schema.safeParse({ description: "读取", readOnly: true, command: { id: "x:c", scope: "project", input: z.void(), output: z.void() } }).success, true);
    assert.equal(syncTransports.scope, "workspace");
});
