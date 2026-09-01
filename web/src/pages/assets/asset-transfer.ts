import { saveAs } from "file-saver";

import { createZip, readZip } from "@/lib/zip";
import { getMediaBlob, setMediaBlob } from "@/services/file-storage";
import { getImageBlob, setImageBlob } from "@/services/image-storage";
import type { Asset, AudioAsset, CompositeAsset, ImageAsset, VideoAsset } from "@/stores/use-asset-store";

type AssetExportFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    assets: Asset[];
    files: AssetExportItem[];
};

type AssetExportItem = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

export async function exportAssets(assets: Asset[], filename: string) {
    const files: AssetExportItem[] = [];
    const zipFiles: { name: string; data: BlobPart }[] = [];

    await Promise.all(
        assets.map(async (asset) => {
            if (asset.kind === "image") {
                if (!asset.data.storageKey) return;
                const blob = await getImageBlob(asset.data.storageKey);
                if (!blob) return;
                const path = `files/${safeFileName(asset.data.storageKey)}.${fileExtension(blob.type, "image")}`;
                files.push({ storageKey: asset.data.storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
                zipFiles.push({ name: path, data: blob });
            } else if (asset.kind === "video" || asset.kind === "audio") {
                if (!asset.data.storageKey) return;
                const blob = await getMediaBlob(asset.data.storageKey);
                if (!blob) return;
                const path = `files/${safeFileName(asset.data.storageKey)}.${fileExtension(blob.type, asset.kind)}`;
                files.push({ storageKey: asset.data.storageKey, path, mimeType: blob.type || asset.data.mimeType, bytes: blob.size });
                zipFiles.push({ name: path, data: blob });
            } else if (asset.kind === "composite") {
                for (const item of asset.data.items) {
                    if (item.itemType !== "assetRef") continue;
                    const refAsset = assets.find(a => a.id === item.refId);
                    if (!refAsset || refAsset.kind === "composite" || refAsset.kind === "text") continue;
                    const storageKey = refAsset.kind === "image" ? refAsset.data.storageKey : refAsset.data.storageKey;
                    if (!storageKey) continue;
                    const blob = refAsset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
                    if (!blob) continue;
                    const path = `files/${safeFileName(storageKey)}.${fileExtension(blob.type, refAsset.kind)}`;
                    files.push({ storageKey, path, mimeType: blob.type || (refAsset as ImageAsset | VideoAsset | AudioAsset).data.mimeType, bytes: blob.size });
                    zipFiles.push({ name: path, data: blob });
                }
            }
        }),
    );

    const data: AssetExportFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), assets, files };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...zipFiles]);
    saveAs(zip, filename);
}

export async function readAssetPackage(file: File) {
    const zip = await readZip(file);
    const assetFile = zip.get("assets.json");
    if (!assetFile) throw new Error("missing assets.json");
    const data = JSON.parse(await assetFile.text()) as AssetExportFile;
    await Promise.all(
        data.files.map(async (item) => {
            const blob = zip.get(item.path);
            if (!blob) return;
            const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
            await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
        }),
    );
    return data.assets;
}

function safeFileName(value: string) {
    return value.replace(/[\\/:*?"<>|]/g, "_");
}

function fileExtension(mimeType: string, kind: Asset["kind"]) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    if (mimeType.includes("ogg")) return "ogg";
    if (mimeType.includes("m4a")) return "m4a";
    return kind === "image" ? "png" : "bin";
}
