/**
 * 一次模型操作；视频提交与每次查询分别发出事件（订阅方可按任务标识合并），聊天按每轮模型请求记录。
 */
export type ModelCallKind = "image" | "text" | "audio" | "video" | "video-query" | "chat" | "summary";

/**
 * 可供插件订阅的调用摘要：请求与返回只含便于排查的文本和数量，实际请求见 ModelCallUpstream。
 */
export type ModelCallRequest = {
    prompt?: string;
    messages?: { role: string; content: string }[];
    options?: Record<string, unknown>;
    images?: number;
    videos?: number;
    audios?: number;
    tools?: string[];
    taskId?: string;
};

export type ModelCallResponse = {
    text?: string;
    images?: number;
    audio?: boolean;
    video?: { taskId?: string; completed?: boolean };
    taskStatus?: string;
};

/**
 * 调用脚本实际发给模型服务的一次请求；密钥已打码，图片等编码数据只保留类型与大小。
 */
export type ModelCallUpstream = {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    status?: number;
    response?: unknown;
    error?: string;
};

export type ModelCallStarted = {
    id: string;
    kind: ModelCallKind;
    model: string;
    channelId?: string;
    channelName?: string;
    groupId?: string;
    groupName?: string;
    startedAt: number;
    request?: ModelCallRequest;
};

export type ModelCallUsage = {
    inputTokens?: number;
    outputTokens?: number;
};

export type ModelCallFinished = ModelCallStarted & {
    status: "success" | "failed" | "cancelled";
    finishedAt: number;
    durationMs: number;
    /**
     * 仅由宿主固定文案映射产生，不传递原始错误。
     */
    errorMessage?: string;
    /** 宿主错误码，便于区分配置、任务或网络失败。 */
    errorCode?: string;
    usage?: ModelCallUsage;
    response?: ModelCallResponse;
    /** 图片、音频与视频调用实际发给模型服务的请求，空数组表示未发出请求；文本与聊天不记录。 */
    upstream?: ModelCallUpstream[];
};
