import { archiveThreadSchema, chatImageKeys } from "./chat.js";
import { canvasDocumentSchema, pluginStandaloneWorkSchema, type CanvasNodeData } from "./canvas/schema/canvas.js";
import { canvasNodeMedia } from "./canvas/ops/archive-resources.js";
import { extensionIdSchema } from "./plugins.js";
import { StorageError } from "./storage-data.js";
import { pluginSyncSnapshotSchema, pluginSyncStoragePrefix } from "./sync-data.js";
import { assetResources, assetLibrarySchema, generationResources, portableGenerationRecord } from "./sync-records.js";
import { archiveResourceId, archiveResourceSchema, archiveResources, type ArchiveResource } from "./work-archive.js";

export type StorageReference = {
    kind: "project" | "work" | "chat" | "asset" | "image-record" | "video-record" | "audio-record" | "plugin-data";
    id: string;
    title?: string;
    owner?: string;
    domain?: string;
    projectId?: string;
};

export function projectMediaResources(doc: { readonly nodes: readonly CanvasNodeData[] }) {
    const candidates = canvasNodeMedia(doc.nodes);
    return [...new Map(candidates.map(resource => [archiveResourceId(resource), resource])).values()];
}

export function referenceCollections(resource: ArchiveResource): string[] {
    if (!archiveResourceSchema.safeParse(resource).success) throw new StorageError("STORAGE_INVALID");
    if (resource.collection === "plugin-files") return ["projects", "works", "plugin:" + resource.owner];
    if (resource.collection === "media") return ["projects", "library", "videoRecords", "audioRecords"];
    return ["projects", "chats", "library", "imageRecords", "videoRecords"];
}

/** 只列出当前持久记录声明的引用。空列表不能证明文件可删，损坏的相关记录必须报告读取失败。 */
export function collectStorageReferences(resource: ArchiveResource, collection: string, key: string, value: unknown): StorageReference[] {
    if (!referenceCollections(resource).includes(collection) || value === null) return [];
    const wanted = archiveResourceId(resource);
    const matches = (ref: ArchiveResource) => archiveResourceId(ref) === wanted;
    try {
        switch (collection) {
            case "projects": {
                const document = canvasDocumentSchema.parse(value);
                if (!key || key !== document.id) throw new StorageError("STORAGE_INVALID");
                return archiveResources({ kind: "canvas", document, threads: [] }).has(wanted)
                    ? [{ kind: "project", id: key, title: document.title }] : [];
            }
            case "works": {
                const work = pluginStandaloneWorkSchema.parse(value);
                if (key !== work.workId) throw new StorageError("STORAGE_INVALID");
                return archiveResources({ kind: "work", work }).has(wanted)
                    ? [{ kind: "work", id: key, owner: work.owner, title: work.title }] : [];
            }
            case "chats": {
                const thread = archiveThreadSchema.parse(value);
                if (key !== thread.id) throw new StorageError("STORAGE_INVALID");
                return chatImageKeys(thread).has(resource.key) ? [{ kind: "chat", id: key, projectId: thread.projectId, title: thread.title }] : [];
            }
            case "library": {
                if (key !== "state") return [];
                const { assets } = assetLibrarySchema.parse(value).state;
                if (new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new StorageError("STORAGE_INVALID");
                return assets.filter((asset) => assetResources(asset).some(matches)).map((asset) => ({ kind: "asset", id: asset.id, title: asset.title }));
            }
            case "imageRecords":
            case "videoRecords":
            case "audioRecords": {
                const kind = collection === "imageRecords" ? "image" : collection === "videoRecords" ? "video" : "audio";
                const record = portableGenerationRecord(kind, value);
                if (key !== record.id) throw new StorageError("STORAGE_INVALID");
                return generationResources(kind, record).some(matches) ? [{ kind: `${kind}-record`, id: key }] : [];
            }
            default: {
                if (resource.collection !== "plugin-files" || !key.startsWith(pluginSyncStoragePrefix)) return [];
                const domain = key.slice(pluginSyncStoragePrefix.length);
                if (!domain.startsWith(resource.owner + ":") || !extensionIdSchema.safeParse(domain).success) throw new StorageError("STORAGE_INVALID");
                const snapshot = pluginSyncSnapshotSchema.parse(value);
                return snapshot.records.filter((record) => record.files.some((file) => file.key === resource.key))
                    .map((record) => ({ kind: "plugin-data", id: record.id, owner: resource.owner, domain }));
            }
        }
    } catch {
        throw new StorageError("STORAGE_INVALID");
    }
}

/** 深度收集 JSON 值中的所有字符串，用于判断素材原件是否仍被任何记录引用。 */
export function collectStringValues(value: unknown, into = new Set<string>()) {
    if (typeof value === "string") into.add(value);
    else if (value !== null && typeof value === "object") for (const item of Object.values(value)) collectStringValues(item, into);
    return into;
}
