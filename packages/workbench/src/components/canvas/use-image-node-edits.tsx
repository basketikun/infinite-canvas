import { commitHostTransaction } from "@workbench/lib/canvas/host-transaction";
import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { workbenchMessageOptions } from "@workbench/components/ui/sonner";
import { nanoid } from "nanoid";
import type { CommandContext, ImageCropRect, ImageSplitParams, ImageUpscaleParams, ReadonlyCanvasNode } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import { getPluginErrorMessage, PluginError } from "@infinite-canvas/shared/plugins";
import { CanvasNodeType, type CanvasNodeData } from "@infinite-canvas/shared/canvas/schema/canvas";
import { CanvasNodeAngleDialog } from "@workbench/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog } from "@workbench/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog } from "@workbench/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog } from "@workbench/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog } from "@workbench/components/canvas/canvas-node-upscale-dialog";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { prepareImage } from "@workbench/lib/canvas/canvas-session-media";
import { cropImage, splitImage, upscaleImage } from "@workbench/lib/canvas/canvas-image-data";
import { fitNodeSize } from "@workbench/lib/canvas/canvas-node-size";
import { imageMetadata } from "@workbench/lib/canvas/canvas-node-factory";
import { readNodeResource } from "@workbench/lib/canvas/node-registry";
import { registerCanvasNodeAsset } from "@workbench/lib/canvas/register-canvas-asset";
import { pluginRegistry } from "@workbench/lib/plugins/registry";
import { bindHostActions } from "@workbench/lib/canvas/host-actions";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { CANVAS_IMAGE_PREVIEW_MAX_EDGE, createImageThumbnail } from "@workbench/lib/image-thumbnail";
import { loadImagePreview, previewUrlFor, readImageBlob } from "@workbench/services/image-storage";

type ImageTool = "crop" | "split" | "upscale" | "angle" | "mask";
type ImageEdit = { tool: "crop"; crop: ImageCropRect } | { tool: "split"; params: ImageSplitParams } | { tool: "upscale"; params: ImageUpscaleParams };
type ImageSize = { width: number; height: number };
type EditorRecord = { id: string; nodeId: string; tool: ImageTool; scope: ScopeBinding; controller: AbortController; sourceUrl?: string; storageKey?: string; dataUrl?: string; image: ImageSize | null; loadingPreview: boolean; release: () => void; previewUrl?: string };

export type ImageNodeEditorProps = { nodeId: string; scope: ScopeBinding; dataUrl?: string; image: ImageSize | null; loadingPreview: boolean; open: boolean; onClose: () => void; onLoadPreview: () => void };

function imageTarget(session: CanvasSession, nodeId: string, context: CommandContext) {
    context.signal.throwIfAborted();
    if (session.signal.aborted || context.canvas?.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    const node = context.canvas.getNodes().find((item) => item.id === nodeId);
    if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
    const resource = readNodeResource(node, "execute", context.scope);
    if (resource?.kind !== "image" || !(resource.storageKey || resource.url)) throw new PluginError("PLUGIN_NOT_FOUND");
    resource.signal.throwIfAborted();
    return { node, resource };
}

async function editImage(session: CanvasSession, nodeId: string, edit: ImageEdit, context: CommandContext, setDialogNodeId: Dispatch<SetStateAction<string | null>>) {
    const { node, resource } = imageTarget(session, nodeId, context);
    const canvas = context.canvas!;
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, session.signal, resource.signal, controller.signal]);
    const revision = session.getSnapshot().revision;
    const check = () => {
        if (signal.aborted) return;
        try {
            const current = imageTarget(session, nodeId, context);
            if (current.node.type !== node.type || current.resource.contributionId !== resource.contributionId || current.resource.storageKey !== resource.storageKey || current.resource.url !== resource.url) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
        } catch (error) { controller.abort(error); }
    };
    const unsubscribe = session.subscribe(check);
    const releaseTarget = session.on("document.committed", (event) => {
        if (event.revision > revision && event.removedNodeIds?.includes(nodeId)) controller.abort(new PluginError("PLUGIN_NOT_FOUND"));
    });
    const unsubscribeRegistry = pluginRegistry.subscribeAll(check);
    try {
        const pieces = edit.tool === "split" ? await splitImage(resource, edit.params, signal) : [{ row: 0, column: 0, blob: edit.tool === "crop" ? await cropImage(resource, edit.crop, signal) : await upscaleImage(resource, edit.params, signal) }];
        signal.throwIfAborted();
        const results = await Promise.allSettled(pieces.map(async (piece) => {
            try {
                const image = await prepareImage(piece.blob, signal);
                const width = Math.min(node.width, Math.max(220, image.width));
                const size = edit.tool === "split" ? { width: node.width / edit.params.columns, height: node.height / edit.params.rows } : edit.tool === "crop" ? { width, height: width * image.height / image.width } : fitNodeSize(image.width, image.height);
                return {
                    id: nanoid(), type: CanvasNodeType.Image,
                    title: edit.tool === "split" ? `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}` : edit.tool === "crop" ? "裁剪图片" : "放大图片",
                    position: { x: node.position.x + node.width + 96 + piece.column * (size.width + 16), y: node.position.y + piece.row * (size.height + 16) },
                    ...size, metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
                } satisfies CanvasNodeData;
            } catch (error) { controller.abort(error); throw error; }
        }));
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
        const children = results.map((result) => (result as PromiseFulfilledResult<CanvasNodeData>).value);
        check();
        signal.throwIfAborted();
        const snapshot = commitHostTransaction(canvas, [
            ...children.map((child) => ({ type: "add_node" as const, node: child })),
            ...children.map((child) => ({ type: "connect_nodes" as const, connection: { id: nanoid(), fromNodeId: nodeId, toNodeId: child.id } })),
        ], { selection: { nodeIds: children.map((child) => child.id), connectionId: null } });
        signal.throwIfAborted();
        await Promise.all(children.map((child) => registerCanvasNodeAsset(child, "上传")));
        if (edit.tool === "split") setDialogNodeId(null);
        else await executeCommand(nodeOpenPanel, { nodeId: children[0].id }, { scope: context.scope, signal, session });
        signal.throwIfAborted();
        return snapshot;
    } finally {
        unsubscribe();
        releaseTarget();
        unsubscribeRegistry();
    }
}

export function registerImageNodeEdits(session: CanvasSession, openEditor: (tool: ImageTool, node: ReadonlyCanvasNode, context: CommandContext) => void, setDialogNodeId: Dispatch<SetStateAction<string | null>>) {
    return bindHostActions(session, {
        nodeOpenImageEditor: ({ nodeId, tool }, context) => { openEditor(tool, imageTarget(session, nodeId, context).node, context); },
        nodeCropImage: ({ nodeId, crop }, context) => editImage(session, nodeId, { tool: "crop", crop }, context, setDialogNodeId),
        nodeSplitImage: ({ nodeId, params }, context) => editImage(session, nodeId, { tool: "split", params }, context, setDialogNodeId),
        nodeUpscaleImage: ({ nodeId, params }, context) => editImage(session, nodeId, { tool: "upscale", params }, context, setDialogNodeId),
    });
}

export function useImageNodeEdits(session: CanvasSession, setDialogNodeId: Dispatch<SetStateAction<string | null>>) {
    const records = useRef(new Map<ImageTool, EditorRecord>());
    const [editors, setEditors] = useState<EditorRecord[]>([]);
    const close = useCallback((record: EditorRecord) => {
        if (records.current.get(record.tool) !== record) return;
        records.current.delete(record.tool);
        record.release();
        record.controller.abort(new PluginError("PLUGIN_SCOPE_CLOSED"));
        if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
        setEditors([...records.current.values()]);
    }, []);
    useLayoutEffect(() => {
        const dispose = registerImageNodeEdits(session, (tool, node, context) => {
            const previous = records.current.get(tool);
            if (previous) close(previous);
            const { resource } = imageTarget(session, node.id, context);
            const revision = session.getSnapshot().revision;
            const controller = new AbortController();
            const scope = Object.freeze({ ...context.scope, signal: AbortSignal.any([context.signal, session.signal, resource.signal, controller.signal]) });
            scope.signal.throwIfAborted();
            const metadata = (resource.storageKey ? resource.storageKey === node.metadata?.storageKey : resource.url === node.metadata?.content) ? node.metadata : undefined;
            const record: EditorRecord = {
                id: nanoid(), nodeId: node.id, tool, scope, controller, sourceUrl: resource.url, storageKey: resource.storageKey, loadingPreview: false,
                dataUrl: previewUrlFor(resource.storageKey),
                image: metadata?.naturalWidth && metadata.naturalHeight ? { width: metadata.naturalWidth, height: metadata.naturalHeight } : null,
                release: () => { unsubscribe(); releaseTarget(); unsubscribeRegistry(); scope.signal.removeEventListener("abort", abort); },
            };
            const abort = () => close(record);
            const check = () => {
                if (scope.signal.aborted || session.signal.aborted) { close(record); return; }
                const current = session.getSnapshot().nodes.find((item) => item.id === record.nodeId);
                const currentResource = current ? readNodeResource(current, "render", scope) : null;
                if (current?.type !== node.type || currentResource?.kind !== "image" || currentResource.contributionId !== resource.contributionId || currentResource.storageKey !== record.storageKey || currentResource.url !== record.sourceUrl) close(record);
            };
            const unsubscribe = session.subscribe(check);
            const releaseTarget = session.on("document.committed", (event) => {
                if (event.revision > revision && event.removedNodeIds?.includes(node.id)) close(record);
            });
            const unsubscribeRegistry = pluginRegistry.subscribeAll(check);
            scope.signal.addEventListener("abort", abort, { once: true });
            records.current.set(tool, record);
            setEditors([...records.current.values()]);
            if (!record.dataUrl && record.storageKey) void loadImagePreview(record.storageKey).then((preview) => {
                if (!preview || scope.signal.aborted || records.current.get(tool) !== record || record.dataUrl) return;
                record.dataUrl = preview;
                setEditors([...records.current.values()]);
            });
        }, setDialogNodeId);
        return () => { dispose(); for (const record of [...records.current.values()]) close(record); };
    }, [session, setDialogNodeId, close]);
    const loadPreview = async (record: EditorRecord) => {
        if (record.loadingPreview) return;
        record.loadingPreview = true;
        setEditors([...records.current.values()]);
        try {
            record.scope.signal.throwIfAborted();
            const node = session.getSnapshot().nodes.find((item) => item.id === record.nodeId);
            if (!node) throw new PluginError("PLUGIN_NOT_FOUND");
            const resource = readNodeResource(node, "execute", record.scope);
            if (resource?.kind !== "image" || resource.storageKey !== record.storageKey || resource.url !== record.sourceUrl) throw new PluginError("PLUGIN_NOT_FOUND");
            const blob = await readImageBlob(resource.storageKey, resource.url, { signal: record.scope.signal });
            record.scope.signal.throwIfAborted();
            const bitmap = await createImageBitmap(blob);
            const size = { width: bitmap.width, height: bitmap.height };
            bitmap.close();
            record.scope.signal.throwIfAborted();
            const preview = Math.max(size.width, size.height) <= CANVAS_IMAGE_PREVIEW_MAX_EDGE ? blob : await createImageThumbnail(blob);
            record.scope.signal.throwIfAborted();
            if (!preview) throw new PluginError("PLUGIN_OPERATION_FAILED");
            if (records.current.get(record.tool) !== record) return;
            if (record.previewUrl) URL.revokeObjectURL(record.previewUrl);
            record.previewUrl = URL.createObjectURL(preview);
            record.dataUrl = record.previewUrl;
            record.image = size;
            setEditors([...records.current.values()]);
        } catch (error) {
            if (!record.scope.signal.aborted) { console.error("[canvas] image editor preview", record.nodeId, error); toast.error(getPluginErrorMessage(error), workbenchMessageOptions.error); }
        } finally {
            record.loadingPreview = false;
            if (records.current.get(record.tool) === record) setEditors([...records.current.values()]);
        }
    };
    return <>{editors.map((record) => {
        const props: ImageNodeEditorProps = { nodeId: record.nodeId, scope: record.scope, dataUrl: record.dataUrl, image: record.image, loadingPreview: record.loadingPreview, open: true, onClose: () => close(record), onLoadPreview: () => { void loadPreview(record); } };
        return record.tool === "crop" ? <CanvasNodeCropDialog key={record.id} {...props} /> : record.tool === "split" ? <CanvasNodeSplitDialog key={record.id} {...props} /> : record.tool === "upscale" ? <CanvasNodeUpscaleDialog key={record.id} {...props} /> : record.tool === "angle" ? <CanvasNodeAngleDialog key={record.id} {...props} /> : <CanvasNodeMaskEditDialog key={record.id} {...props} />;
    })}</>;
}
