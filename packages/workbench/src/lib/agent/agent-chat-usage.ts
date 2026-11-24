/**
 * 单次模型请求返回的 Token 用量；未提供的字段保持未知。
 */
export type AgentTokenUsage = {
    /**
     * 输入总量，包含缓存命中。
     */
    inputTokens: number | undefined;
    /**
     * 输出总量，包含思考。
     */
    outputTokens: number | undefined;
    /**
     * 输出中的思考用量。
     */
    reasoningTokens: number | undefined;
    /**
     * 输入中命中缓存的用量。
     */
    cacheReadTokens: number | undefined;
};

/**
 * 累计已返回的请求用量；任一请求缺少某字段时，不将部分统计当成完整总量。
 */
export function getAgentUsage(usages: AgentTokenUsage[]) {
    const totals = Object.fromEntries((["inputTokens", "outputTokens", "reasoningTokens", "cacheReadTokens"] as const).map((key) => [
        key,
        usages.length && usages.every((usage) => usage[key] !== undefined) ? usages.reduce((sum, usage) => sum + usage[key]!, 0) : undefined,
    ])) as AgentTokenUsage;
    const cacheHitRate = totals.inputTokens !== undefined && totals.inputTokens > 0 && totals.cacheReadTokens !== undefined
        ? totals.cacheReadTokens / totals.inputTokens * 100
        : undefined;
    return { ...totals, cacheHitRate };
}
