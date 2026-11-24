import { assetKindLabels } from "@workbench/constant/labels";
import { Check, Copy, Download, Folder, FolderPlus, ListChecks, LoaderCircle, MoreHorizontal, MoveRight, PencilLine, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import { saveAs } from "file-saver";
import { Dialog, DropdownMenu } from "radix-ui";
import { Button as AssetButton } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@infinite-canvas/plugin-sdk/ui/select";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { AssetEditor } from "./asset-editor";
import { AssetDialog } from "./asset-dialog";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";

import { useCopyText } from "@workbench/hooks/use-copy-text";
import { MediaPlayer } from "@workbench/components/media-player";
import { readMediaBlob } from "@workbench/services/file-storage";
import { formatBytes } from "@workbench/lib/image-utils";
import { getImagePreviewRevision, loadImagePreview, readImageBlob, subscribeImagePreviews } from "@workbench/services/image-storage";
import { assetCoverUrl, flushAssetWrites, useAssetStore, type Asset, type AssetFolder, type AssetKind } from "@workbench/stores/use-asset-store";
import { exportAssets, importAssetPackage } from "./asset-transfer";
import { StorageError } from "@infinite-canvas/shared/storage-data";
import { saveMediaAsset } from "@workbench/services/asset-upload";
import { defaultAssetFolderId } from "@infinite-canvas/shared/sync-records";
import { AssetFolderMoveDialog, AssetFolderNameDialog, type AssetMoveTarget } from "./asset-folder-dialogs";
import { allAssetsFolderId, assetFolderId, assetFolderTreeCounts, defaultAssetFolder, folderChildren, folderLatestUpdatedAt, folderPath } from "@workbench/lib/asset-folders";

const kindFilterLabels: Record<AssetKind | "all" | "folder", string> = { all: "全部类型", folder: "文件夹", text: "文本", image: "图片", video: "视频", audio: "音频" };
const sortLabels = { newest: "最新添加", oldest: "最早上传", name: "名称排序" } as const;
const assetPageSize = 10;
type AssetSort = keyof typeof sortLabels;
type AssetMenuTarget =
    | { kind: "blank" }
    | { kind: "folder"; folder: AssetFolder }
    | { kind: "asset"; asset: Asset };
type AssetContextMenu = { x: number; y: number } & AssetMenuTarget;
type ContextMenuItem = { label: string; run: () => void; danger?: boolean } | { separator: true };

export default function AssetsPage() {
    const deleteDescription = useId();
    const copyText = useCopyText();
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const addFolder = useAssetStore((state) => state.addFolder);
    const updateFolder = useAssetStore((state) => state.updateFolder);
    const removeFolder = useAssetStore((state) => state.removeFolder);
    const downloads = useRef<AbortController | null>(null);
    useLayoutEffect(() => {
        const controller = new AbortController();
        downloads.current = controller;
        return () => { controller.abort(); if (downloads.current === controller) downloads.current = null; };
    }, []);
    useEffect(() => { for (const asset of assets) if (asset.kind === "image") void loadImagePreview(asset.data.storageKey); }, [assets]);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all" | "folder">("all");
    const [sort, setSort] = useState<AssetSort>("newest");
    const [currentFolder, setCurrentFolder] = useState<string>(allAssetsFolderId);
    const [visibleCount, setVisibleCount] = useState(assetPageSize);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [editor, setEditor] = useState<{ asset: Asset; trigger: HTMLElement | null } | null>(null);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [folderDialog, setFolderDialog] = useState<{ mode: "create"; parentId: string | null } | { mode: "rename"; folder: AssetFolder } | null>(null);
    const [moving, setMoving] = useState<AssetMoveTarget | null>(null);
    const [deletingFolder, setDeletingFolder] = useState<AssetFolder | null>(null);
    const [deletion, setDeletion] = useState<{ asset: Asset; accepted: boolean } | null>(null);
    const [batchDeletion, setBatchDeletion] = useState(false);
    const [savingDeletion, setSavingDeletion] = useState(false);
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [uploading, setUploading] = useState(false);
    const [contextMenu, setContextMenu] = useState<AssetContextMenu | null>(null);
    useLayoutEffect(() => {
        if (previewAsset && !assets.includes(previewAsset)) setPreviewAsset(assets.find((asset) => asset.id === previewAsset.id) ?? null);
    }, [assets, previewAsset]);

    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video" || asset.kind === "audio"), [assets]);
    const folderCounts = useMemo(() => assetFolderTreeCounts(validAssets, folders), [validAssets, folders]);
    const breadcrumb = useMemo(() => currentFolder === allAssetsFolderId ? [] : folderPath(folders, currentFolder), [folders, currentFolder]);

    useEffect(() => {
        if (currentFolder !== allAssetsFolderId && !breadcrumb.length) setCurrentFolder(allAssetsFolderId);
    }, [breadcrumb.length, currentFolder]);

    const visibleFolders = useMemo(() => {
        if (currentFolder !== allAssetsFolderId && kindFilter !== "all" && kindFilter !== "folder") return [];
        const roots = currentFolder === allAssetsFolderId
            ? [defaultAssetFolder, ...folderChildren(folders, null)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            : folderChildren(folders, currentFolder);
        const query = keyword.trim().toLowerCase();
        return query ? roots.filter((folder) => folder.name.toLowerCase().includes(query)) : roots;
    }, [folders, currentFolder, keyword, kindFilter]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const folderOnly = kindFilter === "folder";
        const source = currentFolder === allAssetsFolderId
            ? (query ? validAssets : [])
            : validAssets.filter((asset) => assetFolderId(asset, folders) === currentFolder);
        return (folderOnly ? [] : source)
            .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
            .filter((asset) => !query || assetSearchText(asset).includes(query))
            .sort((a, b) => sort === "name" ? a.title.localeCompare(b.title, "zh-CN")
                : sort === "oldest" ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
                    : Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }, [validAssets, folders, currentFolder, keyword, kindFilter, sort]);

    const visibleAssets = useMemo(() => filteredAssets.slice(0, visibleCount), [filteredAssets, visibleCount]);
    const hasMoreAssets = visibleCount < filteredAssets.length;

    useEffect(() => {
        const target = loadMoreRef.current;
        if (!target || !hasMoreAssets) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => count + assetPageSize);
        }, { rootMargin: "240px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [hasMoreAssets, visibleCount]);

    const selectedAssets = useMemo(() => assets.filter((asset) => selected.has(asset.id)), [assets, selected]);

    const openContextMenu = (event: ReactMouseEvent, target: AssetMenuTarget) => {
        event.preventDefault();
        event.stopPropagation();
        if (target.kind === "folder" && target.folder.id === defaultAssetFolderId) return;
        setContextMenu({
            ...target,
            x: Math.max(8, Math.min(event.clientX, window.innerWidth - 200)),
            y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)),
        });
    };

    const openForm = (asset: Asset) => setEditor({
        asset,
        trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });

    const selectFolder = (id: string) => {
        setCurrentFolder(id);
        setVisibleCount(assetPageSize);
        setSelecting(false);
        setSelected(new Set());
    };

    const toggleSelected = (id: string) => setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const stopSelecting = () => {
        setSelecting(false);
        setSelected(new Set());
    };

    const allFilteredSelected = filteredAssets.length > 0 && filteredAssets.every((asset) => selected.has(asset.id));
    const toggleSelectAll = () => setSelected((previous) => {
        const next = new Set(previous);
        if (allFilteredSelected) for (const asset of filteredAssets) next.delete(asset.id);
        else for (const asset of filteredAssets) next.add(asset.id);
        return next;
    });

    const submitFolderName = (name: string) => {
        if (!folderDialog) return;
        try {
            if (folderDialog.mode === "create") addFolder(name, folderDialog.parentId);
            else updateFolder(folderDialog.folder.id, { name });
            setFolderDialog(null);
        } catch (error) {
            toast.error(folderErrorMessage(error), workbenchMessageOptions.error);
        }
    };

    const moveInto = (parentId: string | null) => {
        if (!moving) return;
        try {
            if (moving.kind === "asset") updateAsset(moving.asset.id, { folderId: parentId ?? defaultAssetFolderId });
            else if (moving.kind === "assets") for (const asset of moving.assets) updateAsset(asset.id, { folderId: parentId ?? defaultAssetFolderId });
            else updateFolder(moving.folder.id, { parentId });
            toast.success("已移动", workbenchMessageOptions.success);
            setMoving(null);
        } catch (error) {
            toast.error(folderErrorMessage(error), workbenchMessageOptions.error);
        }
    };

    const deleteFolder = () => {
        if (!deletingFolder) return;
        try {
            removeFolder(deletingFolder.id);
            if (currentFolder === deletingFolder.id) setCurrentFolder(allAssetsFolderId);
            toast.success("文件夹已删除", workbenchMessageOptions.success);
            setDeletingFolder(null);
        } catch (error) {
            toast.error(folderErrorMessage(error), workbenchMessageOptions.error);
            setDeletingFolder(null);
        }
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, "文本已复制");
    };

    const downloadAsset = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio") return;
        const pageSignal = downloads.current?.signal;
        if (!pageSignal || pageSignal.aborted || !useAssetStore.getState().assets.includes(asset)) return;
        const controller = new AbortController();
        const signal = AbortSignal.any([pageSignal, controller.signal]);
        const unsubscribe = useAssetStore.subscribe((state) => { if (!state.assets.includes(asset)) controller.abort(); });
        try {
            const blob = asset.kind === "image" ? await readImageBlob(asset.data.storageKey, asset.data.dataUrl, { signal }) : await readMediaBlob(asset.data.storageKey, asset.data.url, { signal });
            signal.throwIfAborted();
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch (error) {
            if (signal.aborted) return;
            console.error("[assets] download", error);
            toast.error("下载失败，请稍后重试", workbenchMessageOptions.error);
        } finally {
            unsubscribe();
        }
    };

    const uploadAssets = async (fileList: FileList | null) => {
        const files = Array.from(fileList ?? []);
        const signal = downloads.current?.signal;
        if (!files.length || !signal || signal.aborted) return;
        if (files.length === 1 && (files[0].type === "application/zip" || files[0].name.toLowerCase().endsWith(".zip"))) {
            setUploading(true);
            try { await importAssetZip(files[0]); }
            finally { if (!signal.aborted) setUploading(false); }
            return;
        }
        setUploading(true);
        const folderId = currentFolder === allAssetsFolderId ? defaultAssetFolderId : currentFolder;
        let count = 0;
        try {
            for (const file of files) {
                const kind = file.type.startsWith("image/") ? "image" as const : file.type.startsWith("video/") ? "video" as const : file.type.startsWith("audio/") ? "audio" as const : null;
                if (!kind) continue;
                await saveMediaAsset(file, kind, { title: file.name, source: "导入", folderId }, signal);
                count += 1;
            }
            if (signal.aborted) return;
            if (count) toast.success(`已导入 ${count} 个资产`, workbenchMessageOptions.success);
            else toast.warning("仅支持图片、视频或音频文件", workbenchMessageOptions.warning);
        } catch (error) {
            if (!signal.aborted) toast.error("资产未能保存，请重试。", workbenchMessageOptions.error);
        } finally {
            if (!signal.aborted) setUploading(false);
            if (uploadInputRef.current) uploadInputRef.current.value = "";
        }
    };

    const exportSelectedAssets = async () => {
        if (!selectedAssets.length) {
            toast.warning("请先选择资产", workbenchMessageOptions.warning);
            return;
        }
        const signal = downloads.current?.signal;
        if (!signal || signal.aborted) return;
        try { await exportAssets(selectedAssets, "我的资产.zip", signal, folders); }
        catch (error) {
            if (!signal.aborted) { console.error("[assets] export", error); toast.error("资产未能完整导出，请检查原文件后重试。", workbenchMessageOptions.error); }
        }
    };

    const importAssetZip = async (file?: File) => {
        const signal = downloads.current?.signal;
        if (!file || !signal || signal.aborted) return;
        try {
            const count = await importAssetPackage(file, signal);
            if (!signal.aborted) toast.success(`已导入 ${count} 个资产`, workbenchMessageOptions.success);
        } catch (error) {
            if (signal.aborted) return;
            const invalid = error instanceof StorageError && error.code === "STORAGE_INVALID";
            toast.error(invalid ? "导入失败，请选择有效的资产压缩包" : "资产未能保存，请重新选择同一份压缩包重试。", workbenchMessageOptions.error);
        } finally {
            if (uploadInputRef.current) uploadInputRef.current.value = "";
        }
    };

    const confirmDelete = async () => {
        const signal = downloads.current?.signal;
        if (!deletion || savingDeletion || !signal || signal.aborted) return;
        const { asset } = deletion;
        setSavingDeletion(true);
        try {
            if (!deletion.accepted) {
                const store = useAssetStore.getState();
                if (!store.assets.includes(asset)) {
                    toast.error("资产已发生变化，请重新确认。", workbenchMessageOptions.error);
                    setDeletion(null);
                    return;
                }
                store.removeAsset(asset.id);
                deletion.accepted = true;
            }
            await flushAssetWrites();
            if (signal.aborted) return;
            if (useAssetStore.getState().assets.some((item) => item.id === asset.id)) toast.error("资产已发生变化，请重新确认。", workbenchMessageOptions.error);
            else toast.success("资产已删除", workbenchMessageOptions.success);
            setDeletion(null);
        } catch (error) {
            if (signal.aborted) return;
            console.error("[assets] delete", error);
            toast.error("删除结果尚未保存，请重试。", workbenchMessageOptions.error);
        } finally { if (!signal.aborted) setSavingDeletion(false); }
    };

    const confirmBatchDelete = async () => {
        const signal = downloads.current?.signal;
        if (!signal || signal.aborted || savingDeletion) return;
        setSavingDeletion(true);
        try {
            const store = useAssetStore.getState();
            for (const asset of selectedAssets) if (store.assets.some((item) => item.id === asset.id)) store.removeAsset(asset.id);
            await flushAssetWrites();
            if (signal.aborted) return;
            toast.success(`已删除 ${selectedAssets.length} 个资产`, workbenchMessageOptions.success);
            setBatchDeletion(false);
            stopSelecting();
        } catch (error) {
            if (!signal.aborted) {
                console.error("[assets] batch delete", error);
                toast.error("删除结果尚未保存，请重试。", workbenchMessageOptions.error);
            }
        } finally { if (!signal.aborted) setSavingDeletion(false); }
    };

    const assetMenuItems = (asset: Asset): ContextMenuItem[] => [
        { label: "查看", run: () => setPreviewAsset(asset) },
        { label: "编辑", run: () => openForm(asset) },
        { label: "移动到…", run: () => setMoving({ kind: "asset", asset }) },
        asset.kind === "text"
            ? { label: "复制文本", run: () => void copyAssetText(asset) }
            : { label: "下载", run: () => void downloadAsset(asset) },
        { separator: true },
        { label: "删除", run: () => setDeletion({ asset, accepted: false }), danger: true },
    ];

    const contextMenuItems = (menu: AssetContextMenu): ContextMenuItem[] => {
        if (menu.kind === "blank") return [
            { label: "新建文件夹", run: () => setFolderDialog({ mode: "create", parentId: currentFolder === allAssetsFolderId ? null : currentFolder }) },
            { label: "导入资产", run: () => uploadInputRef.current?.click() },
        ];
        if (menu.kind === "folder") return [
            { label: "重命名", run: () => setFolderDialog({ mode: "rename", folder: menu.folder }) },
            { label: "移动到…", run: () => setMoving({ kind: "folder", folder: menu.folder }) },
            { separator: true },
            { label: "删除文件夹", run: () => setDeletingFolder(menu.folder), danger: true },
        ];
        return assetMenuItems(menu.asset);
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] px-6 py-6 [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]"
                onContextMenu={(event) => {
                    if (event.target instanceof Element && event.target.closest("header, [data-asset-card], [data-folder-card]")) return;
                    openContextMenu(event, { kind: "blank" });
                }}>
                <div className="mx-auto w-full max-w-[1600px]">
                    <header className="asset-toolbar">
                        <h1 className="asset-toolbar-title">我的资产</h1>

                        <label className="asset-toolbar-search">
                            <Search aria-hidden className="size-4 shrink-0 text-(--asset-secondary)" />
                            <Input value={keyword} placeholder="搜索资产名" aria-label="搜索资产名" onChange={(event) => { setKeyword(event.target.value); setVisibleCount(assetPageSize); }} />
                            {keyword && <button type="button" aria-label="清空搜索" className="asset-clear" onClick={() => { setKeyword(""); setVisibleCount(assetPageSize); }}><X aria-hidden className="size-3.5" /></button>}
                        </label>

                        <Select value={kindFilter} onValueChange={(value) => { setKindFilter(value as AssetKind | "all" | "folder"); setVisibleCount(assetPageSize); }}>
                            <SelectTrigger className="asset-toolbar-select" aria-label="资产类型"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {(["all", "folder", "text", "image", "video", "audio"] as const).map((option) => <SelectItem key={option} value={option}>{kindFilterLabels[option]}</SelectItem>)}
                            </SelectContent>
                        </Select>

                        <Select value={sort} onValueChange={(value) => { setSort(value as AssetSort); setVisibleCount(assetPageSize); }}>
                            <SelectTrigger className="asset-toolbar-select" aria-label="排序方式"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {(Object.keys(sortLabels) as AssetSort[]).map((option) => <SelectItem key={option} value={option}>{sortLabels[option]}</SelectItem>)}
                            </SelectContent>
                        </Select>

                        <div className="asset-toolbar-actions">
                            <AssetButton type="button" variant="outline" className="asset-toolbar-button" aria-pressed={selecting} onClick={() => selecting ? stopSelecting() : setSelecting(true)}>
                                <ListChecks aria-hidden className="size-4" />批量选择
                            </AssetButton>
                            <AssetButton type="button" variant="outline" className="asset-toolbar-button" onClick={() => setFolderDialog({ mode: "create", parentId: currentFolder === allAssetsFolderId ? null : currentFolder })}>
                                <FolderPlus aria-hidden className="size-4" />新建文件夹
                            </AssetButton>
                            <AssetButton type="button" className="asset-toolbar-button asset-toolbar-primary" aria-busy={uploading} disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
                                {uploading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Upload aria-hidden className="size-4" />}导入资产
                            </AssetButton>
                        </div>
                    </header>

                    {breadcrumb.length ? <div className="asset-breadcrumb-bar">
                        <button type="button" className="asset-breadcrumb" onClick={() => selectFolder(allAssetsFolderId)}>我的资产</button>
                        {breadcrumb.map((folder) => <span key={folder.id} className="flex min-w-0 items-center gap-1.5">
                            <span aria-hidden className="text-(--asset-secondary)">/</span>
                            <button type="button" aria-current={folder.id === currentFolder ? "page" : undefined} className="asset-breadcrumb max-w-[220px] truncate" onClick={() => selectFolder(folder.id)}>{folder.name}</button>
                        </span>)}
                    </div> : null}

                    {selecting ? <div className="asset-batch-bar">
                        <span className="text-sm">已选 {selected.size} 项</span>
                        <AssetButton type="button" variant="outline" size="sm" disabled={!selected.size} onClick={() => setMoving({ kind: "assets", assets: selectedAssets })}><MoveRight className="size-3.5" />移动到…</AssetButton>
                        <AssetButton type="button" variant="outline" size="sm" className="asset-delete" disabled={!selected.size} onClick={() => setBatchDeletion(true)}><Trash2 className="size-3.5" />删除</AssetButton>
                        <AssetButton type="button" variant="outline" size="sm" disabled={!filteredAssets.length} onClick={toggleSelectAll}>{allFilteredSelected ? "取消全选" : "全选"}</AssetButton>
                        <AssetButton type="button" variant="outline" size="sm" disabled={!selected.size} onClick={() => void exportSelectedAssets()}><Download className="size-3.5" />导出资产</AssetButton>
                        <button type="button" className="asset-breadcrumb ml-auto" onClick={stopSelecting}>取消</button>
                    </div> : null}

                    <div className="mt-6 flex flex-col gap-5">
                        {visibleFolders.length ? <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                            {visibleFolders.map((folder) => <FolderCard key={folder.id} folder={folder} count={folderCounts.get(folder.id) ?? 0}
                                age={folderAge(validAssets, folders, folder)}
                                onOpen={() => selectFolder(folder.id)}
                                onContextMenu={(event) => openContextMenu(event, { kind: "folder", folder })} />)}
                        </div> : null}

                        {visibleAssets.length ? <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                            {visibleAssets.map((asset) => (
                                <AssetCard key={asset.id} asset={asset} selecting={selecting} selected={selected.has(asset.id)}
                                    onSelect={() => toggleSelected(asset.id)}
                                    onOpen={() => setPreviewAsset(asset)} menuItems={assetMenuItems(asset)}
                                    onContextMenu={(event) => openContextMenu(event, { kind: "asset", asset })} />
                            ))}
                        </div> : null}

                        {!visibleFolders.length && !visibleAssets.length && <ListEmpty className="py-24" text={keyword.trim() ? "没有找到资产" : kindFilter === "folder" ? "没有找到文件夹" : currentFolder === allAssetsFolderId ? "还没有资产，上传文件或新建文件夹开始整理" : "这个文件夹还没有资产"} />}

                        {(visibleFolders.length || filteredAssets.length) ? <p className="text-center text-[13px] text-stone-500 dark:text-stone-400">
                            {hasMoreAssets ? `共 ${filteredAssets.length + visibleFolders.length} 项` : `已显示全部 ${filteredAssets.length + visibleFolders.length} 项`}
                        </p> : null}

                        {hasMoreAssets ? <div ref={loadMoreRef} aria-hidden className="h-8" /> : null}
                    </div>
                </div>
            </main>

            {contextMenu && <AssetContextMenuView menu={contextMenu} items={contextMenuItems(contextMenu)} onClose={() => setContextMenu(null)} />}

            {editor && <AssetEditor asset={editor.asset} trigger={editor.trigger} onClosed={() => setEditor((current) => current === editor ? null : current)} />}

            <AssetDetailDialog asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadAsset} />

            <AssetFolderNameDialog open={Boolean(folderDialog)} title={folderDialog?.mode === "rename" ? "重命名文件夹" : "新建文件夹"}
                initialName={folderDialog?.mode === "rename" ? folderDialog.folder.name : ""}
                onClose={() => setFolderDialog(null)} onSubmit={submitFolderName} />

            <AssetFolderMoveDialog open={Boolean(moving)} folders={folders} target={moving} onClose={() => setMoving(null)} onMove={moveInto} />

            <AssetDialog title="删除文件夹" open={Boolean(deletingFolder)} width={520} descriptionId={`${deleteDescription}-folder`}
                onDismiss={() => setDeletingFolder(null)}
                action={<AssetButton type="button" variant="destructive" aria-label="删除文件夹" onClick={deleteFolder}>删 除</AssetButton>}>
                <p id={`${deleteDescription}-folder`}>{deletingFolder && `确定删除「${deletingFolder.name}」吗？文件夹里还有文件或子文件夹时不能删除。`}</p>
            </AssetDialog>

            <input ref={uploadInputRef} type="file" accept="image/*,video/*,audio/*,application/zip,.zip" multiple className="hidden" onChange={(event) => void uploadAssets(event.target.files)} />

            <AssetDialog title="删除资产" open={Boolean(deletion)} width={520} descriptionId={deleteDescription}
                onDismiss={() => { if (!savingDeletion) setDeletion(null); }}
                action={<AssetButton type="button" variant="destructive" aria-label="删除" aria-busy={savingDeletion} onClick={() => void confirmDelete()}>{savingDeletion && <LoaderCircle aria-hidden className="size-4 animate-spin" />}删 除</AssetButton>}>
                <p id={deleteDescription}>{deletion && `确定删除「${deletion.asset.title}」吗？删除后会从我的资产中移除。`}</p>
            </AssetDialog>

            <AssetDialog title="删除选中资产" open={batchDeletion} width={520} descriptionId={`${deleteDescription}-batch`}
                onDismiss={() => { if (!savingDeletion) setBatchDeletion(false); }}
                action={<AssetButton type="button" variant="destructive" aria-label="删除选中资产" aria-busy={savingDeletion} onClick={() => void confirmBatchDelete()}>{savingDeletion && <LoaderCircle aria-hidden className="size-4 animate-spin" />}删 除</AssetButton>}>
                <p id={`${deleteDescription}-batch`}>确定删除选中的 {selectedAssets.length} 个资产吗？删除后会从我的资产中移除。</p>
            </AssetDialog>
        </div>
    );
}

function FolderCard({ folder, count, age, onOpen, onContextMenu }: {
    folder: AssetFolder;
    count: number;
    age?: string;
    onOpen: () => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
    return <article className="asset-folder-card" data-folder-card onContextMenu={onContextMenu}>
        <button type="button" className="asset-folder-title truncate" onClick={onOpen}>{folder.name}</button>
        <button type="button" className="asset-folder-card-icon" aria-label={`打开 ${folder.name}`} onClick={onOpen}><Folder aria-hidden strokeWidth={1.2} /></button>
        <div className="flex flex-wrap gap-2">
            <span className="asset-tag">文件夹</span>
            <span className="asset-tag">{count} 项{count && age ? ` · ${age}` : ""}</span>
        </div>
    </article>;
}

function AssetCard({ asset, selecting, selected, onSelect, onOpen, menuItems, onContextMenu }: {
    asset: Asset;
    selecting: boolean;
    selected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    menuItems: ContextMenuItem[];
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [failedCover, setFailedCover] = useState<string>();
    const cover = assetCoverUrl(asset);
    const activate = selecting ? onSelect : onOpen;
    const badge = selecting ? <button type="button" className={`asset-select-badge${selected ? " is-selected" : ""}`} aria-label={selected ? "取消选择" : "选择资产"} aria-pressed={selected}
        onClick={(event) => { event.stopPropagation(); onSelect(); }}>{selected && <Check aria-hidden className="size-3.5" />}</button> : null;
    const menu = selecting ? null : <div className="asset-card-more-wrap">
        <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
                <button type="button" className="asset-card-more" aria-label={`${asset.title} 操作`}><MoreHorizontal aria-hidden className="size-4" /></button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
                <DropdownMenu.Content align="end" sideOffset={4} className="asset-folder-menu">
                    {menuItems.map((item, index) => "separator" in item
                        ? <DropdownMenu.Separator key={`separator-${index}`} className="asset-folder-menu-separator" />
                        : <DropdownMenu.Item key={item.label} className={`asset-folder-menu-item${item.danger ? " asset-folder-menu-danger" : ""}`} onSelect={() => item.run()}>{item.label}</DropdownMenu.Item>)}
                </DropdownMenu.Content>
            </DropdownMenu.Portal>
        </DropdownMenu.Root>
    </div>;
    return (
        <article className={`asset-card relative overflow-hidden${selected ? " is-selected" : ""}`} data-asset-card onContextMenu={onContextMenu}>
            {badge}{menu}
            <button type="button" aria-label={asset.title} aria-pressed={selecting ? selected : undefined} className="asset-card-cover block cursor-pointer text-left" onClick={activate}>
                {asset.kind === "text" ? (
                    <div className="flex aspect-[4/3] items-start overflow-hidden p-4 text-left text-sm leading-6 text-stone-700 dark:text-stone-300"><span className="line-clamp-6 whitespace-pre-wrap">{asset.data.content}</span></div>
                ) : cover && cover !== failedCover ? (
                    <img src={cover} alt={asset.title} onError={() => setFailedCover(cover)} className="aspect-[4/3] w-full object-cover" />
                ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm leading-6 text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                        {asset.kind === "audio" ? "音频文件" : "暂无封面"}
                    </div>
                )}
            </button>
            <button type="button" className="block w-full text-left" onClick={activate}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                    <h2 className="line-clamp-1 min-w-0 flex-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{asset.title}</h2>
                    <span className="asset-tag shrink-0">{assetKindLabels[asset.kind]}</span>
                </div>
            </button>
        </article>
    );
}

function AssetDetailDialog({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const [originalUrl, setOriginalUrl] = useState<string>();
    const [originalError, setOriginalError] = useState(false);
    useEffect(() => {
        if (!asset || asset.kind !== "image") {
            setOriginalUrl(undefined);
            setOriginalError(false);
            return;
        }
        const controller = new AbortController();
        let active = true, url: string | undefined;
        setOriginalUrl(undefined);
        setOriginalError(false);
        readImageBlob(asset.data.storageKey, asset.data.dataUrl, { signal: controller.signal }).then((blob) => {
            if (!active) return;
            url = URL.createObjectURL(blob);
            setOriginalUrl(url);
        }).catch((error) => {
            if (active && !controller.signal.aborted) {
                console.error("[assets] read original", error);
                setOriginalError(true);
            }
        });
        return () => {
            active = false;
            controller.abort();
            if (url) URL.revokeObjectURL(url);
        };
    }, [asset]);
    const meta = !asset ? "" : asset.kind === "text"
        ? `${asset.data.content.length} 字`
        : asset.kind === "audio"
            ? `${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`
            : `${asset.data.width} × ${asset.data.height} · ${formatBytes(asset.data.bytes)} · ${asset.data.mimeType}`;
    return <Dialog.Root open={Boolean(asset)} onOpenChange={(open) => { if (!open) onClose(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-[1000] bg-black/45" />
            <Dialog.Content aria-describedby={undefined}
                className="asset-detail workbench-dialog fixed top-1/2 left-1/2 z-[1000] w-[calc(100%-24px)] max-w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-(--workbench-elevated-panel) p-5 text-(--workbench-elevated-text) outline-none">
                <Dialog.Close aria-label="关闭" className="absolute right-3 top-3 grid size-8 place-items-center rounded text-current/50 hover:bg-muted hover:text-current"><X aria-hidden className="size-5" /></Dialog.Close>
                {asset ? <div className="flex h-[min(520px,68vh)] flex-col gap-3">
                    <Dialog.Title className="shrink-0 pr-8 text-base font-semibold">{asset.title}</Dialog.Title>
                    <div className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800 ${asset.kind === "text" ? "bg-background" : "bg-stone-950"}`}>
                        {asset.kind === "image" ? (
                            originalUrl ? <img src={originalUrl} alt={asset.title} className="mx-auto block max-h-full max-w-full object-contain" />
                                : originalError ? <div className="grid min-h-48 place-items-center text-sm text-stone-400">暂时无法读取原图</div>
                                    : <div className="grid min-h-48 place-items-center text-sm text-stone-400">正在读取原图…</div>
                        ) : asset.kind === "video" ? (
                            <MediaPlayer key={asset.id} source={{ kind: "video", storageKey: asset.data.storageKey, url: asset.data.url }} className="max-h-full w-full" />
                        ) : asset.kind === "audio" ? (
                            <MediaPlayer key={asset.id} source={{ kind: "audio", storageKey: asset.data.storageKey, url: asset.data.url }} className="w-full p-3" />
                        ) : (
                            <div className="h-full w-full overflow-y-auto whitespace-pre-wrap p-4 text-sm leading-6">{asset.data.content}</div>
                        )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="asset-tag">{assetKindLabels[asset.kind]}</span>
                        <span className="text-xs text-(--asset-secondary)">{meta}</span>
                        {asset.kind === "text" ? <AssetButton type="button" size="sm" variant="outline" onClick={() => onCopy(asset)}><Copy className="size-4" />复制文本</AssetButton> : null}
                        {asset.kind !== "text" ? <AssetButton type="button" size="sm" variant="outline" onClick={() => onDownload(asset)}><Download className="size-4" />下载</AssetButton> : null}
                    </div>
                </div> : null}
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}

function folderAge(assets: Asset[], folders: AssetFolder[], folder: AssetFolder) {
    const latest = folderLatestUpdatedAt(assets, folders, folder);
    if (latest === undefined) return undefined;
    const days = Math.max(0, Math.floor((Date.now() - latest) / 86_400_000));
    return days === 0 ? "今天" : `${days} 天`;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}

function folderErrorMessage(error: unknown) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ASSET_FOLDER_NOT_EMPTY") return "文件夹里还有文件或子文件夹，请先移走后再删除。";
    if (code === "ASSET_FOLDER_NAME_REQUIRED") return "请输入文件夹名称。";
    if (code === "ASSET_FOLDER_CYCLE") return "不能把文件夹移动到它自己或它的子文件夹里。";
    if (code === "ASSET_FOLDER_MISSING") return "目标文件夹已不存在，请刷新后重试。";
    if (code === "ASSET_FOLDER_DEFAULT") return "默认素材文件夹不能删除。";
    return "文件夹操作失败，请重试。";
}

function AssetContextMenuView({ menu, items, onClose }: { menu: AssetContextMenu; items: ContextMenuItem[]; onClose: () => void }) {
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = () => onClose();
        const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("pointerdown", close);
        window.addEventListener("blur", close);
        window.addEventListener("keydown", keydown);
        window.addEventListener("scroll", close, true);
        menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
        return () => {
            window.removeEventListener("pointerdown", close);
            window.removeEventListener("blur", close);
            window.removeEventListener("keydown", keydown);
            window.removeEventListener("scroll", close, true);
        };
    }, [onClose]);
    return <div ref={menuRef} role="menu" className="asset-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>
        {items.map((item, index) => "separator" in item
            ? <div key={`separator-${index}`} role="separator" className="asset-context-menu-separator" />
            : <button key={item.label} type="button" role="menuitem" className={item.danger ? "asset-context-menu-danger" : undefined} onClick={() => { onClose(); item.run(); }}>{item.label}</button>)}
    </div>;
}
