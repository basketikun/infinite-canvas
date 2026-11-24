import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Calendar } from "@infinite-canvas/plugin-sdk/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@infinite-canvas/plugin-sdk/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@infinite-canvas/plugin-sdk/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@infinite-canvas/plugin-sdk/ui/alert-dialog";
import { zhCN } from "date-fns/locale";
import { FilterSelect } from "./filter-select";
import { CallDetailDialog } from "./call-detail-dialog";
import type { PluginContext } from "@infinite-canvas/plugin-sdk";
import dayjs from "dayjs";
import { dateRange, duration, groupByDay, groupByModel, kinds, number, statuses, summarize, type CallRecord } from "../lib/statistics";
import { statistics } from "../setup";

function exportRecords(records: CallRecord[]) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `调用记录-${dayjs().format("YYYY-MM-DD-HHmmss")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function Overview({ ctx, embedded }: { ctx: PluginContext; embedded?: boolean }) {
    const { records, saving, storageError, settings } = useSyncExternalStore(statistics.subscribe, statistics.getSnapshot);
    const [period, setPeriod] = useState<string>(settings.defaultPeriod);
    const today = dayjs().format("YYYY-MM-DD");
    const [from, setFrom] = useState(today);
    const [until, setUntil] = useState(today);
    const [range, setRange] = useState<{ from: Date | undefined; to?: Date }>({ from: dayjs(today).toDate(), to: dayjs(today).toDate() });
    const [kind, setKind] = useState("");
    const [channel, setChannel] = useState("");
    const [model, setModel] = useState("");
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(0);
    const [tab, setTab] = useState("records");
    const [openFilter, setOpenFilter] = useState<string | null>(null);
    const [detailRecord, setDetailRecord] = useState<CallRecord | null>(null);
    function changeOpenFilter(filter: string, open: boolean) {
        setOpenFilter((current) => open ? filter : current === filter ? null : current);
    }
    const { start, end } = dateRange(period, today, from, until);
    const filtered = useMemo(() => records.filter((record) => record.startedAt >= start && record.startedAt < end && (!kind || record.kind === kind) && (!channel || record.channelId === channel) && (!model || record.model === model) && (!status || record.status === status)), [records, start, end, kind, channel, model, status]);
    const totals = useMemo(() => summarize(filtered), [filtered]);
    const groups = useMemo(() => tab === "models" ? groupByModel(filtered) : [], [filtered, tab]);
    const days = useMemo(() => tab === "days" ? groupByDay(filtered) : [], [filtered, tab]);
    const channels = useMemo(() => [...new Map(records.filter((record) => record.channelId).map((record) => [record.channelId!, record.channelName])).entries()], [records]);
    const models = useMemo(() => [...new Set(records.filter((record) => !channel || record.channelId === channel).map((record) => record.model))], [records, channel]);
    const count = tab === "records" ? filtered.length : tab === "days" ? days.length : groups.length;
    const currentPage = Math.min(page, Math.max(0, Math.ceil(count / 20) - 1));
    const offset = currentPage * 20;
    const actions = (
        <div className="api-stats-actions">
            <Button variant="outline" size="sm" disabled={!filtered.length} onClick={() => exportRecords(filtered)}>导出筛选记录（{number.format(filtered.length)}）</Button>
            <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" size="sm" disabled={!records.length || saving}>清空记录</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>清空全部调用记录？</AlertDialogTitle><AlertDialogDescription>清空后无法恢复，插件配置会保留。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { void statistics.clear(); setPage(0); }}>确认清空</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </div>
    );
    return <div className={embedded ? "api-stats api-stats-embedded" : "api-stats"}>
        {embedded ? null : <header className="api-stats-header"><h1>调用统计</h1>{actions}</header>}
        {!settings.recordingEnabled ? <p className="api-stats-paused">已暂停记录新调用，可在插件配置中恢复。</p> : null}
        <div className="api-stats-filters">
            <FilterSelect label="统计时间" open={openFilter === "period"} onOpenChange={(open) => changeOpenFilter("period", open)} value={period} onChange={(value) => { setPeriod(value); setPage(0); }} options={[{ value: "today", label: "今天" }, { value: "week", label: "近 7 天" }, { value: "month", label: "近 30 天" }, { value: "all", label: "全部时间" }, { value: "custom", label: "自选日期" }]} />
            {period === "custom" ? <Popover open={openFilter === "date"} onOpenChange={(open) => changeOpenFilter("date", open)}><PopoverTrigger asChild><Button variant="outline">{from} 至 {until}</Button></PopoverTrigger><PopoverContent align="start" className="api-stats-date-popup"><Calendar mode="range" locale={zhCN} selected={range} onSelect={(value) => { setRange(value!); if (value?.from && value.to) { setFrom(dayjs(value.from).format("YYYY-MM-DD")); setUntil(dayjs(value.to).format("YYYY-MM-DD")); setPage(0); } }} required /></PopoverContent></Popover> : null}
            <FilterSelect label="调用类型" open={openFilter === "kind"} onOpenChange={(open) => changeOpenFilter("kind", open)} value={kind} onChange={(value) => { setKind(value); setPage(0); }} options={[{ value: "", label: "全部类型" }, ...Object.entries(kinds).filter(([value]) => value !== "video-query").map(([value, label]) => ({ value, label }))]} />
            <FilterSelect label="调用渠道" open={openFilter === "channel"} onOpenChange={(open) => changeOpenFilter("channel", open)} value={channel} onChange={(value) => { setChannel(value); setModel(""); setPage(0); }} options={[{ value: "", label: "全部渠道" }, ...channels.map(([value, label]) => ({ value, label: label! }))]} />
            <FilterSelect label="调用模型" open={openFilter === "model"} onOpenChange={(open) => changeOpenFilter("model", open)} value={model} onChange={(value) => { setModel(value); setPage(0); }} options={[{ value: "", label: "全部模型" }, ...models.map((value) => ({ value, label: value }))]} />
            <FilterSelect label="调用状态" open={openFilter === "status"} onOpenChange={(open) => changeOpenFilter("status", open)} value={status} onChange={(value) => { setStatus(value); setPage(0); }} options={[{ value: "", label: "全部状态" }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]} />
            {embedded ? actions : null}
        </div>
        <div className="api-stats-summary">
            <div><p className="api-stats-caption">调用次数</p><p className="api-stats-value">{number.format(totals.total)}</p><p className="api-stats-meta">{totals.running} 进行中 · {totals.failed} 失败</p></div>
            <div><p className="api-stats-caption">成功率</p><p className="api-stats-value">{totals.successRate === null ? "—" : `${number.format(totals.successRate * 100)}%`}</p><p className="api-stats-meta">{totals.success} 成功 · {totals.cancelled} 取消</p></div>
            <div><p className="api-stats-caption">平均耗时</p><p className="api-stats-value">{duration(totals.averageMs)}</p><p className="api-stats-meta" title="95% 已完成调用的耗时不超过此值">P95 耗时 {duration(totals.p95Ms)}</p></div>
            <div><p className="api-stats-caption">Token 用量</p><p className="api-stats-value">{totals.usageCount ? number.format(totals.inputTokens + totals.outputTokens) : "—"}</p><p className="api-stats-meta">{totals.usageCount ? `输入 ${totals.inputUsageCount ? number.format(totals.inputTokens) : "—"} · 输出 ${totals.outputUsageCount ? number.format(totals.outputTokens) : "—"}` : "尚无已返回的用量"}</p></div>
        </div>
        {totals.interrupted ? <p className="api-stats-note">{totals.interrupted} 次调用结果未确认，不计入成功率。可在生成记录中查看结果。</p> : null}
        {storageError ? <div role="alert" className="api-stats-error"><span>调用记录未能保存，关闭页面可能丢失。</span><Button variant="outline" size="sm" disabled={saving || ctx.signal.aborted} onClick={() => void statistics.save()}>重试保存</Button></div> : null}
        <Tabs value={tab} onValueChange={(value) => { setTab(value); setPage(0); }}><TabsList variant="line" className="api-stats-tabs"><TabsTrigger value="records">调用记录</TabsTrigger><TabsTrigger value="days">按日统计</TabsTrigger><TabsTrigger value="models">模型汇总</TabsTrigger></TabsList></Tabs>
        {!count ? <div className="api-stats-empty">{records.length ? "没有符合条件的调用记录" : "暂无调用记录，使用模型后会显示在这里。"}</div>
            : tab === "records" ? <Table><TableHeader><TableRow><TableHead>模型 / 渠道</TableHead><TableHead>类型</TableHead><TableHead>状态</TableHead><TableHead>开始时间</TableHead><TableHead>耗时</TableHead><TableHead>Token 输入 / 输出</TableHead><TableHead>详情</TableHead></TableRow></TableHeader><TableBody>
                {filtered.slice(offset, offset + 20).map((record) => <TableRow key={record.id}>
                    <TableCell><p className="api-stats-model-name">{record.model}</p><p className="api-stats-meta">{[record.channelName, record.groupName].filter(Boolean).join(" · ")}</p>{record.status === "failed" && record.errorMessage ? <p className="api-stats-meta api-stats-error-text" title={record.errorMessage}>{record.errorMessage}{record.errorCode ? `（${record.errorCode}）` : ""}</p> : null}</TableCell>
                    <TableCell>{kinds[record.kind]}</TableCell><TableCell><span className="api-stats-status">{statuses[record.status]}</span></TableCell><TableCell>{dayjs(record.startedAt).format("YYYY-MM-DD HH:mm:ss")}</TableCell><TableCell>{duration(record.durationMs)}</TableCell><TableCell>{record.usage?.inputTokens === undefined ? "—" : number.format(record.usage.inputTokens)} / {record.usage?.outputTokens === undefined ? "—" : number.format(record.usage.outputTokens)}</TableCell>
                    <TableCell><Button type="button" variant="ghost" size="xs" onClick={() => setDetailRecord(record)}>查看</Button></TableCell>
                </TableRow>)}
            </TableBody></Table> : tab === "days" ? <Table><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>调用</TableHead><TableHead>失败</TableHead><TableHead>成功率</TableHead><TableHead>已知 Token</TableHead></TableRow></TableHeader><TableBody>
                {days.slice(offset, offset + 20).map((day) => <TableRow key={day.date}><TableCell><Button variant="link" size="sm" onClick={() => { setPeriod("custom"); setFrom(day.date); setUntil(day.date); setRange({ from: dayjs(day.date).toDate(), to: dayjs(day.date).toDate() }); setTab("records"); setPage(0); }}>{day.date}</Button></TableCell><TableCell>{day.total}</TableCell><TableCell>{day.failed}</TableCell><TableCell>{day.successRate === null ? "—" : `${number.format(day.successRate * 100)}%`}</TableCell><TableCell>{day.usageCount ? number.format(day.inputTokens + day.outputTokens) : "—"}</TableCell></TableRow>)}
            </TableBody></Table> : <Table><TableHeader><TableRow><TableHead>模型 / 渠道</TableHead><TableHead>调用</TableHead><TableHead>成功率</TableHead><TableHead>平均耗时</TableHead><TableHead>P95 耗时</TableHead></TableRow></TableHeader><TableBody>
                {groups.slice(offset, offset + 20).map((group) => <TableRow key={group.key}><TableCell><p className="api-stats-model-name">{group.model}</p><p className="api-stats-meta">{[group.channelName, group.groupName].filter(Boolean).join(" · ")}</p></TableCell><TableCell>{group.total}</TableCell><TableCell>{group.successRate === null ? "—" : `${number.format(group.successRate * 100)}%`}</TableCell><TableCell>{duration(group.averageMs)}</TableCell><TableCell>{duration(group.p95Ms)}</TableCell></TableRow>)}
            </TableBody></Table>}
        {count > 20 ? <nav aria-label="统计分页" className="api-stats-pagination"><Button variant="outline" size="sm" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</Button><span className="api-stats-caption">{currentPage + 1} / {Math.ceil(count / 20)}</span><Button variant="outline" size="sm" disabled={offset + 20 >= count} onClick={() => setPage(currentPage + 1)}>下一页</Button></nav> : null}
        <CallDetailDialog record={detailRecord} onClose={() => setDetailRecord(null)} />
    </div>;
}
