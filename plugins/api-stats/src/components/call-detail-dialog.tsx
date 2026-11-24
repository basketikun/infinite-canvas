import { useState } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@infinite-canvas/plugin-sdk/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@infinite-canvas/plugin-sdk/ui/tabs";
import dayjs from "dayjs";
import { duration, kinds, number, statuses, type CallRecord } from "../lib/statistics";

type DetailTab = "request" | "upstream" | "response";

export function CallDetailDialog({ record, onClose }: { record: CallRecord | null; onClose: () => void }) {
    return (
        <Dialog open={Boolean(record)} onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="api-stats-detail-dialog z-[1200]" overlayClassName="z-[1190]">
                {record ? <CallDetail key={record.id} record={record} /> : null}
            </DialogContent>
        </Dialog>
    );
}

function CallDetail({ record }: { record: CallRecord }) {
    // 有实际请求时默认打开，排查参数问题最常用。
    const [tab, setTab] = useState<DetailTab>(record.upstream?.length ? "upstream" : "request");
    const [copied, setCopied] = useState<DetailTab>();
    const value = tab === "request" ? record.request : tab === "upstream" ? (record.upstream?.length ? record.upstream : undefined) : record.response;
    const emptyText = tab === "upstream"
        ? ["text", "chat", "summary"].includes(record.kind) ? "文本与聊天调用不记录实际请求。" : record.upstream ? "调用方式在发送前就已失败，没有向模型服务发出请求，请查看上方错误说明。" : record.status === "running" ? "调用完成后显示实际请求。" : "该记录没有保存实际请求，可能是功能更新前的旧记录，或已在插件配置中关闭记录内容。"
        : `该记录未保存${tab === "request" ? "请求参数" : "返回"}内容，可能是旧记录或已在插件配置中关闭记录内容。`;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
            setCopied(tab);
            setTimeout(() => setCopied((current) => current === tab ? undefined : current), 1500);
        } catch { /* 剪贴板不可用时保留文本供手动选择 */ }
    };
    return <>
        <DialogHeader>
            <DialogTitle>调用详情</DialogTitle>
            <DialogDescription>{kinds[record.kind]} · {record.model} · {statuses[record.status]}</DialogDescription>
        </DialogHeader>
        <dl className="api-stats-detail-meta">
            <DetailTerm label="渠道 / 分组">{record.channelName || record.channelId || "—"}{record.groupName ? ` · ${record.groupName}` : ""}</DetailTerm>
            <DetailTerm label="开始时间">{dayjs(record.startedAt).format("YYYY-MM-DD HH:mm:ss")}</DetailTerm>
            <DetailTerm label="耗时">{duration(record.durationMs)}</DetailTerm>
            <DetailTerm label="Token">{record.usage?.inputTokens === undefined && record.usage?.outputTokens === undefined ? "—" : `输入 ${record.usage?.inputTokens === undefined ? "—" : number.format(record.usage.inputTokens)} / 输出 ${record.usage?.outputTokens === undefined ? "—" : number.format(record.usage.outputTokens)}`}</DetailTerm>
            {record.errorCode || record.errorMessage ? <DetailTerm label="错误"><span className="api-stats-error-text" title={record.errorMessage}>{record.errorMessage || "—"}{record.errorCode ? `（${record.errorCode}）` : ""}</span></DetailTerm> : null}
        </dl>
        <div className="api-stats-detail-tabs">
            <Tabs value={tab} onValueChange={(next) => setTab(next as DetailTab)}>
                <TabsList variant="line">
                    <TabsTrigger value="request">请求参数</TabsTrigger>
                    <TabsTrigger value="upstream">实际请求{record.upstream?.length ? ` ${record.upstream.length}` : ""}</TabsTrigger>
                    <TabsTrigger value="response">返回</TabsTrigger>
                </TabsList>
            </Tabs>
            {value ? <Button type="button" variant="ghost" size="xs" onClick={() => void copy()}>{copied === tab ? "已复制" : "复制"}</Button> : null}
        </div>
        {value ? <pre className="api-stats-detail-pre">{JSON.stringify(value, null, 2)}</pre> : <p className="api-stats-caption">{emptyText}</p>}
    </>;
}

function DetailTerm({ label, children }: { label: string; children: React.ReactNode }) {
    return <><dt>{label}</dt><dd>{children}</dd></>;
}
