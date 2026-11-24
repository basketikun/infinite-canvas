import { useEffect } from "react";

import { CanvasMenuContent } from "./canvas-menu-content";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import type { ContextMenuState } from "@workbench/types/canvas";

export function CanvasNodeContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        // 菜单及其 React Portal 的 pointerdown 在下方容器停止传播，其余点击关闭菜单。
        window.addEventListener("pointerdown", onClose);
        return () => window.removeEventListener("pointerdown", onClose);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border p-1 shadow-2xl"
            data-canvas-no-zoom
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <CanvasMenuContent
                target={menu.type === "node" ? { location: "canvas.nodeContext", position: { x: menu.x, y: menu.y }, nodeId: menu.nodeId } : { location: "canvas.connectionContext", position: { x: menu.x, y: menu.y }, connectionId: menu.connectionId }}
                items={[]}
                onClose={onClose}
            />
        </div>
    );
}
