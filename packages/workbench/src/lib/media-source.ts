import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";

export function hasNodeMedia(node: ReadonlyCanvasNode) {
    return Boolean(node.metadata?.storageKey || node.metadata?.content);
}

/**
 * 本地模型结果使用同源素材地址，保存到画布时复用已有文件。
 */
export function storedAssetFromUrl(url: string) {
    const match = /^\/api\/assets\/(images|media)\/([^/?#]+)$/.exec(url);
    return match ? { collection: match[1] as "images" | "media", key: decodeURIComponent(match[2]) } : undefined;
}
