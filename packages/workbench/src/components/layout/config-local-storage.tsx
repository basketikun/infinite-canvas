import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { CircleAlert, FolderOpen, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { StorageUsage } from "@infinite-canvas/shared/storage-inspection";
import { storageInspection } from "@workbench/services/storage-inspection/runtime";
import { formatStorageBytes } from "@workbench/lib/local-storage-utils";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { ChannelRemoveConfirmation } from "./channel-remove-confirmation";
import "./config-network.css";
import "./config-local-storage.css";

const assetCategories = new Set(["images", "media", "previews", "library"]);
const assetColor = "light-dark(#4096ff, #3b82f6)";
const otherColor = "var(--storage-tertiary)";

export function ConfigLocalStorage({ signal }: { signal: AbortSignal }) {
    const [usage, setUsage] = useState<StorageUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const reading = useRef<AbortSignal | null>(null);

    const refresh = useCallback(async () => {
        if (signal.aborted || reading.current === signal) return;
        reading.current = signal;
        setLoading(true);
        setError("");
        try {
            const result = await storageInspection.usage();
            if (!signal.aborted) setUsage(result);
        } catch (reason) {
            console.error("读取本地存储统计失败", reason);
            if (!signal.aborted) setError("暂时无法读取存储用量，请点击「刷新统计」重试。");
        } finally {
            if (reading.current === signal) reading.current = null;
            if (!signal.aborted) setLoading(false);
        }
    }, [signal]);

    async function cleanup() {
        try {
            const { files, bytes } = await storageInspection.cleanup();
            toast.success(files ? `已清理 ${files} 个未使用的文件，释放 ${formatStorageBytes(bytes)}。` : "没有需要清理的文件。", workbenchMessageOptions.success);
        } catch (reason) {
            console.error("清理未使用文件失败", reason);
            toast.error("清理未使用文件失败，请稍后重试。", workbenchMessageOptions.error);
        }
        await refresh();
    }

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const contentBytes = usage?.contentBytes ?? 0;
    const assetBytes = usage ? usage.categories.filter((category) => assetCategories.has(category.id)).reduce((total, category) => total + category.bytes, 0) : 0;
    const otherBytes = Math.max(0, contentBytes - assetBytes);
    const assetPercent = contentBytes > 0 ? (assetBytes / contentBytes) * 100 : 0;
    const otherPercent = 100 - assetPercent;
    const parts = [
        { label: "资产", bytes: assetBytes, percent: assetPercent, color: assetColor },
        { label: "其他", bytes: otherBytes, percent: otherPercent, color: otherColor },
    ];
    const metrics = usage ? [
        { label: "占用空间", value: usage.contentBytes, total: null },
        { label: "已使用", value: usage.usedBytes, total: usage.totalBytes },
        { label: "剩余空间", value: usage.availableBytes, total: null },
    ] : [];

    return (
        <div className="storage-overview settings-network generation-workspace-controls space-y-4" aria-busy={loading}>
            {error && <div role="alert" className="storage-usage-error flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><CircleAlert aria-hidden className="size-4 shrink-0" />{error}</div>}
            {!usage && loading ? (
                <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-2 text-sm"><LoaderCircle aria-hidden className="size-5 animate-spin" />正在统计存储用量</div>
            ) : usage ? (
                <section className="rounded-xl border border-(--storage-line) p-5 sm:p-6" aria-label="资产占用">
                    <div className="flex items-center justify-between gap-4">
                        <h3 className="m-0 text-sm font-semibold">资产占用</h3>
                        <div className="flex items-center gap-1">
                            {storageInspection.openFolder && <Button type="button" variant="ghost" onClick={() => void storageInspection.openFolder!()}><FolderOpen aria-hidden className="size-3.5" />打开存储文件夹</Button>}
                            <ChannelRemoveConfirmation question="清理未使用的文件？" description="将删除没有被画布、资产、生成记录、聊天和插件使用的图片与音视频。已删除内容的撤销记录可能无法再恢复其中的文件。" onConfirm={cleanup}>
                                <Button type="button" variant="ghost" disabled={loading}><Trash2 aria-hidden className="size-3.5" />清理未使用文件</Button>
                            </ChannelRemoveConfirmation>
                            <Button type="button" variant="ghost" aria-busy={loading} aria-disabled={loading} onClick={() => void refresh()}>
                                {loading ? <LoaderCircle aria-hidden className="size-3.5 animate-spin" /> : <RefreshCw aria-hidden className="size-3.5" />}刷新统计
                            </Button>
                        </div>
                    </div>
                    <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-6">
                        <div className="size-36 shrink-0 sm:size-40">
                            <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={`资产 ${formatStorageBytes(assetBytes)}，占 ${formatStoragePercent(assetPercent)}；其他 ${formatStorageBytes(otherBytes)}，占 ${formatStoragePercent(otherPercent)}`}>
                                <circle cx="60" cy="60" r="50" fill="none" stroke="var(--storage-track)" strokeWidth="16" />
                                {contentBytes > 0 && <>
                                    <circle cx="60" cy="60" r="50" pathLength="100" fill="none" stroke={assetColor} strokeWidth="16" strokeDasharray={`${assetPercent} ${100 - assetPercent}`} />
                                    <circle cx="60" cy="60" r="50" pathLength="100" fill="none" stroke={otherColor} strokeWidth="16" strokeDasharray={`${otherPercent} ${100 - otherPercent}`} strokeDashoffset={-assetPercent} />
                                </>}
                            </svg>
                        </div>
                        <div className="w-full min-w-0 flex-1 space-y-3 sm:w-56 sm:flex-none">
                            {parts.map((part) => (
                                <div key={part.label} className="flex items-center gap-2 text-sm">
                                    <span className="size-2 shrink-0 rounded-full" style={{ background: part.color }} />
                                    <span>{part.label}</span>
                                    <span className="ml-auto font-medium tabular-nums">{formatStorageBytes(part.bytes)}</span>
                                    <span className="w-14 text-right text-xs text-(--storage-secondary) tabular-nums">{formatStoragePercent(part.percent)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="grid w-full gap-4 border-t border-(--storage-line) pt-5 lg:ml-auto lg:w-auto lg:shrink-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                            {metrics.map((metric) => (
                                <div key={metric.label} className="min-w-0">
                                    <div className="text-xs text-(--storage-secondary)">{metric.label}</div>
                                    <div className="mt-0.5 flex items-baseline gap-1.5">
                                        <span className="text-2xl font-semibold tracking-tight tabular-nums">{metric.value === null ? "—" : formatStorageBytes(metric.value)}</span>
                                        {metric.value !== null && metric.total !== null && <span className="text-xs text-(--storage-tertiary) tabular-nums">/ {formatStorageBytes(metric.total)}</span>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            ) : null}
        </div>
    );
}

function formatStoragePercent(percent: number) {
    if (percent > 0 && percent < 0.01) return "< 0.01%";
    return `${percent.toFixed(2)}%`;
}
