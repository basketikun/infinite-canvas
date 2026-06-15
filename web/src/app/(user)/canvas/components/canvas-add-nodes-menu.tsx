"use client";

import { useEffect, type ReactNode } from "react";
import { FileText, Image as ImageIcon, Music2, Settings2, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type Position } from "../types";

type CanvasAddNodesMenuState = {
    x: number;
    y: number;
    position: Position;
};

type CanvasAddNodeType = CanvasNodeType.Text | CanvasNodeType.Image | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Config;

type CanvasAddNodesMenuProps = {
    menu: CanvasAddNodesMenuState;
    onClose: () => void;
    onCreate: (type: CanvasAddNodeType) => void;
};

export function CanvasAddNodesMenu({ menu, onClose, onCreate }: CanvasAddNodesMenuProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-canvas-add-nodes-menu]")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[120] w-[260px] rounded-[18px] border p-3 shadow-2xl backdrop-blur"
            data-canvas-add-nodes-menu
            style={{ left: menu.x, top: menu.y, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm font-medium" style={{ color: theme.node.muted }}>
                    新建节点
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-lg text-base opacity-55 transition hover:bg-white/10 hover:opacity-100" onClick={onClose} aria-label="关闭">
                    ×
                </button>
            </div>

            <div className="grid gap-1">
                <AddNodeOption theme={theme} icon={<FileText className="size-5" />} title="文本" onClick={() => onCreate(CanvasNodeType.Text)} />
                <AddNodeOption theme={theme} icon={<ImageIcon className="size-5" />} title="图片" onClick={() => onCreate(CanvasNodeType.Image)} />
                <AddNodeOption theme={theme} icon={<Video className="size-5" />} title="视频" onClick={() => onCreate(CanvasNodeType.Video)} />
                <AddNodeOption theme={theme} icon={<Music2 className="size-5" />} title="音频" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <AddNodeOption theme={theme} icon={<Settings2 className="size-5" />} title="生成配置" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </div>
    );
}

function AddNodeOption({ theme, icon, title, onClick }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; icon: ReactNode; title: string; onClick: () => void }) {
    return (
        <button type="button" className="flex h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-left transition" style={{ color: theme.node.text }} onClick={onClick} onMouseEnter={(event) => (event.currentTarget.style.background = theme.node.fill)} onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}>
            <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 text-base font-semibold leading-5">{title}</span>
        </button>
    );
}
