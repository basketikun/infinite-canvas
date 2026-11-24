import { z } from "zod";
import type { SyncTransport } from "@infinite-canvas/plugin-sdk";
import { archiveResourceId, archiveResourceSchema, type ArchiveResource } from "@infinite-canvas/shared/work-archive";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { blobSha256, sha256 } from "@infinite-canvas/shared/utils/sha256";
import { storage } from "./storage/runtime";

export const syncFileSchema = z.object({
    resource: archiveResourceSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().nonnegative(), mimeType: z.string(),
}).strict();
type SyncFile = z.infer<typeof syncFileSchema>;
export type FileSource = { resource: ArchiveResource; local: boolean; remote: boolean; canRestore: boolean; expectedSha256?: string };
type Transfer = { file: SyncFile; install?: Blob };

// 未标注类型的原件通过 HTTP 读回时使用通用二进制类型。
function sameFileType(blob: Blob, file: SyncFile) {
    return (blob.type || "application/octet-stream") === (file.mimeType || "application/octet-stream");
}

function collection(ref: ArchiveResource) {
    return ref.collection === "plugin-files" ? storage.pluginFiles(ref.owner) : storage[ref.collection];
}

// 保留原同步并发数。发生错误或取消后停止分派，并等待已开始的请求。
export async function syncBatch<T, R>(items: readonly T[], signal: AbortSignal, run: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    let next = 0, failed = false;
    const workers = Array.from({ length: Math.min(items.length, 3) }, async () => {
        try {
            while (!failed && next < items.length) {
                signal.throwIfAborted();
                const i = next++;
                results[i] = await run(items[i]);
            }
        } catch (error) { failed = true; throw error; }
    });
    const settled = await Promise.allSettled(workers);
    signal.throwIfAborted();
    for (const result of settled) if (result.status === "rejected") throw result.reason;
    return results;
}

export async function prepareSyncFiles(domain: string, sources: Map<string, FileSource>, remoteFiles: SyncFile[], transport: SyncTransport, signal: AbortSignal, progress: (count: number) => void) {
    const remote = new Map(remoteFiles.map((file) => [archiveResourceId(file.resource), file]));
    let done = 0;
    const transfers = await syncBatch([...sources], signal, async ([id, source]): Promise<Transfer> => {
        const { resource } = source;
        const previous = remote.get(id);
        const local = await collection(resource).getItem<Blob>(resource.key);
        signal.throwIfAborted();
        const localHash = local && await blobSha256(local);
        signal.throwIfAborted();
        if (source.remote && !previous) throw new StorageError("STORAGE_INVALID");
        if (source.remote && local && (localHash !== previous!.sha256 || !sameFileType(local, previous!))) throw new PluginError("PLUGIN_CONFLICT");
        if (source.local && !local && (!source.canRestore || !previous)) throw new StorageError("STORAGE_INVALID");
        const file: SyncFile = source.local && local ? { resource, bytes: local.size, sha256: localHash!, mimeType: local.type } : previous!;
        const address = await sha256(new TextEncoder().encode(id).buffer);
        const path = `${domain}/files/${address}/${file.sha256}`;
        signal.throwIfAborted();
        let install: Blob | undefined;
        const uploaded = file.sha256 !== previous?.sha256;
        if (uploaded) {
            await transport.write(path, local!, file.mimeType || "application/octet-stream", signal);
        } else {
            // 清单是声明，不是文件仍存在的凭证。即使已有本地副本也核实远端实物。
            const blob = await transport.read(path, signal);
            signal.throwIfAborted();
            if (!blob || blob.size !== previous!.bytes) throw new StorageError("STORAGE_INVALID");
            if (!local) install = blob.slice(0, blob.size, file.mimeType);
            if (await blobSha256(install ?? blob) !== file.sha256) throw new StorageError("STORAGE_INVALID");
        }
        signal.throwIfAborted();
        progress(++done);
        return { file, install };
    });
    return {
        files: transfers.map(({ file }) => file),
        async install() {
            await syncBatch(transfers.filter((item) => item.install), signal, async ({ file, install }) => {
                const ref = file.resource;
                const current = await collection(ref).getItem<Blob>(ref.key);
                if (!current) {
                    await collection(ref).setItem(ref.key, install!);
                    return;
                }
                // 原件不覆盖：同键已有内容时必须与同步内容一致。
                if (current.size !== file.bytes || !sameFileType(current, file) || await blobSha256(current) !== file.sha256) throw new PluginError("PLUGIN_CONFLICT");
            });
        },
    };
}
