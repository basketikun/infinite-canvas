// 通过真实 McpServer + McpClient 在进程内验证 H3 插件的 7 个 MCP 工具。
// ComfyUiBridge 后端用桩替代(避免依赖真实 ComfyUI),但工具注册、Zod 校验、
// 画布节点读写(SQLite)、参考图落地(storeRuntimeMedia)、任务往返均为真实代码路径。
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { PluginMcpRegistry, buildPluginMcpContext, loadPluginMcpDeclarations } from "./dist/server/plugin-mcp.js";
import { RuntimeDatabase } from "./dist/runtime/database.js";

const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

const results = [];
const check = (name, pass, detail = "") => {
    results.push({ name, pass: !!pass });
    console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ` :: ${detail}` : ""}`);
};

const tmpDb = path.join(os.tmpdir(), `h3-mcp-test-${crypto.randomUUID()}.sqlite`);
const runtimeDb = new RuntimeDatabase(tmpDb);
const nodeId = "node-h3-1";

// ComfyUiBridge 桩:模型清单 / 任务创建 / 取消。
const comfyUi = {
    async models() {
        return { models: ["h3_10Eros_turbo", "h3_pro"], loras: ["combat_lora", "cinematic_lora"] };
    },
    async run(preset, input, params) {
        const task = runtimeDb.createTask(`comfyui:${preset}`, input, params);
        return { ...task, preset };
    },
    cancel(id) {
        return { cancelled: id };
    },
    async status() {
        return { ok: true };
    },
};

// 注入一个画布项目:含 1 个 H3 节点(2 段,seg-0 带一张 data-URL 参考图)+ 1 个其他节点。
runtimeDb.replaceCanvasProjects([
    {
        id: "proj-1",
        updatedAt: new Date().toISOString(),
        nodes: [
            {
                id: nodeId,
                type: "minimax-h3:video",
                title: "H3 测试节点",
                position: { x: 10, y: 20 },
                width: 320,
                height: 200,
                metadata: {
                    segments: [
                        { id: "seg-0", prompt: "一名少女在红金床上", taskMode: "t2v", status: "idle", refs: { image: { url: PNG_1X1, name: "ref.png", type: "image" } } },
                        { id: "seg-1", prompt: "镜头缓缓拉远", taskMode: "r2v", status: "idle" },
                    ],
                },
            },
            { id: "node-other", type: "some-other", title: "其他节点", position: { x: 0, y: 0 }, width: 100, height: 100 },
        ],
    },
]);

const context = buildPluginMcpContext({ url: "http://127.0.0.1:17371", token: "test-token" }, runtimeDb, comfyUi);
const server = new McpServer({ name: "canvas-agent-test", version: "0.0.0" }, { instructions: "test" });
const registry = new PluginMcpRegistry(server, context);

// 浏览器启用插件(写入 SQLite + 当前进程注册工具),顺序与 startMcpServer 一致:先注册后 connect。
await registry.syncFromBrowser([{ id: "minimax-h3", name: "MiniMax H3", version: "1.2.0", mcp: { tools: [], enabled: true } }]);

const [clientT, serverT] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
await Promise.all([server.connect(serverT), client.connect(clientT)]);

const text = (res) => JSON.parse(res.content[0].text);

try {
    // 1) 7 个工具已注册
    const tools = await client.listTools();
    const h3Tools = tools.tools.filter((t) => t.name.startsWith("h3_"));
    check("注册 7 个 h3_* 工具", h3Tools.length === 7, h3Tools.map((t) => t.name).join(","));

    // 2) 声明已持久化到 SQLite
    const decls = loadPluginMcpDeclarations(runtimeDb);
    check("插件 MCP 声明已写入 SQLite", decls.length === 1 && decls[0].id === "minimax-h3" && decls[0].mcp.enabled === true, JSON.stringify(decls.map((d) => d.id)));

    // 3) h3_list_models
    const models = text(await client.callTool({ name: "h3_list_models", arguments: {} }));
    check("h3_list_models 返回模型+LoRA", Array.isArray(models.models) && Array.isArray(models.loras) && models.loras.length > 0, `${models.models.length} models / ${models.loras.length} loras`);

    // 4) h3_get_node
    const node = text(await client.callTool({ name: "h3_get_node", arguments: { nodeId } }));
    check("h3_get_node 返回 H3 节点(2 段)", node?.type?.includes("minimax") && node?.metadata?.segments?.length === 2, node?.id);

    // 5) h3_update_clip(写回 SQLite)
    const upd = text(await client.callTool({ name: "h3_update_clip", arguments: { nodeId, segmentIndex: 0, patch: { prompt: "已更新的提示词" } } }));
    check("h3_update_clip 返回 ok", upd.ok === true);
    const node2 = text(await client.callTool({ name: "h3_get_node", arguments: { nodeId } }));
    check("h3_update_clip 已持久化到画布节点", node2.metadata.segments[0].prompt === "已更新的提示词", node2.metadata.segments[0].prompt);

    // 6) h3_run_clip(真实走参考图落地 storeRuntimeMedia + comfyUi.run 桩)
    const task = text(await client.callTool({ name: "h3_run_clip", arguments: { nodeId, segmentIndex: 0 } }));
    check("h3_run_clip 返回任务(含 id)", Boolean(task?.id), task?.id);
    const taskId = task.id;

    // 7) h3_get_task(任务往返)
    const got = text(await client.callTool({ name: "h3_get_task", arguments: { taskId } }));
    check("h3_get_task 取回同一任务", got.id === taskId, got.id);

    // 8) h3_cancel_task
    const cancelRes = await client.callTool({ name: "h3_cancel_task", arguments: { taskId } });
    check("h3_cancel_task 正常返回", cancelRes.content?.[0]?.text?.includes(taskId) === true);

    // 9) h3_run_all_clips
    const all = text(await client.callTool({ name: "h3_run_all_clips", arguments: {} }));
    check("h3_run_all_clips 提交未完成片段", all.count >= 1, `count=${all.count}`);

    // 10) 输入校验:缺 nodeId 应报错
    const bad = await client.callTool({ name: "h3_get_node", arguments: {} });
    check("h3_get_node 缺少必填 nodeId 被 Zod 拒绝", bad.isError === true);

    // 11) 禁用插件后工具隐藏
    await registry.syncFromBrowser([{ id: "minimax-h3", name: "MiniMax H3", version: "1.2.0", mcp: { tools: [], enabled: false } }]);
    const afterDisable = (await client.listTools()).tools.filter((t) => t.name.startsWith("h3_"));
    check("禁用插件后 h3_* 工具隐藏", afterDisable.length === 0, `剩余=${afterDisable.length}`);

    // 12) 重新启用后工具恢复
    await registry.syncFromBrowser([{ id: "minimax-h3", name: "MiniMax H3", version: "1.2.0", mcp: { tools: [], enabled: true } }]);
    const afterEnable = (await client.listTools()).tools.filter((t) => t.name.startsWith("h3_"));
    check("重新启用后 h3_* 工具恢复(7 个)", afterEnable.length === 7, `恢复=${afterEnable.length}`);
} catch (error) {
    check("测试执行未抛异常", false, error instanceof Error ? error.stack || error.message : String(error));
} finally {
    await client.close().catch(() => {});
    await server.close().catch(() => {});
    runtimeDb.close();
    fs.rmSync(tmpDb, { force: true });
    fs.rmSync(`${tmpDb}-wal`, { force: true });
    fs.rmSync(`${tmpDb}-shm`, { force: true });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n===== 结果: ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) {
    console.log("失败项:", failed.map((f) => f.name).join("; "));
    process.exit(1);
}
