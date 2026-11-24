import { network } from "@workbench/services/network/runtime";
import { storedAssetFromUrl } from "@workbench/lib/media-source";
import { ModelExecutionError } from "@infinite-canvas/shared/model-http";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { storage } from "@workbench/services/storage/runtime";
import { nanoid } from "nanoid";
import { getThumbnailDimensions } from "@workbench/lib/image-thumbnail";


export type UploadedFile = { url?: string; storageKey?: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = storage.media;

/** 已保存的媒体直接复用原键，其余内容写入新键。 */
export async function uploadMediaFile(input: string | Blob, prefix = "file", signal?: AbortSignal): Promise<UploadedFile & { storageKey: string }> {
    signal?.throwIfAborted();
    const asset = typeof input === "string" ? storedAssetFromUrl(input) : undefined;
    let blob: Blob;
    if (typeof input === "string") {
        try { blob = await readMediaBlob(undefined, input, { signal }); }
        catch { signal?.throwIfAborted(); throw new ModelExecutionError("MODEL_RESULT_MISSING"); }
    } else blob = input;
    signal?.throwIfAborted();
    const existingKey = asset?.collection === "media" ? asset.key : undefined;
    const storageKey = existingKey || `${prefix}:${nanoid()}`;
    const { poster, ...meta } = await readMediaInfo(blob, signal);
    signal?.throwIfAborted();
    if (!existingKey) await store.setItem(storageKey, blob);
    // 视频封面与图片缩略图同库同键保存，播放器未加载视频时直接展示。
    if (poster) await storage.previews.setItem(storageKey, poster).catch((error) => console.error("[media] poster", error));
    return { storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta };
}

export async function mediaBlobMetadata(blob: Blob, signal?: AbortSignal): Promise<Pick<UploadedFile, "width" | "height" | "durationMs">> {
    const { poster: _poster, ...meta } = await readMediaInfo(blob, signal);
    return meta;
}

async function readMediaInfo(blob: Blob, signal?: AbortSignal): Promise<Pick<UploadedFile, "width" | "height" | "durationMs"> & { poster?: Blob }> {
    signal?.throwIfAborted();
    const read = blob.type.startsWith("video/") ? readVideoMeta : blob.type.startsWith("audio/") ? readAudioMeta : undefined;
    if (!read) return {};
    const url = URL.createObjectURL(blob);
    try { return await read(url, signal); }
    finally { URL.revokeObjectURL(url); }
}

export async function readMediaBlob(storageKey: string | undefined, url: string | undefined, options?: { signal?: AbortSignal }): Promise<Blob> {
    const signal = options?.signal;
    signal?.throwIfAborted();
    try {
        if (storageKey) {
            const blob = await store.getItem<Blob>(storageKey);
            if (!blob) throw new PluginError("PLUGIN_NOT_FOUND");
            return blob;
        }
        if (!url) throw new PluginError("PLUGIN_NOT_FOUND");
        const response = await fetch(network.url(url), { signal });
        signal?.throwIfAborted();
        if (!response.ok) throw new PluginError("PLUGIN_OPERATION_FAILED");
        return await response.blob();
    } finally { signal?.throwIfAborted(); }
}

function readVideoMeta(url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return new Promise<{ width: number; height: number; durationMs?: number; poster?: Blob }>((resolve, reject) => {
        const video = document.createElement("video");
        const clear = () => {
            signal?.removeEventListener("abort", abort);
            video.onloadedmetadata = video.onseeked = video.onerror = null;
            video.removeAttribute("src");
            video.load();
        };
        const abort = () => { clear(); reject(signal!.reason); };
        const done = (poster?: Blob) => {
            const meta = { width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined };
            clear();
            resolve({ ...meta, poster });
        };
        // 跳过开头可能的黑帧，截取 0.1 秒处的画面作为封面；截取失败时只返回尺寸与时长。
        const capture = () => {
            try {
                const size = getThumbnailDimensions(video.videoWidth, video.videoHeight);
                const canvas = document.createElement("canvas");
                canvas.width = size.width;
                canvas.height = size.height;
                canvas.getContext("2d")!.drawImage(video, 0, 0, size.width, size.height);
                canvas.toBlob((poster) => done(poster || undefined), "image/webp", 0.86);
            } catch { done(); }
        };
        signal?.addEventListener("abort", abort, { once: true });
        video.muted = true;
        video.onloadedmetadata = () => {
            if (!video.videoWidth) return done();
            video.onseeked = capture;
            video.currentTime = Math.min(0.1, (video.duration || 0.2) / 2);
        };
        video.onerror = () => done();
        video.src = url;
    });
}

function readAudioMeta(url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return new Promise<{ durationMs?: number }>((resolve, reject) => {
        const audio = document.createElement("audio");
        const clear = () => {
            signal?.removeEventListener("abort", abort);
            audio.onloadedmetadata = audio.onerror = null;
            audio.removeAttribute("src");
            audio.load();
        };
        const abort = () => { clear(); reject(signal!.reason); };
        const done = () => {
            const meta = { durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined };
            clear();
            resolve(meta);
        };
        signal?.addEventListener("abort", abort, { once: true });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}
