import type { ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, Brain, Database, Gauge, CheckCircle2, Circle, CircleDot, Sparkles } from "lucide-react";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import type { CreateLog } from "@workbench/services/create/logs";
import type { CreateAgentItem, CreateAgentThread } from "@workbench/services/create/agent-logs";
import type { AiConfig } from "@workbench/stores/use-config-store";
import { CreateAgentGenerationCard } from "./create-agent-generation-card";
import { readPlanSteps } from "../create-agent-plan";
import { getAgentUsage } from "@workbench/lib/agent/agent-chat-usage";
import { CreateEntry, type CreateEntryActions } from "./create-entry";
import { Shimmer } from "@workbench/components/ai-elements/shimmer";
import { Message, MessageContent, MessageResponse } from "@workbench/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@workbench/components/ai-elements/reasoning";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@workbench/components/ai-elements/tool";

const toolLabels: Record<string, string> = {
    generate_image: "生成图片",
    generate_video: "提交视频",
    generate_audio: "生成音频",
    list_models: "查询模型",
    search_prompts: "搜索提示词",
    add_asset: "写入资产",
    update_plan: "任务规划",
};

const numberFormat = new Intl.NumberFormat("zh-CN");

export function CreateAgentConversation({ thread, logs, actions, running, agentMode, compacting, contextWindow, config, onConfirmGeneration, onRejectGeneration }: {
    thread: CreateAgentThread;
    logs: CreateLog[];
    actions: CreateEntryActions;
    running: boolean;
    agentMode: boolean;
    compacting?: boolean;
    contextWindow?: number;
    config: AiConfig;
    onConfirmGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>, overrides: Partial<AiConfig>) => Promise<void>;
    onRejectGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>) => void;
}) {
    // 生成结果已经挂在发起它的工具卡片里，不再作为独立记录重复插入时间线。
    const attached = new Set(thread.items.flatMap((item) => item.role === "tool" && item.logId ? [item.logId] : []));
    const timeline = [
        ...thread.items.map((item) => ({ time: item.createdAt, order: 0, item })),
        ...logs.filter((log) => !attached.has(log.id)).map((log) => ({ time: log.createdAt, order: 1, log })),
    ].sort((left, right) => left.time - right.time || left.order - right.order);
    const lastUser = thread.items.findLastIndex((item) => item.role === "user");
    const usage = getAgentUsage(thread.items.slice(Math.max(0, lastUser)).flatMap((item) => item.role === "assistant" && item.usage ? [item.usage] : []));
    const activeTool = thread.items.findLast((item) => item.role === "tool" && item.status === "running");
    const streaming = thread.items.findLast((item) => item.role === "assistant" && item.status === "running");
    const showStatus = Boolean(compacting) || (running && !activeTool && !(streaming?.role === "assistant" && (streaming.text || streaming.reasoning)));
    // 只在 Agent 真正给出回复、并且本轮没有等待确认或仍在执行的工具时展示本轮汇总。
    const roundItems = thread.items.slice(Math.max(0, lastUser));
    const pending = roundItems.some((item) => item.role === "tool" && (item.status === "running" || item.status === "waiting" || item.status === "generating"));
    const lastAnswered = roundItems.findLast((item) => item.role === "assistant" && item.status === "done" && Boolean(item.text));
    const answered = agentMode && !running && !pending && Boolean(lastAnswered);
    const waiting = roundItems.some((item) => item.role === "tool" && item.status === "waiting");
    return (
        <div className="flex flex-col gap-5 pb-8">
            {timeline.map((entry) => "log" in entry
                ? <CreateEntry key={entry.log.id} log={entry.log} actions={actions} />
                : <AgentItem key={entry.item.id} item={entry.item} logs={logs} config={config} actions={actions} onConfirmGeneration={onConfirmGeneration} onRejectGeneration={onRejectGeneration} />)}
            {waiting && !running ? <p role="status" className="text-sm text-muted-foreground">等待你在生成卡片中确认后继续…</p> : null}
            {showStatus ? <AgentStatus label={compacting ? "正在压缩上下文…" : "正在思考…"} /> : null}
            {answered ? <UsageSummary usage={usage} contextTokens={thread.contextTokens} contextWindow={contextWindow} /> : null}
        </div>
    );
}

function AgentStatus({ label }: { label: string }) {
    return (
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
            <Shimmer className="text-sm">{label}</Shimmer>
        </div>
    );
}

function AgentItem({ item, logs, config, actions, onConfirmGeneration, onRejectGeneration }: {
    item: CreateAgentItem;
    logs: CreateLog[];
    config: AiConfig;
    actions: CreateEntryActions;
    onConfirmGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>, overrides: Partial<AiConfig>) => Promise<void>;
    onRejectGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>) => void;
}) {
    if (item.role === "user") return <Message from="user" className="max-w-[85%]"><MessageContent className="whitespace-pre-wrap break-words text-[15px] leading-7">{item.text}</MessageContent></Message>;
    if (item.role === "error") return <p role="status" className="text-sm leading-6 text-muted-foreground">{item.text}</p>;
    if (item.role === "notice") return (
        <div className="rounded-lg border border-dashed px-3 py-2 text-xs leading-5 text-muted-foreground">
            <p className="flex items-center gap-1.5"><Sparkles className="size-3.5" aria-hidden="true" />{item.text}</p>
            {item.usage ? <UsageLine usage={item.usage} /> : null}
        </div>
    );
    if (item.role === "tool") return <ToolItem item={item} logs={logs} config={config} actions={actions} onConfirmGeneration={onConfirmGeneration} onRejectGeneration={onRejectGeneration} />;
    // 只调用工具、没有文字和思考的步骤不渲染空消息，用量统一累计到本轮汇总。
    if (!item.text && !item.reasoning) return null;
    return (
        <Message from="assistant" className="max-w-full">
            {item.reasoning ? <Reasoning isStreaming={item.status === "running"}><ReasoningTrigger /><ReasoningContent>{item.reasoning}</ReasoningContent></Reasoning> : null}
            {item.text ? <MessageResponse className="agent-streamdown" isAnimating={item.status === "running"} lineNumbers={false} controls={{ code: { copy: true, download: false }, table: { copy: true, download: false, fullscreen: false } }} translations={{ copyCode: "复制代码", copied: "已复制", copyLink: "复制链接" }}>{item.text}</MessageResponse> : null}
        </Message>
    );
}

const toolStates = { running: "input-available", generating: "input-available", waiting: "approval-requested", failed: "output-error", rejected: "output-denied", done: "output-available" } as const;

const generationTools = new Set(["generate_image", "generate_video", "generate_audio"]);

function ToolItem({ item, logs, config, actions, onConfirmGeneration, onRejectGeneration }: {
    item: Extract<CreateAgentItem, { role: "tool" }>;
    logs: CreateLog[];
    config: AiConfig;
    actions: CreateEntryActions;
    onConfirmGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>, overrides: Partial<AiConfig>) => Promise<void>;
    onRejectGeneration: (item: Extract<CreateAgentItem, { role: "tool" }>) => void;
}) {
    if (item.toolName === "update_plan" && readPlanSteps(item.input).length) return <PlanItem item={item} />;
    if (item.toolName === "search_prompts") return <PromptSearchItem item={item} />;
    if (generationTools.has(item.toolName)) return <CreateAgentGenerationCard item={item} config={config} log={logs.find((log) => log.id === item.logId)} actions={actions} onConfirm={(overrides) => onConfirmGeneration(item, overrides)} onReject={() => onRejectGeneration(item)} />;
    return (
        <Tool defaultOpen className="mb-0">
            <ToolHeader type={`tool-${item.toolName}`} state={toolStates[item.status]} title={toolLabels[item.toolName] ?? item.toolName} />
            <ToolContent>
                {item.input !== undefined && item.input !== null ? <ToolInput input={item.input as object} /> : null}
                <ToolOutput output={item.output} errorText={undefined} />
            </ToolContent>
        </Tool>
    );
}

type PromptSearchRow = { title: string; prompt: string; category?: string; tags: string[] };

function readPromptSearch(output?: string) {
    if (!output) return null;
    try {
        const data = JSON.parse(output) as { result?: { total?: unknown; items?: unknown } };
        const result = data.result;
        if (!result) return null;
        const items = Array.isArray(result.items) ? result.items.flatMap((raw): PromptSearchRow[] => {
            if (!raw || typeof raw !== "object") return [];
            const item = raw as { title?: unknown; prompt?: unknown; category?: unknown; tags?: unknown };
            if (typeof item.title !== "string") return [];
            return [{
                title: item.title,
                prompt: typeof item.prompt === "string" ? item.prompt : "",
                category: typeof item.category === "string" ? item.category : undefined,
                tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
            }];
        }) : [];
        return { total: Number(result.total) || items.length, items };
    } catch {
        return null;
    }
}

function promptSearchInput(input: unknown) {
    if (!input || typeof input !== "object") return { keyword: "", category: "" };
    const value = input as { keyword?: unknown; category?: unknown };
    return { keyword: typeof value.keyword === "string" ? value.keyword.trim() : "", category: typeof value.category === "string" ? value.category.trim() : "" };
}

function PromptSearchItem({ item }: { item: Extract<CreateAgentItem, { role: "tool" }> }) {
    const { keyword, category } = promptSearchInput(item.input);
    const result = readPromptSearch(item.output);
    return (
        <Tool defaultOpen className="mb-0">
            <ToolHeader type="tool-search_prompts" state={toolStates[item.status]} title="搜索提示词" />
            <ToolContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                    {keyword || category ? [keyword && `关键词：${keyword}`, category && category !== "全部" && `分类：${category}`].filter(Boolean).join(" · ") : "搜索提示词库"}
                    {result ? ` · 共 ${result.total} 条` : ""}
                </p>
                {result?.items.length ? <ul className="space-y-1.5">
                    {result.items.slice(0, 5).map((row, index) => <li key={`${index}-${row.title}`} className="rounded-md bg-muted/40 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium">{row.title}</span>
                            {row.category ? <span className="shrink-0 text-[11px] text-muted-foreground">{row.category}</span> : null}
                        </div>
                        {row.prompt ? <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-muted-foreground">{row.prompt}</p> : null}
                    </li>)}
                    {result.items.length > 5 ? <li className="px-1 text-[11px] text-muted-foreground">还有 {result.items.length - 5} 条结果没有展开</li> : null}
                </ul> : <p className="text-xs text-muted-foreground">{result ? "没有找到匹配的提示词。" : item.status === "running" ? "正在搜索…" : item.output ? "结果较长，请查看 Agent 的整理内容。" : "这次搜索没有返回结果。"}</p>}
            </ToolContent>
        </Tool>
    );
}

function PlanItem({ item }: { item: Extract<CreateAgentItem, { role: "tool" }> }) {
    const steps = readPlanSteps(item.input);
    const done = steps.filter((step) => step.status === "completed").length;
    return (
        <Tool defaultOpen className="mb-0">
            <ToolHeader type="tool-update_plan" state={toolStates[item.status]} title={`任务规划 ${done}/${steps.length}`} />
            <ToolContent>
                <ol className="space-y-2">
                    {steps.map((step, index) => <li key={`${index}-${step.title}`} className="flex items-start gap-2 text-sm leading-6">
                        {step.status === "completed"
                            ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                            : step.status === "in_progress"
                                ? <CircleDot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />}
                        <span className={cn("min-w-0 break-words", step.status === "completed" ? "text-muted-foreground line-through" : step.status === "in_progress" ? "font-medium" : "")}>{step.title}</span>
                    </li>)}
                </ol>
            </ToolContent>
        </Tool>
    );
}

type UsageStats = { inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cacheRate?: number };

function UsageStatsRow({ stats, className, children }: { stats: UsageStats; className?: string; children?: ReactNode }) {
    const items = [
        { label: "输入", icon: ArrowDownLeft, text: stats.inputTokens === undefined ? undefined : numberFormat.format(stats.inputTokens) },
        { label: "输出", icon: ArrowUpRight, text: stats.outputTokens === undefined ? undefined : numberFormat.format(stats.outputTokens) },
        { label: "思考", icon: Brain, text: stats.reasoningTokens === undefined ? undefined : numberFormat.format(stats.reasoningTokens) },
        { label: "缓存率", icon: Database, text: stats.cacheRate === undefined ? undefined : `${stats.cacheRate.toFixed(1)}%` },
    ].filter((item) => item.text !== undefined);
    if (!items.length && !children) return null;
    return (
        <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-5 tabular-nums text-muted-foreground", className)}>
            {items.map(({ label, icon: Icon, text }) => <span key={label} title={label} aria-label={`${label} ${text}`} className="inline-flex items-center gap-1"><Icon className="size-3" aria-hidden="true" />{text}</span>)}
            {children}
        </p>
    );
}

function UsageLine({ usage }: { usage: NonNullable<Extract<CreateAgentItem, { role: "assistant" }>["usage"]> }) {
    return <UsageStatsRow className="mt-1.5 px-1" stats={{ ...usage, cacheRate: usage.cacheReadTokens !== undefined && usage.inputTokens ? usage.cacheReadTokens / usage.inputTokens * 100 : undefined }} />;
}

function UsageSummary({ usage, contextTokens, contextWindow }: { usage: ReturnType<typeof getAgentUsage>; contextTokens?: number; contextWindow?: number }) {
    return (
        <UsageStatsRow className="border-t pt-3" stats={{ ...usage, cacheRate: usage.cacheHitRate }}>
            {contextTokens === undefined ? null : (
                <span title={contextWindow ? `上下文上限 ${numberFormat.format(contextWindow)} Token，达到 80% 自动压缩` : "未设置模型上下文上限"} aria-label="上下文" className="inline-flex items-center gap-1">
                    <Gauge className="size-3" aria-hidden="true" />{contextWindow ? `${(contextTokens / contextWindow * 100).toFixed(1)}%` : numberFormat.format(contextTokens)}
                </span>
            )}
        </UsageStatsRow>
    );
}
