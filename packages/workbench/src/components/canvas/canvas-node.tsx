import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { nodes } from "@infinite-canvas/plugin-sdk/builtin";
import { canvasBinding } from "@workbench/lib/plugins/runtime";
import { usePluginStore } from "@workbench/stores/use-plugin-store";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { GripHorizontal, Puzzle } from "lucide-react";

import { canvasThemes } from "@workbench/lib/canvas-theme";
import { getNodeDefinition, getNodePluginId, readNodeResource, useNodeRegistryVersion } from "@workbench/lib/canvas/node-registry";
import { buildNodeContext } from "@workbench/lib/canvas/plugin-node-context";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasNodeAppearance, CanvasNodeContext, CanvasPluginHost } from "@infinite-canvas/plugin-sdk";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionColor = "var(--canvas-node-activeStroke, #2f80ff)";

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    referenceSelectionState?: "target" | "disabled" | "available";
    showPanel: boolean;
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    isGroupDropTarget?: boolean;
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onSelectReference?: (nodeId: string) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    canvas?: CanvasPluginHost["canvas"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    pluginContext?: CanvasNodeContext | null;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    referenceSelectionState,
    showPanel,
    pluginHost,
    renderPanel,
    isGroupDropTarget = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResizeStart,
    onResize,
    onResizeEnd,
    onTitleChange,
    onSelectReference,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const [hovered, setHovered] = useState(false);
    const registryVersion = useNodeRegistryVersion((state) => state.version);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected, registryVersion]);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const isGroup = data.type === CanvasNodeType.Group;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    let forceInteractive = false;
    try { forceInteractive = supportsInteractionToggle && Boolean(definition?.forceInteractive?.(data)); } catch { /* 忽略失败的交互状态贡献。 */ }
    const hasResource = supportsInteractionToggle && (Boolean(data.metadata?.content) || (pluginContext ? Boolean(readNodeResource(data, "render", pluginContext.scope)) : false));
    const contentInteractive = !supportsInteractionToggle || forceInteractive || !hasResource ? true : Boolean(data.metadata?.interactive);
    let appearance: CanvasNodeAppearance = { background: "fill", border: "normal", bottomGradient: true };
    const declaredAppearance = definition?.appearance;
    try { if (declaredAppearance) appearance = typeof declaredAppearance === "function" ? declaredAppearance(data) : declaredAppearance; } catch { /* 失败的外观贡献沿用完整卡片外观。 */ }
    const background = isGroup || appearance.background === "transparent" ? "transparent" : theme.node.fill;
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        onResizeEnd(data.id);
    }, [data.id, handleResizeMove, onResizeEnd]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        let keepRatio: boolean;
        try {
            keepRatio = Boolean(definition?.keepAspectRatio?.(data));
        } catch (error) {
            toast.error(getPluginErrorMessage(error));
            return;
        }
        onResizeStart(data.id);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio,
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element group/node absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"} ${referenceSelectionState === "available" ? "cursor-pointer" : referenceSelectionState ? "cursor-not-allowed" : ""}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => {
                if (!referenceSelectionState) onSelectCapture?.(event, data.id);
            }}
            onContextMenu={(event) => {
                if (referenceSelectionState) event.preventDefault();
                else onContextMenu(event, data.id);
            }}
        >
            {!referenceSelectionState && (isSelected || hovered || isEditingTitle) && (
                <div className="absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
                            style={{ color: theme.node.text }}
                            title="双击修改节点名称"
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                        >
                            {data.title || "未命名节点"}
                        </button>
                    )}
                </div>
            )}

            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background,
                    borderColor: isGroup ? (isGroupDropTarget || isActive ? selectionColor : theme.node.stroke) : isActive ? selectionColor : isRelated ? theme.node.muted : appearance.border === "none" ? "transparent" : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget ? `0 0 0 2px color-mix(in srgb, ${selectionColor} 40%, transparent), inset 0 0 0 999px color-mix(in srgb, ${selectionColor} 6%, transparent)` : isActive ? `0 0 0 1px color-mix(in srgb, ${selectionColor} 33%, transparent)` : isRelated ? `0 0 0 1px color-mix(in srgb, ${theme.node.muted} 33%, transparent), 0 18px 48px rgba(0,0,0,.14)` : undefined,
                }}
                onMouseDown={(event) => {
                    if (!referenceSelectionState) onMouseDown(event, data.id);
                    else if (event.button === 0 && referenceSelectionState === "available") {
                        event.stopPropagation();
                        onSelectReference?.(data.id);
                    }
                }}
                onDoubleClickCapture={(event) => { if (referenceSelectionState) event.stopPropagation(); }}
                onDoubleClick={(event) => {
                    if (referenceSelectionState) {
                        event.stopPropagation();
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        try { if (definition.onDoubleClick(pluginContext)) event.stopPropagation(); }
                        catch (error) {
                            event.stopPropagation();
                            toast.error(getPluginErrorMessage(error));
                        }
                        return;
                    }
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${definition?.contentOverflow === "visible" ? "overflow-visible" : "overflow-hidden"}`}
                    style={{
                            background,
                            pointerEvents: contentInteractive ? undefined : "none",
                        } as React.CSSProperties}
                >
                    <NodeContent
                        node={data}
                        canvas={pluginHost?.canvas}
                        theme={theme}
                        pluginContext={pluginContext}
                    />
                </div>

                {supportsInteractionToggle && hasResource && !forceInteractive && contentInteractive ? (
                    // 交互模式下内容会接管鼠标，顶部留一条抓取条，保证仍能选中、拖动节点并呼出工具条。
                    <div aria-hidden="true" className="absolute inset-x-0 top-0 z-[55] flex h-5 cursor-move items-center justify-center rounded-t-[inherit] opacity-0 transition-opacity duration-150 group-hover/node:opacity-100" style={{ background: `linear-gradient(to bottom, color-mix(in srgb, ${theme.canvas.background} 70%, transparent), transparent)`, color: theme.node.muted }}>
                        <GripHorizontal className="size-4" />
                    </div>
                ) : null}

                {!isGroup && appearance.bottomGradient ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, color-mix(in srgb, ${theme.canvas.background} 40%, transparent), transparent)` }} /> : null}

                {referenceSelectionState && (referenceSelectionState !== "available" || hovered) ? (
                    <div className="pointer-events-none absolute inset-0 z-[60] grid place-items-center rounded-[inherit]" style={{ background: `color-mix(in srgb, ${theme.canvas.background} ${referenceSelectionState === "target" ? 78 : referenceSelectionState === "disabled" ? 60 : 34}%, transparent)`, boxShadow: referenceSelectionState === "available" ? `inset 0 0 0 2px ${selectionColor}` : undefined }}>
                        {referenceSelectionState !== "disabled" ? <span className="rounded-lg px-3 py-2 text-sm font-medium shadow-sm" style={{ background: theme.toolbar.panel, color: theme.node.text }}>{(referenceSelectionState === "target" ? "正在添加参考" : "选择")}</span> : null}
                    </div>
                ) : null}

                {!referenceSelectionState ? <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} /> : null}
                {!referenceSelectionState ? <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} /> : null}
            </div>

            {!referenceSelectionState && !isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!referenceSelectionState && (definition?.hasSourceHandle ?? true) ? <ConnectionHandleDot side="right" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {/* Counter-scale the panel so its on-screen size stays constant while the canvas zooms. */}
            {showPanel && !isGroup && renderPanel ? (
                <div className="absolute left-1/2 top-full z-[70] w-[600px] pt-4" style={{ transform: `translateX(-50%) scale(${1 / scale})`, transformOrigin: "top center" }} data-node-panel={data.id}>
                    {renderPanel(data)}
                </div>
            ) : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const Content = definition.Content;
        return <PluginBoundary key={props.node.type} remountOnReset resetKey={definition} pluginId={getNodePluginId(props.node.type)} contributionId={props.node.type} callbackName="Content"><Content ctx={props.pluginContext} /></PluginBoundary>;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} canvas={props.canvas} />;
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme" | "canvas"> & { type: string }) {
    const opening = usePluginStore((state) => Object.values(state.states).some((item) => item.status === "starting"));
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{opening ? "正在打开节点…" : "缺少插件"}</span>
            {!opening && <span className="text-[11px] opacity-70">{`节点类型“${type}”的插件未安装或未启用`}</span>}
        </div>
    );
}

function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, onMouseDown }: { side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}
