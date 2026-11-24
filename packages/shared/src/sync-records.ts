import { z } from "zod";
import { StorageError } from "./storage-data.js";
import { remoteVideoIdentitySchema, videoChannelFingerprintSchema } from "./model-http.js";
import type { ArchiveResource } from "./work-archive.js";

const text = z.string();
const number = z.number();
const key = text.min(1).optional();
const media = z.object({ storageKey: key, width: number, height: number, bytes: number, mimeType: text });
const defaultAssetFolderId = "default";
const asset = z.object({
    id: text.min(1), title: text, coverUrl: text, createdAt: text, updatedAt: text,
    folderId: text.min(1).optional(),
    source: text.optional(), note: text.optional(),
    metadata: z.custom<Record<string, unknown>>((v) => typeof v === "object" && v !== null && !Array.isArray(v)).optional(),
});
export const assetFolderSchema = z.object({
    id: text.min(1), name: text.min(1), parentId: text.min(1).nullable(), createdAt: text, updatedAt: text,
}).strict();
export type StoredAssetFolder = z.infer<typeof assetFolderSchema>;
export { defaultAssetFolderId };
export const assetSchema = z.discriminatedUnion("kind", [
    asset.extend({ kind: z.literal("text"), data: z.object({ content: text }) }),
    asset.extend({ kind: z.literal("image"), data: media.extend({ dataUrl: text.optional() }) }),
    asset.extend({ kind: z.literal("video"), data: media.extend({ url: text.optional() }) }),
    asset.extend({ kind: z.literal("audio"), data: media.extend({ url: text.optional() }) }),
]);

export type StoredAsset = z.infer<typeof assetSchema>;
export type StoredMediaAsset = Exclude<StoredAsset, { kind: "text" }>;
const assetLibraryFoldersSchema = z.array(assetFolderSchema).optional();
export const assetLibraryEditsSchema = z.object({
    put: z.array(assetSchema),
    remove: z.array(z.string().min(1)),
    folders: z.object({ put: z.array(assetFolderSchema), remove: z.array(z.string().min(1)) }).strict().optional(),
}).strict();
export type AssetLibraryEdits = z.infer<typeof assetLibraryEditsSchema>;
export const assetLibraryKey = "infinite-canvas:asset_store";
export const assetLibrarySchema = z.object({ state: z.object({ assets: z.array(assetSchema), folders: assetLibraryFoldersSchema }), version: z.number().optional() });

function currentAssetLibrary(library: unknown) {
    if (library === null) return { state: { assets: [] as StoredAsset[], folders: undefined as StoredAssetFolder[] | undefined }, version: 0 as const };
    const parsed = assetLibrarySchema.safeParse(library);
    if (!parsed.success || (parsed.data.version !== undefined && parsed.data.version !== 0) ||
        new Set(parsed.data.state.assets.map((item) => item.id)).size !== parsed.data.state.assets.length) throw new StorageError("STORAGE_INVALID");
    if (parsed.data.state.folders) assertAssetFolders(parsed.data.state.folders);
    return library as typeof parsed.data;
}

/** 文件夹只描述树结构；默认文件夹由客户端固定展示，不写入库记录。 */
function assertAssetFolders(folders: StoredAssetFolder[]) {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    if (byId.size !== folders.length || byId.has(defaultAssetFolderId)) throw new StorageError("STORAGE_INVALID");
    for (const folder of folders) {
        if (folder.parentId !== null && folder.parentId !== defaultAssetFolderId && !byId.has(folder.parentId)) throw new StorageError("STORAGE_INVALID");
        const seen = new Set([folder.id]);
        let parentId = folder.parentId;
        while (parentId && parentId !== defaultAssetFolderId) {
            if (seen.has(parentId)) throw new StorageError("STORAGE_INVALID");
            seen.add(parentId);
            parentId = byId.get(parentId)?.parentId ?? null;
        }
    }
}

function applyFolderEdits(folders: StoredAssetFolder[], edits: NonNullable<AssetLibraryEdits["folders"]>, assets: StoredAsset[]) {
    const changed = new Map(edits.put.map((item) => [item.id, item]));
    const removed = new Set(edits.remove);
    if (changed.size !== edits.put.length || edits.remove.some((id) => changed.has(id)) || removed.has(defaultAssetFolderId) || changed.has(defaultAssetFolderId)) throw new StorageError("STORAGE_INVALID");
    const next = folders.filter((item) => !removed.has(item.id)).map((item) => {
        const replacement = changed.get(item.id);
        changed.delete(item.id);
        return replacement ?? item;
    });
    const result = [...changed.values(), ...next];
    assertAssetFolders(result);
    for (const id of removed) if (assets.some((item) => item.folderId === id)) throw new StorageError("STORAGE_INVALID");
    return result;
}

export function applyAssetEdits(library: unknown, edits: AssetLibraryEdits) {
    const current = currentAssetLibrary(library);
    const changed = new Map(edits.put.map((item) => [item.id, item]));
    const removed = new Set(edits.remove);
    if (changed.size !== edits.put.length || edits.remove.some((id) => changed.has(id))) throw new StorageError("STORAGE_INVALID");
    const assets = current.state.assets.filter((item) => !removed.has(item.id)).map((item) => {
        const next = changed.get(item.id);
        changed.delete(item.id);
        return next ?? item;
    });
    const nextAssets = [...changed.values(), ...assets];
    const folders = edits.folders ? applyFolderEdits(current.state.folders ?? [], edits.folders, nextAssets) : current.state.folders;
    return { ...current, state: { ...current.state, assets: nextAssets, ...(folders !== undefined && { folders }) } };
}

export function assetResources(asset: z.infer<typeof assetSchema>): Extract<ArchiveResource, { collection: "images" | "media" }>[] {
    if (asset.kind === "text") return [];
    if (asset.data.storageKey) return [{ collection: asset.kind === "image" ? "images" : "media", key: asset.data.storageKey }];
    const url = asset.kind === "image" ? asset.data.dataUrl : asset.data.url;
    if (!url || url.startsWith("blob:")) throw new StorageError("STORAGE_INVALID");
    return [];
}

// 历史记录只传业务字段。可恢复的任务和带凭据的调用脚本留在发起设备。
function portableMedia<T extends { storageKey?: string; url?: string; dataUrl?: string }>(source: T) {
    const { url, dataUrl, ...item } = source;
    if (item.storageKey) return item;
    const remoteUrl = url && !url.startsWith("blob:") ? url : undefined;
    const inlineUrl = dataUrl && !dataUrl.startsWith("blob:") ? dataUrl : undefined;
    if (!remoteUrl && !inlineUrl) throw new StorageError("STORAGE_INVALID");
    return { ...item, ...(remoteUrl && { url: remoteUrl }), ...(inlineUrl && { dataUrl: inlineUrl }) };
}

const reference = z.object({ id: text, name: text, type: text, storageKey: key, url: text.optional(), dataUrl: text.optional() }).transform(portableMedia);
const result = media.extend({ id: text, durationMs: number });
const outputImage = result.extend({ dataUrl: text.optional() }).strict().refine((image) => image.storageKey ? image.dataUrl === undefined : Boolean(image.dataUrl && /^https?:\/\//i.test(image.dataUrl)));
export type StoredOutputImage = z.infer<typeof outputImage>;

const outputVideo = result.extend({ url: text.optional() }).strict().refine((video) => video.storageKey ? video.url === undefined : Boolean(video.url && /^https?:\/\//i.test(video.url)));
export type StoredOutputVideo = z.infer<typeof outputVideo>;
const workbenchVideoTask = remoteVideoIdentitySchema.extend({ channelFingerprint: videoChannelFingerprintSchema });
export type WorkbenchVideoTask = z.infer<typeof workbenchVideoTask>;
const outputAudio = result.extend({ url: text.optional() }).strict().refine((audio) => audio.storageKey ? audio.url === undefined : Boolean(audio.url && /^https?:\/\//i.test(audio.url)));
export type StoredOutputAudio = z.infer<typeof outputAudio>;
const record = z.object({
    id: text.min(1), createdAt: number, title: text, time: text, prompt: text, model: text,
    references: z.array(reference), durationMs: number, size: text,
    status: z.enum(["pending", "success", "failed", "interrupted"]),
});
const config = z.object({ model: text, size: text });
export const generationRecordSchemas = {
    image: record.extend({
        config: config.extend({ imageModel: text, quality: text, count: text }),
        successCount: number, failCount: number, imageCount: number, quality: text,
        images: z.array(result.extend({ dataUrl: text.optional() }).transform(portableMedia)),
    }),
    video: record.extend({
        config: config.extend({ videoModel: text, vquality: text, videoSeconds: text, videoGenerateAudio: text, videoWatermark: text, videoMode: text }),
        resolution: text, seconds: text, video: result.extend({ url: text.optional() }).transform(portableMedia).optional(),
    }),
    audio: record.extend({
        config: z.object({ model: text, audioModel: text, audioVoice: text, audioFormat: text, audioSpeed: text }),
        audio: result.extend({ url: text.optional() }).transform(portableMedia).optional(),
    }),
};
export type StoredGenerationRecord = z.infer<(typeof generationRecordSchemas)[keyof typeof generationRecordSchemas]>;

export function portableGenerationRecord(kind: "image" | "video" | "audio", value: unknown): StoredGenerationRecord {
    const parsed = generationRecordSchemas[kind].safeParse(value);
    if (!parsed.success) throw new StorageError("STORAGE_INVALID");
    const log = parsed.data;
    if (log.status === "pending") log.status = "interrupted";
    return log;
}

export function generationResources(kind: "image" | "video" | "audio", log: StoredGenerationRecord): ArchiveResource[] {
    const files: ArchiveResource[] = [];
    for (const ref of log.references) if (ref.storageKey) files.push({ collection: "images", key: ref.storageKey });
    if (kind === "image" && "images" in log) {
        for (const image of log.images) if (image.storageKey) files.push({ collection: "images", key: image.storageKey });
    } else if ("video" in log && log.video?.storageKey) files.push({ collection: "media", key: log.video.storageKey });
    else if ("audio" in log && log.audio?.storageKey) files.push({ collection: "media", key: log.audio.storageKey });
    return files;
}
