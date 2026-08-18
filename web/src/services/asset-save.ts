import { imageToDataUrl } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { createEagleAsset, createEagleTextAsset } from "@/services/eagle-assets";
import type { Asset, ImageAsset, TextAsset, VideoAsset } from "@/stores/use-asset-store";

export type AssetSaveTarget = { provider: "local" } | { provider: "eagle"; folderId?: string };
export type AssetDraft = Omit<TextAsset, "id" | "createdAt" | "updatedAt"> | Omit<ImageAsset, "id" | "createdAt" | "updatedAt"> | Omit<VideoAsset, "id" | "createdAt" | "updatedAt">;

export async function saveAssetDraft(draft: AssetDraft, target: AssetSaveTarget, addLocalAsset: (asset: AssetDraft) => string) {
    if (target.provider === "local") return { provider: "local" as const, id: addLocalAsset(draft) };

    const folders = target.folderId ? [target.folderId] : undefined;
    if (draft.kind === "text") {
        const created = await createEagleTextAsset({ content: draft.data.content, name: draft.title, tags: draft.tags, folders, annotation: draft.note || "" });
        return { provider: "eagle" as const, id: created.id || created.ids?.[0] };
    }

    const base64 = draft.kind === "image" ? await imageToDataUrl({ dataUrl: draft.data.dataUrl, storageKey: draft.data.storageKey, url: draft.coverUrl }) : await mediaToDataUrl({ url: draft.data.url, storageKey: draft.data.storageKey });
    if (!base64) throw new Error("Asset media is empty");
    const created = await createEagleAsset({ base64, name: draft.title, tags: draft.tags, folders, annotation: draft.note || "" });
    return { provider: "eagle" as const, id: created.id || created.ids?.[0] };
}

async function mediaToDataUrl(input: { url?: string; storageKey?: string }) {
    const source = await resolveMediaUrl(input.storageKey, input.url || "");
    if (!source) return "";
    if (source.startsWith("data:")) return source;
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to read asset media (${response.status})`);
    return blobToDataUrl(await response.blob());
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Unable to convert asset media"));
        reader.readAsDataURL(blob);
    });
}
