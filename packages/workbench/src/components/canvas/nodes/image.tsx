import { useEffect, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { ChevronRight, Copy, Download, Image as ImageIcon, RefreshCw, Star, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import type { CanvasNodeContentProps, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { canvasApply, nodeOpenPanel, nodePreviewImage, nodeRetry } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { hostActions } from "@workbench/lib/canvas/host-actions";
import { formatBytes } from "@workbench/lib/image-utils";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { useCanvasStore } from "@workbench/stores/canvas/use-canvas-store";
import { loadImagePreview, previewUrlFor, subscribeImagePreviews, getImagePreviewRevision } from "@workbench/services/image-storage";
import { CanvasNodeBatchFrame } from "../canvas-node-batch-frame";
import { buildImageSlotCopy, buildImageSlotRemoval, buildImageSlotSelection } from "./image-transactions";

type ImageSlot = NonNullable<NonNullable<ReadonlyCanvasNode["metadata"]>["images"]>[number];
const selectionColor = "var(--canvas-node-activeStroke, #2f80ff)";

export function ImageContent({ ctx }: CanvasNodeContentProps) {
    const { node, theme, expanded: batchExpanded } = ctx;
    const showImageInfo = useCanvasStore((state) => state.projects.find((project) => project.id === ctx.scope.projectId)?.showImageInfo);
    const resource = readNodeResource(node, "render", ctx.scope);
    const hasImage = resource?.kind === "image";
    const info = showImageInfo && hasImage ? <ImageInfoBar node={node} /> : null;
    const [failedPreview, setFailedPreview] = useState<string>();
    useEffect(() => { if (hasImage) void loadImagePreview(resource.storageKey); }, [hasImage, resource?.storageKey]);
    const run = async (action: () => Promise<unknown>) => {
        try { await action(); } catch (error) {
            if (!ctx.scope.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
        }
    };
    const currentNode = () => {
        const current = ctx.getNode(node.id);
        if (!current) throw new PluginError("PLUGIN_NOT_FOUND");
        return current;
    };
    const onViewBatchImage = (slotId?: string) => { void run(() => ctx.commands.execute(nodePreviewImage, { nodeId: node.id, slotId }, { scope: ctx.scope })); };
    const onDownloadBatchImage = (slotId: string) => { void run(() => hostActions.nodeDownloadResource({ nodeId: node.id, slotId }, ctx.scope.signal)); };
    const onRetryBatchImage = (slotId?: string) => { void run(() => ctx.commands.execute(nodeRetry, { nodeId: node.id, slotId }, { scope: ctx.scope })); };
    const onSetBatchPrimary = (slotId: string) => { void run(() => ctx.commands.execute(canvasApply, { ops: [buildImageSlotSelection(currentNode(), slotId)] }, { scope: ctx.scope })); };
    const onDeleteBatchImage = (slotId: string) => { void run(async () => {
        const result = await ctx.commands.execute(canvasApply, { ops: [buildImageSlotRemoval(currentNode(), slotId)] }, { scope: ctx.scope });
        if ((result.nodes.find((item) => item.id === node.id)?.metadata?.images?.length || 0) < 2) ctx.setExpanded(false);
    }); };
    const onDuplicateBatchImage = (slotId: string) => { void run(async () => {
        const copy = buildImageSlotCopy(currentNode(), slotId, nanoid());
        await ctx.commands.execute(canvasApply, { ops: [{ type: "add_node", node: copy }], selection: { nodeIds: [copy.id], connectionId: null } }, { scope: ctx.scope });
        await ctx.commands.execute(nodeOpenPanel, { nodeId: copy.id }, { scope: ctx.scope });
    }); };
    const onToggleBatch = () => {
        try { ctx.setExpanded(!batchExpanded); } catch (error) { if (!ctx.scope.signal.aborted) toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
    };
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const images = node.metadata?.images || [];
    const batchCount = images.length;
    const isBatchRoot = batchCount > 1;
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primarySource = hasImage ? previewUrlFor(resource.storageKey) : undefined;

    let content;
    if (!isBatchRoot && node.metadata?.status === "loading") content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
    else if (!isBatchRoot && node.metadata?.status === "error") content = (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata.errorDetails || "生成失败"}</div>
            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => { event.stopPropagation(); onRetryBatchImage(); }} onMouseDown={(event) => event.stopPropagation()}>
                <RefreshCw className="size-3.5" />{node.metadata.tasks?.length ? "查询原任务" : "重试"}
            </button>
        </div>
    );
    else if (!isBatchRoot && !hasImage) content = <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
        <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}><ImageIcon className="size-6 opacity-30" /></div>
        <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
    </div>;

    else content = (
        <CanvasNodeBatchFrame batchCount={batchCount} expanded={batchExpanded}>
            {batchExpanded
                ? images
                      .filter((image) => image.id !== primaryImageId)
                      .map((image, index) => <ExpandedImageCard key={image.id} node={node} image={image} index={index} scope={ctx.scope} onView={() => onViewBatchImage(image.id)} onSetPrimary={() => onSetBatchPrimary(image.id)} onDuplicate={() => onDuplicateBatchImage(image.id)} onDownload={() => onDownloadBatchImage(image.id)} onRetry={() => onRetryBatchImage(image.id)} onDelete={() => onDeleteBatchImage(image.id)} />)
                : null}
            <div className="h-full w-full overflow-hidden rounded-3xl">
                {primarySource && primarySource !== failedPreview ? (
                    <img
                        src={primarySource}
                        alt={node.title}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        onError={() => setFailedPreview(primarySource)}
                        className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    />
                ) : hasImage ? <div className="grid size-full place-items-center" title="双击查看图片"><ImageIcon className="size-6 opacity-40" /></div> : (
                    <ImageSlotStatus image={primaryImage} />
                )}
            </div>
            {primaryImage?.status === "error" ? <BatchImageFailureActions placement="left" onRetry={() => onRetryBatchImage(primaryImage.id)} onDelete={() => onDeleteBatchImage(primaryImage.id)} /> : null}
            {primaryImage && hasImage ? (
                <button type="button" className="pointer-events-none absolute left-2.5 top-2.5 z-30 flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-medium opacity-0 shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02] group-hover/node:pointer-events-auto group-hover/node:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title="下载" onClick={(event) => (event.stopPropagation(), onDownloadBatchImage(primaryImage.id))}>
                    <Download className="size-3" />
                    下载
                </button>
            ) : null}
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold shadow-[0_6px_18px_rgba(28,25,23,.16)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none">{`${batchCount} 张`}</span>
                    <ChevronRight className={`size-3.5 opacity-80 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
        </CanvasNodeBatchFrame>
    );
    return <div className="flex h-full w-full items-center justify-center" onDoubleClick={(event) => { if (hasImage) { event.stopPropagation(); onViewBatchImage(); } }}>
        {content}
        {info}
    </div>;
}

function ExpandedImageCard({ node, image, index, scope, onView, onSetPrimary, onDuplicate, onDownload, onRetry, onDelete }: { node: ReadonlyCanvasNode; image: ImageSlot; index: number; scope: ScopeBinding; onView: () => void; onSetPrimary: () => void; onDuplicate: () => void; onDownload: () => void; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resource = readNodeResource(node, "render", scope, image.id);
    const hasImage = resource?.kind === "image";
    const [failedPreview, setFailedPreview] = useState<string>();
    useEffect(() => { if (hasImage) void loadImagePreview(resource.storageKey); }, [hasImage, resource?.storageKey]);
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const count = node.metadata?.images?.length || 0;
    const columns = Math.min(count, 4);
    const rows = Math.ceil(count / columns);
    const rootSlot = (rows - 1) * columns;
    const slot = index >= rootSlot ? index + 1 : index;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    const x = column * (node.width + 18);
    const y = (row - rows + 1) * (node.height + 18);
    const source = hasImage ? previewUrlFor(resource.storageKey) : undefined;

    return (
        <div
            className={`absolute z-20 overflow-hidden rounded-3xl ${hasImage ? "" : "border shadow-[0_18px_50px_rgba(28,25,23,.18)]"}`}
            style={{
                    left: x,
                    top: y,
                    width: node.width,
                    height: node.height,
                    background: "transparent",
                    borderColor: theme.node.stroke,
                    "--batch-from-x": `${-x}px`,
                    "--batch-from-y": `${-y}px`,
                    "--batch-from-rotate": `${4 + index * 2}deg`,
                    animation: `canvas-batch-child-in 320ms ${index * 35}ms cubic-bezier(.2,.85,.18,1) both`,
                } as CSSProperties}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
                if (!hasImage || (event.target instanceof Element && event.target.closest("button"))) return;
                event.stopPropagation();
                onView();
            }}
        >
            {source && source !== failedPreview ? <img src={source} alt={node.title} draggable={false} onError={() => setFailedPreview(source)} className="pointer-events-none h-full w-full select-none object-contain" /> : hasImage ? <div className="grid size-full place-items-center" title="双击查看图片"><ImageIcon className="size-6 opacity-40" /></div> : <ImageSlotStatus image={image} />}
            {hasImage ? (
                <div className="pointer-events-none absolute inset-x-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/node:pointer-events-auto group-hover/node:opacity-100">
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title="下载" onClick={(event) => (event.stopPropagation(), onDownload())}>
                        <Download className="size-3 shrink-0" />
                        <span className="truncate">下载</span>
                    </button>
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title="创建副本" onClick={(event) => (event.stopPropagation(), onDuplicate())}>
                        <Copy className="size-3 shrink-0" />
                        <span className="truncate">创建副本</span>
                    </button>
                    <button type="button" className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg border px-1.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.toolbar.activeText }} title="设为主图" onClick={(event) => (event.stopPropagation(), onSetPrimary())}>
                        <Star className="size-3 shrink-0" style={{ color: selectionColor }} />
                        <span className="truncate">设为主图</span>
                    </button>
                </div>
            ) : null}
            {image.status === "error" ? <BatchImageFailureActions placement="right" onRetry={onRetry} onDelete={onDelete} /> : null}
        </div>
    );
}

function BatchImageFailureActions({ placement, onRetry, onDelete }: { placement: "left" | "right"; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RefreshCw className="size-3.5" />
                重试
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label="删除" title="删除">
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

function ImageSlotStatus({ image }: { image?: ImageSlot }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    const failed = image?.status === "error";
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <span className="text-xs leading-5">{image.errorDetails || "生成失败"}</span> : <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            {!failed ? <span className="text-[10px] tracking-[0.2em]">生成中</span> : null}
        </div>
    );
}

function ImageInfoBar({ node }: { node: ReadonlyCanvasNode }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

