import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCallFinished, PluginContext, PluginEvents } from "@infinite-canvas/plugin-sdk";
import { createStatistics, saveStatisticsSettings, type StatisticsSettings, dateRange, groupByDay, groupByModel, summarize, type CallRecord } from "../src/lib/statistics";

const record: ModelCallFinished = { id: "one", kind: "image", model: "test-model", channelId: "channel", channelName: "测试渠道", groupId: "group", groupName: "测试分组", startedAt: 1, finishedAt: 101, durationMs: 100, status: "success" };

function fixture(saved: CallRecord[] = [], settings: StatisticsSettings | null = null) {
    const controller = new AbortController();
    const listeners = new Map<string, (event: never) => void>();
    const cleanups: Array<() => void | Promise<void>> = [];
    const state = { saved: structuredClone(saved), settings, fail: false, writes: 0 };
    const ctx = {
        signal: controller.signal,
        storage: {
            async get(key: string) { return structuredClone(key === "settings" ? state.settings : state.saved); },
            async set(key: string, value: CallRecord[] | StatisticsSettings) {
                controller.signal.throwIfAborted();
                if (state.fail) throw new Error("fixture storage unavailable");
                state.writes++;
                if (key === "settings") state.settings = structuredClone(value as StatisticsSettings);
                else state.saved = structuredClone(value as CallRecord[]);
            },
        },
        on(event: string, handler: (value: never) => void) { listeners.set(event, handler); return () => listeners.delete(event); },
        onMessage(event: string, handler: (value: never) => void) { listeners.set(`message:${event}`, handler); return () => listeners.delete(`message:${event}`); },
        emit(event: string, value: unknown) { controller.signal.throwIfAborted(); listeners.get(`message:${event}`)?.(value as never); },
        onDispose(cleanup: () => void | Promise<void>) { cleanups.push(cleanup); },
    } as unknown as PluginContext;
    return {
        ctx, state,
        emit<K extends keyof PluginEvents>(event: K, value: PluginEvents[K]) { listeners.get(event)?.(value as never); },
        async close() { controller.abort(); for (const cleanup of cleanups) await cleanup(); listeners.clear(); },
    };
}

test("成功率排除取消与未知结果，耗时只计算已结束调用，未知 Token 不冒充已知用量", () => {
    const records: CallRecord[] = [record, { ...record, id: "failed", status: "failed", durationMs: 300, usage: { inputTokens: 12 } }, { ...record, id: "cancelled", status: "cancelled" }, { ...record, id: "running", status: "running" }, { ...record, id: "unknown", status: "interrupted" }];
    const totals = summarize(records);
    assert.equal(totals.total, 5);
    assert.equal(totals.successRate, 0.5);
    assert.equal(totals.averageMs, 200);
    assert.equal(totals.inputTokens, 12);
    assert.equal(totals.usageCount, 1);
    assert.equal(totals.inputUsageCount, 1);
    assert.equal(totals.outputUsageCount, 0);
    assert.equal(summarize([]).successRate, null);
    assert.equal(summarize([]).averageMs, null);
    assert.equal(groupByModel([record, { ...record, id: "two", channelId: "other" }]).length, 2);
});

test("开始与结束合并同一记录，重复结束不重计；刷新后未完成记录变为未知", async () => {
    const host = fixture([{ ...record, id: "previous", status: "running", durationMs: undefined }]);
    const stats = await createStatistics(host.ctx);
    assert.equal(stats.getSnapshot().records[0].status, "interrupted");
    host.emit("model.call.started", record);
    host.emit("model.call.finished", record);
    host.emit("model.call.finished", { ...record, status: "failed" });
    await stats.save();
    assert.equal(stats.getSnapshot().records.length, 2);
    assert.equal(stats.getSnapshot().records[0].status, "success");
    assert.equal(host.state.saved[0].status, "success");
    await host.close();
    host.emit("model.call.started", { ...record, id: "after-stop" });
    assert.equal(stats.getSnapshot().records.length, 2);
});

test("清空时不补回在途记录，未订阅到开始的调用不计入，记录不会被分页截断", async () => {
    const host = fixture();
    const stats = await createStatistics(host.ctx);
    host.emit("model.call.finished", record);
    assert.equal(stats.getSnapshot().records.length, 0);
    host.emit("model.call.started", record);
    await stats.clear();
    host.emit("model.call.finished", record);
    assert.equal(stats.getSnapshot().records.length, 0);
    for (let index = 0; index < 45; index++) {
        const event = { ...record, id: String(index) };
        host.emit("model.call.started", event);
        host.emit("model.call.finished", event);
    }
    await host.close();
    assert.equal(host.state.saved.length, 45);
});

test("保存失败保留内存记录并可重试，不重新执行模型调用", async (t) => {
    t.mock.method(console, "error", () => {});
    const host = fixture();
    const stats = await createStatistics(host.ctx);
    host.state.fail = true;
    host.emit("model.call.started", record);
    host.emit("model.call.finished", record);
    await stats.save();
    assert.equal(stats.getSnapshot().storageError, true);
    assert.equal(stats.getSnapshot().records[0].status, "success");
    host.state.fail = false;
    await stats.save();
    assert.equal(stats.getSnapshot().storageError, false);
    assert.equal(host.state.saved.length, 1);
    await host.close();
});


test("按本地日期筛选包含结束日，按日汇总与 P95 使用相同的有效记录", () => {
    const start = new Date(2026, 2, 7).getTime();
    const end = new Date(2026, 2, 9).getTime();
    assert.deepEqual(dateRange("custom", "2026-03-09", "2026-03-07", "2026-03-08"), { start, end });
    assert.equal(dateRange("week", "2026-03-13", "", "").start, start);
    const records = Array.from({ length: 20 }, (_, i) => ({ ...record, id: String(i), startedAt: end - 1, durationMs: i + 1 }));
    const groups = groupByDay([...records, { ...record, startedAt: start, status: "interrupted" }]);
    assert.deepEqual(groups.map((group) => [group.date, group.total, group.p95Ms]), [["2026-03-08", 20, 19], ["2026-03-07", 1, null]]);
});


test("插件设置保存后重开恢复，暂停只影响新调用，保存失败保留原设置", async () => {
    const host = fixture();
    const stats = await createStatistics(host.ctx);
    host.emit("model.call.started", record);
    const settings: StatisticsSettings = { defaultPeriod: "month", recordingEnabled: false, capturePayloads: true, showInSidebar: false };
    await saveStatisticsSettings(host.ctx, settings);
    host.emit("model.call.started", { ...record, id: "paused" });
    host.emit("model.call.finished", record);
    assert.equal(stats.getSnapshot().records.length, 1);
    assert.equal(stats.getSnapshot().records[0].status, "success");
    assert.deepEqual(host.state.settings, settings);
    host.state.fail = true;
    await assert.rejects(saveStatisticsSettings(host.ctx, { defaultPeriod: "all", recordingEnabled: true, capturePayloads: true, showInSidebar: false }));
    assert.deepEqual(stats.getSnapshot().settings, settings);
    host.state.fail = false;
    await host.close();
    const reopened = fixture(host.state.saved, host.state.settings);
    const restored = await createStatistics(reopened.ctx);
    assert.deepEqual(restored.getSnapshot().settings, settings);
    await saveStatisticsSettings(reopened.ctx, { ...settings, recordingEnabled: true });
    reopened.emit("model.call.started", { ...record, id: "resumed" });
    assert.equal(restored.getSnapshot().records.length, 2);
    await reopened.close();
});

test("请求与返回摘要默认保存，关闭后只保留元信息", async () => {
    const host = fixture();
    const stats = await createStatistics(host.ctx);
    const detailed = { ...record, request: { prompt: "测试提示词", messages: [{ role: "user", content: "你好" }], tools: ["generate_image"] }, response: { text: "生成完成" } };
    const upstream = [{ method: "POST", url: "https://model.invalid/v1/videos", body: { size: "1280x720" }, status: 400, response: { error: { message: "只支持 720p" } } }];
    host.emit("model.call.started", detailed);
    host.emit("model.call.finished", { ...detailed, upstream });
    assert.deepEqual(stats.getSnapshot().records[0].upstream, upstream);
    assert.equal(stats.getSnapshot().records[0].request?.prompt, "测试提示词");
    assert.equal(stats.getSnapshot().records[0].request?.tools?.[0], "generate_image");
    assert.equal(stats.getSnapshot().records[0].response?.text, "生成完成");
    await saveStatisticsSettings(host.ctx, { defaultPeriod: "today", recordingEnabled: true, capturePayloads: false, showInSidebar: false });
    const hidden = { ...record, id: "hidden", request: { prompt: "不要保存" }, response: { text: "不要保存" } };
    host.emit("model.call.started", hidden);
    host.emit("model.call.finished", { ...hidden, upstream });
    const saved = stats.getSnapshot().records.find((item) => item.id === "hidden")!;
    assert.equal(saved.request, undefined);
    assert.equal(saved.response, undefined);
    assert.equal(saved.upstream, undefined);
    await host.close();
});

test("停用时单独保存配置不启动记录，启用后读取保存结果", async () => {
    const host = fixture([record]);
    const settings: StatisticsSettings = { defaultPeriod: "week", recordingEnabled: false, capturePayloads: true, showInSidebar: false };
    await saveStatisticsSettings(host.ctx, settings);
    host.emit("model.call.started", { ...record, id: "disabled" });
    assert.deepEqual(host.state.saved, [record]);
    assert.equal(host.state.writes, 1);
    const stats = await createStatistics(host.ctx);
    assert.deepEqual(stats.getSnapshot().settings, settings);
    host.emit("model.call.started", { ...record, id: "paused" });
    assert.equal(stats.getSnapshot().records.length, 1);
    await host.close();
});

test("视频查询合并到生成记录：查询中不新增行，最终结果更新状态与总耗时", async () => {
    const host = fixture();
    const stats = await createStatistics(host.ctx);
    const submit: ModelCallFinished = { ...record, id: "video", kind: "video", startedAt: 1000, finishedAt: 1200, durationMs: 200, response: { video: { taskId: "task-1", completed: false } }, upstream: [{ method: "POST", url: "https://model.invalid/v1/videos" }] };
    host.emit("model.call.started", submit);
    host.emit("model.call.finished", submit);
    assert.equal(stats.getSnapshot().records[0].status, "running");
    const query: ModelCallFinished = { ...record, id: "q1", kind: "video-query", startedAt: 3000, finishedAt: 3100, durationMs: 100, request: { taskId: "task-1" }, response: { taskStatus: "pending" }, upstream: [{ method: "GET", url: "https://model.invalid/v1/videos/task-1" }] };
    host.emit("model.call.started", query);
    host.emit("model.call.finished", query);
    host.emit("model.call.finished", { ...query, id: "q2", finishedAt: 9000, response: { taskStatus: "completed" } });
    const [saved] = stats.getSnapshot().records;
    assert.equal(stats.getSnapshot().records.length, 1);
    assert.equal(saved.status, "success");
    assert.equal(saved.durationMs, 8000);
    assert.equal(saved.response?.taskStatus, "completed");
    assert.equal(saved.upstream?.length, 2);
    await host.close();
});
