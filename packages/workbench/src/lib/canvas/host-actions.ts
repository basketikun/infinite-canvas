import type { CanvasNodeContext, CanvasClipboardFragment, Command, CanvasSnapshot, CommandContext, ImageAngleParams, ImageCropRect, ImageSplitParams, ImageUpscaleParams, Position } from "@infinite-canvas/plugin-sdk";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { canvasBinding, canvasFor } from "@workbench/lib/plugins/runtime";
import { hostTransactions } from "./host-transaction";
import type { CanvasSession } from "./canvas-session";

type Nodes = { nodeId: string };
type Media = { nodeId?: string; position?: Position };
export type HostActionMap = {
    nodeSaveAsset: [Nodes, void];
    nodeSelectReferences: [Nodes, void];
    nodeTogglePanel: [Nodes, void];
    nodeCreateImageFromText: [Nodes, CanvasSnapshot];
    nodeDownloadResource: [Nodes & { slotId?: string }, void];
    nodeCopyPrompt: [Nodes, void];
    nodeCreateImageReversePrompt: [Nodes, CanvasSnapshot];
    nodeSetImageFreeResize: [Nodes & { freeResize: boolean }, CanvasSnapshot];
    nodeOpenImageEditor: [Nodes & { tool: "crop" | "split" | "upscale" | "angle" | "mask" }, void];
    nodeCropImage: [Nodes & { crop: ImageCropRect }, CanvasSnapshot];
    nodeSplitImage: [Nodes & { params: ImageSplitParams }, CanvasSnapshot];
    nodeUpscaleImage: [Nodes & { params: ImageUpscaleParams }, CanvasSnapshot];
    nodeGenerateImageAngle: [Nodes & { params: ImageAngleParams }, CanvasSnapshot];
    nodeEditImageMask: [Nodes & { prompt: string; maskDataUrl: string; generate: boolean }, CanvasSnapshot];
    nodeCaptureVideoFrame: [Nodes & ({ position: "first" | "last" } | { position: "current"; currentTime: number }), CanvasSnapshot];
    nodeOpenInfo: [Nodes, void];
    canvasCopyToClipboard: [{ nodeIds: string[] }, void];
    canvasPasteFromClipboard: [{ position: Position }, CanvasSnapshot];
    canvasCopyNodes: [{ nodeIds: string[] }, CanvasClipboardFragment];
    canvasPasteNodes: [{ fragment: CanvasClipboardFragment; position: Position }, CanvasSnapshot];
    canvasExportProject: [void, void];
    canvasExportNodes: [{ nodeIds: string[] }, void];
    canvasOpenMediaPicker: [Media, void];
    canvasOpenShortcuts: [void, void];
    canvasOpenClearConfirmation: [void, void];
};
type Runs = { [K in keyof HostActionMap]?: (input: HostActionMap[K][0], context: CommandContext) => HostActionMap[K][1] | Promise<HostActionMap[K][1]> };
type Run = (input: never, context: CommandContext) => unknown;
const bound = new Map<string, { session: CanvasSession; run: Run }>();

/** 宿主界面动作：由当前画布页面绑定，业务入口直接调用，不进入插件命令。 */
export function hostContext(session: CanvasSession, extra?: AbortSignal): CommandContext {
    const base = canvasBinding(session);
    const canvas = canvasFor(builtinPlugin.scope, { kind: "ui" }, session, extra ? { ...base, signal: AbortSignal.any([session.signal, extra]) } : base);
    hostTransactions.set(canvas, (ops, options) => session.transact(ops, { ...options, source: { kind: "ui" } }));
    return { scope: canvas.scope, signal: canvas.signal, canvas };
}

export function bindHostActions(session: CanvasSession, runs: Runs) {
    const entries = Object.entries(runs) as [string, Run][];
    for (const [name, run] of entries) bound.set(name, { session, run });
    return () => { for (const [name, run] of entries) if (bound.get(name)?.run === run) bound.delete(name); };
}

export const hostActions = new Proxy({} as { [K in keyof HostActionMap]: (input: HostActionMap[K][0], signal?: AbortSignal) => Promise<HostActionMap[K][1]> }, {
    get: (_, name: string) => async (input: never, signal?: AbortSignal) => {
        const action = bound.get(name);
        if (!action || action.session.signal.aborted) throw new PluginError("PLUGIN_PROJECT_CHANGED");
        const context = hostContext(action.session, signal);
        try {
            const result = await action.run(input, context);
            context.signal.throwIfAborted();
            return result;
        }
        catch (error) {
            console.error("[canvas] action", name, error);
            if (context.signal.aborted) throw context.signal.reason instanceof PluginError ? context.signal.reason : new PluginError("PLUGIN_INACTIVE", { cause: error });
            throw error instanceof PluginError ? error : new PluginError("PLUGIN_OPERATION_FAILED", { cause: error });
        }
    },
});

/** 节点工具点击时执行保留命令。 */
export function runNodeCommand<I, O>(ctx: CanvasNodeContext, command: Command<I, O>, input: I) {
    return () => ctx.commands.execute(command, input, { scope: ctx.scope });
}
