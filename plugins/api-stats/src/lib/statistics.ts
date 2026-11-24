import dayjs from "dayjs";
import type { ModelCallFinished, ModelCallKind, ModelCallStarted, PluginContext } from "@infinite-canvas/plugin-sdk";

export type StatisticsSettings = {
    /** 打开统计页面时使用的时间范围。 */
    defaultPeriod: "today" | "week" | "month" | "all";
    /** 是否记录新开始的调用，已在进行的调用仍会完成记录。 */
    recordingEnabled: boolean;
    /** 是否记录请求与返回摘要；默认开启，可在插件配置中关闭。 */
    capturePayloads: boolean;
    /** 是否在侧栏显示「调用统计」入口。 */
    showInSidebar: boolean;
};

export const defaultStatisticsSettings: StatisticsSettings = { defaultPeriod: "month", recordingEnabled: true, capturePayloads: true, showInSidebar: false };

const MAX_PROMPT = 8000;
const MAX_MESSAGE = 4000;
const MAX_MESSAGES = 12;

function clip(text: string, limit: number) {
    return text.length > limit ? `${text.slice(0, limit)}…（已截断，共 ${text.length} 字）` : text;
}

/** 摘要文本按上限截断；实际请求由宿主打码密钥、替换编码数据后原样保存。 */
function compactEvent<T extends ModelCallStarted | ModelCallFinished>(event: T, capture: boolean): T {
    if (!capture) {
        const { request: _request, response: _response, upstream: _upstream, ...rest } = event as T & { request?: unknown; response?: unknown; upstream?: unknown };
        return rest as T;
    }
    const request = event.request && {
        ...event.request,
        ...(event.request.prompt !== undefined && { prompt: clip(event.request.prompt, MAX_PROMPT) }),
        ...(event.request.messages && { messages: event.request.messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, content: clip(message.content, MAX_MESSAGE) })) }),
    };
    const response = "response" in event && event.response ? {
        ...event.response,
        ...(event.response.text !== undefined && { text: clip(event.response.text, MAX_PROMPT) }),
    } : undefined;
    return { ...event, request, response } as T;
}

export async function saveStatisticsSettings(ctx: PluginContext, settings: StatisticsSettings) {
    await ctx.storage.set("settings", settings);
    ctx.emit("settings.changed", settings);
}

export type CallRecord = ModelCallStarted & Partial<Pick<ModelCallFinished, "finishedAt" | "durationMs" | "usage" | "errorMessage" | "errorCode" | "response" | "upstream">> & {
    status: ModelCallFinished["status"] | "running" | "interrupted";
};

export const kinds: Record<ModelCallKind, string> = { image: "图片生成", text: "文本生成", audio: "音频生成", video: "视频生成", "video-query": "视频查询", chat: "聊天", summary: "对话摘要" };
export const statuses: Record<CallRecord["status"], string> = { running: "进行中", success: "成功", failed: "失败", cancelled: "已取消", interrupted: "结果未确认" };
export const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

export function duration(ms: number | null | undefined) {
    if (ms === null || ms === undefined) return "—";
    return ms < 1000 ? `${Math.round(ms)} ms` : `${number.format(ms / 1000)} 秒`;
}

export function summarize(records: CallRecord[]) {
    const result = { total: records.length, success: 0, failed: 0, running: 0, cancelled: 0, interrupted: 0, durationMs: 0, inputTokens: 0, outputTokens: 0, inputUsageCount: 0, outputUsageCount: 0, usageCount: 0 };
    const durations: number[] = [];
    for (const record of records) {
        result[record.status]++;
        if (record.status === "success" || record.status === "failed") {
            result.durationMs += record.durationMs!;
            durations.push(record.durationMs!);
        }
        if (record.usage?.inputTokens !== undefined || record.usage?.outputTokens !== undefined) result.usageCount++;
        if (record.usage?.inputTokens !== undefined) { result.inputTokens += record.usage.inputTokens; result.inputUsageCount++; }
        if (record.usage?.outputTokens !== undefined) { result.outputTokens += record.usage.outputTokens; result.outputUsageCount++; }
    }
    const completed = result.success + result.failed;
    durations.sort((a, b) => a - b);
    return { ...result, p95Ms: completed ? durations[Math.ceil(completed * .95) - 1] : null, successRate: completed ? result.success / completed : null, averageMs: completed ? result.durationMs / completed : null };
}

export function groupByModel(records: CallRecord[]) {
    const groups = new Map<string, { key: string; channelName?: string; groupName?: string; model: string; records: CallRecord[] }>();
    for (const record of records) {
        const key = JSON.stringify([record.channelId, record.groupId, record.model]);
        if (!groups.has(key)) groups.set(key, { key, channelName: record.channelName, groupName: record.groupName, model: record.model, records: [] });
        groups.get(key)!.records.push(record);
    }
    return [...groups.values()].map(({ records, ...group }) => ({ ...group, ...summarize(records) })).sort((a, b) => b.total - a.total);
}

export function groupByDay(records: CallRecord[]) {
    const groups = new Map<string, CallRecord[]>();
    for (const record of records) {
        const date = dayjs(record.startedAt).format("YYYY-MM-DD");
        const group = groups.get(date);
        if (group) group.push(record);
        else groups.set(date, [record]);
    }
    return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, calls]) => ({ date, ...summarize(calls) }));
}

export function dateRange(period: string, today: string, from: string, until: string) {
    if (period === "custom") return {
        start: from ? dayjs(from).startOf("day").valueOf() : -Infinity,
        end: until ? dayjs(until).add(1, "day").startOf("day").valueOf() : Infinity,
    };
    if (period === "all") return { start: -Infinity, end: Infinity };
    const date = dayjs(today);
    const days = period === "week" ? 7 : period === "month" ? 30 : 1;
    return { start: date.subtract(days - 1, "day").startOf("day").valueOf(), end: date.add(1, "day").startOf("day").valueOf() };
}

export async function createStatistics(ctx: PluginContext) {
    const [saved, settings] = await Promise.all([
        ctx.storage.get<CallRecord[]>("records"),
        ctx.storage.get<StatisticsSettings>("settings"),
    ]);
    let snapshot = {
        settings: { ...defaultStatisticsSettings, ...settings },
        records: (saved ?? []).map((record): CallRecord => record.status === "running" ? { ...record, status: "interrupted" } : record),
        saving: false,
        storageError: false,
    };
    const listeners = new Set<() => void>();
    const pending = new Set<Promise<void>>();
    let revision = 0;
    const notify = () => { for (const listener of listeners) listener(); };
    const save = () => {
        const current = ++revision;
        snapshot = { ...snapshot, saving: true };
        notify();
        // 立即交给宿主有序保存，停用时仅等待已接受的写入，不再调用已停用的 storage。
        const write = ctx.storage.set("records", snapshot.records).then(() => {
            if (current === revision) snapshot = { ...snapshot, storageError: false };
        }).catch((error) => {
            if (current === revision) snapshot = { ...snapshot, storageError: true };
            console.error("[api-stats] save failed", error);
        }).finally(() => {
            pending.delete(write);
            if (current === revision) snapshot = { ...snapshot, saving: false };
            notify();
        });
        pending.add(write);
        return write;
    };
    const capture = () => snapshot.settings.capturePayloads !== false;
    const update = (records: CallRecord[]) => {
        snapshot = { ...snapshot, records };
        return save();
    };
    ctx.onMessage("settings.changed", (value) => {
        snapshot = { ...snapshot, settings: value as StatisticsSettings };
        notify();
    });
    ctx.on("model.call.started", (event) => {
        // 视频查询不单独成行，结果合并到对应的视频生成记录。
        if (!ctx.signal.aborted && snapshot.settings.recordingEnabled && event.kind !== "video-query") void update([{ ...compactEvent(event, capture()), status: "running" }, ...snapshot.records]);
    });
    ctx.on("model.call.finished", (event) => {
        if (ctx.signal.aborted) return;
        if (event.kind === "video-query") return void finishVideo(event);
        if (!snapshot.records.some((record) => record.id === event.id && record.status === "running")) return;
        const next = compactEvent(event, capture());
        // 提交后需要查询结果的视频保持进行中，直到查询得到最终结果。
        const waiting = event.kind === "video" && event.status === "success" && event.response?.video?.taskId && !event.response.video.completed;
        void update(snapshot.records.map((record) => record.id === event.id ? (waiting ? { ...next, status: "running" } : next) : record));
    });
    // 仍在生成的查询不写记录；最终结果更新状态、总耗时，并追加最后一次查询的实际请求。
    const finishVideo = (event: ModelCallFinished) => {
        if (event.status === "success" && event.response?.taskStatus === "pending" || event.status === "cancelled") return;
        const target = snapshot.records.find((record) => record.kind === "video" && (record.status === "running" || record.status === "interrupted") && record.response?.video?.taskId === event.request?.taskId);
        if (!target) return;
        const query = compactEvent(event, capture());
        void update(snapshot.records.map((record) => record === target ? {
            ...record,
            status: event.status,
            finishedAt: event.finishedAt,
            durationMs: event.finishedAt - record.startedAt,
            errorMessage: event.errorMessage,
            errorCode: event.errorCode,
            ...(record.response && { response: { ...record.response, taskStatus: event.response?.taskStatus ?? "failed" } }),
            ...(record.upstream && query.upstream && { upstream: [...record.upstream, ...query.upstream] }),
        } : record));
    };
    ctx.onDispose(async () => { await Promise.all(pending); listeners.clear(); });
    if (saved?.some((record) => record.status === "running")) void save();
    return {
        getSnapshot: () => snapshot,
        subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
        clear: () => update([]),
        save,
    };
}
