import { useEffect, useMemo, useState } from "react";
import { Alert, Empty, Input, Modal, Pagination, Tag } from "antd";
import { Folder, FolderOpen, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAssetCatalog } from "@/hooks/use-asset-catalog";
import { cn } from "@/lib/utils";
import { isEagleAsset, type EagleFolder } from "@/services/eagle-assets";
import type { Asset } from "@/stores/use-asset-store";
import type { AssetFolderSelection } from "@/components/asset-folder-tree";

export type InsertAssetPayload = { kind: "text"; content: string; title: string } | { kind: "image"; dataUrl: string; title: string; storageKey?: string } | { kind: "video"; url: string; title: string; storageKey?: string; width?: number; height?: number };

type Props = {
    open: boolean;
    defaultTab?: string;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, onInsert, onClose }: Props) {
    const { t } = useTranslation();
    const catalog = useAssetCatalog();
    return (
        <Modal title={t("canvas.assetPicker.title")} open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 16px 16px", minHeight: 480 } }}>
            <MyAssetsTab
                assets={catalog.assets}
                localAssets={catalog.localAssets}
                eagleAssets={catalog.eagleAssets}
                eagleFolders={catalog.eagleFolders}
                onInsert={onInsert}
                eagleLoading={catalog.eagleLoading}
                eagleError={catalog.eagleError}
                onRefreshEagle={catalog.refreshEagle}
            />
        </Modal>
    );
}

const PAGE_SIZE = 6;

const kindOptions = ["all", "text", "image", "video"];

function PickerCard({ title, kind, cover, onClick }: { title: string; kind: string; cover: string; onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onClick}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{t(`assets.kinds.${kind}`)}</Tag>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">{t("canvas.assetPicker.insert")}</div>
        </button>
    );
}

function MyAssetsTab({
    assets,
    localAssets,
    eagleAssets,
    eagleFolders,
    onInsert,
    eagleLoading,
    eagleError,
    onRefreshEagle,
}: {
    assets: Asset[];
    localAssets: Asset[];
    eagleAssets: Asset[];
    eagleFolders: EagleFolder[];
    onInsert: (payload: InsertAssetPayload) => void;
    eagleLoading: boolean;
    eagleError: string | null;
    onRefreshEagle: () => void;
}) {
    const { t } = useTranslation();
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [folderSelection, setFolderSelection] = useState<AssetFolderSelection>("all");
    const [page, setPage] = useState(1);

    const currentFolderLabel = useMemo(() => {
        if (folderSelection === "all") return t("assets.folders.all");
        if (folderSelection === "local") return t("assets.folders.local");
        if (folderSelection === "eagle") return t("assets.folders.eagle");
        if (folderSelection === "eagle:uncategorized") return t("assets.folders.uncategorized");
        return eagleFolders.find((folder) => folder.id === folderSelection.slice("eagle:".length))?.name || t("assets.folders.eagle");
    }, [eagleFolders, folderSelection, t]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video")
            .filter((a) => assetBelongsToFolder(a, folderSelection))
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, a.source || "", a.note || "", ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter, folderSelection]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title });
        } else {
            onInsert(asset.kind === "video" ? { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height } : { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title });
        }
    };

    return (
        <div className="grid min-w-0 grid-cols-[154px_minmax(0,1fr)] gap-4">
            <PickerFolderTree
                folders={eagleFolders}
                assets={eagleAssets}
                localAssetCount={localAssets.length}
                totalAssetCount={assets.length}
                selection={folderSelection}
                onSelect={(selection) => {
                    setPage(1);
                    setFolderSelection(selection);
                }}
            />

            <div className="min-w-0 space-y-3">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{currentFolderLabel}</div>
                        <div className="text-[11px] text-stone-400 dark:text-stone-500">{filtered.length} {t("assets.title")}</div>
                    </div>
                    {eagleLoading && folderSelection !== "local" ? <span className="shrink-0 text-[11px] text-stone-400">{t("assets.eagleLoading")}</span> : null}
                </div>

                <Input
                    className="w-full"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder={t("canvas.assetPicker.search")}
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />

                <div className="flex flex-wrap gap-1">
                    {kindOptions.map((option) => (
                        <Tag.CheckableTag
                            key={option}
                            checked={kindFilter === option}
                            className={cn("m-0 rounded-md px-2 py-0.5 text-xs", kindFilter === option && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(option);
                            }}
                        >
                            {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                        </Tag.CheckableTag>
                    ))}
                </div>

                {eagleError ? <Alert className="py-1.5" type="warning" showIcon message={t("assets.eagleUnavailable")} action={<button type="button" className="text-xs underline" onClick={onRefreshEagle}>{t("assets.retryEagle")}</button>} /> : null}

                {visible.length ? (
                    <div className="grid grid-cols-3 gap-2.5">
                        {visible.map((asset) => (
                            <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => handleInsert(asset)} />
                        ))}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.assetPicker.empty")} className="py-12" />
                )}

                {filtered.length > PAGE_SIZE && (
                    <div className="flex justify-center">
                        <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                    </div>
                )}
            </div>
        </div>
    );
}

function eagleFolderIds(asset: Asset) {
    const folderIds = asset.metadata?.eagleFolderIds;
    return Array.isArray(folderIds) ? folderIds.filter((id): id is string => typeof id === "string") : [];
}

function assetBelongsToFolder(asset: Asset, selection: AssetFolderSelection) {
    if (selection === "all") return true;
    if (selection === "local") return !isEagleAsset(asset);
    if (selection === "eagle") return isEagleAsset(asset);
    if (!isEagleAsset(asset)) return false;
    if (selection === "eagle:uncategorized") return eagleFolderIds(asset).length === 0;
    return eagleFolderIds(asset).includes(selection.slice("eagle:".length));
}

function PickerFolderTree({ folders, assets, localAssetCount, totalAssetCount, selection, onSelect }: { folders: EagleFolder[]; assets: Asset[]; localAssetCount: number; totalAssetCount: number; selection: AssetFolderSelection; onSelect: (selection: AssetFolderSelection) => void }) {
    const { t } = useTranslation();
    const counts = new Map<string, number>();
    let uncategorizedCount = 0;
    assets.forEach((asset) => {
        const ids = eagleFolderIds(asset);
        if (!ids.length) uncategorizedCount += 1;
        ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });

    return (
        <aside className="min-h-0 border-r border-stone-200 pr-3 dark:border-stone-800">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-stone-800 dark:text-stone-200">
                <FolderOpen className="size-3.5 text-sky-500" />
                {t("assets.folders.title")}
            </div>
            <div className="max-h-[430px] space-y-0.5 overflow-y-auto pr-1">
                <PickerFolderButton active={selection === "all"} label={t("assets.folders.all")} count={totalAssetCount} onClick={() => onSelect("all")} />
                <PickerFolderButton active={selection === "local"} label={t("assets.folders.local")} count={localAssetCount} onClick={() => onSelect("local")} />
                <div className="mt-2 border-t border-stone-100 pt-2 dark:border-stone-800">
                    <PickerFolderButton active={selection === "eagle"} label={t("assets.folders.eagle")} count={assets.length} onClick={() => onSelect("eagle")} />
                    <div className="ml-2 border-l border-stone-200 pl-1.5 dark:border-stone-700">
                        <PickerFolderButton active={selection === "eagle:uncategorized"} label={t("assets.folders.uncategorized")} count={uncategorizedCount} onClick={() => onSelect("eagle:uncategorized")} />
                        <PickerFolderNodes folders={folders} counts={counts} parentId="" selection={selection} onSelect={onSelect} />
                    </div>
                </div>
            </div>
        </aside>
    );
}

function PickerFolderButton({ active, label, count, depth = 0, onClick }: { active: boolean; label: string; count?: number; depth?: number; onClick: () => void }) {
    return (
        <button
            type="button"
            className={cn(
                "group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs transition",
                active ? "bg-stone-100 font-medium text-stone-950 shadow-[inset_2px_0_0_#1c1917] dark:bg-stone-800 dark:text-stone-50 dark:shadow-[inset_2px_0_0_#f5f5f4]" : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-900",
            )}
            style={{ paddingLeft: `${6 + depth * 10}px` }}
            onClick={onClick}
        >
            {active ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500" />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {typeof count === "number" ? <span className="shrink-0 text-[10px] text-stone-400 dark:text-stone-500">{count}</span> : null}
        </button>
    );
}

function PickerFolderNodes({ folders, counts, parentId, selection, onSelect, depth = 0 }: { folders: EagleFolder[]; counts: Map<string, number>; parentId: string; selection: AssetFolderSelection; onSelect: (selection: AssetFolderSelection) => void; depth?: number }) {
    return (
        <div>
            {folders
                .filter((folder) => (folder.parent || "") === parentId)
                .map((folder) => {
                    const id = `eagle:${folder.id}` as AssetFolderSelection;
                    return (
                        <div key={folder.id}>
                            <PickerFolderButton active={selection === id} label={folder.name} count={counts.get(folder.id) || 0} depth={depth} onClick={() => onSelect(id)} />
                            <PickerFolderNodes folders={folders} counts={counts} parentId={folder.id} selection={selection} onSelect={onSelect} depth={depth + 1} />
                        </div>
                    );
                })}
        </div>
    );
}
