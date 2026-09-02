import { useEffect, useState } from "react";
import { Button, Empty, Modal, Tag, message } from "antd";
import { Copy, Trash2 } from "lucide-react";

import { deleteBackendGenerationLogs, fetchBackendGenerationLogs, type BackendGenerationLog as GenerationLog } from "@/services/backend-api";
import { useBackendStore } from "@/stores/use-backend-store";

export function CanvasGenerationLogDialog({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
    // Select primitive fields separately. Returning a fresh object from a
    // Zustand selector makes useSyncExternalStore see a new snapshot forever.
    const connected = useBackendStore((state) => state.connected);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [loading, setLoading] = useState(false);
    const load = async () => {
        if (!connected || !projectId) return;
        setLoading(true);
        try { setLogs((await fetchBackendGenerationLogs({ projectId })).logs || []); } finally { setLoading(false); }
    };
    useEffect(() => { if (open) void load(); }, [open, projectId, connected]);
    const remove = async (id?: string) => {
        if (!connected) return;
        await deleteBackendGenerationLogs(id ? { id } : { projectId });
        await load();
    };
    return <Modal title={`生成日志${logs.length ? ` (${logs.length})` : ""}`} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden>
        <div className="mb-3 flex justify-end"><Button danger size="small" icon={<Trash2 className="size-3.5" />} disabled={!logs.length} onClick={() => void remove()}>清空日志</Button></div>
        {!connected ? <Empty description="Canvas Agent 未连接" /> : !logs.length ? <Empty description={loading ? "加载中…" : "暂无生成日志"} /> : <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            {logs.map((log) => <LogCard key={log.id} log={log} onDelete={() => void remove(log.id)} />)}
        </div>}
    </Modal>;
}

function LogCard({ log, onDelete }: { log: GenerationLog; onDelete: () => void }) {
    const copy = async (value: string) => { await navigator.clipboard?.writeText(value); message.success("已复制"); };
    const statusColor = log.status === "success" ? "green" : log.status === "failed" ? "red" : log.status === "running" ? "processing" : "default";
    return <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
        <div className="flex items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-1.5"><Tag color={statusColor}>{log.status}</Tag><Tag>{log.platform}</Tag>{log.taskMode ? <Tag>{log.taskMode}</Tag> : null}{log.model ? <Tag>{log.model}</Tag> : null}<span className="text-xs text-stone-500">{new Date(log.createdAt).toLocaleString()} · {Math.round(log.durationMs / 1000)}s</span></div><Button type="text" danger size="small" icon={<Trash2 className="size-3.5" />} onClick={onDelete} /></div>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-500"><span>节点：{log.nodeId || "-"}</span><span>Clip：{log.segmentId || "-"}</span><span>任务：{log.runtimeTaskId || log.promptId || "等待任务 ID"}</span></div>
        {log.prompt ? <div className="mt-2 flex gap-2 text-sm"><div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{log.prompt}</div><Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy(log.prompt || "")} /></div> : null}
        {log.error ? <div className="mt-2 flex gap-2 whitespace-pre-wrap break-words rounded bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-300"><div className="min-w-0 flex-1">{log.error}</div><Button type="text" danger size="small" icon={<Copy className="size-3.5" />} onClick={() => void copy(log.error || "")} /></div> : null}
        {log.outputs.length ? <div className="mt-3 grid grid-cols-4 gap-2">{log.outputs.map((output, index) => <Output key={`${log.id}-${index}`} output={output} />)}</div> : null}
    </div>;
}

function Output({ output }: { output: Record<string, unknown> }) {
    const url = String(output.url || output.localUrl || output.storageKey || "");
    const video = String(output.mimeType || output.type || "").startsWith("video");
    if (!url) return null;
    return video ? <video src={url} controls muted playsInline className="aspect-video w-full rounded object-cover" /> : <img src={url} alt="output" className="aspect-video w-full rounded object-cover" />;
}
