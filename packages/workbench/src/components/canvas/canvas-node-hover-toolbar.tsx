import { assetKindLabels } from "@workbench/constant/labels";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CanvasDialog } from "./canvas-dialog";
import { CanvasSegments } from "./canvas-segments";
import { Ellipsis } from "lucide-react";

import { canvasThemes } from "@workbench/lib/canvas-theme";
import { getNodeDefinition, readNodeResource } from "@workbench/lib/canvas/node-registry";
import { formatBytes, getDataUrlByteSize } from "@workbench/lib/image-utils";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { type ViewportTransform } from "@workbench/types/canvas";
import type { CanvasNodeToolbarItem, PluginMenuItem } from "@infinite-canvas/plugin-sdk";
import { CanvasToolbarContent } from "./canvas-toolbar-content";
import { ImageToolSettingsModal } from "./canvas-image-toolbar-settings-modal";
import { IMAGE_TOOLBAR_PREFERENCES_KEY, isImageToolbarToolVisible, type ImageToolbarPreferences } from "./canvas-image-toolbar-preferences";

type CanvasNodeHoverToolbarProps = {
    node: CanvasNodeData | null;
    viewport: ViewportTransform;
    onKeep: (nodeId: string) => void;
    onLeave: () => void;
    extraTools?: CanvasNodeToolbarItem[];
};

export function CanvasNodeHoverToolbar({ node, viewport, onKeep, onLeave, extraTools = [] }: CanvasNodeHoverToolbarProps) {
    const [preferences, setPreferences] = useState<ImageToolbarPreferences>(() => {
        const stored = window.localStorage.getItem(IMAGE_TOOLBAR_PREFERENCES_KEY);
        return stored ? JSON.parse(stored) : { visibility: {}, showLabels: false };
    });
    const [draftPreferences, setDraftPreferences] = useState(preferences);
    const [imageToolSettingsOpen, setImageToolSettingsOpen] = useState(false);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        setImageToolSettingsOpen(false);
    }, [node?.id]);

    if (!node) return null;

    const activeNode = node;
    const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const top = viewport.y + node.position.y * viewport.k - 14;
    const isImage = node.type === CanvasNodeType.Image;
    const hasImage = isImage && readNodeResource(node, "render")?.kind === "image";

    function openImageToolSettings() {
        onKeep(activeNode.id);
        setDraftPreferences(preferences);
        setImageToolSettingsOpen(true);
    }

    const toolbarTools: PluginMenuItem[] = [
        ...extraTools.map((tool): PluginMenuItem => ({ id: tool.id, type: "action", title: tool.label, tooltip: tool.title, icon: tool.icon, active: tool.active, danger: tool.danger, disabled: tool.disabled, hidden: isImage && !isImageToolbarToolVisible(tool, preferences.visibility), run: tool.onClick })),
        { id: "builtin:more", type: "action", title: "更多", tooltip: "配置快捷工具", icon: <Ellipsis />, hidden: !hasImage, active: imageToolSettingsOpen, run: openImageToolSettings },
    ];

    const closeImageToolSettings = () => {
        setImageToolSettingsOpen(false);
        onLeave();
    };

    const setDraftImageToolVisible = (id: string, visible: boolean) => {
        setDraftPreferences((current) => ({ ...current, visibility: { ...current.visibility, [id]: visible } }));
    };

    const saveImageToolSettings = () => {
        setPreferences(draftPreferences);
        window.localStorage.setItem(IMAGE_TOOLBAR_PREFERENCES_KEY, JSON.stringify(draftPreferences));
        closeImageToolSettings();
    };

    return (
        <>
            <div
                className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border text-[15px] shadow-lg"
                data-node-toolbar={node.id}
                style={{ left, top, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => {
                    if (!imageToolSettingsOpen) onLeave();
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <CanvasToolbarContent target={{ location: "canvas.nodeToolbar", nodeId: node.id }} items={toolbarTools} showLabels={!isImage || preferences.showLabels} />
            </div>
            {isImage ? (
                <ImageToolSettingsModal
                    open={imageToolSettingsOpen}
                    tools={extraTools}
                    visibility={draftPreferences.visibility}
                    showLabels={draftPreferences.showLabels}
                    onToggle={setDraftImageToolVisible}
                    onShowLabelsChange={(showLabels) => setDraftPreferences((current) => ({ ...current, showLabels }))}
                    onCancel={closeImageToolSettings}
                    onSave={saveImageToolSettings}
                />
            ) : null}
        </>
    );
}

export function CanvasNodeInfoModal({ node, open, onClose }: { node: CanvasNodeData | null; open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const [view, setView] = useState<"info" | "json">("info");
    const imageBytes = node?.type === CanvasNodeType.Image && node.metadata?.content ? getDataUrlByteSize(node.metadata.content) : 0;
    const batchCount = node?.type === CanvasNodeType.Image ? node.metadata?.images?.length || 0 : 0;
    const json = useMemo(() => {
        if (!node) return "";
        return JSON.stringify(
            node,
            (key, value) => {
                if (key === "content" && typeof value === "string" && value.startsWith("data:image/")) {
                    return "[base64 image]";
                }
                return value;
            },
            2,
        );
    }, [node]);

    useEffect(() => {
        if (open) setView("info");
    }, [node?.id, open]);

    return (
        <CanvasDialog title="节点信息" hideTitle width={520} open={open && Boolean(node)} onClose={onClose}>
            <div className="mb-2 flex items-center justify-between gap-4 pr-12">
                <h2 className="text-base font-semibold">节点信息</h2>
                <CanvasSegments<"info" | "json"> label="信息视图" compact value={view} onChange={setView}
                    options={[{ label: "信息", value: "info" }, { label: "JSON", value: "json" }]} />
            </div>
            {node ? (
                <div className="h-[56vh] min-h-[360px] select-text text-sm" data-canvas-shortcuts-ignore>
                    {view === "info" ? (
                        <div className="thin-scrollbar h-full space-y-3 overflow-auto pr-1">
                            <InfoRow label="ID" value={node.id} />
                            <InfoRow label="名称" value={node.title || "未命名节点"} />
                            <InfoRow label="类型" value={node.type === CanvasNodeType.Group ? "组" : [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio, CanvasNodeType.Text].includes(node.type as CanvasNodeType) ? assetKindLabels[node.type] : getNodeDefinition(node.type)?.title || node.type} />
                            <InfoRow label="尺寸" value={`${Math.round(node.width)} x ${Math.round(node.height)}`} />
                            <InfoRow label="位置" value={`${Math.round(node.position.x)}, ${Math.round(node.position.y)}`} />
                            <InfoRow label="状态" value={node.metadata?.status || "idle"} />
                            {batchCount > 1 ? <InfoRow label="图片组" value={`${batchCount} 张`} /> : null}
                            {node.metadata?.prompt ? <InfoRow label="提示词" value={node.metadata.prompt} /> : null}
                            {node.metadata?.webVideoTask ? <InfoRow label="任务 ID" value={node.metadata.webVideoTask.id} /> : null}
                            {imageBytes ? <InfoRow label="图片大小" value={formatBytes(imageBytes)} /> : null}
                            {node.metadata?.errorDetails ? (
                                <div className="rounded-lg border p-3 text-red-400" style={{ borderColor: theme.node.stroke }}>
                                    {node.metadata.errorDetails}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <pre className="thin-scrollbar h-full overflow-auto rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}>
                            {json}
                        </pre>
                    )}
                </div>
            ) : null}
        </CanvasDialog>
    );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
            <span className="opacity-50">{label}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{value}</span>
        </div>
    );
}
