import { z } from "zod";
import type { VideoTaskIdentity } from "./model-execution.js";
import type { ModelCallUpstream } from "./model-calls.js";

export const modelErrorMessages = {
    MODEL_LIST_AUTH: "无法获取模型列表，请检查分组密钥和访问权限。",
    MODEL_LIST_LIMITED: "获取模型列表的请求过于频繁或额度不足，请稍后重试。",
    MODEL_LIST_CONNECTION: "无法连接模型服务，请检查渠道地址和网络后重试。",
    MODEL_PROXY: "本次请求使用了本地代理，但无法连接。请启动本地代理，或在设置的「本地代理」中关闭代理模式后重试。",
    MODEL_LIST_FAILED: "暂时无法获取模型列表，请检查渠道地址和列表格式后重试。",
    MODEL_CONFIG_MISSING: "所选模型的配置已不可用，请检查渠道、密钥和调用方式后重试。",
    MODEL_REFERENCE_MISSING: "无法读取参考素材，请重新选择素材后重试。",
    MODEL_FAILED: "本次生成未完成，请检查模型配置或稍后重试。",
    MODEL_AUTH: "鉴权失败，请检查 API Key、套餐权限或模型权限",
    MODEL_INVALID_KEY: "无效的令牌，请检查 API Key 是否正确",
    MODEL_LIMITED: "请求被限流或额度不足，请稍后重试",
    MODEL_NOT_FOUND: "接口地址不存在（404），请检查 Base URL 和模型选择",
    MODEL_BAD_GATEWAY: "网关错误（502），接口服务暂时不可用，请稍后重试",
    MODEL_BUSY: "服务繁忙（503），请稍后重试",
    MODEL_TIMEOUT: "请求超时，接口长时间没有返回，请稍后重试或更换渠道",
    MODEL_NETWORK: "Network Error",
    MODEL_TASK_INTERRUPTED: "本地程序已停止，生成结果未确认。请先检查已有结果，再决定是否重新生成。",
    MODEL_TASK_CANCELLED: "已停止等待本次生成。",
    MODEL_TASK_PAUSED: "暂时无法取得视频结果，可以稍后继续查询。",
    MODEL_TASK_CONFLICT: "这次生成与当前内容不匹配，请回到原画布或生成记录查看。",
    MODEL_VIDEO_CONNECTION_CHANGED: "视频任务的连接已更改。请恢复原渠道地址和凭据后，再查询原任务。",
    MODEL_VIDEO_CONNECTION_UNVERIFIED: "无法核实视频任务原来使用的连接。请在节点信息中查看任务 ID，并到原渠道查看结果。",
    MODEL_LOCAL_VIDEO_CONNECTION_UNVERIFIED: "无法核实视频任务原来使用的连接。请到提交时所用渠道，根据提交时间和内容查看生成记录。",
    MODEL_VIDEO_RECEIPT_UNSAVED: "视频任务已提交，暂时无法确认保存。请点击「获取任务状态」重试。",
    MODEL_TASK_FAILED: "视频生成未完成，请调整内容或参考素材后重试。",
    MODEL_TASK_MISSING: "找不到这个生成任务，请确认当前打开的是提交任务时的工作区。",
    MODEL_UNAVAILABLE: "无法连接本地程序，请重新打开启动时显示的地址后重试。",
    MODEL_RESULT_MISSING: "未能读取生成结果，请稍后查询任务或检查模型配置。",
    SCRIPT_STORAGE_REQUIRED: "此参考素材需要公开链接，请先在设置的「对象存储」中填写上传信息，或改用公开链接。",
    SCRIPT_STORAGE_PUBLIC_URL_REQUIRED: "请在「对象存储」中填写可公开访问的地址，本机或内网地址无法用于生成。",
    SCRIPT_STORAGE_UPLOAD_FAILED: "参考素材上传失败，请检查对象存储地址、密钥、写入权限和跨域设置后重试。",
    SCRIPT_VIDEO_REFERENCES_UNSUPPORTED: "此调用方式不支持当前参考素材组合，请按脚本说明调整素材或更换调用方式。",
    SCRIPT_IMAGE_REQUIRED: "请连接一张参考图片后重试。",
    SCRIPT_IMAGE_AUDIO_REQUIRED: "此调用方式需要一张图片和一段音频，请调整参考素材后重试。",
    SCRIPT_AUDIO_RESULT_MISSING: "返回内容中没有可播放的音频，请确认所选模型支持音频生成。",
    SCRIPT_REFERENCE_URL_REQUIRED: "此调用方式的视频参考素材需要公开链接，请替换本地文件后重试。",
    SCRIPT_REFERENCE_READ_FAILED: "无法读取参考素材，请重新上传素材，或在设置中启用本地代理后重试。",
    SCRIPT_IMAGE_SIZE_REQUIRED: "此调用方式需要指定图片尺寸，请选择分辨率和比例后重试。",
    SCRIPT_ENTRY_REQUIRED: "脚本需要定义 main(params)，请使用初始模板补齐。",
    SCRIPT_NOT_IMPLEMENTED: "脚本尚未填写调用内容，请先编辑完成后重试。",
    SCRIPT_TEXT_INCOMPLETE: "文本尚未生成完整，请缩短内容要求后重试。",
} as const;
export type ModelErrorCode = keyof typeof modelErrorMessages;

/** detail 为模型服务返回的错误说明，有则直接展示，否则展示错误码文案。 */
export class ModelExecutionError extends Error {
    constructor(public code: ModelErrorCode, public detail?: string) { super(detail ?? modelErrorMessages[code]); }
}

export type ModelMediaInput = { url?: string; storageKey?: string };
export const modelResourceSchema = z.object({ collection: z.enum(["images", "media"]), key: z.string() });
export type ModelResource = z.infer<typeof modelResourceSchema>;
export type ModelAsset = ModelResource & { mimeType: string };
export type ModelStreamEvent<T> = { type: "text"; text: string } | { type: "result"; result: T } | { type: "upstream"; upstream: ModelCallUpstream[] } | { type: "error"; code: ModelErrorCode; message?: string };

export function modelAssetUrl(asset: ModelAsset) {
    return `/api/assets/${asset.collection}/${encodeURIComponent(asset.key)}`;
}

export const modelCallSchema = z.object({
    groupId: z.string(), model: z.string(), scriptId: z.string(), script: z.string(), systemPrompt: z.string(),
    reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]),
}).strict();
const sourceSchema = z.union([modelResourceSchema, z.object({ url: z.string().url() })]);
export const localModelRequestSchema = z.object({
    action: z.enum(["image", "audio", "text", "video", "video-query"]),
    call: modelCallSchema,
    prompt: z.string().optional(),
    images: z.array(sourceSchema).optional(),
    videos: z.array(sourceSchema).optional(),
    audios: z.array(sourceSchema).optional(),
    messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.union([z.string(), z.array(z.union([z.object({ type: z.literal("text"), text: z.string() }), z.object({ type: z.literal("image_url"), image_url: sourceSchema })]))]) })).optional(),
    options: z.record(z.unknown()).optional(),
}).strict();
export type LocalModelRequest = z.infer<typeof localModelRequestSchema>;
export type ModelSource = z.infer<typeof sourceSchema>;

export const pluginTaskTargetSchema = z.object({ page: z.literal("plugin"), pluginId: z.string().min(1), packageName: z.string().min(1), projectId: z.string().min(1).optional(), workId: z.string().min(1).optional() }).strict();
export type PluginTaskTarget = z.infer<typeof pluginTaskTargetSchema>;
export function samePluginTaskTarget(first: PluginTaskTarget, second: PluginTaskTarget) {
    return first.pluginId === second.pluginId && first.packageName === second.packageName && first.projectId === second.projectId && first.workId === second.workId;
}
export const remoteVideoIdentitySchema = z.object({ id: z.string().min(1), model: z.string().min(1), scriptId: z.string().min(1), script: z.string().min(1) }).strict();
export const videoChannelFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const pluginVideoResult = z.object({
    storageKey: z.string().min(1).optional(), url: z.string().url().regex(/^https?:\/\//i).optional(), mimeType: z.string().min(1),
    width: z.number().optional(), height: z.number().optional(), durationMs: z.number().optional(),
}).strict().refine((value) => (value.storageKey !== undefined) !== (value.url !== undefined));
const pluginVideoReceiptSchema = z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/), target: pluginTaskTargetSchema,
    state: z.discriminatedUnion("status", [
        z.object({ status: z.literal("pending"), task: remoteVideoIdentitySchema, channelFingerprint: videoChannelFingerprintSchema }).strict(),
        z.object({ status: z.literal("failed") }).strict(),
        z.object({ status: z.literal("completed"), result: pluginVideoResult }).strict(),
    ]),
}).strict();
export type WebPluginVideoReceipt = z.infer<typeof pluginVideoReceiptSchema>;

export function storedPluginVideoReceipt(value: unknown, id: string, target: PluginTaskTarget) {
    const saved = pluginVideoReceiptSchema.safeParse(value);
    if (!saved.success || saved.data.id !== id || !samePluginTaskTarget(saved.data.target, target)) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    return saved.data;
}

/** 另一笔查询已发表终态时直接返回它；只允许原远端身份首次完成。 */
export function finishPluginVideoReceipt(value: unknown, next: WebPluginVideoReceipt, previous: VideoTaskIdentity) {
    const saved = storedPluginVideoReceipt(value, next.id, next.target);
    if (next.state.status === "pending") throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    if (saved.state.status !== "pending") return saved;
    const task = saved.state.task;
    if (task.id !== previous.id || task.model !== previous.model || task.scriptId !== previous.scriptId || task.script !== previous.script) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    return next;
}
export const modelTaskTargetSchema = z.discriminatedUnion("page", [
    z.object({ page: z.literal("canvas"), projectId: z.string(), nodeId: z.string(), slotId: z.string().optional() }).strict(),
    z.object({ page: z.enum(["image", "video"]), recordId: z.string() }).strict(),
    pluginTaskTargetSchema,
]);
export type ModelTaskTarget = z.infer<typeof modelTaskTargetSchema>;
export const taskSubmissionSchema = z.object({ taskId: z.string().min(1), target: modelTaskTargetSchema.optional(), request: localModelRequestSchema }).strict();

/** 工作区 task 集合的公开快照。第三方标识、调用脚本和渠道配置仅在服务内使用。 */
export type ModelTask = {
    taskId: string;
    action: Exclude<LocalModelRequest["action"], "video-query">;
    status: "running" | "completed" | "failed" | "interrupted" | "cancelled" | "paused";
    revision: string;
    createdAt: number;
    updatedAt: number;
    model: string;
    target?: ModelTaskTarget;
    text?: string;
    result?: ModelAsset[] | ModelAsset | string;
    code?: ModelErrorCode;
    message?: string;
    /** 提交阶段实际发给模型服务的请求，供调用统计排查。 */
    upstream?: ModelCallUpstream[];
};

export function assertModelTaskTarget(task: ModelTask, taskId: string, expected?: ModelTaskTarget): void {
    const actual = task.target;
    if (task.taskId !== taskId) throw new ModelExecutionError("MODEL_TASK_CONFLICT");
    if (!expected) return;
    if (expected.page === "plugin") {
        if (actual?.page === "plugin" && samePluginTaskTarget(actual, expected)) return;
    } else if (expected.page === "canvas") {
        if (actual?.page === "canvas" && actual.projectId === expected.projectId && actual.nodeId === expected.nodeId && actual.slotId === expected.slotId) return;
    } else if (actual?.page === expected.page && actual.recordId === expected.recordId) return;
    throw new ModelExecutionError("MODEL_TASK_CONFLICT");
}
