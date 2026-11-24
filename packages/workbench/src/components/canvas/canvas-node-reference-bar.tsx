import { FileText, Image as ImageIcon, Music2, Plus, Puzzle, Video, X } from "lucide-react";
import { HoverCard } from "radix-ui";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { canvasThemes } from "@workbench/lib/canvas-theme";
import { MediaPlayer } from "@workbench/components/media-player";
import { readNodeResource, useNodeRegistryVersion } from "@workbench/lib/canvas/node-registry";
import { getGroupResourceNodes } from "@workbench/lib/canvas/canvas-resource-references";
import { getImagePreviewRevision, loadImagePreview, previewUrlFor, subscribeImagePreviews } from "@workbench/services/image-storage";
import { useThemeStore } from "@workbench/stores/use-theme-store";
import { CanvasNodeType } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import { nodePreviewImage } from "@infinite-canvas/plugin-sdk/builtin";
import { PluginError, getPluginErrorMessage } from "@infinite-canvas/shared/plugins";
import { executeCommand } from "@workbench/lib/plugins/commands";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";

export function CanvasNodeReferenceBar({ nodeId, scope, nodes, connectedNodes, onDisconnect, onStartSelection }: { nodeId: string; scope: ScopeBinding; nodes: readonly ReadonlyCanvasNode[]; connectedNodes: readonly ReadonlyCanvasNode[]; onDisconnect?: (fromNodeId: string, toNodeId: string) => void; onStartSelection?: (nodeId: string) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useNodeRegistryVersion((state) => state.version);
    const references = connectedNodes.flatMap((sourceNode) => (sourceNode.type === CanvasNodeType.Group ? getGroupResourceNodes(sourceNode.id, nodes, "render", scope) : [sourceNode]).map((node) => ({ node, sourceNodeId: sourceNode.id })));
    return (
        <div className="mb-2">
            <div className="mb-1.5 text-[11px] font-medium" style={{ color: theme.node.muted }}>参考内容</div>
            <div className="thin-scrollbar flex min-h-12 gap-2 overflow-x-auto pb-1">
                {references.map(({ node, sourceNodeId }) => <ReferenceItem key={`${sourceNodeId}:${node.id}`} node={node} scope={scope} onRemove={() => onDisconnect?.(sourceNodeId, nodeId)} />)}
                <button type="button" className="grid size-12 shrink-0 place-items-center rounded-xl border bg-transparent transition hover:opacity-70" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }} title="从画布选择参考节点" onClick={() => onStartSelection?.(nodeId)}>
                    <Plus className="size-4" />
                </button>
            </div>
        </div>
    );
}

function ReferenceItem({ node, scope, onRemove }: { node: ReadonlyCanvasNode; scope: ScopeBinding; onRemove: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const resource = readNodeResource(node, "render", scope);
    const thumbnail = resource?.kind === "image" ? previewUrlFor(resource.storageKey) : undefined;
    const [failed, setFailed] = useState<string>();
    const trigger = useRef<HTMLDivElement>(null);
    const [popover, setPopover] = useState<AbortController | null>(null);
    useEffect(() => { if (resource?.kind === "image") void loadImagePreview(resource.storageKey); }, [resource?.kind, resource?.storageKey]);
    useEffect(() => () => popover?.abort(), [popover]);
    const Icon = resource?.kind === "image" ? ImageIcon : resource?.kind === "video" ? Video : resource?.kind === "audio" ? Music2 : resource?.kind === "text" ? FileText : Puzzle;
    return (
        <HoverCard.Root openDelay={150} closeDelay={100} open={Boolean(popover)} onOpenChange={(open) => {
            if (open) { if (!popover) setPopover(new AbortController()); }
            else { popover?.abort(); setPopover(null); }
        }}>
            <HoverCard.Trigger asChild><div ref={trigger} tabIndex={0} aria-label={node.title} className="group relative grid size-12 shrink-0 place-items-center rounded-xl border" style={{ background: theme.toolbar.activeBg, borderColor: theme.toolbar.border }}>
                <span className="grid size-full place-items-center overflow-hidden rounded-[inherit]">
                    {thumbnail && thumbnail !== failed ? <img src={thumbnail} alt="" onError={() => setFailed(thumbnail)} className="size-full object-cover" /> : <Icon className="size-4 opacity-65" />}
                </span>
                <button type="button" className="absolute right-0 top-0 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }} aria-label="断开参考连接" title="断开参考连接" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><X className="size-3" /></button>
            </div></HoverCard.Trigger>
            <HoverCard.Portal container={trigger.current?.closest<HTMLElement>('[role="dialog"]')}>
                <HoverCard.Content side="top" align="start" sideOffset={6} collisionPadding={8} data-canvas-shortcuts-ignore data-canvas-no-zoom
                    className="workbench-dialog pointer-events-auto z-[1200] max-w-[calc(100vw-16px)] rounded-lg bg-(--workbench-elevated-panel) p-3 text-(--workbench-elevated-text)">
                    {popover && <ReferencePreview node={node} resource={resource} scope={scope} signal={popover.signal} />}
                </HoverCard.Content>
            </HoverCard.Portal>
        </HoverCard.Root>
    );
}

function ReferencePreview({ node, resource, scope, signal }: { node: ReadonlyCanvasNode; resource: ReturnType<typeof readNodeResource>; scope: ScopeBinding; signal: AbortSignal }) {
    const [failed, setFailed] = useState<string>();
    const resourceSignal = resource?.signal;
    const playbackSignal = useMemo(() => resourceSignal ? AbortSignal.any([resourceSignal, scope.signal, signal]) : signal, [resourceSignal, scope.signal, signal]);
    const preview = resource?.kind === "image" ? previewUrlFor(resource.storageKey) : undefined;
    if (resource?.kind === "image") return <div className="w-72 space-y-2">
        {preview && preview !== failed ? <img src={preview} alt={node.title} onError={() => setFailed(preview)} className="max-h-52 w-full rounded-lg object-contain" /> : <div className="grid h-32 place-items-center"><ImageIcon className="size-6 opacity-50" /></div>}
        <button type="button" className="rounded-md px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" onClick={() => {
            void executeCommand(nodePreviewImage, { nodeId: node.id }, { scope, signal: resource.signal }).catch((error) => {
                if (!scope.signal.aborted && !resource.signal.aborted && !(error instanceof PluginError && ["PLUGIN_INACTIVE", "PLUGIN_SCOPE_CLOSED", "PLUGIN_PROJECT_CHANGED"].includes(error.code))) void toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error);
            });
        }}>查看原图</button>
    </div>;
    if ((resource?.kind === "video" || resource?.kind === "audio") && (resource.storageKey || resource.url)) return <MediaPlayer source={{ kind: resource.kind, storageKey: resource.storageKey, url: resource.url, signal: playbackSignal }} className={resource.kind === "video" ? "max-h-52 w-72 rounded-lg" : "w-72"} />;
    return <div className="max-h-52 w-72 overflow-auto whitespace-pre-wrap text-sm">{resource?.text || node.title || "暂无内容"}</div>;
}
