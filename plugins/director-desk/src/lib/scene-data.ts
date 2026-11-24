import type { CanvasNodeContext } from "@infinite-canvas/plugin-sdk";
import type { Attachment, Scene } from "./desk-messages";

export function openNodeScene(ctx: CanvasNodeContext, signal: AbortSignal) {
    let loaded = false;
    return {
        async load() {
            signal.throwIfAborted();
            const node = ctx.getNode(ctx.node.id);
            if (!node) throw new Error("NODE_MISSING");
            const scene = node.metadata?.directorScene as Scene | undefined;
            const results = await Promise.allSettled((node.metadata?.attachments ?? []).map(async ({ slot, storageKey }) => ({
                key: slot, file: await ctx.media.read(storageKey, undefined, signal),
            })));
            signal.throwIfAborted();
            loaded = true;
            return { scene: scene ?? null, files: results.filter(result => result.status === "fulfilled").map(result => result.value) };
        },
        async save(scene: Scene, added: Attachment[]) {
            if (!loaded) throw new Error("SCENE_NOT_LOADED");
            await ctx.updateMetadata({ directorScene: JSON.parse(JSON.stringify(scene)) }, { keys: scene.keys, files: added });
        },
    };
}
