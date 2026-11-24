import { tool, zodSchema, type ToolSet } from "ai";
import { z } from "zod";
import { toolDescriptions, toolInputSchemas } from "@infinite-canvas/shared/canvas/tools/schemas";
import { runSiteTool } from "@workbench/lib/agent/agent-site-tools";

const siteSchemas = {
    canvas_list_models: toolInputSchemas.canvas_list_models,
    prompts_search: toolInputSchemas.prompts_search,
    assets_add: toolInputSchemas.assets_add,
} as const;

const planStepSchema = z.object({
    title: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed"]),
});

/** 生成类工具只创建待确认卡片，真正的生成由用户确认后从卡片发起。 */
const imageParams = {
    model: z.string().optional().describe("可选图片模型 ID，必须来自模型列表"),
    quality: z.string().optional().describe("图片质量，如 auto、low、medium、high"),
    ratio: z.string().optional().describe("宽高比，如 1:1、2:3、16:9"),
    scale: z.string().optional().describe("分辨率档位，如 1k、2k、4k、auto"),
    count: z.number().int().min(1).max(10).optional().describe("生成张数"),
};

const videoParams = {
    model: z.string().optional().describe("可选视频模型 ID，必须来自模型列表"),
    ratio: z.string().optional().describe("视频比例，如 16:9、9:16、1:1"),
    resolution: z.string().optional().describe("清晰度，如 720、1080"),
    seconds: z.number().optional().describe("视频时长（秒）"),
    generateAudio: z.boolean().optional().describe("是否生成声音"),
    watermark: z.boolean().optional().describe("是否加水印"),
    mode: z.enum(["frames", "reference"]).optional().describe("首尾帧或全能参考模式"),
};

const audioParams = {
    model: z.string().optional().describe("可选音频模型 ID，必须来自模型列表"),
    voice: z.string().optional().describe("音色值"),
    format: z.string().optional().describe("音频格式，如 mp3、wav"),
    speed: z.string().optional().describe("语速，如 1、1.25"),
};

export function createCreateAgentTools(): ToolSet {
    return {
        generate_image: tool({
            description: "准备一次图片生成：只创建待确认的生成卡片，不会立即生成。prompt 写清楚要生成的内容；可以按需求给出 quality、ratio、scale、count 作为卡片默认值（例如九宫格表情包用 1:1、9 张），用户仍可在卡片里修改模型和参数。判断出要生成什么时直接调用，不要为可调细节先追问用户。",
            inputSchema: zodSchema(z.object({ prompt: z.string().min(1), ...imageParams })),
            execute: async (input) => ({ ok: true, status: "awaiting_confirmation", kind: "image", ...input, message: "已创建图片生成卡片，等待用户确认，尚未生成。" }),
        }),
        generate_video: tool({
            description: "准备一次视频生成：只创建待确认的生成卡片，不会立即生成。prompt 写清楚镜头、动作和氛围；可以按需求给出 ratio、resolution、seconds 等作为卡片默认值，用户仍可在卡片里修改模型和参数。",
            inputSchema: zodSchema(z.object({ prompt: z.string().min(1), ...videoParams })),
            execute: async (input) => ({ ok: true, status: "awaiting_confirmation", kind: "video", ...input, message: "已创建视频生成卡片，等待用户确认，尚未生成。" }),
        }),
        generate_audio: tool({
            description: "准备一次音频生成：只创建待确认的生成卡片，不会立即生成。prompt 写清楚内容、语气和用途；可以按需求给出 voice、format、speed 作为卡片默认值，用户仍可在卡片里修改模型和参数。",
            inputSchema: zodSchema(z.object({ prompt: z.string().min(1), ...audioParams })),
            execute: async (input) => ({ ok: true, status: "awaiting_confirmation", kind: "audio", ...input, message: "已创建音频生成卡片，等待用户确认，尚未生成。" }),
        }),
        update_plan: tool({
            description: "为需要多个步骤的任务建立或更新执行清单。第一次调用时列出全部步骤并全部标为 pending，开始某一步时改为 in_progress，完成后改为 completed；每次调用都提交完整的步骤列表，不要遗漏还没完成的步骤。步骤控制在 2–8 个，简单的一步请求不要调用。",
            inputSchema: zodSchema(z.object({ steps: z.array(planStepSchema).min(1).max(12) })),
            execute: async ({ steps }) => ({ ok: true, steps, message: `任务计划已更新，共 ${steps.length} 项。` }),
        }),
        list_models: tool({
            description: toolDescriptions.canvas_list_models,
            inputSchema: zodSchema(siteSchemas.canvas_list_models),
            execute: async (input, { abortSignal }) => {
                try { return { ok: true, result: await runSiteTool("canvas_list_models", input as Record<string, unknown>, { signal: abortSignal }) }; }
                catch (error) {
                    if (abortSignal?.aborted) throw error;
                    console.error("[create-agent] list models", error);
                    return { ok: false, error: "暂时无法读取模型列表，请稍后重试。" };
                }
            },
        }),
        search_prompts: tool({
            description: toolDescriptions.prompts_search,
            inputSchema: zodSchema(siteSchemas.prompts_search),
            execute: async (input, { abortSignal }) => {
                try { return { ok: true, result: await runSiteTool("prompts_search", input as Record<string, unknown>, { signal: abortSignal }) }; }
                catch (error) {
                    if (abortSignal?.aborted) throw error;
                    console.error("[create-agent] search prompts", error);
                    return { ok: false, error: "提示词搜索没有完成，请稍后重试。" };
                }
            },
        }),
        add_asset: tool({
            description: toolDescriptions.assets_add,
            inputSchema: zodSchema(siteSchemas.assets_add),
            execute: async (input, { abortSignal }) => {
                try { return { ok: true, result: await runSiteTool("assets_add", input as Record<string, unknown>, { signal: abortSignal }) }; }
                catch (error) {
                    if (abortSignal?.aborted) throw error;
                    console.error("[create-agent] add asset", error);
                    return { ok: false, error: "写入资产没有完成，请确认标题和内容后重试。" };
                }
            },
        }),
    };
}

export const createAgentSystemPrompt = "你是创作页的创作助手。先判断用户要图片、视频还是音频，再调用对应工具：generate_image、generate_video、generate_audio。这些工具只创建待确认的生成卡片，不会立即生成；调用时可按需求给出参数作为卡片默认值（图片 quality/ratio/scale/count，视频 ratio/resolution/seconds，音频 voice/format/speed），用户仍可在卡片里修改。调用后请用户确认卡片里的模型和参数，不要声称已经生成或已经提交。能判断出要生成什么时，立即调用对应工具创建卡片，不要先追问再创建——卡片本身就是确认步骤，用户确认并生成完成后会自动继续执行后续步骤，不要要求用户再发消息催你继续。风格、数量、比例、分辨率、参考图等细节都能在卡片里调整，不要为这些可调项反问用户；只有连要画什么或生成什么都不清楚时，才简短追问一句。遇到需要多个步骤完成的任务，先用 update_plan 列出步骤；之后每开始或完成一个步骤就再次调用 update_plan 提交完整的步骤列表，让新的规划卡片出现在当前进度位置，不要回头改写之前的规划。还没完成的步骤不要标成 completed。生成卡片等待确认期间不要再输出文字或调用其他工具，直接结束本次回复；用户确认或拒绝后会自动继续。页面上的参考图会随生成卡片自动带入，不需要让用户重新上传。需要模型列表用 list_models，需要现成提示词用 search_prompts 搜索，需要保存素材用 add_asset。工具生成的内容会自动出现在创作记录中，不要编造没有返回的结果或链接。工具失败时说明下一步建议，不要暴露密钥和内部错误。用中文回答，保持简洁。";
