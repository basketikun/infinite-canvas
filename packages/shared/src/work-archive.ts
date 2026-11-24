import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { archiveThreadSchema, chatImageKeys, formatChatImagePrompt, isChatImageFile, type ArchiveThread } from "./chat.js";
import { canvasDocumentSchema, pluginStandaloneWorkSchema } from "./canvas/schema/canvas.js";
import { mapCanvasResources, mapWorkResources } from "./canvas/ops/archive-resources.js";
import { applyOps } from "./canvas/ops/apply.js";
import { StorageError } from "./storage-data.js";

export type { ArchiveThread } from "./chat.js";

const id = z.string().min(1);
export const archiveResourceSchema = z.union([
    z.object({ collection: z.enum(["images", "media"]), key: id }).strict(),
    z.object({ collection: z.literal("plugin-files"), owner: id, key: id }).strict(),
]);
export type ArchiveResource = z.infer<typeof archiveResourceSchema>;
export type ArchiveFile = { resource: ArchiveResource; blob: Blob };

const canvas = z.object({ kind: z.literal("canvas"), document: canvasDocumentSchema, threads: z.array(archiveThreadSchema) }).strict();
const work = z.object({ kind: z.literal("work"), work: pluginStandaloneWorkSchema }).strict();
const targetSchema = z.discriminatedUnion("kind", [canvas, work]);
export type ArchiveTarget = z.infer<typeof targetSchema>;
export const archivePreferencesSchema = z.object({
    viewport: z.object({ x: z.number(), y: z.number(), k: z.number().positive() }).strict(),
    backgroundMode: z.enum(["dots", "lines", "blank"]), showImageInfo: z.boolean(),
}).strict();
export type ArchivePreferences = z.infer<typeof archivePreferencesSchema>;
const entrySchema = z.discriminatedUnion("kind", [canvas.extend({ preferences: archivePreferencesSchema, activeThreadId: id.nullable() }), work])
    .refine((entry) => entry.kind === "work" || entry.activeThreadId === null || entry.threads.some((thread) => thread.id === entry.activeThreadId));
export type ArchiveEntry = z.infer<typeof entrySchema>;
export type ArchiveInstall = { target: ArchiveTarget; files: ArchiveFile[] };
export type WorkArchive = { entries: ArchiveEntry[]; files: ArchiveFile[] };
const fileSchema = z.object({ resource: archiveResourceSchema, path: id, mime: z.string(), bytes: z.number().int().nonnegative() }).strict();
const manifest = z.object({ app: z.literal("infinite-canvas"), version: z.literal(4), entries: z.array(entrySchema).nonempty(), files: z.array(fileSchema) }).strict();
const installation = z.object({ target: targetSchema, files: z.array(fileSchema) }).strict();

export function archiveResourceId(resource: ArchiveResource) {
    return JSON.stringify(resource.collection === "plugin-files" ? [resource.collection, resource.owner, resource.key] : [resource.collection, resource.key]);
}

/** 聊天只重映射展示附件和模型用户消息的文件部分。用户原话、工具参数与模型回复逐字保留。 */
export function mapArchiveThread(thread: ArchiveThread, map: (resource: ArchiveResource) => string): ArchiveThread {
    const labels = new Map<string, string>();
    const keys = new Map([...chatImageKeys(thread)].map((key) => [key, map({ collection: "images", key })]));
    const items = thread.items.map((item) => {
        if (!item.images?.length) return item;
        const images = item.images.map((image) => ({ ...image, storageKey: keys.get(image.storageKey)! }));
        const source = JSON.stringify([item.images.map((image) => image.storageKey), formatChatImagePrompt(item.text, item.images)]);
        labels.set(source, formatChatImagePrompt(item.text, images));
        return { ...item, images };
    });
    function messages(list: ArchiveThread["messages"]) {
        return list.map((msg) => {
            if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;
            const attached = msg.content.flatMap((part) => isChatImageFile(part, keys) ? [part.data] : []);
            if (!attached.length) return msg;
            return { ...msg, content: msg.content.map((part, index) => {
                if (isChatImageFile(part, keys)) return { ...part, data: keys.get(part.data)! };
                if (index === 0 && part.type === "text" && typeof part.text === "string") {
                    const prompt = labels.get(JSON.stringify([attached, part.text]));
                    if (prompt !== undefined) return { ...part, text: prompt };
                }
                return part;
            }) };
        });
    }
    return { ...thread, items, messages: messages(thread.messages), ...(thread.contextMessages && { contextMessages: messages(thread.contextMessages) }) };
}

export function archiveResources(target: ArchiveTarget) {
    const refs = new Map<string, ArchiveResource>();
    const visit = (resource: ArchiveResource) => { refs.set(archiveResourceId(resource), resource); return resource.key; };
    if (target.kind === "work") mapWorkResources(target.work, visit);
    else {
        mapCanvasResources(target.document, visit);
        for (const thread of target.threads) {
            for (const key of chatImageKeys(thread)) visit({ collection: "images", key });
        }
    }
    return refs;
}

function assertFiles(targets: readonly ArchiveTarget[], files: ArchiveFile[]) {
    const wanted = new Set<string>();
    const ids = new Set<string>();
    for (const target of targets) {
        const key = JSON.stringify([target.kind, target.kind === "canvas" ? target.document.id : target.work.workId]);
        if (ids.has(key)) throw new StorageError("STORAGE_INVALID");
        ids.add(key);
        if (target.kind === "canvas") {
            const doc = target.document;
            if (!doc.id) throw new StorageError("STORAGE_INVALID");
            applyOps({ nodes: [], connections: [] }, [{ type: "replace_graph", graph: doc }]);
            if (target.threads.some((thread) => thread.projectId !== doc.id) || new Set(target.threads.map((thread) => thread.id)).size !== target.threads.length) throw new StorageError("STORAGE_INVALID");
        }
        for (const key of archiveResources(target).keys()) wanted.add(key);
    }
    if (files.length !== wanted.size) throw new StorageError("STORAGE_INVALID");
    for (const { resource, blob } of files) {
        if (!archiveResourceSchema.safeParse(resource).success || !(blob instanceof Blob) || !wanted.delete(archiveResourceId(resource))) throw new StorageError("STORAGE_INVALID");
    }
}

function validateArchiveData<T>(validate: () => T): T {
    try { return validate(); } catch { throw new StorageError("STORAGE_INVALID"); }
}

export function assertArchiveInstall(install: ArchiveInstall, preferences?: ArchivePreferences) {
    validateArchiveData(() => {
        if (!targetSchema.safeParse(install.target).success) throw new StorageError("STORAGE_INVALID");
        if (preferences !== undefined && (install.target.kind !== "canvas" || !archivePreferencesSchema.safeParse(preferences).success)) throw new StorageError("STORAGE_INVALID");
        assertFiles([install.target], install.files);
    });
}

function fileTable(files: ArchiveFile[]) {
    return files.map(({ resource, blob }, i) => ({ resource, path: `files/${i}`, mime: blob.type, bytes: blob.size }));
}

async function encode(name: string, metadata: unknown, files: ArchiveFile[]) {
    const entries: Record<string, Uint8Array> = { [name]: strToU8(JSON.stringify(metadata)) };
    for (const [i, file] of files.entries()) entries[`files/${i}`] = new Uint8Array(await file.blob.arrayBuffer());
    return new Blob([zipSync(entries, { level: 0 })], { type: "application/zip" });
}

function decode<T extends { files: z.infer<typeof fileSchema>[] }>(bytes: Uint8Array, name: string, schema: z.ZodType<T>) {
    const seen = new Set<string>();
    const zip = unzipSync(bytes, { filter: (file) => {
        if (seen.has(file.name)) throw new StorageError("STORAGE_INVALID");
        seen.add(file.name); return true;
    } });
    if (!zip[name]) throw new StorageError("STORAGE_INVALID");
    const data = JSON.parse(strFromU8(zip[name])) as T;
    if (!schema.safeParse(data).success || seen.size !== data.files.length + 1) throw new StorageError("STORAGE_INVALID");
    const files = data.files.map(({ resource, path, bytes, mime }, index) => {
        if (path !== `files/${index}` || zip[path]?.length !== bytes) throw new StorageError("STORAGE_INVALID");
        return { resource, blob: new Blob([zip[path]], { type: mime }) };
    });
    return { data, files };
}

export async function encodeWorkArchive(archive: WorkArchive) {
    const data = validateArchiveData(() => {
        const metadata = { app: "infinite-canvas", version: 4, entries: archive.entries, files: fileTable(archive.files) };
        if (!manifest.safeParse(metadata).success) throw new StorageError("STORAGE_INVALID");
        assertFiles(archive.entries, archive.files);
        return metadata;
    });
    return encode("works.json", data, archive.files);
}

export function decodeWorkArchive(bytes: Uint8Array): WorkArchive {
    return validateArchiveData(() => {
        const { data, files } = decode(bytes, "works.json", manifest);
        assertFiles(data.entries, files);
        return { entries: data.entries, files };
    });
}

export async function encodeArchiveInstall(install: ArchiveInstall, preferences?: ArchivePreferences) {
    assertArchiveInstall(install, preferences);
    return encode("install.json", { target: install.target, files: fileTable(install.files) }, install.files);
}

export function decodeArchiveInstall(bytes: Uint8Array): ArchiveInstall {
    return validateArchiveData(() => {
        const { data, files } = decode(bytes, "install.json", installation);
        const install = { target: data.target, files };
        assertArchiveInstall(install);
        return install;
    });
}
