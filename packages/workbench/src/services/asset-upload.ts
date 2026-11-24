import { PluginError } from "@infinite-canvas/shared/plugins";
import { useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { mediaBlobMetadata, uploadMediaFile } from "./file-storage";
import { imageBlobDimensions, resolveImageInput, saveImageBlob, uploadImage, type UploadedImage } from "./image-storage";

type AssetDetails = Pick<Asset, "title" | "source" | "note"> & Partial<Pick<Asset, "coverUrl" | "metadata" | "folderId">>;

async function localMediaData(file: Blob, kind: "image" | "video" | "audio", signal?: AbortSignal) {
    const meta = kind === "image" ? await imageBlobDimensions(file, signal) : await mediaBlobMetadata(file, signal);
    signal?.throwIfAborted();
    const mimeType = kind === "image" ? (file.type.startsWith("image/") ? file.type : "") : file.type || "application/octet-stream";
    return { width: meta.width ?? 0, height: meta.height ?? 0, mimeType, bytes: file.size };
}

export async function saveMediaAsset(source: Blob | string | null, kind: "image" | "video" | "audio", details: AssetDetails, signal?: AbortSignal, target?: Asset): Promise<string> {
    signal?.throwIfAborted();
    let data: Asset["data"];
    if (source === null) {
        if (!target || target.kind !== kind) throw new PluginError("PLUGIN_NOT_FOUND");
        data = target.data;
    } else if (kind === "image") {
        const input = typeof source === "string" ? await resolveImageInput(source, { signal }) : { blob: source };
        if ("blob" in input) {
            const meta = await localMediaData(input.blob, kind, signal);
            data = { ...meta, storageKey: await saveImageBlob(input.blob) };
        } else {
            const image: UploadedImage = "external" in input ? input.external : await uploadImage(input.url, { signal });
            data = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        }
    } else if (typeof source === "string") {
        const media = await uploadMediaFile(source, kind, signal);
        data = { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType };
    } else {
        const meta = await localMediaData(source, kind, signal);
        data = { ...meta, storageKey: (await uploadMediaFile(source, kind, signal)).storageKey };
    }
    signal?.throwIfAborted();
    const store = useAssetStore.getState();
    const next = { coverUrl: "", ...details, kind, data };
    if (!target) return store.addAsset(next);
    if (!store.assets.includes(target)) throw new PluginError("PLUGIN_CONFLICT");
    store.updateAsset(target.id, next);
    return target.id;
}
