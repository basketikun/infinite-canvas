import type { z } from "zod";
import type { PluginCommand, PluginContext } from "@infinite-canvas/plugin-sdk";
import { applySceneLayout, cameraLayouts, layoutResultSchema, sceneSummarySchema, sceneTargets } from "../api/camera-layouts";
import type { LayoutRequest } from "../lib/desk-messages";
import { editVoxel } from "../api/voxel-edit";
import { voxelEditOutput, type VoxelEditInput, type VoxelEditOutput } from "../lib/voxel-edit";

type Desk = { ctx: PluginContext; sceneId: string; request: LayoutRequest; session: AbortSignal };
let desk: Desk | null = null;

// 导演台打开后才能读取和修改场景；Agent 工具在未打开时给出明确提示。
export function openSceneLayout(ctx: PluginContext, sceneId: string, request: LayoutRequest, session: AbortSignal) {
    const current = { ctx, sceneId, request, session };
    desk = current;
    return () => { if (desk === current) desk = null; };
}
function opened() {
    if (!desk || desk.session.aborted) throw new Error("请先打开导演台");
    return desk;
}
async function summary({ sceneId, request }: Desk, signal: AbortSignal) {
    const scene = sceneSummarySchema.parse(await request({ action: "summary" }, signal));
    signal.throwIfAborted();
    if (scene.sceneId !== sceneId) throw new Error("CANVAS_CHANGED");
    return scene;
}

export const readTargets: PluginCommand<z.infer<typeof sceneTargets.input>, z.infer<typeof sceneTargets.output>> = {
    command: sceneTargets, title: "读取镜头目标",
    run: async (_, context) => {
        const current = opened();
        if (context.scope.projectId !== current.ctx.scope.projectId) throw new Error("CANVAS_CHANGED");
        const scene = await summary(current, AbortSignal.any([current.session, context.signal]));
        return { sceneId: current.sceneId, targets: scene.objects.filter(item => item.visible && item.focusTarget).map(({ id, name }) => ({ id, name })) };
    },
};

export const applyLayout: PluginCommand<z.infer<typeof applySceneLayout.input>, z.infer<typeof applySceneLayout.output>> = {
    command: applySceneLayout, title: "应用镜头布局",
    run: async (input, context) => {
        const current = opened();
        const { ctx, sceneId, request, session } = current;
        if (input.sceneId !== sceneId || context.scope.projectId !== ctx.scope.projectId) throw new Error("CANVAS_CHANGED");
        const entry = ctx.extensions.query(cameraLayouts, ctx.scope).find(item => item.id === input.layoutId);
        if (!entry) throw new Error("UNKNOWN_TOOL");
        const signal = AbortSignal.any([entry.signal, session, context.signal]);
        return ctx.extensions.track(entry, async () => {
            const scene = await summary(current, signal);
            const result = layoutResultSchema.parse(await entry.value.generate({ scene, parameters: entry.value.parametersSchema.parse(input.parameters) }, { signal }));
            signal.throwIfAborted();
            if (result.sceneId !== sceneId) throw new Error("CANVAS_CHANGED");
            await request({ action: "apply-layout", result }, signal);
            return { sceneId, addedShots: result.shots.length };
        });
    },
};

export const editSceneVoxel: PluginCommand<VoxelEditInput, VoxelEditOutput> = {
    command: editVoxel, title: "编辑体素",
    run: async (input, context) => {
        const { ctx, sceneId, request, session } = opened();
        if (input.sceneId !== sceneId || context.scope.projectId !== ctx.scope.projectId) throw new Error("CANVAS_CHANGED");
        const signal = AbortSignal.any([session, context.signal]);
        signal.throwIfAborted();
        const result = voxelEditOutput.parse(await request({ action: "edit-voxel", input }, signal));
        signal.throwIfAborted();
        if (result.sceneId !== sceneId || result.objectId !== input.objectId) throw new Error("CANVAS_CHANGED");
        return result;
    },
};
