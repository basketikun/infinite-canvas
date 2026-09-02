// 真实 CLI 入口 + 真实 stdio MCP 客户端 的端到端测试。
//
// 流程:
// 1. 把子进程的 HOME(USERPROFILE)重定向到临时目录,避免触碰你真实的 ~/.infinite-canvas/runtime.sqlite。
// 2. 在该临时 DB 里种入「插件 MCP 声明」(minimax-h3 enabled) 与一个画布 H3 节点。
// 3. 起一个 mock ComfyUI HTTP 服务(object_info /prompt /history /upload/image)。
// 4. 用 StdioClientTransport 真实 spawn `node dist/index.js mcp` 并连接。
// 5. 断言 7 个 h3_* 工具注册可见,并端到端跑 h3_get_node / h3_list_models / h3_run_clip / h3_get_task / h3_update_clip。
//
// 与 test-mcp-h3.mjs(进程内联调)的区别:这里验证的是真实 CLI 入口 + 真实 stdio 传输 +
// 真实进程内的注册表/SQLite/ComfyUiBridge 接线,而非同进程内联。

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { RuntimeDatabase } from "./dist/runtime/database.js";
import { pluginMcp } from "./dist/plugins/minimax-h3/mcp.js";

const distIndex = path.resolve("dist/index.js");

let passed = 0;
let failed = 0;
const log = [];
function check(name, cond, detail) {
    if (cond) { passed++; log.push("  PASS  " + name); }
    else { failed++; log.push("  FAIL  " + name + (detail !== undefined ? " :: " + JSON.stringify(detail) : "")); }
}
function text(result) {
    const content = result?.content || [];
    const first = content[0]?.text;
    if (typeof first !== "string") return first;
    try { return JSON.parse(first); } catch { return first; }
}

async function main() {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "h3-mcp-e2e-"));
    const dbPath = path.join(tempHome, ".infinite-canvas", "runtime.sqlite");

    // ---- 1) 种入临时 DB ----
    const seedDb = new RuntimeDatabase(dbPath);
    seedDb.replaceCanvasProjects([
        {
            id: "proj-test",
            updatedAt: new Date().toISOString(),
            nodes: [
                {
                    id: "node-h3",
                    type: "minimax-h3:video",
                    title: "H3 测试节点",
                    position: { x: 0, y: 0 },
                    width: 1,
                    height: 1,
                    metadata: { segments: [{ id: "seg-0", prompt: "一只猫在跳舞", taskMode: "t2v", status: "idle" }] },
                },
            ],
        },
    ]);
    seedDb.setSetting("plugins.mcp.declarations", [
        { id: "minimax-h3", name: "MiniMax H3", version: "1.2.0", mcp: { tools: pluginMcp.tools, enabled: true } },
    ]);
    seedDb.close();

    // ---- 2) mock ComfyUI ----
    const mockModel = "h3_10Eros_minimax_h3_TURBO-hybrid_beta4_int8_convrot_2.safetensors";
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const json = (body) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
        if (req.method === "GET" && url.pathname === "/object_info/UNETLoader") {
            return json({ UNETLoader: { input: { required: { unet_name: [[mockModel]] } } } });
        }
        if (req.method === "GET" && url.pathname === "/object_info/LoraLoader") {
            return json({ LoraLoader: { input: { required: { lora_name: [["some_lora.safetensors"]] } } } });
        }
        if (req.method === "POST" && url.pathname === "/prompt") {
            let body = "";
            req.on("data", (c) => (body += c));
            req.on("end", () => json({ prompt_id: "fake-prompt-" + crypto.randomUUID() }));
            return;
        }
        if (req.method === "GET" && url.pathname.startsWith("/history/")) {
            const pid = decodeURIComponent(url.pathname.slice("/history/".length));
            return json({ [pid]: { status: { completed: true }, outputs: { "9": [{ videos: [{ filename: "out.mp4", subfolder: "", type: "output" }] }] } } });
        }
        if (req.method === "POST" && url.pathname === "/upload/image") {
            return json({ name: "fake-upload.png" });
        }
        if (req.method === "GET" && url.pathname === "/system_stats") {
            return json({ devices: [] });
        }
        res.statusCode = 404;
        res.end("not found");
    });
    await new Promise((r) => server.listen(0, r));
    const mockPort = server.address().port;
    const mockUrl = `http://127.0.0.1:${mockPort}`;

    // ---- 3) spawn 真实 mcp 子进程 ----
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [distIndex, "mcp"],
        env: { ...process.env, USERPROFILE: tempHome, HOME: tempHome, COMFYUI_URL: mockUrl },
    });
    const client = new Client({ name: "h3-e2e-test", version: "0.0.0" });
    await client.connect(transport);

    // ---- 4) 等待 7 个 h3_* 工具出现(冷启动即从 SQLite 加载) ----
    let toolIds = [];
    for (let i = 0; i < 30; i++) {
        const list = await client.listTools();
        toolIds = list.tools.map((t) => t.name);
        if (toolIds.filter((n) => n.startsWith("h3_")).length >= 7) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    const h3Tools = toolIds.filter((n) => n.startsWith("h3_"));
    console.log("  已注册工具数:", toolIds.length, "| h3_* 工具:", h3Tools.join(", "));
    check("7 个 h3_* 工具在真实 mcp 子进程中注册可见", h3Tools.length === 7, h3Tools);

    // ---- 5) h3_get_node(纯读,无需 ComfyUI) ----
    const node = text(await client.callTool({ name: "h3_get_node", arguments: { nodeId: "node-h3" } }));
    check("h3_get_node 读回画布 H3 节点", node?.id === "node-h3");
    check("h3_get_node 片段 prompt 正确", node?.metadata?.segments?.[0]?.prompt === "一只猫在跳舞", node?.metadata?.segments?.[0]?.prompt);

    // ---- 6) h3_list_models(走真实 ComfyUiBridge.models()) ----
    const models = text(await client.callTool({ name: "h3_list_models", arguments: {} }));
    check("h3_list_models 经真实 ComfyUiBridge 返回模型清单", Array.isArray(models?.models) && models.models.includes(mockModel), models);

    // ---- 7) h3_run_clip(完整派发:ComfyUiBridge.run -> 任务库 -> /prompt -> /history -> 结果) ----
    let runTaskId = null;
    let runError = null;
    try {
        const task = text(await client.callTool({
            name: "h3_run_clip",
            arguments: { nodeId: "node-h3", segmentIndex: 0, params: { modelName: mockModel, taskMode: "t2v", duration: 4 } },
        }));
        runTaskId = task?.id || null;
        check("h3_run_clip 返回任务对象并写入任务库", Boolean(runTaskId), task);
    } catch (error) {
        runError = error instanceof Error ? error.message : String(error);
        check("h3_run_clip 未抛错", false, runError);
    }

    // 轮询任务终态
    let finalTask = null;
    if (runTaskId) {
        for (let i = 0; i < 30; i++) {
            finalTask = text(await client.callTool({ name: "h3_get_task", arguments: { taskId: runTaskId } }));
            if (finalTask?.status === "succeeded" || finalTask?.status === "failed") break;
            await new Promise((r) => setTimeout(r, 500));
        }
        check("h3_get_task 取回同一任务", finalTask?.id === runTaskId);
        console.log("  [info] h3_run_clip 任务终态:", finalTask?.status, finalTask?.error ? "| error: " + finalTask.error : "");
        check("h3_run_clip 端到端跑通(succeeded)", finalTask?.status === "succeeded", { status: finalTask?.status, error: finalTask?.error });
    }

    // ---- 8) h3_update_clip(写回 SQLite 并经真实进程读回) ----
    const upd = text(await client.callTool({ name: "h3_update_clip", arguments: { nodeId: "node-h3", segmentIndex: 0, patch: { prompt: "已更新的提示词" } } }));
    check("h3_update_clip 返回 ok", upd?.ok === true);
    const node2 = text(await client.callTool({ name: "h3_get_node", arguments: { nodeId: "node-h3" } }));
    check("h3_update_clip 经真实进程持久化到画布节点", node2?.metadata?.segments?.[0]?.prompt === "已更新的提示词", node2?.metadata?.segments?.[0]?.prompt);

    // ---- 9) 验证省略 segmentIndex 时自动选段(修复的 bug) ----
    let autoOk = false;
    let autoErr = null;
    try {
        const t2 = text(await client.callTool({ name: "h3_run_clip", arguments: { nodeId: "node-h3", params: { modelName: mockModel, taskMode: "t2v", duration: 4 } } }));
        autoOk = Boolean(t2?.id);
    } catch (error) {
        autoErr = error instanceof Error ? error.message : String(error);
    }
    check("省略 segmentIndex 时自动选段(不再抛'片段下标越界')", autoOk, autoErr);

    // ---- 清理 ----
    await client.close();
    await new Promise((r) => server.close(r));
    fs.rmSync(tempHome, { recursive: true, force: true });

    console.log("\n=== H3 MCP 子进程端到端测试结果 ===");
    console.log(log.join("\n"));
    console.log(`\n通过 ${passed} / 失败 ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
    console.error("测试运行异常:", error);
    process.exit(1);
});
