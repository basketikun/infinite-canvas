import { defaultAssetFolderId, type StoredAssetFolder } from "@infinite-canvas/shared/sync-records";

export const allAssetsFolderId = "all";

export const defaultAssetFolder: StoredAssetFolder = {
    id: defaultAssetFolderId,
    name: "默认素材",
    parentId: null,
    createdAt: "",
    updatedAt: "",
};

export function assetFolderId(asset: { folderId?: string }, folders: readonly StoredAssetFolder[]) {
    const id = asset.folderId ?? defaultAssetFolderId;
    return id === defaultAssetFolderId || folders.some((folder) => folder.id === id) ? id : defaultAssetFolderId;
}

export function folderChildren(folders: readonly StoredAssetFolder[], parentId: string | null) {
    return folders.filter((folder) => folder.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

export function folderPath(folders: readonly StoredAssetFolder[], id: string) {
    const path: StoredAssetFolder[] = [];
    const seen = new Set<string>();
    let current = id === defaultAssetFolderId ? defaultAssetFolder : folders.find((folder) => folder.id === id);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        path.unshift(current);
        const parentId = current.parentId;
        current = parentId === null ? undefined
            : parentId === defaultAssetFolderId ? defaultAssetFolder
                : folders.find((folder) => folder.id === parentId);
    }
    return path;
}

export function folderDescendantIds(folders: readonly StoredAssetFolder[], id: string) {
    const descendants = new Set<string>();
    const queue = [id];
    while (queue.length) {
        const parentId = queue.shift()!;
        for (const folder of folders) {
            if (folder.parentId !== parentId || descendants.has(folder.id)) continue;
            descendants.add(folder.id);
            queue.push(folder.id);
        }
    }
    return descendants;
}

export function assetFolderCounts(assets: readonly { folderId?: string }[], folders: readonly StoredAssetFolder[]) {
    const counts = new Map<string, number>();
    for (const asset of assets) {
        const id = assetFolderId(asset, folders);
        counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
}

/** 文件夹卡片展示包含子文件夹在内的总项数。 */
export function assetFolderTreeCounts(assets: readonly { folderId?: string }[], folders: readonly StoredAssetFolder[]) {
    const direct = assetFolderCounts(assets, folders);
    const totals = new Map(direct);
    const parentOf = (id: string) => id === defaultAssetFolderId ? null : folders.find((folder) => folder.id === id)?.parentId ?? null;
    for (const [id, count] of direct) {
        if (id === defaultAssetFolderId) continue;
        let parent = parentOf(id);
        while (parent) {
            totals.set(parent, (totals.get(parent) ?? 0) + count);
            parent = parent === defaultAssetFolderId ? null : parentOf(parent);
        }
    }
    return totals;
}

export function folderLatestUpdatedAt(assets: readonly { folderId?: string; updatedAt: string }[], folders: readonly StoredAssetFolder[], folder: StoredAssetFolder) {
    const ids = new Set([folder.id, ...folderDescendantIds(folders, folder.id)]);
    let latest = Date.parse(folder.updatedAt);
    for (const asset of assets) {
        const time = Date.parse(asset.updatedAt);
        if (ids.has(assetFolderId(asset, folders)) && Number.isFinite(time)) latest = Math.max(latest, time);
    }
    return Number.isFinite(latest) ? latest : undefined;
}
