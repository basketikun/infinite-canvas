import type { ReactNode } from "react";
import { Brush, Camera, Copy, FileText, Grid2x2, Lock, LockOpen, Maximize2, Scissors, Sparkles, Upload, ZoomIn } from "lucide-react";

import type { TranslateFn } from "@/i18n";
import type { CanvasNodeData } from "@/types/canvas";

export type ImageNodeActionToolId = "copyPrompt" | "reversePrompt" | "replace" | "resize" | "maskEdit" | "crop" | "split" | "upscale" | "superResolve" | "angle" | "view";
export type ImageQuickToolId = "info" | "delete" | "saveAsset" | "download" | "edit" | ImageNodeActionToolId;

export type ImageToolHandlers = {
    onUpload: (node: CanvasNodeData) => void;
    onToggleFreeResize: (node: CanvasNodeData) => void;
    onMaskEdit: (node: CanvasNodeData) => void;
    onCrop: (node: CanvasNodeData) => void;
    onSplit: (node: CanvasNodeData) => void;
    onUpscale: (node: CanvasNodeData) => void;
    onSuperResolve: (node: CanvasNodeData) => void;
    onAngle: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onCopyPrompt: (node: CanvasNodeData) => void;
    onReversePrompt: (node: CanvasNodeData) => void;
};

export type ImageToolDefinition = {
    id: ImageNodeActionToolId;
    defaultVisible: boolean;
    panelLabel: string;
    label: string | ((node: CanvasNodeData) => string);
    title: string | ((node: CanvasNodeData) => string);
    icon: (node: CanvasNodeData) => ReactNode;
    active?: (node: CanvasNodeData) => boolean;
    run: (node: CanvasNodeData, handlers: ImageToolHandlers) => void;
};

export type ImageQuickToolsConfig = {
    ids: ImageQuickToolId[];
    showLabels: boolean;
};

export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools-v6";

const defaultBaseToolIds: ImageQuickToolId[] = ["info", "delete", "saveAsset", "download", "edit"];

const imageToolIds: ImageNodeActionToolId[] = ["copyPrompt", "reversePrompt", "replace", "resize", "maskEdit", "crop", "split", "upscale", "superResolve", "angle", "view"];

export function createImageToolDefinitions(t: TranslateFn): ImageToolDefinition[] {
    return [
        {
            id: "copyPrompt",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.copyPrompt.panelLabel"),
            label: t("canvas.imageToolbar.copyPrompt.label"),
            title: t("canvas.imageToolbar.copyPrompt.title"),
            icon: () => <Copy className="size-4" />,
            run: (node, handlers) => handlers.onCopyPrompt(node),
        },
        {
            id: "reversePrompt",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.reversePrompt.panelLabel"),
            label: t("canvas.imageToolbar.reversePrompt.label"),
            title: t("canvas.imageToolbar.reversePrompt.title"),
            icon: () => <FileText className="size-4" />,
            run: (node, handlers) => handlers.onReversePrompt(node),
        },
        {
            id: "replace",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.replace.panelLabel"),
            label: t("canvas.imageToolbar.replace.label"),
            title: t("canvas.imageToolbar.replace.title"),
            icon: () => <Upload className="size-4" />,
            run: (node, handlers) => handlers.onUpload(node),
        },
        {
            id: "resize",
            defaultVisible: false,
            panelLabel: t("canvas.imageToolbar.resize.panelLabel"),
            label: (node) => (node.metadata?.freeResize ? t("canvas.imageToolbar.resize.freeRatio") : t("canvas.imageToolbar.resize.lockRatio")),
            title: (node) => (node.metadata?.freeResize ? t("canvas.imageToolbar.resize.titleLock") : t("canvas.imageToolbar.resize.titleFree")),
            icon: (node) => (node.metadata?.freeResize ? <LockOpen className="size-4" /> : <Lock className="size-4" />),
            active: (node) => Boolean(node.metadata?.freeResize),
            run: (node, handlers) => handlers.onToggleFreeResize(node),
        },
        {
            id: "maskEdit",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.maskEdit.panelLabel"),
            label: t("canvas.imageToolbar.maskEdit.label"),
            title: t("canvas.imageToolbar.maskEdit.title"),
            icon: () => <Brush className="size-4" />,
            run: (node, handlers) => handlers.onMaskEdit(node),
        },
        {
            id: "crop",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.crop.panelLabel"),
            label: t("canvas.imageToolbar.crop.label"),
            title: t("canvas.imageToolbar.crop.title"),
            icon: () => <Scissors className="size-4" />,
            run: (node, handlers) => handlers.onCrop(node),
        },
        {
            id: "split",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.split.panelLabel"),
            label: t("canvas.imageToolbar.split.label"),
            title: t("canvas.imageToolbar.split.title"),
            icon: () => <Grid2x2 className="size-4" />,
            run: (node, handlers) => handlers.onSplit(node),
        },
        {
            id: "upscale",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.upscale.panelLabel"),
            label: t("canvas.imageToolbar.upscale.label"),
            title: t("canvas.imageToolbar.upscale.title"),
            icon: () => <ZoomIn className="size-4" />,
            run: (node, handlers) => handlers.onUpscale(node),
        },
        {
            id: "superResolve",
            defaultVisible: false,
            panelLabel: t("canvas.imageToolbar.superResolve.panelLabel"),
            label: t("canvas.imageToolbar.superResolve.label"),
            title: t("canvas.imageToolbar.superResolve.title"),
            icon: () => <Sparkles className="size-4" />,
            run: (node, handlers) => handlers.onSuperResolve(node),
        },
        {
            id: "angle",
            defaultVisible: false,
            panelLabel: t("canvas.imageToolbar.angle.panelLabel"),
            label: t("canvas.imageToolbar.angle.label"),
            title: t("canvas.imageToolbar.angle.title"),
            icon: () => <Camera className="size-4" />,
            run: (node, handlers) => handlers.onAngle(node),
        },
        {
            id: "view",
            defaultVisible: true,
            panelLabel: t("canvas.imageToolbar.view.panelLabel"),
            label: t("canvas.imageToolbar.view.label"),
            title: t("canvas.imageToolbar.view.title"),
            icon: () => <Maximize2 className="size-4" />,
            run: (node, handlers) => handlers.onViewImage(node),
        },
    ];
}

export const defaultImageQuickToolIds: ImageQuickToolId[] = [...defaultBaseToolIds, "copyPrompt", "reversePrompt", "replace", "maskEdit", "crop", "split", "upscale", "view"];

export function buildImageToolbarTools(node: CanvasNodeData, handlers: ImageToolHandlers, t: TranslateFn) {
    return createImageToolDefinitions(t).map((tool) => ({
        id: tool.id,
        label: resolveToolText(tool.label, node),
        title: resolveToolText(tool.title, node),
        icon: tool.icon(node),
        active: tool.active?.(node),
        onClick: () => tool.run(node, handlers),
    }));
}

export function createImageToolbarSettingsTools(t: TranslateFn): ImageToolDefinition[] {
    return createImageToolDefinitions(t);
}

export function normalizeImageQuickToolIds(value: unknown[]) {
    const allIds: ImageQuickToolId[] = [...defaultBaseToolIds, ...imageToolIds];
    const ids = new Set(allIds);
    return allIds.filter((id) => value.includes(id) && ids.has(id));
}

export function readImageQuickToolsConfig(value: unknown): ImageQuickToolsConfig {
    if (Array.isArray(value)) return { ids: normalizeImageQuickToolIds(value), showLabels: true };
    if (!value || typeof value !== "object") return { ids: defaultImageQuickToolIds, showLabels: true };
    const data = value as Partial<ImageQuickToolsConfig>;
    return {
        ids: Array.isArray(data.ids) ? normalizeImageQuickToolIds(data.ids) : defaultImageQuickToolIds,
        showLabels: data.showLabels !== false,
    };
}

function resolveToolText(value: string | ((node: CanvasNodeData) => string), node: CanvasNodeData) {
    return typeof value === "function" ? value(node) : value;
}
