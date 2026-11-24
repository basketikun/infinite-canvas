import type { CanvasNodeResource, ImageCropRect, ImageSplitParams, ImageUpscaleAlgorithm, ImageUpscaleParams } from "@infinite-canvas/plugin-sdk";
import { readImageBlob } from "@workbench/services/image-storage";

export const MAX_UPSCALE_LONG_EDGE = 4096;

type ImageSplitPiece = {
    row: number;
    column: number;
    blob: Blob;
};

export async function cropImage(resource: Pick<CanvasNodeResource, "storageKey" | "url">, crop?: ImageCropRect, signal?: AbortSignal) {
    const image = await loadImage(resource, signal);
    signal?.throwIfAborted();
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitImage(resource: Pick<CanvasNodeResource, "storageKey" | "url">, params: ImageSplitParams, signal?: AbortSignal): Promise<ImageSplitPiece[]> {
    const image = await loadImage(resource, signal);
    signal?.throwIfAborted();
    const xCuts = buildSplitCuts(params.verticalLines, image.width, Math.max(1, Math.floor(params.columns)));
    const yCuts = buildSplitCuts(params.horizontalLines, image.height, Math.max(1, Math.floor(params.rows)));
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < yCuts.length - 1; row += 1) {
        const sy = yCuts[row];
        const sh = yCuts[row + 1] - sy;
        for (let column = 0; column < xCuts.length - 1; column += 1) {
            const sx = xCuts[column];
            const sw = xCuts[column + 1] - sx;
            signal?.throwIfAborted();
            pieces.push({ row, column, blob: await drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

function buildSplitCuts(lines: number[] | undefined, size: number, count: number) {
    if (!lines?.length) return Array.from({ length: count + 1 }, (_, index) => Math.floor((index * size) / count));
    return [0, ...lines.map((line) => Math.round(line * size)).filter((line) => line > 0 && line < size).sort((a, b) => a - b), size];
}

export async function upscaleImage(resource: Pick<CanvasNodeResource, "storageKey" | "url">, params: ImageUpscaleParams, signal?: AbortSignal) {
    const image = await loadImage(resource, signal);
    signal?.throwIfAborted();
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return pngBlob(params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResizeCanvas(image, image.width, image.height, width, height, params.algorithm));
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败");
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return pngBlob(canvas);
}

function pngBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片处理失败")), "image/png"));
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("图片处理失败");
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

async function loadImage(resource: Pick<CanvasNodeResource, "storageKey" | "url">, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const blob = await readImageBlob(resource.storageKey, resource.url, { signal });
    signal?.throwIfAborted();
    const url = URL.createObjectURL(blob);
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            const cleanup = () => {
                image.onload = null;
                image.onerror = null;
                signal?.removeEventListener("abort", abort);
            };
            const abort = () => { cleanup(); image.src = ""; reject(signal!.reason); };
            image.onload = () => { cleanup(); resolve(image); };
            image.onerror = () => { cleanup(); reject(new Error("读取图片失败")); };
            signal?.addEventListener("abort", abort, { once: true });
            image.src = url;
        });
    } finally { URL.revokeObjectURL(url); }
}
