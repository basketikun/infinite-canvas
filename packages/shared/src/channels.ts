import { z } from "zod";
import { sha256 } from "./utils/sha256.js";
import type { ModelCapability } from "./models.js";
import { modelCapabilities } from "./models.js";
import type { AgentModelSettings } from "./model-execution.js";

export type ModelListFormat = "openai" | "gemini";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    /**
     * 新增模型时按名称和用途预选脚本；用户可以重新选择。
     */
    scriptId?: string;
    agentSettings?: AgentModelSettings;
};

export type ModelGroup = {
    /**
     * 分组的稳定标识，模型选择与生成记录使用此标识。
     */
    id: string;
    /**
     * 用于区分不同密钥的分组名称。
     */
    name: string;
    /**
     * 本分组拉取模型和生成时使用的密钥。
     */
    apiKey: string;
    /**
     * 本地服务已保存密钥，页面不会收到其原文。
     */
    hasApiKey?: boolean;
    /**
     * 本分组可用的模型及各自的调用脚本。
     */
    models: ChannelModel[];
};

export type ModelChannel = {
    /**
     * 渠道的稳定标识。
     */
    id: string;
    /**
     * 渠道显示名称。
     */
    name: string;
    /**
     * 渠道内所有分组共用的服务地址。
     */
    baseUrl: string;
    /**
     * 按密钥独立管理的模型分组。
     */
    groups: ModelGroup[];
};

export type ChannelSnapshot = { channels: ModelChannel[] };

/** 每笔任务单独加盐，持久记录不需要保存渠道密钥。 */
export function modelConnectionFingerprint(token: string, channel: ModelChannel, group: ModelGroup) {
    return sha256(new TextEncoder().encode(JSON.stringify([token, channel.id, channel.baseUrl, group.id, group.apiKey])).buffer);
}

export const channelsSchema = z.array(z.object({
    id: z.string(), name: z.string(), baseUrl: z.string(),
    groups: z.array(z.object({
        id: z.string(), name: z.string(), apiKey: z.string(), hasApiKey: z.boolean().optional(),
        models: z.array(z.object({
            name: z.string(), capability: z.enum(modelCapabilities), scriptId: z.string().optional(),
            agentSettings: z.object({ contextWindow: z.number().optional(), reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh"]).optional(), autoCompact: z.boolean().optional() }).optional(),
        })),
    })),
}));
