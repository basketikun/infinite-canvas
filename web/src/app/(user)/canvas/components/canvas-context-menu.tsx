"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { ClipboardPaste, Copy, CopyPlus, FileText, Image as ImageIcon, Library, Music2, Redo2, Save, Settings2, Trash2, Undo2, Upload, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type ContextMenuState } from "../types";

type CanvasContextMenuProps = {
    menu: ContextMenuState;
    canUndo?: boolean;
    canRedo?: boolean;
    onClose: () => void;
    onDuplicate: () => void;
    onCopyNode: () => void;
    onSaveAsset: () => void;
    onDelete: () => void;
    onCreateNode: (type: CanvasNodeType) => void;
    onUpload: () => void;
    onOpenMyAssets: () => void;
    onOpenAssetLibrary: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: () => void;
};

export function CanvasNodeContextMenu({ menu, canUndo = false, canRedo = false, onClose, onDuplicate, onCopyNode, onSaveAsset, onDelete, onCreateNode, onUpload, onOpenMyAssets, onOpenAssetLibrary, onUndo, onRedo, onPaste }: CanvasContextMenuProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            data-canvas-no-zoom
            onPointerDown={(event) => event.stopPropagation()}
        >
            {menu.type === "canvas" ? (
                <>
                    <MenuButton icon={<FileText className="size-4" />} label="添加文本" onClick={() => onCreateNode(CanvasNodeType.Text)} />
                    <MenuButton icon={<ImageIcon className="size-4" />} label="添加图片" onClick={() => onCreateNode(CanvasNodeType.Image)} />
                    <MenuButton icon={<Video className="size-4" />} label="添加视频" onClick={() => onCreateNode(CanvasNodeType.Video)} />
                    <MenuButton icon={<Music2 className="size-4" />} label="添加音频" onClick={() => onCreateNode(CanvasNodeType.Audio)} />
                    <MenuButton icon={<Settings2 className="size-4" />} label="添加生成配置" onClick={() => onCreateNode(CanvasNodeType.Config)} />
                    <MenuDivider />
                    <MenuButton icon={<Upload className="size-4" />} label="上传素材" onClick={onUpload} />
                    <MenuButton icon={<Library className="size-4" />} label="我的素材" onClick={onOpenMyAssets} />
                    <MenuButton icon={<ImageIcon className="size-4" />} label="素材库" onClick={onOpenAssetLibrary} />
                    <MenuDivider />
                    <MenuButton icon={<ClipboardPaste className="size-4" />} label="粘贴" onClick={onPaste} />
                    <MenuButton icon={<Undo2 className="size-4" />} label="撤销" onClick={onUndo} disabled={!canUndo} />
                    <MenuButton icon={<Redo2 className="size-4" />} label="重做" onClick={onRedo} disabled={!canRedo} />
                </>
            ) : null}
            {menu.type === "node" ? (
                <>
                    <MenuButton icon={<CopyPlus className="size-4" />} label="复制一份" onClick={onDuplicate} />
                    <MenuButton icon={<Copy className="size-4" />} label="复制节点" onClick={onCopyNode} />
                    <MenuButton icon={<Save className="size-4" />} label="保存到我的素材" onClick={onSaveAsset} />
                    <MenuDivider />
                    <MenuButton icon={<Trash2 className="size-4" />} label="删除" onClick={onDelete} danger />
                </>
            ) : null}
            {menu.type === "connection" ? <MenuButton icon={<Trash2 className="size-4" />} label="删除连线" onClick={onDelete} danger /> : null}
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false, disabled = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean; disabled?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ color: danger ? "#f87171" : theme.node.text }}
            onClick={onClick}
            disabled={disabled}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function MenuDivider() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return <div className="my-1 h-px" style={{ background: theme.toolbar.border }} />;
}
