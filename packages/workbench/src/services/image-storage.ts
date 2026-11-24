import { network } from "@workbench/services/network/runtime";
import { storedAssetFromUrl } from "@workbench/lib/media-source";
import { storage } from "@workbench/services/storage/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { nanoid } from "nanoid";
import { createImageThumbnail } from "@workbench/lib/image-thumbnail";

export type UploadedImage = {
    url: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const previewUrls = new Map<string, string>();
const previewListeners = new Set<() => void>();
let previewRevision = 0;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_REMOTE_LOAD_TIMEOUT_MS = 10 * 60_000;
const IMAGE_DECODE_TIMEOUT_MS = 10_000;
const IMAGE_RESPONSE_ERROR = "ImageResponseError";
const IMAGE_TIMEOUT_ERROR = "ImageTimeoutError";

type ImageReadOptions = { signal?: AbortSignal };

export async function readImageBlob(storageKey: string | undefined, url: string | undefined, options?: ImageReadOptions): Promise<Blob> {
    throwIfAborted(options?.signal);
    if (!storageKey && !url) throw new PluginError("PLUGIN_NOT_FOUND");
    let blob: Blob | null;
    try { blob = storageKey ? await storage.images.getItem<Blob>(storageKey) : await fetchImageBlob(url!, options); }
    finally { throwIfAborted(options?.signal); }
    if (!blob) throw new PluginError("PLUGIN_NOT_FOUND");
    return blob;
}

export async function resolveImageInput(input: string | Blob, options?: ImageReadOptions): Promise<{ blob: Blob } | { storageKey: string; url: string } | { external: UploadedImage }> {
    throwIfAborted(options?.signal);
    if (typeof input !== "string") return { blob: input };
    const asset = storedAssetFromUrl(input);
    if (asset?.collection === "images") return { storageKey: asset.key, url: input };
    try {
        return { blob: await fetchImageBlob(input, options) };
    } catch (error) {
        if (options?.signal?.aborted || isNamedError(error, IMAGE_RESPONSE_ERROR) || isNamedError(error, IMAGE_TIMEOUT_ERROR) || !/^https?:\/\//i.test(input)) throw error;
        const meta = await loadImageMeta(input, options, IMAGE_REMOTE_LOAD_TIMEOUT_MS);
        if (!meta) throw error;
        return { external: { url: input, width: meta.width, height: meta.height, bytes: 0, mimeType: "" } };
    }
}

/** 已保存的图片直接复用原键，其余内容写入新键并同时保存缩略图。 */
export async function uploadImage(input: string | Blob, options?: ImageReadOptions): Promise<UploadedImage> {
    const result = await resolveImageInput(input, options);
    throwIfAborted(options?.signal);
    if ("external" in result) return result.external;
    const blob = "blob" in result ? result.blob : await readImageBlob(result.storageKey, undefined, options);
    const size = await imageBlobDimensions(blob, options?.signal);
    const storageKey = "storageKey" in result ? result.storageKey : await saveImageBlob(blob);
    return { url: URL.createObjectURL(blob), storageKey, width: size.width, height: size.height, bytes: blob.size, mimeType: blob.type.startsWith("image/") ? blob.type : "" };
}

/** 图片原件写入新键后不再覆盖；缩略图按同键保存。 */
export async function saveImageBlob(blob: Blob) {
    const storageKey = `image:${nanoid()}`;
    await storage.images.setItem(storageKey, blob);
    await createImageThumbnail(blob).then((thumbnail) => thumbnail && storage.previews.setItem(storageKey, thumbnail)).catch((error) => console.error("[images] thumbnail", error));
    return storageKey;
}

export async function imageBlobDimensions(blob: Blob, signal?: AbortSignal) {
    const url = URL.createObjectURL(blob);
    try {
        const meta = await loadImageMeta(url, { signal });
        if (!meta) throw new Error("读取图片失败");
        return meta;
    } finally { URL.revokeObjectURL(url); }
}

export async function fetchImageBlob(url: string, options?: ImageReadOptions) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    if (options?.signal?.aborted) abort();
    else options?.signal?.addEventListener("abort", abort, { once: true });
    const timer = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(network.url(url), { signal: controller.signal });
        if (!response.ok) throw namedError(IMAGE_RESPONSE_ERROR);
        return await response.blob();
    } catch (error) {
        if (timedOut) throw namedError(IMAGE_TIMEOUT_ERROR);
        if (options?.signal?.aborted) throw abortReason(options.signal);
        throw error;
    } finally {
        window.clearTimeout(timer);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function loadImageMeta(url: string, options?: ImageReadOptions, timeoutMs = IMAGE_DECODE_TIMEOUT_MS) {
    return new Promise<{ width: number; height: number } | null>((resolve, reject) => {
        if (options?.signal?.aborted) return reject(abortReason(options.signal));
        const image = new Image();
        let settled = false;
        const finish = (value: { width: number; height: number } | null) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            options?.signal?.removeEventListener("abort", abort);
            image.onload = null;
            image.onerror = null;
            resolve(value);
        };
        const abort = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            image.onload = null;
            image.onerror = null;
            reject(abortReason(options!.signal!));
        };
        const timer = window.setTimeout(() => finish(null), timeoutMs);
        options?.signal?.addEventListener("abort", abort, { once: true });
        image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
        image.onerror = () => finish(null);
        image.src = url;
    });
}

function namedError(name: string) {
    const error = new Error("读取图片失败");
    error.name = name;
    return error;
}

function isNamedError(error: unknown, name: string) {
    return error instanceof Error && error.name === name;
}

function abortReason(signal: AbortSignal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw abortReason(signal);
}

export async function getImageBlob(storageKey: string) {
    return storage.images.getItem<Blob>(storageKey);
}

export function previewUrlFor(storageKey?: string) {
    return storageKey ? previewUrls.get(storageKey) : undefined;
}

// 缩略图加载完成时通知展示界面。
export function subscribeImagePreviews(listener: () => void) {
    previewListeners.add(listener);
    return () => { previewListeners.delete(listener); };
}

export function getImagePreviewRevision() {
    return previewRevision;
}

export function readImagePreview(storageKey: string) {
    return storage.previews.getItem<Blob>(storageKey);
}

/** 读取缩略图；缺失时用原图补建一次，别处导入的图片也能显示。 */
export async function loadImagePreview(storageKey?: string) {
    if (!storageKey) return undefined;
    const cached = previewUrls.get(storageKey);
    if (cached) return cached;
    let preview = await storage.previews.getItem<Blob>(storageKey);
    if (!preview) {
        const original = await storage.images.getItem<Blob>(storageKey);
        preview = original && await createImageThumbnail(original).catch(() => undefined) || null;
        if (!preview) return undefined;
        await storage.previews.setItem(storageKey, preview);
    }
    const url = previewUrls.get(storageKey) ?? URL.createObjectURL(preview);
    previewUrls.set(storageKey, url);
    previewRevision += 1;
    previewListeners.forEach((listener) => listener());
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }, options?: ImageReadOptions) {
    throwIfAborted(options?.signal);
    const url = image.dataUrl || image.url;
    if (!image.storageKey && url?.startsWith("data:")) return url;
    const blob = await readImageBlob(image.storageKey, url, options);
    const dataUrl = await blobToDataUrl(blob);
    throwIfAborted(options?.signal);
    return dataUrl;
}

export function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}
