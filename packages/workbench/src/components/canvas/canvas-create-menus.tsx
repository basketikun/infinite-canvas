import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Puzzle } from "lucide-react";
import { getNodePluginId, listNodeDefinitions } from "@workbench/lib/canvas/node-registry";

import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasMenuContent } from "./canvas-menu-content";
import type { Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { type ConnectionHandle } from "@workbench/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
};

export function ConnectionCreateMenu({ pending, scale = 1, onClose }: { pending: PendingConnectionCreate; scale?: number; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className="absolute z-[120] w-[240px] rounded-xl border p-1.5 shadow-lg backdrop-blur"
            data-connection-create-menu
            style={{ left: pending.position.x, top: pending.position.y, transform: `scale(${1 / scale})`, transformOrigin: "top left", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <CanvasMenuContent
                title="引用该节点生成"
                target={{ location: "canvas.connectionCreate", position: pending.position, ...pending.connection }}
                items={[]}
                onClose={onClose}
            />
        </div>
    );
}

export function NodeCreateMenu({ position, scale = 1, onClose }: { position: Position; scale?: number; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const menuRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLButtonElement>(null);
    const [extensions, setExtensions] = useState(false);
    const [flyoutBottom, setFlyoutBottom] = useState(0);
    const [shift, setShift] = useState({ x: 0, y: 0 });
    // 菜单靠近屏幕边缘时整体移回可见范围，底部预留工具栏高度；右侧面板展开时一并计入宽度。
    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const rect = menu.getBoundingClientRect();
        const screenPerPixel = rect.height / menu.offsetHeight;
        const localToScreen = screenPerPixel * scale;
        // 先还原已有偏移再计算，重复执行结果一致。
        const top = rect.top - shift.y * localToScreen;
        const bottom = rect.bottom - shift.y * localToScreen;
        const right = rect.right - shift.x * localToScreen + (extensions ? 248 * screenPerPixel : 0);
        const dx = Math.min(0, window.innerWidth - 12 - right);
        const dy = Math.max(12 - top, Math.min(0, window.innerHeight - 96 - bottom));
        setShift({ x: dx / localToScreen, y: dy / localToScreen });
    }, [position, extensions, scale]);
    // 右侧面板底边与「扩展节点」入口底边对齐。
    useLayoutEffect(() => {
        const row = rowRef.current;
        const menu = menuRef.current;
        if (extensions && row && menu) setFlyoutBottom(menu.offsetHeight - row.offsetTop - row.offsetHeight);
    }, [extensions]);
    const hasExtensions = listNodeDefinitions().some((definition) => getNodePluginId(definition.type) !== "builtin" && definition.showInCreateMenu !== false);
    // Close automatically when clicking outside the menu.
    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [onClose]);
    const panelClass = "max-h-[70vh] w-[240px] overflow-x-hidden overflow-y-auto rounded-xl border p-1.5 shadow-lg backdrop-blur thin-scrollbar";
    const panelStyle = { background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text };
    return (
        <div
            ref={menuRef}
            className="absolute z-[120]"
            data-canvas-no-zoom
            style={{ left: position.x + shift.x, top: position.y + shift.y, transform: `scale(${1 / scale})`, transformOrigin: "top left" }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className={`${panelClass} relative`} style={panelStyle}>
                <CanvasMenuContent title="选择节点" target={{ location: "canvas.create", position, extensions: false }} items={[]} onClose={onClose} />
                {hasExtensions ? <button ref={rowRef} type="button" className={`mt-0.5 flex min-h-14 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${extensions ? "bg-black/5 dark:bg-white/10" : ""}`} onClick={() => setExtensions(!extensions)}>
                    <span className="grid size-5 shrink-0 place-items-center [&>svg]:size-4" style={{ color: theme.node.muted }}><Puzzle /></span>
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-5">扩展节点</span>
                        <span className="mt-0.5 block text-xs leading-4" style={{ color: theme.node.muted }}>插件提供的更多节点</span>
                    </span>
                    <ChevronRight className="size-4 opacity-45" />
                </button> : null}
            </div>
            {extensions ? <div className={`${panelClass} absolute left-full ml-2`} style={{ ...panelStyle, bottom: flyoutBottom }}>
                <CanvasMenuContent title="扩展节点" target={{ location: "canvas.create", position, extensions: true }} items={[]} onClose={onClose} />
            </div> : null}
        </div>
    );
}
