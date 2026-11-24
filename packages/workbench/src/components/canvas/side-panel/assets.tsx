import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@infinite-canvas/plugin-sdk/ui/popover";
import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { ListEmpty } from "@workbench/components/ui/list-empty";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { SidePanelSearch } from "./search";
import { Folder, Image as ImageIcon, Music2, Plus, Trash2, Video } from "lucide-react";
import type { PluginCanvasSideTab } from "@infinite-canvas/plugin-sdk";
import { canvasInsertAsset } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { assetKindLabels } from "@workbench/constant/labels";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { toCanvasAssetInput } from "@workbench/lib/asset-utils";
import { runPluginCallback } from "@workbench/lib/plugins/runtime";
import { saveMediaAsset } from "@workbench/services/asset-upload";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { useAssetStore, type Asset } from "@workbench/stores/use-asset-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { allAssetsFolderId, assetFolderId, assetFolderTreeCounts, defaultAssetFolder, folderChildren, folderPath } from "@workbench/lib/asset-folders";
import { defaultAssetFolderId } from "@infinite-canvas/shared/sync-records";

export function CanvasAssetsTab({ ctx, view }: ComponentProps<PluginCanvasSideTab["Content"]>) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const assets = useAssetStore((state) => state.assets);
    const folders = useAssetStore((state) => state.folders);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [folderId, setFolderId] = useState(allAssetsFolderId);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const query = keyword.trim().toLowerCase();
    const counts = useMemo(() => assetFolderTreeCounts(assets, folders), [assets, folders]);
    const breadcrumb = useMemo(() => folderId === allAssetsFolderId ? [] : folderPath(folders, folderId), [folderId, folders]);
    useEffect(() => {
        if (folderId !== allAssetsFolderId && folderId !== defaultAssetFolderId && !folders.some((folder) => folder.id === folderId)) setFolderId(allAssetsFolderId);
    }, [folderId, folders]);
    const currentFolders = useMemo(() => {
        const roots = folderId === allAssetsFolderId
            ? [defaultAssetFolder, ...folderChildren(folders, null)].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
            : folderChildren(folders, folderId);
        return query ? roots.filter((folder) => folder.name.toLowerCase().includes(query)) : roots;
    }, [folders, folderId, query]);
    const filtered = useMemo(() => {
        const source = folderId === allAssetsFolderId
            ? (query ? assets : [])
            : assets.filter((asset) => assetFolderId(asset, folders) === folderId);
        return source.filter((asset) => !query || asset.title.toLowerCase().includes(query));
    }, [assets, folders, folderId, query]);
    const openFolder = (id: string) => {
        setFolderId(id);
        setKeyword("");
    };
    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length || ctx.signal.aborted) return;
        setUploading(true);
        const notice = toast.loading("正在添加资产…", { className: "workbench-message", duration: Infinity });
        try {
            const added = await runPluginCallback(ctx, "builtin:assets", "upload", async () => {
                let count = 0;
                for (const file of files) {
                    ctx.signal.throwIfAborted();
                    const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
                    if (!kind) continue;
                    await saveMediaAsset(file, kind, { title: file.name || assetKindLabels[kind], folderId: folderId === allAssetsFolderId ? undefined : folderId }, ctx.signal);
                    count += 1;
                }
                return count;
            });
            if (ctx.signal.aborted) return;
            if (added) toast.success(`已添加 ${added} 个资产`, workbenchMessageOptions.success);
            else toast.warning("仅支持图片、视频或音频文件", workbenchMessageOptions.warning);
        } catch (error) {
            if (!ctx.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
        } finally {
            toast.dismiss(notice);
            if (!ctx.signal.aborted) {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = "";
            }
        }
    };
    const insertAsset = async (asset: Asset) => {
        if (ctx.signal.aborted) return;
        try { await ctx.commands.execute(canvasInsertAsset, { asset: toCanvasAssetInput(asset), position: view.getCenter() }, { scope: ctx.scope }); }
        catch (error) { if (!ctx.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
    };

    return <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 px-3 pb-2 pt-1">
            <SidePanelSearch placeholder="搜索资产" value={keyword} onChange={setKeyword} />
            <button type="button" disabled={uploading} onClick={() => { if (!ctx.signal.aborted) fileInputRef.current?.click(); }} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10" style={{ color: theme.node.text }}><Plus className="size-3.5" />添加</button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {folderId !== allAssetsFolderId ? <div className="flex flex-wrap items-center gap-1 px-1.5 pb-1 pt-0.5 text-[11px] opacity-70">
                <button type="button" className="transition hover:opacity-100" onClick={() => openFolder(allAssetsFolderId)}>全部资产</button>
                {breadcrumb.map((folder) => <span key={folder.id} className="flex min-w-0 items-center gap-1">
                    <span aria-hidden className="opacity-40">/</span>
                    <button type="button" aria-current={folder.id === folderId ? "page" : undefined} className="max-w-28 truncate transition hover:opacity-100" onClick={() => openFolder(folder.id)}>{folder.name}</button>
                </span>)}
            </div> : null}
            {currentFolders.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2 px-1 pb-2 pt-1">{currentFolders.map((folder) => <button key={folder.id} type="button" onClick={() => openFolder(folder.id)} className="relative flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}>
                <span className="absolute right-2 top-1.5 text-[11px] opacity-50">{counts.get(folder.id) ?? 0} 项</span><Folder className="size-5 opacity-60" /><span className="w-full truncate text-xs font-semibold">{folder.name}</span>
            </button>)}</div> : null}
            {filtered.length ? <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">{filtered.map((asset) => <AssetCard key={asset.id} asset={asset} onInsert={() => void insertAsset(asset)} onRemove={() => {
                if (ctx.signal.aborted) return;
                removeAsset(asset.id);
                toast.success("资产已移除", workbenchMessageOptions.success);
            }} />)}</div> : null}
            {!currentFolders.length && !filtered.length ? <ListEmpty text={query ? "没有找到资产" : folderId === allAssetsFolderId ? "暂无资产" : "这个文件夹没有资产"} className="pt-16" /> : null}
        </div>
    </div>;
}

function AssetCard({ asset, onInsert, onRemove }: { asset: Asset; onInsert: () => void; onRemove: () => void }) {
    const [confirming, setConfirming] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="group relative aspect-square overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
        <AssetCover asset={asset} />
        <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <button type="button" onClick={onInsert} className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80" aria-label="插入画布"><Plus className="size-4" /></button>
            <Popover open={confirming} onOpenChange={setConfirming}>
                <PopoverTrigger asChild>
                <button type="button" className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400" aria-label="移除资产"><Trash2 className="size-4" /></button>
                </PopoverTrigger>
                <PopoverContent side="top" role="alertdialog" aria-label="移除该资产？" data-canvas-shortcuts-ignore className="workbench-dialog generation-workspace-controls z-[1000] w-auto p-3" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}>
                    <p className="font-semibold">移除该资产？</p>
                    <div className="mt-2 flex justify-end gap-2">
                        <Button variant="outline" size="xs" onClick={() => setConfirming(false)}>取消</Button>
                        <Button variant="destructive" size="xs" onClick={() => { onRemove(); setConfirming(false); }}>移除</Button>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    </div>;
}

function AssetCover({ asset }: { asset: Asset }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [failed, setFailed] = useState<string>();
    const storageKey = asset.kind === "image" ? asset.data.storageKey : undefined;
    useEffect(() => { if (asset.kind === "image") void loadImagePreview(storageKey); }, [asset.kind, storageKey]);
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    const Icon = asset.kind === "video" ? Video : asset.kind === "audio" ? Music2 : ImageIcon;
    const preview = asset.coverUrl || previewUrlFor(storageKey);
    return preview && preview !== failed ? <img src={preview} alt="" onError={() => setFailed(preview)} className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" /> : <div className="grid size-full place-items-center"><Icon className="size-6 opacity-50" /></div>;
}
