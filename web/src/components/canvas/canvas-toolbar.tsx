import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { Button, Segmented, Switch } from "antd";
import { CircleDot, Eraser, FolderOpen, Grid2x2, Hand, Image as ImageIcon, Info, Moon, Music2, Palette, Redo2, Settings2, Square, Sun, Trash2, Type, Undo2, Upload, Video } from "lucide-react";

import { useTranslation } from "@/components/layout/locale-provider";
import { canvasThemes, type CanvasBackgroundMode, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";
import type { TranslateFn } from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export function CanvasToolbar({
    selectedCount,
    canUndo,
    canRedo,
    backgroundMode,
    showImageInfo,
    onAddImage,
    onAddVideo,
    onAddAudio,
    onAddText,
    onAddConfig,
    onUndo,
    onRedo,
    onUpload,
    onDelete,
    onClear,
    onDeselect,
    onBackgroundModeChange,
    onShowImageInfoChange,
    onOpenMyAssets,
}: {
    selectedCount: number;
    canUndo: boolean;
    canRedo: boolean;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    onAddImage: () => void;
    onAddVideo: () => void;
    onAddAudio: () => void;
    onAddText: () => void;
    onAddConfig: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onUpload: () => void;
    onDelete: () => void;
    onClear: () => void;
    onDeselect: () => void;
    onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
    onShowImageInfoChange: (show: boolean) => void;
    onOpenMyAssets: () => void;
}) {
    const { t } = useTranslation();
    const wrapRef = useRef<HTMLDivElement>(null);
    const colorTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const [hovered, setHovered] = useState<string | null>(null);
    const [tipX, setTipX] = useState(0);
    const [appearanceOpen, setAppearanceOpen] = useState(false);
    const [panelX, setPanelX] = useState(0);
    const dockStyle = { background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item, boxShadow: colorTheme === "dark" ? "0 18px 45px rgba(0,0,0,.32)" : "0 16px 40px rgba(28,25,23,.12)" };
    const hoverStyle = { background: theme.toolbar.itemHover, color: theme.toolbar.activeText };
    const activeStyle = { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };
    const tip = hovered ? toolLabel(hovered, t) : "";

    return (
        <div className="pointer-events-none absolute bottom-5 z-50 flex justify-center" style={{ left: 300, right: 16 }}>
            {tip ? <DockTip label={tip} x={tipX} theme={theme} /> : null}
            <div ref={wrapRef} className="thin-scrollbar pointer-events-auto flex h-14 max-w-full items-center gap-1 overflow-x-auto rounded-xl border px-2 shadow-lg backdrop-blur [&>*]:shrink-0" style={dockStyle}>
                <ToolbarButton id="tool-hand" label={t("canvas.toolbar.hand")} active={!selectedCount} hovered={hovered} activeStyle={activeStyle} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDeselect}>
                    <Hand className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-undo" label={t("canvas.toolbar.undo")} disabled={!canUndo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUndo}>
                    <Undo2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-redo" label={t("canvas.toolbar.redo")} disabled={!canRedo} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onRedo}>
                    <Redo2 className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-text" label={t("canvas.toolbar.text")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddText}>
                    <Type className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-image" label={t("canvas.toolbar.image")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddImage}>
                    <ImageIcon className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-video" label={t("canvas.toolbar.video")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddVideo}>
                    <Video className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-audio" label={t("canvas.toolbar.audio")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddAudio}>
                    <Music2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-config" label={t("canvas.toolbar.config")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onAddConfig}>
                    <Settings2 className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton id="tool-upload" label={t("canvas.toolbar.upload")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onUpload}>
                    <Upload className="size-4.5" />
                </ToolbarButton>
                <Divider theme={theme} />
                <ToolbarButton id="tool-assets" label={t("canvas.toolbar.assets")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onOpenMyAssets}>
                    <FolderOpen className="size-4.5" />
                </ToolbarButton>
                <ToolbarButton
                    id="tool-style"
                    label={t("canvas.toolbar.appearance")}
                    active={appearanceOpen}
                    hovered={hovered}
                    activeStyle={activeStyle}
                    hoverStyle={hoverStyle}
                    wrapRef={wrapRef}
                    onTipX={setTipX}
                    onHover={setHovered}
                    onClick={(event) => {
                        setPanelX(getTipX(wrapRef.current, event.currentTarget));
                        setAppearanceOpen((value) => !value);
                    }}
                >
                    <Palette className="size-4.5" />
                </ToolbarButton>
                {selectedCount ? (
                    <>
                        <Divider theme={theme} />
                        <ToolbarButton id="tool-delete" label={t("canvas.toolbar.deleteSelected")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onDelete} danger>
                            <Trash2 className="size-4.5" />
                        </ToolbarButton>
                    </>
                ) : null}
                <Divider theme={theme} />
                <ToolbarButton id="tool-clear" label={t("canvas.toolbar.clear")} hovered={hovered} hoverStyle={hoverStyle} wrapRef={wrapRef} onTipX={setTipX} onHover={setHovered} onClick={onClear} danger>
                    <Eraser className="size-4.5" />
                </ToolbarButton>
            </div>

            {appearanceOpen ? (
                <div
                    className="pointer-events-auto absolute bottom-[72px] z-30 w-[248px] -translate-x-1/2 rounded-xl border p-2.5 shadow-xl backdrop-blur"
                    style={{ left: panelX || "50%", background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.item }}
                >
                    <div className="px-1 pb-2 text-sm font-medium opacity-65">{t("canvas.toolbar.appearance")}</div>
                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>
                    <div className="grid grid-cols-2 gap-1 rounded-lg p-1" style={{ background: theme.toolbar.itemHover }}>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="light" onThemeChange={setTheme} t={t}>
                            <Sun className="size-4" />
                            {t("canvas.toolbar.themeLight")}
                        </CanvasThemeButton>
                        <CanvasThemeButton colorTheme={colorTheme} targetTheme="dark" onThemeChange={setTheme} t={t}>
                            <Moon className="size-4" />
                            {t("canvas.toolbar.themeDark")}
                        </CanvasThemeButton>
                    </div>
                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>
                    <Segmented
                        className="w-full !p-1 [&_.ant-segmented-group]:!flex [&_.ant-segmented-item]:!min-h-8 [&_.ant-segmented-item]:!flex-1 [&_.ant-segmented-item-label]:!min-h-8 [&_.ant-segmented-item-label]:!leading-8"
                        value={backgroundMode}
                        onChange={(value) => onBackgroundModeChange(value as CanvasBackgroundMode)}
                        options={[
                            {
                                value: "dots",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <CircleDot className="size-4" />{t("common.dots")}
                                    </span>
                                ),
                            },
                            {
                                value: "lines",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Grid2x2 className="size-4" />{t("common.lines")}
                                    </span>
                                ),
                            },
                            {
                                value: "blank",
                                label: (
                                    <span className="inline-flex items-center gap-1.5">
                                        <Square className="size-4" />
                                        {t("common.blank")}
                                    </span>
                                ),
                            },
                        ]}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1">
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium opacity-65">
                            <Info className="size-3.5" />
                            {t("canvas.toolbar.imageInfo")}
                        </span>
                        <Switch size="small" checked={showImageInfo} onChange={onShowImageInfoChange} />
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function ToolbarButton({
    id,
    label,
    active,
    hovered,
    activeStyle,
    hoverStyle,
    wrapRef,
    onTipX,
    onHover,
    onClick,
    disabled = false,
    danger = false,
    children,
}: {
    id: string;
    label: string;
    active?: boolean;
    hovered: string | null;
    activeStyle?: CSSProperties;
    hoverStyle: CSSProperties;
    wrapRef: RefObject<HTMLDivElement | null>;
    onTipX: (x: number) => void;
    onHover: (id: string | null) => void;
    onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
    disabled?: boolean;
    danger?: boolean;
    children: ReactNode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <Button
            type="text"
            aria-label={label}
            className="!h-8 !w-8 !min-w-8 !p-0"
            disabled={disabled}
            style={active ? activeStyle : hovered === id && !disabled ? hoverStyle : { color: danger ? "#f87171" : theme.toolbar.item, opacity: disabled ? 0.35 : 1 }}
            icon={children}
            onMouseEnter={(event) => {
                onHover(id);
                onTipX(getTipX(wrapRef.current, event.currentTarget));
            }}
            onMouseLeave={() => onHover(null)}
            onClick={onClick}
        />
    );
}

function Divider({ theme }: { theme: CanvasTheme }) {
    return <div className="mx-1 h-6 w-px" style={{ background: theme.toolbar.border }} />;
}

function CanvasThemeButton({ colorTheme, targetTheme, onThemeChange, t, children }: { colorTheme: CanvasColorTheme; targetTheme: CanvasColorTheme; onThemeChange: (theme: CanvasColorTheme) => void; t: TranslateFn; children: ReactNode }) {
    const theme = canvasThemes[colorTheme];
    const active = colorTheme === targetTheme;
    const activeStyle = colorTheme === "light" ? { background: "#111111", color: "#ffffff" } : { background: theme.toolbar.activeBg, color: theme.toolbar.activeText };

    return (
        <AnimatedThemeToggler
            theme={colorTheme}
            targetTheme={targetTheme}
            onThemeChange={onThemeChange}
            className="inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-sm transition"
            style={active ? activeStyle : { color: theme.toolbar.item }}
            aria-label={t("canvas.toolbar.switchTheme", { theme: targetTheme === "dark" ? t("canvas.toolbar.themeDark") : t("canvas.toolbar.themeLight") })}
            title={t("canvas.toolbar.switchTheme", { theme: targetTheme === "dark" ? t("canvas.toolbar.themeDark") : t("canvas.toolbar.themeLight") })}
        >
            {children}
        </AnimatedThemeToggler>
    );
}

function DockTip({ label, x, theme }: { label: string; x: number; theme: CanvasTheme }) {
    return (
        <span className="absolute bottom-[calc(100%+8px)] -translate-x-1/2 rounded-md px-2 py-1 text-xs shadow-lg" style={{ left: x, background: theme.node.text, color: theme.node.panel }}>
            {label}
        </span>
    );
}

function toolLabel(id: string, t: TranslateFn) {
    if (id === "tool-hand") return t("canvas.toolbar.hand");
    if (id === "tool-undo") return t("canvas.toolbar.undo");
    if (id === "tool-redo") return t("canvas.toolbar.redo");
    if (id === "tool-text") return t("canvas.toolbar.text");
    if (id === "tool-image") return t("canvas.toolbar.image");
    if (id === "tool-video") return t("canvas.toolbar.video");
    if (id === "tool-audio") return t("canvas.toolbar.audio");
    if (id === "tool-config") return t("canvas.toolbar.config");
    if (id === "tool-upload") return t("canvas.toolbar.upload");
    if (id === "tool-assets") return t("canvas.toolbar.assets");
    if (id === "tool-style") return t("canvas.toolbar.appearance");
    if (id === "tool-delete") return t("canvas.toolbar.deleteSelected");
    if (id === "tool-clear") return t("canvas.toolbar.clear");
    return "";
}

function getTipX(wrap: HTMLDivElement | null, target: HTMLElement) {
    if (!wrap) return 0;
    const wrapBox = wrap.parentElement?.getBoundingClientRect() || wrap.getBoundingClientRect();
    const box = target.getBoundingClientRect();
    return box.left - wrapBox.left + box.width / 2;
}
