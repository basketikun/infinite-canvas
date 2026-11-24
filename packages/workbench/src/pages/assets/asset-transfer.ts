import { saveAs } from "file-saver";
import { strFromU8, unzipSync } from "fflate";
import { nanoid } from "nanoid";
import { z } from "zod";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { archiveResourceId } from "@infinite-canvas/shared/work-archive";
import { serializeAsset } from "@workbench/lib/asset-utils";
import { assetFolderSchema, assetResources, assetSchema, defaultAssetFolderId } from "@infinite-canvas/shared/sync-records";
import { createZip } from "@workbench/lib/zip";
import { readImageBlob, saveImageBlob } from "@workbench/services/image-storage";
import { readMediaBlob, uploadMediaFile } from "@workbench/services/file-storage";
import { appendImportedAssets, flushAssetWrites, useAssetStore, type Asset, type AssetFolder } from "@workbench/stores/use-asset-store";

const manifestSchema = z.object({
    app: z.literal("infinite-canvas"), version: z.literal(2), exportedAt: z.string(),
    assets: z.array(assetSchema),
    folders: z.array(assetFolderSchema).optional(),
    files: z.array(z.object({
        collection: z.enum(["images", "media"]), storageKey: z.string().min(1), path: z.string(), mimeType: z.string(), bytes: z.number().int().nonnegative(),
    }).strict()),
}).strict();

function collectAssetResources(assets: Asset[]) {
    const refs = new Map<string, { collection: "images" | "media"; key: string; mimeType: string }>();
    for (const asset of assets) {
        if (asset.kind === "text") continue;
        for (const ref of assetResources(asset)) {
            const id = archiveResourceId(ref);
            if (!refs.has(id)) refs.set(id, { ...ref, mimeType: asset.data.mimeType });
        }
    }
    return refs;
}

export async function exportAssets(assets: Asset[], filename: string, signal?: AbortSignal, folders: AssetFolder[] = []) {
    signal?.throwIfAborted();
    const snapshot = structuredClone(assets.map(serializeAsset));
    const reads = await Promise.allSettled(Array.from(collectAssetResources(snapshot).values(), async (ref, index) => {
        const blob = ref.collection === "images" ? await readImageBlob(ref.key, undefined, { signal }) : await readMediaBlob(ref.key, undefined, { signal });
        return { file: { collection: ref.collection, storageKey: ref.key, path: `files/${index}`, mimeType: blob.type || ref.mimeType, bytes: blob.size }, blob };
    }));
    signal?.throwIfAborted();
    const files = reads.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
    });
    const data = { app: "infinite-canvas", version: 2, exportedAt: new Date().toISOString(), assets: snapshot, folders: structuredClone(folders), files: files.map(({ file }) => file) };
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify(data, null, 2) }, ...files.map(({ file, blob }) => ({ name: file.path, data: blob }))]);
    signal?.throwIfAborted();
    saveAs(zip, filename);
}

function decodeAssetPackage(bytes: Uint8Array) {
    const paths = new Set<string>();
    const zip = unzipSync(bytes, { filter: (file) => {
        if (paths.has(file.name)) throw new StorageError("STORAGE_INVALID");
        paths.add(file.name);
        return true;
    } });
    if (!zip["assets.json"]) throw new StorageError("STORAGE_INVALID");
    const data: z.infer<typeof manifestSchema> = JSON.parse(strFromU8(zip["assets.json"]));
    if (!manifestSchema.safeParse(data).success || paths.size !== data.files.length + 1) throw new StorageError("STORAGE_INVALID");
    const required = collectAssetResources(data.assets);
    const folders = data.folders ?? [];
    const folderIds = new Set(folders.map((folder) => folder.id));
    if (folderIds.size !== folders.length || folders.some((folder) => folder.id === defaultAssetFolderId ||
        folder.parentId !== null && folder.parentId !== defaultAssetFolderId && !folderIds.has(folder.parentId))) throw new StorageError("STORAGE_INVALID");
    const files = data.files.map(({ collection, storageKey, path, bytes, mimeType }, index) => {
        const id = archiveResourceId({ collection, key: storageKey });
        if (!required.delete(id) || path !== `files/${index}` || zip[path]?.length !== bytes) throw new StorageError("STORAGE_INVALID");
        return { id, collection, blob: new Blob([zip[path]], { type: mimeType }) };
    });
    if (required.size) throw new StorageError("STORAGE_INVALID");
    return { assets: data.assets, folders, files };
}

export async function importAssetPackage(file: File, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let data: ReturnType<typeof decodeAssetPackage>;
    try { data = decodeAssetPackage(bytes); }
    catch { throw new StorageError("STORAGE_INVALID"); }
    if (!useAssetStore.getState().hydrated) throw new StorageError("STORAGE_UNAVAILABLE");
    const keys = new Map<string, string>();
    for (const { id, collection, blob } of data.files) {
        signal?.throwIfAborted();
        keys.set(id, collection === "images" ? await saveImageBlob(blob) : (await uploadMediaFile(blob, "file", signal)).storageKey);
    }
    signal?.throwIfAborted();
    const now = new Date().toISOString();
    const folderIds = new Map(data.folders.map((folder) => [folder.id, nanoid()]));
    const folders: AssetFolder[] = data.folders.map((folder) => ({
        ...folder,
        id: folderIds.get(folder.id)!,
        parentId: folder.parentId === null || folder.parentId === defaultAssetFolderId ? folder.parentId : folderIds.get(folder.parentId) ?? null,
        createdAt: now,
        updatedAt: now,
    }));
    const assets = data.assets.map((asset) => {
        const [ref] = assetResources(asset);
        const result = serializeAsset(asset);
        if (ref && result.kind !== "text") result.data = { ...result.data, storageKey: keys.get(archiveResourceId(ref))! };
        const folderId = asset.folderId === undefined ? undefined
            : asset.folderId === defaultAssetFolderId ? defaultAssetFolderId
                : folderIds.get(asset.folderId) ?? defaultAssetFolderId;
        return { ...result, ...(folderId && { folderId }), id: nanoid(), createdAt: now, updatedAt: now };
    });
    await appendImportedAssets(assets.reverse(), folders);
    await flushAssetWrites();
    return assets.length;
}
