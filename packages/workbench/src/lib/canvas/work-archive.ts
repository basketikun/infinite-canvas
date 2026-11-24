import type { PluginWorkInfo } from "@infinite-canvas/plugin-sdk";
import type { ReadonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";
import { mapCanvasResources, mapWorkResources } from "@infinite-canvas/shared/canvas/ops/archive-resources";
import type { CanvasDocument, PluginStandaloneWork } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { archiveResourceId, archiveResources, assertArchiveInstall, decodeWorkArchive, encodeWorkArchive, mapArchiveThread, type ArchiveEntry, type ArchiveInstall, type ArchivePreferences, type ArchiveResource, type WorkArchive } from "@infinite-canvas/shared/work-archive";
import { storage } from "@workbench/services/storage/runtime";
import { readProjectChats, receiveProjectChats } from "@workbench/stores/use-agent-chat-store";
import { useCanvasStore, type CanvasProject } from "@workbench/stores/canvas/use-canvas-store";
import { nanoid } from "nanoid";
import { cloneNodeForCopy } from "./node-copy";

type Prepared = { install: ArchiveInstall; preferences?: ArchivePreferences; activeThreadId?: string | null };

export class ArchivePublishError extends Error {
    constructor(done: number, total: number, cause: unknown) {
        super(`已保存 ${done}/${total} 部作品，其余作品未保存。重新导入会再生成已保存作品的副本，可先删除多余副本。`, { cause });
    }
}

function canvasSnapshot(project: ReadonlySnapshot<CanvasProject>) {
    const { schemaVersion, id, title, createdAt, updatedAt, nodes, connections, pluginDomains, viewport, backgroundMode, showImageInfo } = project as CanvasProject;
    const document: CanvasDocument = { schemaVersion, id, title, createdAt, updatedAt, nodes: nodes.map(cloneNodeForCopy), connections, ...(pluginDomains && { pluginDomains }) };
    const snapshot = mapCanvasResources(document, (resource) => resource.key);
    const preferences = structuredClone({ viewport, backgroundMode, showImageInfo });
    return { kind: "canvas" as const, document: snapshot, preferences };
}

async function collect(entries: ArchiveEntry[], signal: AbortSignal): Promise<WorkArchive> {
    signal.throwIfAborted();
    const snapshots: ArchiveEntry[] = [];
    const resources = new Map<string, ArchiveResource>();
    for (const entry of entries) {
        snapshots.push(entry);
        for (const [key, resource] of archiveResources(entry)) resources.set(key, resource);
    }
    const reads = await Promise.allSettled(Array.from(resources.values(), async (resource) => {
        signal.throwIfAborted();
        const table = resource.collection === "plugin-files" ? storage.pluginFiles(resource.owner) : storage[resource.collection];
        const blob = await table.getItem<Blob>(resource.key);
        if (!blob) throw new PluginError("PLUGIN_OPERATION_FAILED", { cause: new Error("ARCHIVE_FILE_MISSING") });
        return { resource, blob };
    }));
    signal.throwIfAborted();
    return { entries: snapshots, files: reads.map((item) => { if (item.status === "rejected") throw item.reason; return item.value; }) };
}

async function collectCanvases(projects: readonly ReadonlySnapshot<CanvasProject>[], signal: AbortSignal): Promise<WorkArchive> {
    signal.throwIfAborted();
    const results = await Promise.allSettled(projects.map(canvasSnapshot).map(async (entry) => {
        const { threads, activeThreadId } = await readProjectChats(entry.document.id);
        return { ...entry, threads: JSON.parse(JSON.stringify(threads)), activeThreadId };
    }));
    const entries = results.map((result) => { if (result.status === "rejected") throw result.reason; return result.value; });
    return collect(entries, signal);
}

export async function exportProjectArchive(projects: readonly ReadonlySnapshot<CanvasProject>[], signal: AbortSignal) {
    const zip = await encodeWorkArchive(await collectCanvases(projects, signal));
    signal.throwIfAborted();
    return zip;
}

export async function exportWorkArchive(works: PluginStandaloneWork[], signal: AbortSignal) {
    signal.throwIfAborted();
    const zip = await encodeWorkArchive(await collect(works.map((work) => ({ kind: "work", work: structuredClone(work) })), signal));
    signal.throwIfAborted();
    return zip;
}

async function prepare(archive: WorkArchive, operation: "import" | "copy", signal: AbortSignal, title?: string): Promise<Prepared[]> {
    const blobs = new Map(archive.files.map(({ resource, blob }) => [archiveResourceId(resource), blob]));
    const prepared: Prepared[] = [];
    for (const entry of archive.entries) {
        signal.throwIfAborted();
        const id = crypto.randomUUID();
        const files: ArchiveInstall["files"] = [];
        const targets = new Map<string, string>();
        for (const [identity, source] of archiveResources(entry)) {
            const blob = blobs.get(identity);
            if (!blob) throw new StorageError("STORAGE_INVALID");
            const key = source.collection === "plugin-files" ? crypto.randomUUID() : `${source.collection === "images" ? "image" : "file"}:${nanoid()}`;
            targets.set(identity, key);
            files.push({ resource: { ...source, key }, blob });
        }
        const remap = (resource: ArchiveResource) => targets.get(archiveResourceId(resource))!;
        let next: ArchiveEntry;
        if (entry.kind === "work") {
            next = { kind: "work", work: { ...mapWorkResources(entry.work, remap), workId: id, title: title ?? entry.work.title } };
        } else {
            const document = mapCanvasResources(entry.document, remap);
            const now = new Date().toISOString();
            const threadIds = new Map(entry.threads.map((thread) => [thread.id, crypto.randomUUID()]));
            next = { kind: "canvas", document: { ...document, id, title: title ?? document.title, createdAt: now, updatedAt: now, nodes: document.nodes.map(cloneNodeForCopy) },
                preferences: entry.preferences, activeThreadId: entry.activeThreadId && threadIds.get(entry.activeThreadId)!, threads: entry.threads.map((thread) => ({
                    ...mapArchiveThread(thread, remap), id: threadIds.get(thread.id)!, projectId: id,
                })) };
        }
        const transformed = next;
        if (transformed.kind === "work") prepared.push({ install: { target: transformed, files } });
        else {
            const { preferences, activeThreadId, ...target } = transformed;
            prepared.push({ install: { target, files }, preferences, activeThreadId });
        }
    }
    for (const { install, preferences } of prepared) assertArchiveInstall(install, preferences);
    return prepared;
}

async function publish(make: () => Promise<Prepared[]>, signal: AbortSignal): Promise<PluginWorkInfo[]> {
    signal.throwIfAborted();
    const prepared = await make();
    for (const [done, { install, preferences, activeThreadId }] of prepared.entries()) {
        signal.throwIfAborted();
        try {
            await storage.installArchive(install, preferences);
            if (install.target.kind === "canvas") {
                const id = install.target.document.id;
                await receiveProjectChats(id, activeThreadId ?? null);
                await useCanvasStore.getState().receiveProject(id);
            }
        } catch (error) {
            throw new ArchivePublishError(done, prepared.length, error);
        }
    }
    return prepared.map(({ install }) => install.target.kind === "canvas"
        ? { workId: install.target.document.id, title: install.target.document.title } : { workId: install.target.work.workId, title: install.target.work.title });
}

async function importArchive(file: Blob, author: { owner: string; packageName: string } | null, signal: AbortSignal) {
    signal.throwIfAborted();
    const bytes = await file.arrayBuffer();
    signal.throwIfAborted();
    return publish(async () => {
        const archive = decodeWorkArchive(new Uint8Array(bytes));
        if (archive.entries.some((entry) => author === null ? entry.kind !== "canvas" : entry.kind !== "work" || entry.work.owner !== author.owner || entry.work.packageName !== author.packageName)) throw new StorageError("STORAGE_INVALID");
        return prepare(archive, "import", signal);
    }, signal);
}

export async function importProjectArchive(file: Blob, signal: AbortSignal) {
    return (await importArchive(file, null, signal)).map((entry) => entry.workId);
}

export async function importWorkArchive(file: Blob, author: { owner: string; packageName: string }, signal: AbortSignal): Promise<PluginWorkInfo[]> {
    return importArchive(file, author, signal);
}

export async function copyCanvasProject(project: CanvasProject, title: string, signal: AbortSignal) {
    const items = await publish(async () => prepare(await collectCanvases([project as ReadonlySnapshot<CanvasProject>], signal), "copy", signal, title), signal);
    return items[0].workId;
}

export async function copyStandaloneWork(work: PluginStandaloneWork, title: string, signal: AbortSignal) {
    const items = await publish(async () =>
        prepare(await collect([{ kind: "work", work: structuredClone(work) }], signal), "copy", signal, title), signal);
    return items[0];
}
