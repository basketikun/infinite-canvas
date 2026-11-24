import type { ReactNode } from "react";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { CanvasMenuContent } from "./canvas-menu-content";
import { CanvasToolbarContent } from "./canvas-toolbar-content";
import { useCallback, useEffect, useRef, useState } from "react";
import { RadioGroup } from "radix-ui";
import { Switch } from "@infinite-canvas/plugin-sdk/ui/switch";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { CircleDot, Grid2x2, Info, Moon, Square, Sun } from "lucide-react";

import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme } from "@workbench/lib/canvas-theme";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import type { CanvasViewController } from "@workbench/lib/canvas/canvas-view";
import { setCanvasPreferences } from "@workbench/lib/canvas/canvas-view-commands";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { AnimatedThemeToggler } from "@workbench/components/ui/animated-theme-toggler";
import { useCanvasToolbar, type CanvasToolbarPanel } from "@workbench/components/canvas/use-canvas-toolbar";

const backgroundOptions = [
    { value: "dots", label: "点", Icon: CircleDot },
    { value: "lines", label: "线", Icon: Grid2x2 },
    { value: "blank", label: "空白", Icon: Square },
] as const;

export function CanvasToolbar({ session, view }: { session: CanvasSession; view: CanvasViewController }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === session.projectId));
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const [panel, setPanel] = useState<CanvasToolbarPanel>(null);
    const panelRef = useRef<CanvasToolbarPanel>(null);
    const [panelX, setPanelX] = useState(0);
    const setToolbarPanel = useCallback((next: CanvasToolbarPanel) => {
        if (next && view.scope.signal.aborted) return;
        panelRef.current = next;
        if (next) setPanelX(getPanelX(rootRef.current, `builtin:${next}`));
        setPanel(next);
    }, [view]);
    useCanvasToolbar(session, view, () => panelRef.current, setToolbarPanel);
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const failed = (error: unknown) => {
        console.error("[canvas] preferences", error);
        if (!view.scope.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) toast.error("暂时无法保存画布外观，请重试。", workbenchMessageOptions.error);
    };

    // Close extension-node and canvas-appearance popovers when clicking outside the toolbar and its panels.
    useEffect(() => {
        if (!panel) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setToolbarPanel(null);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [panel, setToolbarPanel]);

    if (!project) return null;

    return (
        <div ref={rootRef} className="pointer-events-none absolute bottom-5 z-50 flex justify-center" style={{ left: 300, right: 16 }} data-canvas-bottom-toolbar>
            <div className="thin-scrollbar pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <CanvasToolbarContent target={{ location: "canvas.toolbar" }} items={[]} showLabels={false} />
            </div>

            {panel === "extensions" ? (
                <div
                    className="thin-scrollbar pointer-events-auto absolute bottom-[72px] z-30 max-h-[50vh] w-[240px] -translate-x-1/2 overflow-y-auto rounded-xl border p-2 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <CanvasMenuContent
                        title="扩展节点与工具"
                        target={{ location: "canvas.extensions" }}
                        items={[]}
                        onClose={() => setToolbarPanel(null)}
                    />
                </div>
            ) : null}

            {panel === "appearance" ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">画布外观</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">主题模式</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton targetTheme="light" signal={view.scope.signal}>
                            <Sun className="size-4" />
                            浅色
                        </CanvasThemeButton>
                        <CanvasThemeButton targetTheme="dark" signal={view.scope.signal}>
                            <Moon className="size-4" />
                            深色
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">网格样式</div>
                    <RadioGroup.Root aria-label="网格样式" orientation="horizontal" value={project.backgroundMode} className="grid grid-cols-3 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}
                        onValueChange={(value) => { void setCanvasPreferences(session, { backgroundMode: value as CanvasBackgroundMode }).catch(failed); }}>
                        {backgroundOptions.map(({ value, label, Icon }) => <RadioGroup.Item key={value} value={value}
                            className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm data-[state=checked]:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
                            style={project.backgroundMode === value ? { background: theme.toolbar.panel, color: theme.node.text } : { color: theme.toolbar.item }}>
                            <Icon className="size-4" />{label}
                        </RadioGroup.Item>)}
                    </RadioGroup.Root>
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            图片信息
                        </span>
                        <Switch aria-label="图片信息" size="sm" checked={project.showImageInfo} onCheckedChange={(showImageInfo) => { void setCanvasPreferences(session, { showImageInfo }).catch(failed); }} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function CanvasThemeButton({ targetTheme, signal, children }: { targetTheme: CanvasColorTheme; signal: AbortSignal; children: ReactNode }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    const label = targetTheme === "dark" ? "切换到深色主题" : "切换到浅色主题";

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            signal={signal}
            targetTheme={targetTheme}
            onThemeChange={(value) => { signal.throwIfAborted(); setTheme(value); }}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={label}
            title={label}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function getPanelX(root: HTMLDivElement | null, id: string) {
    const target = root?.querySelector<HTMLElement>(`[data-canvas-action="${id}"]`);
    if (!root || !target) return 0;
    const box = target.getBoundingClientRect();
    return box.left - root.getBoundingClientRect().left + box.width / 2;
}
