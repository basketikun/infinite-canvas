import { Button } from "@infinite-canvas/plugin-sdk/ui/button";
import { Input } from "@infinite-canvas/plugin-sdk/ui/input";
import { Folder, FolderInput } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { defaultAssetFolderId } from "@infinite-canvas/shared/sync-records";
import type { Asset, AssetFolder } from "@workbench/stores/use-asset-store";
import { AssetDialog } from "./asset-dialog";
import { assetFolderId, defaultAssetFolder, folderChildren, folderDescendantIds, folderPath } from "@workbench/lib/asset-folders";

export function AssetFolderNameDialog({ open, title, initialName, onClose, onSubmit }: {
    open: boolean;
    title: string;
    initialName: string;
    onClose: () => void;
    onSubmit: (name: string) => void;
}) {
    const id = useId();
    const [name, setName] = useState(initialName);
    const [error, setError] = useState("");
    useEffect(() => {
        if (open) {
            setName(initialName);
            setError("");
        }
    }, [open, initialName]);
    const submit = () => {
        if (!name.trim()) {
            setError("请输入文件夹名称");
            return;
        }
        onSubmit(name.trim());
    };
    return <AssetDialog open={open} title={title} width={460} descriptionId={id} onDismiss={onClose} action={<Button type="button" onClick={submit}>确 定</Button>}>
        <label htmlFor={`${id}-name`} className="mb-1 block text-sm">文件夹名称</label>
        <Input id={`${id}-name`} value={name} autoFocus aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => { setName(event.target.value); if (error) setError(""); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
        {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </AssetDialog>;
}

export type AssetMoveTarget = { kind: "asset"; asset: Asset } | { kind: "folder"; folder: AssetFolder } | { kind: "assets"; assets: Asset[] };

export function AssetFolderMoveDialog({ open, folders, target, onClose, onMove }: {
    open: boolean;
    folders: AssetFolder[];
    target: AssetMoveTarget | null;
    onClose: () => void;
    onMove: (parentId: string | null) => void;
}) {
    const id = useId();
    const [selected, setSelected] = useState<string | null>(null);
    const [browsing, setBrowsing] = useState<string | null>(null);
    useEffect(() => {
        if (!open || !target) return;
        setBrowsing(null);
        setSelected(target.kind === "folder" ? target.folder.parentId
            : target.kind === "asset" ? assetFolderId(target.asset, folders)
                : target.assets[0] ? assetFolderId(target.assets[0], folders) : defaultAssetFolderId);
    }, [open, target]);
    if (!target) return null;
    const movingFolder = target.kind === "folder" ? target.folder : null;
    const blocked = movingFolder ? new Set([movingFolder.id, ...folderDescendantIds(folders, movingFolder.id)]) : new Set<string>();
    const path = browsing ? folderPath(folders, browsing) : [];
    const visible = (browsing ? folderChildren(folders, browsing) : [defaultAssetFolder, ...folderChildren(folders, null)])
        .filter((folder) => !blocked.has(folder.id));
    const enter = (folderId: string) => {
        setBrowsing(folderId);
        setSelected(folderId);
    };
    const enterSelected = () => { if (selected) enter(selected); };
    const goUp = () => {
        if (!browsing) return;
        const parentId = browsing === defaultAssetFolderId ? null : folders.find((folder) => folder.id === browsing)?.parentId ?? null;
        setBrowsing(parentId);
        if (!parentId) { if (movingFolder) setSelected(null); }
        else setSelected(parentId);
    };
    return <AssetDialog open={open} title={movingFolder ? "移动文件夹" : "移动到文件夹"} width={820} descriptionId={id} onDismiss={onClose}
        leadingAction={<>
            <Button type="button" variant="outline" size="sm" disabled={!selected} onClick={enterSelected}>进入</Button>
            <Button type="button" variant="outline" size="sm" disabled={!browsing} onClick={goUp}>上一级</Button>
        </>}
        action={<Button type="button" disabled={!movingFolder && selected === null} onClick={() => onMove(selected)}>移 动</Button>}>
        <p id={id} className="mb-3 text-sm text-(--asset-secondary)">
            {movingFolder ? `把「${movingFolder.name}」移动到：` : target.kind === "asset" ? `把「${target.asset.title}」移动到：` : target.kind === "assets" ? `把选中的 ${target.assets.length} 个资产移动到：` : ""}
        </p>
        <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-(--asset-secondary)">
            <button type="button" className="cursor-pointer hover:text-(--asset-accent)" onClick={() => { setBrowsing(null); if (movingFolder) setSelected(null); }}>{movingFolder ? "根目录" : "全部资产"}</button>
            {path.map((folder) => <span key={folder.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <button type="button" className="max-w-40 cursor-pointer truncate hover:text-(--asset-accent)" onClick={() => enter(folder.id)}>{folder.name}</button>
            </span>)}
        </div>
        <div className="asset-folder-browser">
            {movingFolder && browsing === null ? <button type="button" className={`asset-folder-browser-card${selected === null ? " is-active" : ""}`} onClick={() => setSelected(null)} onDoubleClick={() => { setBrowsing(null); setSelected(null); }}>
                <FolderInput aria-hidden className="size-6 shrink-0 text-(--asset-secondary)" />
                <span className="w-full truncate text-xs font-medium">根目录</span>
            </button> : null}
            {visible.map((folder) => <button key={folder.id} type="button" title={folder.name} className={`asset-folder-browser-card${selected === folder.id ? " is-active" : ""}`}
                onClick={() => setSelected(folder.id)} onDoubleClick={() => enter(folder.id)}>
                <Folder aria-hidden className="size-6 shrink-0 text-(--asset-secondary)" />
                <span className="w-full truncate text-xs">{folder.name}</span>
            </button>)}
            {!visible.length && !(movingFolder && browsing === null) ? <p className="asset-folder-browser-empty">没有子文件夹，将移动到当前位置</p> : null}
        </div>
    </AssetDialog>;
}
