import { PluginError } from "@infinite-canvas/shared/plugins";
import { uploadMediaFile } from "@workbench/services/file-storage";
import { canvasNodeIndex } from "./graph-index";
import { getPluginNodeContext } from "@workbench/lib/plugins/runtime";
import type { CanvasTheme } from "@workbench/lib/canvas-theme";
import type { CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { readonlySnapshot } from "@infinite-canvas/plugin-sdk/readonly-snapshot";

export function buildNodeContext(host: CanvasPluginHost, node: CanvasNodeData, theme: CanvasTheme, scale: number, isSelected = false, viewBinding?: ScopeBinding): CanvasNodeContext {
    const { ctx: context, canvas } = getPluginNodeContext(node.type, host.canvas, viewBinding);
    return Object.freeze({
        plugin: context,
        scope: context.scope,
        commands: context.commands,
        images: context.images,
        media: context.media,
        node: readonlySnapshot(node), theme: readonlySnapshot(theme), scale, isSelected,
        isGenerating: host.isGenerating(node.id),
        expanded: host.isExpanded(node.id),
        setExpanded: (expanded) => { canvas.signal.throwIfAborted(); host.setExpanded(node.id, expanded); },
        async updateMetadata(patch, attachments) {
            if (!attachments) return canvas.transact([{ type: "update_node", id: node.id, metadata: patch }]);
            const signal = canvas.signal;
            const previous = new Map(canvas.getNodes().find(item => item.id === node.id)?.metadata?.attachments?.map(file => [file.slot, file.storageKey]));
            const files = new Map(attachments.files.map(file => [file.key, file.file]));
            const slots: { slot: string; storageKey: string }[] = [];
            for (const slot of attachments.keys) {
                let storageKey = previous.get(slot);
                if (!storageKey) {
                    const file = files.get(slot);
                    if (!file) throw new PluginError("PLUGIN_NOT_FOUND");
                    storageKey = (await uploadMediaFile(file, "file", signal)).storageKey;
                }
                slots.push({ slot, storageKey });
            }
            signal.throwIfAborted();
            if (canvas.getNodes().find(item => item.id === node.id)?.type !== node.type) throw new PluginError("PLUGIN_NOT_FOUND");
            const result = host.canvas.transact([{ type: "update_node", id: node.id, metadata: { ...patch, attachments: slots } }], { source: { kind: "plugin", id: context.id } });
            await canvas.flush();
            return result;
        },
        updateNode: (patch) => canvas.transact([{ type: "update_node", id: node.id, patch }]),
        getSnapshot: canvas.getSnapshot,
        subscribe: canvas.subscribe,
        getNode: (id: string) => canvasNodeIndex(canvas.getNodes()).get(id)?.node ?? null,
        getNodes: canvas.getNodes,
        getConnections: canvas.getConnections,
        getUpstream: () => { canvas.signal.throwIfAborted(); return readonlySnapshot(host.getUpstream(node.id)); },
        getDownstream: () => { canvas.signal.throwIfAborted(); return readonlySnapshot(host.getDownstream(node.id)); },
        transact: canvas.transact,
        models: canvas.models,
        openPanel: () => { canvas.signal.throwIfAborted(); host.openPanel(node.id); },
        closePanel: () => { canvas.signal.throwIfAborted(); host.closePanel(node.id); },
        storage: context.storage,
    } satisfies CanvasNodeContext);
}
