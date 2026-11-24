import type { ModelMediaInput } from "./model-http.js";

export type TextAgentProtocol = "responses" | "chat-completions" | "anthropic" | "gemini";

export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type AgentModelSettings = {
    /**
     * 模型的上下文窗口大小。
     */
    contextWindow?: number;
    /**
     * 聊天单独指定的推理强度。
     */
    reasoningEffort?: ReasoningEffort;
    /**
     * 是否自动总结较早的聊天内容。
     */
    autoCompact?: boolean;
};

/**
 * 单次执行使用的模型配置，不包含渠道列表、页面状态或生成表单。
 */
export type ModelExecutionConfig = {
    groupId?: string;
    /**
     * 服务使用的模型名称，不含渠道分组标识。
     */
    model: string;
    /**
     * 此次调用的服务地址。
     */
    baseUrl: string;
    /**
     * 此次调用使用的凭据，不随任务结果保存。
     */
    apiKey: string;
    /**
     * 配置的系统提示词，保留给调用脚本使用。
     */
    systemPrompt: string;
    /**
     * 当前生成流程选择的推理强度。
     */
    reasoningEffort: ReasoningEffort;
    /**
     * 所选模型的聊天设置，工具执行函数仍由宿主提供。
     */
    agentSettings?: AgentModelSettings;
};

export type ModelCall = ModelExecutionConfig & { groupId: string; scriptId: string; script: string };

export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: ModelMediaInput }>;
};

/**
 * text 为截至当前的完整文本，调用方直接替换展示内容。
 */
export type ModelTextEvent = { type: "text"; text: string };

export type ImageModelRequest = {
    call: ModelCall;
    prompt: string;
    images: ModelMediaInput[];
    options: { size?: string; ratio?: string; resolution?: string; quality?: string; count: number; background?: string };
};

export type TextModelRequest = { call: ModelCall; messages: AiTextMessage[] };

export type AudioModelRequest = {
    call: ModelCall;
    prompt: string;
    options: { voice: string; format: string; speed: string; instructions: string };
};

export type VideoModelRequest = {
    call: ModelCall;
    prompt: string;
    images: ModelMediaInput[];
    videos?: ModelMediaInput[];
    audios?: ModelMediaInput[];
    options: { seconds: string; size: string | null; resolution: string; ratio: string; generateAudio: boolean; watermark: boolean; mode: "frames" | "reference" };
};

export type VideoTaskQuery = { call: ModelCall; taskId: string };

/**
 * model 保存用户选择的模型标识，scriptId 和 script 保存提交时的脚本身份与源码，供恢复查询使用。
 */
export type VideoTaskIdentity = { id: string; model: string; scriptId: string; script: string };

