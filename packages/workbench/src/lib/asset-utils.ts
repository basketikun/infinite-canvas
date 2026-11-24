import type { CanvasAssetInput } from "@infinite-canvas/plugin-sdk";
import type { Asset } from "@workbench/stores/use-asset-store";

/** 本地播放/显示地址属于宿主，正文、备注和插件元数据里的同名字段属于资产。 */
export function serializeAsset(asset: Asset): Asset {
    const coverUrl = asset.coverUrl.startsWith("blob:") ? "" : asset.coverUrl;
    if (asset.kind === "image") {
        const { dataUrl, storageKey } = asset.data;
        if (dataUrl?.startsWith("blob:") || (storageKey && dataUrl?.startsWith("data:"))) return { ...asset, coverUrl, data: { ...asset.data, dataUrl: "" } };
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        const { url, storageKey } = asset.data;
        if (url?.startsWith("blob:") || (storageKey && url?.startsWith("data:"))) return { ...asset, coverUrl, data: { ...asset.data, url: "" } };
    }
    return { ...asset, coverUrl };
}

export function toCanvasAssetInput(asset: Asset): CanvasAssetInput {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video" || asset.kind === "audio") return { kind: asset.kind, title: asset.title, ...asset.data };
    const { dataUrl, ...data } = asset.data;
    return { kind: "image", title: asset.title, url: dataUrl, ...data };
}
