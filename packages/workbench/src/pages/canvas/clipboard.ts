import { canvasImportMedia, canvasInsertAsset, nodeOpenPanel } from "@infinite-canvas/plugin-sdk/builtin";
import type { Position } from "@infinite-canvas/plugin-sdk";
import type { ScopeBinding } from "@infinite-canvas/plugin-sdk/runtime";
import { PluginError } from "@infinite-canvas/shared/plugins";
import type { CanvasSession } from "@workbench/lib/canvas/canvas-session";
import { executeCommand } from "@workbench/lib/plugins/commands";
import { registerChangedCanvasAssets } from "@workbench/lib/canvas/register-canvas-asset";

export async function pasteSystemClipboard(session: CanvasSession, scope: ScopeBinding, position: Position): Promise<"image" | "text" | null> {
    const signal = AbortSignal.any([session.signal, scope.signal]);
    signal.throwIfAborted();
    if (scope.projectId !== session.projectId) throw new PluginError("PLUGIN_PROJECT_CHANGED");
    if (!navigator.clipboard) return null;
    const targetPosition = { ...position };
    const options = { session, scope, signal, source: { kind: "ui" as const } };
    const items = await navigator.clipboard.read();
    signal.throwIfAborted();
    const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
    if (imageItem) {
        const type = imageItem.types.find((type) => type.startsWith("image/"))!;
        const blob = await imageItem.getType(type);
        signal.throwIfAborted();
        const file = new File([blob], "clipboard-image.png", { type });
        const before = session.getSnapshot().nodes;
        const snapshot = await executeCommand(canvasImportMedia, { files: [file], position: targetPosition }, options);
        signal.throwIfAborted();
        await session.flush();
        signal.throwIfAborted();
        registerChangedCanvasAssets(before, snapshot.nodes);
        signal.throwIfAborted();
        return "image";
    }
    const textItem = items.find((item) => item.types.includes("text/plain"));
    if (!textItem) return null;
    const blob = await textItem.getType("text/plain");
    signal.throwIfAborted();
    const text = await blob.text();
    signal.throwIfAborted();
    if (text === "") return null;
    const result = await executeCommand(canvasInsertAsset, { asset: { kind: "text", title: text.slice(0, 32), content: text }, position: targetPosition }, options);
    signal.throwIfAborted();
    await session.flush();
    signal.throwIfAborted();
    await executeCommand(nodeOpenPanel, { nodeId: result.selection.nodeIds[0] }, options);
    signal.throwIfAborted();
    return "text";
}
