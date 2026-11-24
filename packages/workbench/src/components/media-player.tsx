import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { Play, X } from "lucide-react";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { readMediaBlob } from "@workbench/services/file-storage";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { network } from "@workbench/services/network/runtime";

type Source = { kind: "video" | "audio"; storageKey?: string; url?: string; signal?: AbortSignal };
type CanvasSource = { projectId: string; nodeId: string; contributionId: string };
type VideoPlayback = CanvasSource & { storageKey?: string; url?: string; src: string; signal: AbortSignal };
const videoPlaybacks = new WeakMap<HTMLVideoElement, VideoPlayback>();

export function readVideoPlayhead(element: HTMLVideoElement | null, projectId: string, nodeId: string, resource: { storageKey?: string; url?: string; contributionId: string }): number {
    const playback = element && videoPlaybacks.get(element);
    if (!element || !playback || playback.signal.aborted || !element.isConnected) throw new PluginError("PLUGIN_OPERATION_FAILED");
    const sameNode = playback.projectId === projectId && playback.nodeId === nodeId;
    const sameResource = playback.contributionId === resource.contributionId && playback.storageKey === resource.storageKey && playback.url === resource.url;
    if (!sameNode || !sameResource || element.getAttribute("src") !== playback.src || element.currentSrc !== element.src || element.error || element.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !Number.isFinite(element.currentTime)) throw new PluginError("PLUGIN_OPERATION_FAILED");
    return element.currentTime;
}

export function MediaPlayer({ source, read, canvas, className }: { source: Source; read?: (key: string | undefined, url: string | undefined, signal: AbortSignal) => Promise<Blob>; canvas?: CanvasSource; className?: string }) {
    const { kind, storageKey, url, signal: parentSignal } = source;
    const video = useRef<HTMLVideoElement>(null);
    const audio = useRef<HTMLAudioElement>(null);
    const current = useRef<((notify?: boolean) => void) | null>(null);
    const [phase, setPhase] = useState<"idle" | "loading" | "ready">("idle");
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const poster = kind === "video" ? previewUrlFor(storageKey) : undefined;
    // 浏览器无法下载保存的外链视频没有封面图，直接让视频元素加载开头画面作为封面。
    const remotePoster = kind === "video" && !storageKey && url ? network.url(url) : undefined;
    useEffect(() => { if (kind === "video") void loadImagePreview(storageKey); }, [kind, storageKey]);
    useLayoutEffect(() => {
        setPhase("idle");
        return () => current.current?.(false);
    }, [kind, storageKey, url, parentSignal, canvas?.projectId, canvas?.nodeId, canvas?.contributionId]);

    const start = async () => {
        const videoElement = kind === "video" ? video.current : null;
        const element = videoElement ?? audio.current;
        if (!element || parentSignal?.aborted) return;
        current.current?.();
        const controller = new AbortController();
        const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
        let ownedUrl: string | undefined;
        const close = (notify = true) => {
            if (current.current !== close) return;
            current.current = null;
            signal.removeEventListener("abort", cancel);
            element.removeEventListener("error", onMediaError);
            controller.abort();
            if (videoElement && videoPlaybacks.get(videoElement)?.signal === signal) videoPlaybacks.delete(videoElement);
            element.pause();
            element.removeAttribute("src");
            element.load();
            if (ownedUrl) URL.revokeObjectURL(ownedUrl);
            if (notify) setPhase("idle");
        };
        const cancel = () => close();
        const fail = (error: unknown) => {
            if (signal.aborted || current.current !== close) return;
            console.error("[media] playback", error);
            close();
            toast.error(kind === "video" ? "视频暂时无法播放，请重试。" : "音频暂时无法播放，请重试。", workbenchMessageOptions.error);
        };
        const onMediaError = () => { if (element.error) fail(element.error); };
        current.current = close;
        signal.addEventListener("abort", cancel, { once: true });
        element.addEventListener("error", onMediaError);
        setPhase("loading");
        try {
            let src: string;
            if (storageKey) {
                const blob = read ? await read(storageKey, url, signal) : await readMediaBlob(storageKey, url, { signal });
                signal.throwIfAborted();
                src = ownedUrl = URL.createObjectURL(blob);
            } else {
                if (!url) throw new PluginError("PLUGIN_NOT_FOUND");
                src = network.url(url);
            }
            element.setAttribute("src", src);
            if (videoElement && canvas) videoPlaybacks.set(videoElement, { ...canvas, storageKey, url, src, signal });
            setPhase("ready");
            try { await element.play(); }
            catch (error) {
                if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) return;
                throw error;
            }
        } catch (error) { fail(error); }
    };

    return <>
        {kind === "video" ? <video ref={video} controls playsInline preload="none" poster={poster} className={cn(className, phase !== "ready" && "hidden")} data-canvas-video={canvas?.nodeId} data-canvas-no-zoom /> : <audio ref={audio} controls preload="none" className={cn(className, phase !== "ready" && "hidden")} data-canvas-no-zoom />}
        {phase !== "ready" ? <button type="button" data-canvas-no-zoom className={cn(className, "relative flex min-h-9 items-center justify-center bg-transparent bg-contain bg-center bg-no-repeat text-sm hover:opacity-75")} style={poster ? { backgroundImage: `url("${poster}")` } : undefined} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => {
            event.stopPropagation();
            if (phase === "loading") current.current?.();
            else void start();
        }}>
            {remotePoster ? <video src={remotePoster} muted playsInline preload="metadata" onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(0.1, event.currentTarget.duration / 2); }} onError={(event) => console.error("[media] poster", event.currentTarget.error)} className="pointer-events-none absolute inset-0 size-full object-contain" /> : null}
            <span className={cn("relative flex items-center gap-2", (poster || remotePoster) && "rounded-full bg-black/55 px-3 py-1.5 text-white")}>
                {phase === "loading" ? <><X className="size-4" />取消加载</> : <><Play className="size-4" />{kind === "video" ? "播放视频" : "播放音频"}</>}
            </span>
        </button> : null}
    </>;
}
