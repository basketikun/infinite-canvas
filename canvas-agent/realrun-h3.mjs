// 真实端到端实跑：通过真实 MCP 子进程驱动你本机 8188 的 ComfyUI 真出一片 H3 视频。
// 与 test-mcp-h3-subprocess.mjs 的唯一区别：这里 COMFYUI_URL 指向真实 ComfyUI，没有 mock。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { RuntimeDatabase } from "./dist/runtime/database.js";
import { pluginMcp } from "./dist/plugins/minimax-h3/mcp.js";

const COMFYUI_URL = "http://127.0.0.1:8188";
const distIndex = path.resolve("dist/index.js");

function text(result) {
    const first = result?.content?.[0]?.text;
    if (typeof first !== "string") return first;
    try { return JSON.parse(first); } catch { return first; }
}

async function main() {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "h3-realrun-"));
    const dbPath = path.join(tempHome, ".infinite-canvas", "runtime.sqlite");

    const seedDb = new RuntimeDatabase(dbPath);
    seedDb.replaceCanvasProjects([
        {
            id: "proj-real",
            updatedAt: new Date().toISOString(),
            nodes: [
                {
                    id: "node-h3",
                    type: "minimax-h3:video",
                    title: "H3 真实实跑节点",
                    position: { x: 0, y: 0 },
                    width: 1, height: 1,
                    metadata: { segments: [{ id: "seg-0", prompt: "一只橘色小猫在洒满阳光的木地板上追逐毛线球，温暖自然光，电影感，4K", taskMode: "t2v", status: "idle" }] },
                },
            ],
        },
    ]);
    seedDb.setSetting("plugins.mcp.declarations", [
        { id: "minimax-h3", name: "MiniMax H3", version: "1.2.0", mcp: { tools: pluginMcp.tools, enabled: true } },
    ]);
    seedDb.close();

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [distIndex, "mcp"],
        env: { ...process.env, USERPROFILE: tempHome, HOME: tempHome, COMFYUI_URL },
    });
    const client = new Client({ name: "h3-realrun", version: "0.0.0" });
    await client.connect(transport);

    // 1) 拉真实已加载模型
    let toolIds = [];
    for (let i = 0; i < 30; i++) {
        const list = await client.listTools();
        toolIds = list.tools.map((t) => t.name);
        if (toolIds.filter((n) => n.startsWith("h3_")).length >= 7) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    console.log("  已注册 h3_* 工具:", toolIds.filter((n) => n.startsWith("h3_")).join(", "));

    const models = text(await client.callTool({ name: "h3_list_models", arguments: {} }));
    console.log("  真实 ComfyUI 已加载 UNET 模型:", (models?.models || []).join(" | ") || "(空)");
    const h3Model = (models?.models || []).find((m) => /h3|minimax/i.test(m)) || models?.models?.[0];
    if (!h3Model) {
        console.log("  [跳过] 真实 ComfyUI 没有可用的 H3/UNET 模型，无法真出片。请先在 8188 加载 H3 checkpoint。");
        await client.close();
        fs.rmSync(tempHome, { recursive: true, force: true });
        process.exit(2);
    }
    console.log("  选用模型:", h3Model);

    // 2) 真实跑一段 t2v
    console.log("  >> 提交 h3_run_clip (t2v, 4s) 到真实 ComfyUI ...");
    const task = text(await client.callTool({
        name: "h3_run_clip",
        arguments: { nodeId: "node-h3", segmentIndex: 0, params: { modelName: h3Model, taskMode: "t2v", duration: 4 } },
    }));
    const taskId = task?.id;
    console.log("  任务 id:", taskId);

    let finalTask = null;
    for (let i = 0; i < 240; i++) {
        finalTask = text(await client.callTool({ name: "h3_get_task", arguments: { taskId } }));
        const st = finalTask?.status;
        if (st === "succeeded" || st === "failed") break;
        if (i % 10 === 0) console.log(`  轮询中... status=${st} progress=${(finalTask?.progress ?? 0).toFixed(2)}`);
        await new Promise((r) => setTimeout(r, 2000));
    }
    console.log("  终态:", finalTask?.status, finalTask?.error ? "| error: " + finalTask.error : "");

    let savedPath = null;
    if (finalTask?.status === "succeeded") {
        const media = finalTask?.result?.media || finalTask?.media || [];
        const video = media.find((m) => String(m?.mimeType || "").startsWith("video/")) || media[0];
        console.log("  出片 media:", JSON.stringify(video));
        if (video?.url) {
            const outPath = path.resolve("h3-realrun-output.mp4");
            await new Promise((resolve, reject) => {
                const f = fs.createWriteStream(outPath);
                http.get(video.url, (res) => {
                    res.pipe(f);
                    f.on("finish", () => { f.close(() => resolve()); });
                }).on("error", reject);
            });
            const size = fs.statSync(outPath).size;
            console.log(`  已落盘: ${outPath} (${size} bytes)`);
            savedPath = outPath;
        }
    }

    await client.close();
    fs.rmSync(tempHome, { recursive: true, force: true });
    if (savedPath) { console.log("\nREALRUN_OK " + savedPath); process.exit(0); }
    else { console.log("\nREALRUN_FAIL"); process.exit(1); }
}

main().catch((error) => { console.error("实跑异常:", error); process.exit(1); });
