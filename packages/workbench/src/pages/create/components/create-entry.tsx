import { Download, FolderPlus, ImagePlus, LoaderCircle, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import type { StoredOutputAudio, StoredOutputImage, StoredOutputVideo } from "@infinite-canvas/shared/sync-records";
import { ImageThumbnail } from "@workbench/components/image-thumbnail";
import { MediaPlayer } from "@workbench/components/media-player";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@workbench/lib/audio-generation";
import { formatBytes, formatDuration } from "@workbench/lib/image-utils";
import { hasUnverifiedVideoTask } from "@workbench/services/generation-records";
import { imageQualityLabel, imageSizeLabel } from "@workbench/components/image-settings-panel";
import { videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@workbench/components/video-settings-panel";
import { Shimmer } from "@workbench/components/ai-elements/shimmer";
import { modelOptionName } from "@workbench/stores/use-config-store";
import type { ReferenceImage } from "@workbench/types/image";
import type { AudioLog, CreateLog, ImageLog, VideoLog } from "@workbench/services/create/logs";

export type CreateEntryActions = {
    signal: AbortSignal;
    onPreviewImage: (image: StoredOutputImage, images?: StoredOutputImage[]) => void;
    onPreviewReference: (reference: ReferenceImage, references?: ReferenceImage[]) => void;
    onAddReference: (image: StoredOutputImage) => Promise<void>;
    onSaveImage: (log: ImageLog, image: StoredOutputImage) => Promise<void>;
    onDownloadImage: (image: StoredOutputImage) => Promise<void>;
    onSaveVideo: (log: VideoLog, video: StoredOutputVideo) => Promise<void>;
    onDownloadVideo: (video: StoredOutputVideo) => Promise<void>;
    onDownloadAudio: (audio: StoredOutputAudio) => Promise<void>;
    onReuse: (log: CreateLog) => void;
    onRegenerate: (log: CreateLog) => void;
    onWaitVideo: (log: VideoLog) => void;
};

export function CreateEntry({ log, actions, hidePrompt = false }: { log: CreateLog; actions: CreateEntryActions; hidePrompt?: boolean }) {
    return (
        <article>
            {hidePrompt ? null : <div className="mb-1 flex justify-end">
                <div className="max-w-[72%]">
                    {log.references.length ? (
                        <div className="mb-2 ml-auto flex max-w-[360px] flex-wrap justify-end gap-2">
                            {log.references.map((reference) => (
                                <button key={reference.id} type="button" className="size-20 cursor-zoom-in overflow-hidden rounded-xl bg-muted transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看参考图 ${reference.name}`} onClick={() => actions.onPreviewReference(reference, log.references)}>
                                    {reference.storageKey ? <ImageThumbnail storageKey={reference.storageKey} alt={reference.name} className="size-full" /> : reference.url || reference.dataUrl ? <img src={reference.url || reference.dataUrl} alt={reference.name} className="size-full object-cover" /> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <p className="whitespace-pre-wrap px-1 text-right text-[15px] leading-7 text-foreground/90">{log.prompt}</p>
                </div>
            </div>}
            <div className={cn("mb-3 flex min-w-0 items-center gap-2 overflow-hidden", hidePrompt ? "justify-start" : "justify-end")}>
                <time className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{new Date(log.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
                <div className="flex min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-[11px] text-muted-foreground">
                    {entrySummary(log).map((value) => <span key={value} className="truncate">{value}</span>)}
                </div>
                <Button variant="ghost" size="xs" className="shrink-0" onClick={() => actions.onReuse(log)}><RotateCcw data-icon="inline-start" />复用提示词</Button>
            </div>
            <CreateEntryResults log={log} actions={actions} />
        </article>
    );
}

export function CreateEntryResults({ log, actions }: { log: CreateLog; actions: CreateEntryActions }) {
    return log.kind === "image" ? <ImageResults log={log} actions={actions} /> : log.kind === "video" ? <VideoResults log={log} actions={actions} /> : <AudioResults log={log} actions={actions} />;
}

function ImageResults({ log, actions }: { log: ImageLog; actions: CreateEntryActions }) {
    const count = log.slots.length;
    return (
        <>
            <div className="@container">
                <div className={cn(
                    "grid gap-2",
                    count >= 4 ? "max-w-[920px] grid-cols-2 @3xl:grid-cols-3 @4xl:grid-cols-4"
                        : count === 3 ? "max-w-[680px] grid-cols-2 @2xl:grid-cols-3"
                            : count === 2 ? "max-w-[440px] grid-cols-2"
                                : "max-w-[220px]",
                )}>
                    {log.slots.map((slot, index) => {
                        const image = log.images.find((item) => item.id === slot.id);
                        if (image) return <ImageResult key={slot.id} log={log} image={image} index={index} actions={actions} />;
                        if (slot.error) return <ResultMessage key={slot.id} tone="error" text={slot.error} />;
                        if (log.status === "interrupted") return <ResultMessage key={slot.id} tone="error" text="页面已重新打开，无法确认这张图片的结果。" />;
                        return <PendingResult key={slot.id} kind="image" />;
                    })}
                </div>
            </div>
            {log.slots.some((slot) => slot.error) || log.status === "failed" || log.status === "interrupted" ? <div className="mt-2"><Button variant="ghost" size="xs" onClick={() => actions.onRegenerate(log)}>重新生成</Button></div> : null}
        </>
    );
}

function ImageResult({ log, image, index, actions }: { log: ImageLog; image: StoredOutputImage; index: number; actions: CreateEntryActions }) {
    const [saving, setSaving] = useState(false);
    const [referencing, setReferencing] = useState(false);
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <button type="button" className="relative block aspect-square w-full cursor-zoom-in overflow-hidden rounded-xl bg-muted" aria-label={`查看生成结果 ${index + 1}`} onClick={() => actions.onPreviewImage(image, log.images)}>
                {image.storageKey ? <ImageThumbnail storageKey={image.storageKey} alt={`生成结果 ${index + 1}`} className="size-full" /> : <img src={image.dataUrl} alt={`生成结果 ${index + 1}`} className="size-full object-cover" />}
            </button>
            <p className="truncate px-1 text-[11px] tabular-nums text-muted-foreground">
                {image.width && image.height ? `${image.width} × ${image.height}` : "— × —"} · {formatBytes(image.bytes)} · {formatDuration(image.durationMs)}
            </p>
            <div className="flex gap-1">
                <ResultButton label="加入资产" busy={saving} icon={<FolderPlus className="size-3.5" />} onClick={async () => {
                    setSaving(true);
                    try { await actions.onSaveImage(log, image); } finally { setSaving(false); }
                }} />
                <ResultButton label="加入参考" busy={referencing} icon={<ImagePlus className="size-3.5" />} onClick={async () => {
                    setReferencing(true);
                    try { await actions.onAddReference(image); } finally { setReferencing(false); }
                }} />
                <ResultButton label="下载" icon={<Download className="size-3.5" />} onClick={() => void actions.onDownloadImage(image)} />
            </div>
        </div>
    );
}

function VideoResults({ log, actions }: { log: VideoLog; actions: CreateEntryActions }) {
    if (log.video) return <VideoResult log={log} video={log.video} actions={actions} />;
    if (hasUnverifiedVideoTask(log)) return <div className="max-w-[480px] rounded-xl border p-4 text-sm text-muted-foreground">无法核实这项视频任务的原连接。请到提交时的渠道查看任务结果。</div>;
    if (log.status === "pending" && !log.error) return <div className="max-w-[480px]"><PendingResult kind="video" /></div>;
    if (log.status === "pending") return <div className="max-w-[480px]"><div className="grid aspect-video place-items-center rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">{log.error || "等待查询结果"}<Button className="mt-3" variant="outline" size="xs" onClick={() => actions.onWaitVideo(log)}>查询原任务</Button></div></div>;
    return (
        <div className="max-w-[480px]">
            <ResultMessage tone="error" text={log.status === "interrupted" ? "页面已重新打开，无法确认这次生成的结果。" : log.error || "生成失败"} />
            <div className="mt-2 flex gap-1">
                <Button variant="ghost" size="xs" onClick={() => actions.onRegenerate(log)}>重新生成</Button>
            </div>
        </div>
    );
}

function VideoResult({ log, video, actions }: { log: VideoLog; video: StoredOutputVideo; actions: CreateEntryActions }) {
    const [saving, setSaving] = useState(false);
    return (
        <div className="max-w-[480px] overflow-hidden rounded-xl border bg-background">
            <MediaPlayer source={{ kind: "video", storageKey: video.storageKey, url: video.url, signal: actions.signal }} className="aspect-video w-full bg-black object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
                <p className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">{`${video.width} × ${video.height} · ${formatBytes(video.bytes)} · ${formatDuration(video.durationMs)}`}</p>
                <div className="flex shrink-0 gap-1">
                    <ResultButton label="加入资产" busy={saving} icon={<FolderPlus className="size-3.5" />} onClick={async () => {
                        setSaving(true);
                        try { await actions.onSaveVideo(log, video); } finally { setSaving(false); }
                    }} />
                    <ResultButton label="下载" icon={<Download className="size-3.5" />} onClick={() => void actions.onDownloadVideo(video)} />
                </div>
            </div>
        </div>
    );
}

function AudioResults({ log, actions }: { log: AudioLog; actions: CreateEntryActions }) {
    if (log.audio) return <AudioResult log={log} audio={log.audio} actions={actions} />;
    if (log.status === "pending" && !log.error) return <div className="max-w-[480px]"><PendingResult kind="audio" /></div>;
    return (
        <div className="max-w-[480px]">
            <ResultMessage tone="error" text={log.status === "interrupted" ? "页面已重新打开，这次音频结果无法确认。" : log.error || "生成失败"} />
            <div className="mt-2 flex gap-1">
                <Button variant="ghost" size="xs" onClick={() => actions.onRegenerate(log)}>重新生成</Button>
            </div>
        </div>
    );
}

function AudioResult({ log, audio, actions }: { log: AudioLog; audio: StoredOutputAudio; actions: CreateEntryActions }) {
    return (
        <div className="max-w-[480px] overflow-hidden rounded-xl border bg-background">
            <div className="p-3">
                <MediaPlayer source={{ kind: "audio", storageKey: audio.storageKey, url: audio.url, signal: actions.signal }} className="w-full" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
                <p className="min-w-0 truncate text-[11px] tabular-nums text-muted-foreground">{`${formatBytes(audio.bytes)} · ${audioFormatLabel(log.config.audioFormat)} · ${audioVoiceLabel(log.config.audioVoice)}`}</p>
                <div className="flex shrink-0 gap-1">
                    <ResultButton label="下载" icon={<Download className="size-3.5" />} onClick={() => void actions.onDownloadAudio(audio)} />
                </div>
            </div>
        </div>
    );
}

function ResultButton({ label, icon, busy, onClick }: { label: string; icon: ReactNode; busy?: boolean; onClick: () => void }) {
    return <Button variant="outline" size="xs" className="min-w-0 text-[11px]" aria-busy={busy} onClick={onClick}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : icon}<span className="truncate">{label}</span></Button>;
}

function PendingResult({ kind }: { kind: "image" | "video" | "audio" }) {
    return (
        <div className={cn("grid place-items-center rounded-xl border border-dashed bg-muted/50 text-sm text-muted-foreground", kind === "image" ? "aspect-square" : kind === "video" ? "aspect-video" : "h-24")}>
            <Shimmer className="text-sm">正在生成…</Shimmer>
        </div>
    );
}

function ResultMessage({ tone, text }: { tone: "error" | "muted"; text: string }) {
    return <div className={cn("grid min-h-24 place-items-center rounded-xl border p-4 text-center text-sm", tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-dashed text-muted-foreground")}>{text}</div>;
}

function entrySummary(log: CreateLog) {
    if (log.kind === "audio") return [
        modelOptionName(log.config.audioModel || log.model),
        audioVoiceLabel(log.config.audioVoice),
        audioFormatLabel(log.config.audioFormat),
        audioSpeedLabel(log.config.audioSpeed),
    ].filter(Boolean);
    if (log.kind === "image") return [
        modelOptionName(log.config.imageModel || log.model),
        imageQualityLabel(log.config.quality),
        imageSizeLabel(log.config.size),
        `${log.imageCount} 张`,
    ].filter(Boolean);
    return [
        modelOptionName(log.config.videoModel || log.model),
        videoResolutionLabel(log.config.vquality),
        videoSizeLabel(log.config.size),
        videoSecondsLabel(log.config.videoSeconds),
        log.config.videoGenerateAudio === "true" ? "有声" : "",
    ].filter(Boolean);
}
