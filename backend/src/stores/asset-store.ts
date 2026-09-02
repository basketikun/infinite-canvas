import type { BackendDatabase, Asset, AssetFolder } from "../db.js";
import type { AssetStore, AssetFilter } from "./types.js";

/** 资产 store：素材库 + 文件夹树。 */
export function createAssetStore(db: BackendDatabase): AssetStore {
    return {
        list: (filter?: AssetFilter) => db.listAssets(filter ?? {}),
        get: (id) => db.getAsset(id),
        upsert: (asset) => db.upsertAsset(asset),
        replaceAll: (assets, folders) => db.replaceAssets(assets, folders),
        delete: (id) => db.deleteAsset(id),
        folders: () => db.listAssetFolders(),
        upsertFolder: (folder) => {
            db.upsertAssetFolder(folder);
            return folder;
        },
        deleteFolder: (id) => db.deleteAssetFolder(id),
    };
}
