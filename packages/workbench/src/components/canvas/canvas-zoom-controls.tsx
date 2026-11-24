import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { registerCanvasZoomControls } from "./builtin-zoom-controls";
import { CanvasToolbarContent } from "./canvas-toolbar-content";

export function CanvasZoomControls({ session, view, shortcutsOpen }: { session: CanvasSession; view: CanvasViewController; shortcutsOpen: boolean }) {
    const shortcuts = useRef(shortcutsOpen);
    shortcuts.current = shortcutsOpen;
    useSyncExternalStore(view.subscribe, view.getSnapshot);
    useLayoutEffect(() => registerCanvasZoomControls(session, view, () => shortcuts.current), [session, view]);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };

    return (
        <div className="absolute bottom-5 left-5 z-50" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur [&_[data-canvas-content]]:gap-1" style={dockStyle}>
                <CanvasToolbarContent target={{ location: "canvas.zoomControls" }} items={[]} showLabels={false} />
            </div>
        </div>
    );
}
