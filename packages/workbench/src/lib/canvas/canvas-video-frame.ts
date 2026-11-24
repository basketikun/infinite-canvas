import type { CanvasNodeResource, VideoFramePosition } from "@infinite-canvas/plugin-sdk";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { readMediaBlob } from "@workbench/services/file-storage";
import { network } from "@workbench/services/network/runtime";

export async function captureVideoFrame(source: Pick<CanvasNodeResource, "url" | "storageKey">, position: VideoFramePosition, currentTime: number, signal: AbortSignal): Promise<Blob> {
    signal.throwIfAborted();
    const blob = source.storageKey ? await readMediaBlob(source.storageKey, source.url, { signal }) : undefined;
    signal.throwIfAborted();
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const localUrl = blob && URL.createObjectURL(blob);
    try {
        const url = localUrl || (source.url && network.url(source.url));
        if (!url) throw new PluginError("PLUGIN_NOT_FOUND");
        await waitForVideo(video, "loadedmetadata", signal, () => {
            video.src = url;
            video.load();
        });
        signal.throwIfAborted();
        const endTime = Math.max(0, video.duration - 0.001);
        const time = position === "first" ? 0 : position === "last" ? endTime : Math.min(currentTime, endTime);
        if (time) {
            await waitForVideo(video, "seeked", signal, () => { video.currentTime = time; });
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForVideo(video, "loadeddata", signal);
        }

        signal.throwIfAborted();
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new PluginError("PLUGIN_OPERATION_FAILED");
        context.drawImage(video, 0, 0);
        return await new Promise<Blob>((resolve, reject) => {
            signal.throwIfAborted();
            const abort = () => {
                signal.removeEventListener("abort", abort);
                reject(signal.reason);
            };
            signal.addEventListener("abort", abort, { once: true });
            try {
                canvas.toBlob((result) => {
                    signal.removeEventListener("abort", abort);
                    if (signal.aborted) reject(signal.reason);
                    else if (result) resolve(result);
                    else reject(new PluginError("PLUGIN_OPERATION_FAILED"));
                }, "image/png");
            } catch (error) {
                signal.removeEventListener("abort", abort);
                reject(error);
            }
        });
    } finally {
        try {
            video.removeAttribute("src");
            video.load();
        } finally {
            if (localUrl) URL.revokeObjectURL(localUrl);
        }
    }
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked", signal: AbortSignal, start?: () => void) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const cleanup = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            signal.removeEventListener("abort", abort);
        };
        const finish = () => {
            cleanup();
            resolve();
        };
        const fail = () => {
            cleanup();
            reject(new PluginError("PLUGIN_OPERATION_FAILED", { cause: video.error }));
        };
        const abort = () => {
            cleanup();
            reject(signal.reason);
        };
        video.addEventListener(eventName, finish);
        video.addEventListener("error", fail);
        signal.addEventListener("abort", abort, { once: true });
        try { start?.(); }
        catch (error) { cleanup(); reject(error); }
    });
}
