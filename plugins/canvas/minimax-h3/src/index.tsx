import { definePlugin } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";
import { defaultH3Model, defaultPrompt } from "./constants";
import { H3ContentExact, H3Panel } from "./components/H3Workbench";
import h3Css from "./styles/h3.css";

export default definePlugin({
    id: "minimax-h3",
    name: "MiniMax H3",
    version: "1.2.0",
    description: "把原画布 MiniMax H3 的视频、角色参考、Motion Context 和生成参数带入新画布。",
    css: h3Css,
    nodes: [{
        type: "minimax-h3:video",
        legacyTypes: ["smart-minimax", "minimax"],
        title: "MiniMax H3",
        icon: "✦",
        description: "H3 视频生成与人物替换节点",
        defaultSize: { width: 980, height: 720 },
        defaultMetadata: {
            content: "", prompt: defaultPrompt, status: "idle", duration: "8", aspectRatio: "16:9",
            videoSteps: 8, denoise: 0.65, modelName: defaultH3Model, minimaxBaseModel: defaultH3Model,
            motionContextEnabled: true, motionContextNoiseEnabled: false,
            segments: [{ id: "segment-1", prompt: defaultPrompt, duration: 8, taskMode: "r2v", status: "idle" }],
        },
        minimapColor: "#f97316",
        Content: H3ContentExact,
        Panel: H3Panel,
        resource: (node) => {
            const content = node.metadata?.content;
            return typeof content === "string" && content ? { kind: "video", url: content } : null;
        },
        toolbar: (ctx: CanvasNodeContext) => [
            { id: "h3-open", title: "打开 H3 参数", label: "参数", icon: "⚙", onClick: () => ctx.openPanel() },
            { id: "h3-clear", title: "清空 H3 输出", label: "清空", icon: "×", onClick: () => ctx.updateMetadata({ content: "", status: "idle", errorDetails: "" }) },
        ],
    }],
    mcp: {
        id: "minimax-h3",
        version: "1.2.0",
        tools: [
            { id: "h3_list_models", version: "1.2.0", name: "H3 列出模型", description: "列出 MiniMax H3 可用的模型(unet)与 LoRA 清单。", inputJsonSchema: { type: "object", properties: {} }, annotations: { title: "H3 列出模型", readOnlyHint: true } },
            { id: "h3_get_node", version: "1.2.0", name: "H3 读取画布节点", description: "按节点 id 读取画布上的 MiniMax H3 节点及其片段/参考图配置。", inputJsonSchema: { type: "object", properties: { nodeId: { type: "string", description: "画布节点 id" } }, required: ["nodeId"] }, annotations: { title: "H3 读取画布节点", readOnlyHint: true } },
            { id: "h3_run_clip", version: "1.2.0", name: "H3 运行单段", description: "读取指定画布 H3 节点的某个片段,解析参考图/视频/音频后提交 ComfyUI 生成任务。", inputJsonSchema: { type: "object", properties: { nodeId: { type: "string", description: "画布节点 id" }, segmentIndex: { type: "integer", description: "片段下标;省略则运行首个未完成的片段" }, params: { type: "object", description: "覆盖片段自带参数的生成参数" } }, required: ["nodeId"] }, annotations: { title: "H3 运行单段" } },
            { id: "h3_get_task", version: "1.2.0", name: "H3 查询任务", description: "按任务 id 查询 MiniMax H3 生成任务的状态、进度与结果。", inputJsonSchema: { type: "object", properties: { taskId: { type: "string", description: "任务 id" } }, required: ["taskId"] }, annotations: { title: "H3 查询任务", readOnlyHint: true } },
            { id: "h3_cancel_task", version: "1.2.0", name: "H3 取消任务", description: "取消正在运行的 MiniMax H3 生成任务。", inputJsonSchema: { type: "object", properties: { taskId: { type: "string", description: "任务 id" } }, required: ["taskId"] }, annotations: { title: "H3 取消任务", destructiveHint: true } },
            { id: "h3_update_clip", version: "1.2.0", name: "H3 更新片段", description: "更新画布 H3 节点某个片段的部分字段,写回节点 metadata。", inputJsonSchema: { type: "object", properties: { nodeId: { type: "string", description: "画布节点 id" }, segmentIndex: { type: "integer", description: "片段下标" }, patch: { type: "object", description: "要合并进该片段的字段" } }, required: ["nodeId", "segmentIndex", "patch"] }, annotations: { title: "H3 更新片段" } },
            { id: "h3_run_all_clips", version: "1.2.0", name: "H3 运行全部片段", description: "对画布上所有(或指定的)MiniMax H3 节点,提交其未完成片段的生成任务。", inputJsonSchema: { type: "object", properties: { nodeIds: { type: "array", items: { type: "string" }, description: "限定运行的节点 id;省略则运行全部 H3 节点" }, params: { type: "object", description: "覆盖片段自带参数的生成参数" } } }, annotations: { title: "H3 运行全部片段" } },
        ],
    },
});
