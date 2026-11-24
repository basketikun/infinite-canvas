import { z } from "zod";
import { isValidElementType } from "react-is";
import type { ComponentType } from "react";
import { defineCommand, defineExtensionPoint } from "@infinite-canvas/plugin-sdk";

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const transform = z.object({ position: vector, rotation: vector, scale: vector }).strict();
const shot = z.object({ name: z.string(), position: vector, target: vector, fov: z.number().finite().min(10).max(120), targetObjectId: z.string().nullable() }).strict();

export const sceneSummarySchema = z.object({
    sceneId: z.string(), transform,
    objects: z.array(z.object({
        id: z.string(), name: z.string(), kind: z.enum(["character", "scene", "prop", "camera", "panorama"]),
        visible: z.boolean(), transform, focusTarget: vector.nullable(),
    }).strict()),
    cameras: z.array(shot.extend({ id: z.string() })), selectedObjectIds: z.array(z.string()),
}).strict();
export const layoutResultSchema = z.object({ sceneId: z.string(), shots: z.array(shot) }).strict();
export type SceneSummary = z.infer<typeof sceneSummarySchema>;
export type LayoutResult = z.infer<typeof layoutResultSchema>;
export type CameraLayoutParametersProps<P> = { scene: SceneSummary; value: Partial<P>; onChange(value: Partial<P>): void };
export type CameraLayout<P = any> = {
    title: string;
    parametersSchema: z.ZodType<P>;
    Parameters?: ComponentType<CameraLayoutParametersProps<P>>;
    generate(input: { scene: SceneSummary; parameters: P }, context: { signal: AbortSignal }): LayoutResult | Promise<LayoutResult>;
};

export const cameraLayouts = defineExtensionPoint<CameraLayout>({
    id: "director-desk:camera-layouts",
    schema: z.object({
        title: z.string(), parametersSchema: z.custom<z.ZodType>((value) => typeof value?.safeParse === "function"),
        Parameters: z.custom<ComponentType<CameraLayoutParametersProps<any>>>(isValidElementType).optional(),
        generate: z.custom<CameraLayout["generate"]>((value) => typeof value === "function"),
    }),
});

export function defineCameraLayout<P>(definition: CameraLayout<P>): CameraLayout<P> {
    return { ...definition, generate: async (input, context) => {
        context.signal.throwIfAborted();
        const parameters = definition.parametersSchema.parse(input.parameters);
        const result = await definition.generate({ scene: sceneSummarySchema.parse(input.scene), parameters }, context);
        context.signal.throwIfAborted();
        return layoutResultSchema.parse(result);
    } };
}


export const sceneTargets = defineCommand({
    id: "director-desk:scene-targets", scope: "project", input: z.object({}).strict(),
    output: z.object({ sceneId: z.string(), targets: z.array(z.object({ id: z.string(), name: z.string() })) }),
});

export const applySceneLayout = defineCommand({
    id: "director-desk:apply-layout", scope: "project",
    input: z.object({ sceneId: z.string(), layoutId: z.string(), parameters: z.record(z.unknown()) }).strict(),
    output: z.object({ sceneId: z.string(), addedShots: z.number().int() }),
});
