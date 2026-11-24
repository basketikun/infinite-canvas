import { useCallback, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { Dialog } from "radix-ui";
import { PluginBoundary } from "@workbench/components/plugins/plugin-contributions";
import { usePluginViewScope } from "@workbench/hooks/use-plugin-view-scope";
import { canvasNeighbors } from "@workbench/lib/canvas/graph-index";
import { buildNodeContext } from "@workbench/lib/canvas/plugin-node-context";
import { getNodeDefinition, getNodePluginId, resolveNodeTools } from "@workbench/lib/canvas/node-registry";
import { setPluginCanvas } from "@workbench/lib/plugins/runtime";
import { canvasThemes } from "@workbench/lib/canvas-theme";
import type { CanvasNodeDefinition, CanvasNodeToolbarItem, CanvasPluginHost } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { CanvasNodePromptPanel } from "@workbench/components/canvas/canvas-node-prompt-panel";

export type OpenNodePanel = { nodeId: string; signal: AbortSignal; close(): void };

export function createNodePanelSelection(session: CanvasSession, publish: (panel: OpenNodePanel | null) => void) {
    let current: (OpenNodePanel & { controller: AbortController }) | null = null;
    const setNodeId: Dispatch<SetStateAction<string | null>> = (update) => {
        const previous = current;
        const previousId = previous?.nodeId ?? null;
        const nodeId = typeof update === "function" ? update(previousId) : update;
        if (nodeId === previousId) return;
        if (nodeId === null) current = null;
        else {
            session.signal.throwIfAborted();
            const controller = new AbortController();
            const panel = {
                nodeId, controller, signal: AbortSignal.any([session.signal, controller.signal]),
                close: () => { if (current === panel) setNodeId(null); },
            };
            current = panel;
        }
        const next = current;
        previous?.controller.abort();
        if (current === next) publish(next);
    };
    return { setNodeId, capture: (nodeId: string): OpenNodePanel | null => current?.nodeId === nodeId && !current.signal.aborted ? current : null };
}

type PluginHostParams = {
    session: CanvasSession;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    dialogPanel: OpenNodePanel | null;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
    isGenerating: (nodeId: string) => boolean;
    expandedNodeIds: Set<string>;
    setExpandedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    onImageSettingsOpenChange: (owner: AbortSignal, open: boolean) => void;
};

/** 节点宿主绑定本次项目会话；模型服务由工作区统一提供。 */
export function usePluginHost({ session, theme, dialogPanel, setDialogNodeId, isGenerating, expandedNodeIds, setExpandedNodeIds, onImageSettingsOpenChange }: PluginHostParams) {
    const pluginHost = useMemo<CanvasPluginHost>(() => ({
        canvas: session,
        isGenerating,
        isExpanded: (nodeId) => expandedNodeIds.has(nodeId),
        setExpanded: (nodeId, expanded) => {
            session.signal.throwIfAborted();
            setExpandedNodeIds((current) => { const next = new Set(current); if (expanded) next.add(nodeId); else next.delete(nodeId); return next; });
        },
        getUpstream: nodeId => canvasNeighbors(session.getSnapshot(), nodeId, "upstream", "connection"),
        getDownstream: nodeId => canvasNeighbors(session.getSnapshot(), nodeId, "downstream", "connection"),
        openPanel: (nodeId) => { session.signal.throwIfAborted(); setDialogNodeId(nodeId); },
        closePanel: (nodeId) => setDialogNodeId((current) => current === nodeId ? null : current),
    }), [session, setDialogNodeId, isGenerating, expandedNodeIds, setExpandedNodeIds]);
    useLayoutEffect(() => {
        setPluginCanvas(session);
        return () => setPluginCanvas(null);
    }, [session]);
    const renderPluginPanel = useCallback((panelNode: CanvasNodeData) => {
        const definition = getNodeDefinition(panelNode.type);
        if (dialogPanel?.nodeId !== panelNode.id || !definition || (!definition.Panel && !definition.useBuiltinPanel)) return null;
        return <PluginBoundary key={panelNode.id} remountOnReset resetKey={definition} pluginId={getNodePluginId(panelNode.type)} contributionId={panelNode.type} callbackName="Panel">
            <NodePanel node={panelNode} definition={definition} record={dialogPanel} host={pluginHost} theme={theme} onImageSettingsOpenChange={onImageSettingsOpenChange} />
        </PluginBoundary>;
    }, [dialogPanel, pluginHost, theme, onImageSettingsOpenChange]);
    const buildNodeToolbarItems = useCallback((node: CanvasNodeData): CanvasNodeToolbarItem[] => {
        const ctx = buildNodeContext(pluginHost, node, theme, session.getSnapshot().viewport.k);
        return resolveNodeTools(ctx);
    }, [pluginHost, session, theme]);
    return { pluginHost, renderPluginPanel, buildNodeToolbarItems };
}

function NodePanel({ node, definition, record, host, theme, onImageSettingsOpenChange }: { node: CanvasNodeData; definition: CanvasNodeDefinition; record: OpenNodePanel; host: CanvasPluginHost; theme: PluginHostParams["theme"]; onImageSettingsOpenChange: PluginHostParams["onImageSettingsOpenChange"] }) {
    const opener = useRef<HTMLElement | null>(null);
    const binding = usePluginViewScope(`node-panel:${record.nodeId}`, host.canvas.projectId, record.signal);
    useLayoutEffect(() => () => { if (binding) onImageSettingsOpenChange(binding.signal, false); }, [binding, onImageSettingsOpenChange]);
    const changeImageSettings = useCallback((open: boolean) => {
        if (binding && !binding.signal.aborted && getNodeDefinition(node.type) === definition) onImageSettingsOpenChange(binding.signal, open);
    }, [binding, definition, node.type, onImageSettingsOpenChange]);
    if (!binding || getNodeDefinition(node.type) !== definition) return null;
    const ctx = buildNodeContext({ ...host, closePanel: record.close }, node, theme, host.canvas.getSnapshot().viewport.k, false, binding);
    const Panel = definition.Panel;
    if (Panel && definition.panelPresentation === "fullscreen") return <Dialog.Root open>
        <Dialog.Portal><Dialog.Content aria-describedby={undefined} data-canvas-shortcuts-ignore data-canvas-no-zoom className="fixed inset-0 z-50 bg-background text-foreground outline-none"
            onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
            onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }}
            onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
            onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
            onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
            <Dialog.Title className="sr-only">{definition.title}</Dialog.Title>
            <Panel ctx={ctx} onClose={ctx.closePanel} />
        </Dialog.Content></Dialog.Portal>
    </Dialog.Root>;
    return Panel ? <Panel ctx={ctx} onClose={ctx.closePanel} /> : <CanvasNodePromptPanel ctx={ctx} mode={definition.useBuiltinPanel!.mode} onImageSettingsOpenChange={changeImageSettings} />;
}
