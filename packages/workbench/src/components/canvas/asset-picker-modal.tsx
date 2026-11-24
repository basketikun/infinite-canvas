import { assetKindLabels } from "@workbench/constant/labels";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChevronRight, Folder, Music2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { CanvasDialog } from "./canvas-dialog";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { ListPagination } from "@workbench/components/ui/list-pagination";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";

import type { CanvasAssetInput } from "@infinite-canvas/plugin-sdk";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { cn } from "@infinite-canvas/plugin-sdk/ui/utils";
import { getImagePreviewRevision, loadImagePreview, subscribeImagePreviews } from "@workbench/services/image-storage";
import { assetCoverUrl, useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { toCanvasAssetInput } from "@workbench/lib/asset-utils";
import { allAssetsFolderId, assetFolderId, assetFolderTreeCounts, defaultAssetFolder, folderChildren, folderPath } from "@workbench/lib/asset-folders";

type Props = {
    open: boolean;
    parentSignal?: AbortSignal;
    onInsert: (payload: CanvasAssetInput, signal: AbortSignal) => Promise<void | boolean>;
    onClose: () => void;
};

type PickAsset = (asset: Asset) => Promise<void>;

export function AssetPickerModal({ open, parentSignal, onInsert, onClose }: Props) {
    const current = useRef<AbortController | null>(null);
    const pending = useRef<AbortController | null>(null);
    const [view, setView] = useState<{ parentSignal?: AbortSignal; controller: AbortController } | null>(null);
    useLayoutEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        const close = () => controller.abort();
        current.current = controller;
        parentSignal?.addEventListener("abort", close, { once: true });
        if (parentSignal?.aborted) close();
        setView({ parentSignal, controller });
        return () => {
            close();
            parentSignal?.removeEventListener("abort", close);
            if (current.current === controller) current.current = null;
        };
    }, [open, parentSignal]);
    const insert: PickAsset = async (asset) => {
        if (!open || !view || view.parentSignal !== parentSignal || view.controller.signal.aborted) return;
        const { controller } = view;
        pending.current?.abort();
        const choice = new AbortController();
        pending.current = choice;
        const signal = AbortSignal.any([controller.signal, choice.signal]);
        try {
            const accepted = await onInsert(toCanvasAssetInput(asset), signal);
            if (accepted === false || signal.aborted || current.current !== controller) return;
            controller.abort();
            onClose();
        } catch (error) {
            if (!signal.aborted && !(error instanceof PluginError && (error.code === "PLUGIN_INACTIVE" || error.code === "PLUGIN_SCOPE_CLOSED"))) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
        } finally {
            if (pending.current === choice) pending.current = null;
        }
    };
    return (
        <CanvasDialog title="选择资产" open={open} width={860} top onClose={() => { current.current?.abort(); onClose(); }}>
            <div className="min-h-[min(480px,60dvh)]"><MyAssetsTab onInsert={insert} /></div>
        </CanvasDialog>
    );
}

const PAGE_SIZE = 8;

const kindOptions = ["all", "text", "image", "video", "audio"];

function PickerCard({ asset, onPick }: { asset: Asset; onPick: PickAsset }) {
    const [failed, setFailed] = useState<string>();
    const { title, kind } = asset;
    const cover = assetCoverUrl(asset);
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={() => void onPick(asset)}
        >
            {cover && cover !== failed ? (
                <img src={cover} alt={title} onError={() => setFailed(cover)} className="aspect-[4/3] w-full object-cover" />
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{kind === "audio" ? <Music2 aria-hidden className="size-6" /> : title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-[10px]">{assetKindLabels[kind]}</span>
                </div>
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: PickAsset }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    useEffect(() => { for (const asset of assets) if (asset.kind === "image") void loadImagePreview(asset.data.storageKey); }, [assets]);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [folder, setFolder] = useState<string>(allAssetsFolderId);
    const [page, setPage] = useState(1);

    const valid = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const counts = useMemo(() => assetFolderTreeCounts(valid, folders), [valid, folders]);
    const breadcrumb = useMemo(() => folder === allAssetsFolderId ? [] : folderPath(folders, folder), [folder, folders]);
    const visibleFolders = useMemo(() => {
        if (kindFilter !== "all") return [];
        const roots = folder === allAssetsFolderId
            ? [defaultAssetFolder, ...folderChildren(folders, null)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            : folderChildren(folders, folder);
        const query = keyword.trim().toLowerCase();
        return query ? roots.filter((item) => item.name.toLowerCase().includes(query)) : roots;
    }, [folders, folder, keyword, kindFilter]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const rootOnly = folder === allAssetsFolderId && !query && kindFilter === "all";
        const source = folder === allAssetsFolderId ? valid : valid.filter((asset) => assetFolderId(asset, folders) === folder);
        return (rootOnly ? [] : source)
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => !query || asset.title.toLowerCase().includes(query));
    }, [valid, folders, folder, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((value) => Math.min(value, maxPage));
    }, [filtered.length]);

    const openFolder = (id: string) => {
        setFolder(id);
        setKeyword("");
        setPage(1);
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <label className="relative flex w-56 max-w-full items-center">
                    <Search aria-hidden className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
                    <Input aria-label="搜索资产" className="h-7 pl-7 pr-7 text-sm" placeholder="搜索资产" value={keyword} onChange={(event) => { setPage(1); setKeyword(event.target.value); }} />
                    {keyword && <button type="button" aria-label="清除搜索" className="absolute right-1.5 p-0.5 text-muted-foreground" onClick={(event) => { setPage(1); setKeyword(""); event.currentTarget.parentElement?.querySelector("input")?.focus(); }}><X className="size-3.5" /></button>}
                </label>
                <div className="flex gap-1.5">
                    {kindOptions.map((option) => (
                        <button type="button" key={option} aria-pressed={kindFilter === option} className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                            onClick={() => { setPage(1); setKindFilter(option); }}>
                            {option === "all" ? "全部" : assetKindLabels[option]}
                        </button>
                    ))}
                </div>
            </div>

            {folder !== allAssetsFolderId ? <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <button type="button" className="cursor-pointer hover:text-foreground" onClick={() => { setFolder(allAssetsFolderId); setKeyword(""); setPage(1); }}>全部资产</button>
                {breadcrumb.map((item) => <span key={item.id} className="flex min-w-0 items-center gap-1">
                    <span aria-hidden>/</span>
                    <button type="button" aria-current={item.id === folder ? "page" : undefined} className="max-w-40 cursor-pointer truncate hover:text-foreground" onClick={() => openFolder(item.id)}>{item.name}</button>
                </span>)}
            </div> : null}

            {visibleFolders.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleFolders.map((item) => <button type="button" key={item.id} className="flex min-h-[132px] min-w-0 flex-col justify-between rounded-xl border border-border bg-card p-3.5 text-left transition hover:border-foreground/30 hover:bg-muted/40" onClick={() => openFolder(item.id)}>
                    <span className="flex min-w-0 items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium">{item.name}</span>
                        <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    </span>
                    <Folder aria-hidden className="my-2 size-9 self-center text-muted-foreground" strokeWidth={1.4} />
                    <span className="text-xs text-muted-foreground">{counts.get(item.id) ?? 0} 项</span>
                </button>)}
            </div> : null}

            {visible.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {visible.map((asset) => <PickerCard key={asset.id} asset={asset} onPick={onInsert} />)}
            </div> : null}

            {!visibleFolders.length && !visible.length ? <ListEmpty text={keyword.trim() ? "没有找到资产" : "这个文件夹没有资产"} className="py-10" /> : null}

            {filtered.length > PAGE_SIZE && <div className="flex justify-center">
                <ListPagination current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
            </div>}
        </div>
    );
}
