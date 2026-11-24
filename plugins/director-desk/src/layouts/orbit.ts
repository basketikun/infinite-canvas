import { z } from "zod";
import { defineCameraLayout } from "../api/camera-layouts";
import { OrbitParameters } from "./orbit-parameters";

export const orbitParameters = z.object({
    targetObjectId: z.string(), distance: z.number().finite().positive(), height: z.number().finite(), count: z.number().int().positive(),
}).strict();
export type OrbitOptions = z.infer<typeof orbitParameters>;

export const orbit = defineCameraLayout({
    title: "环绕目标", parametersSchema: orbitParameters, Parameters: OrbitParameters,
    generate({ scene, parameters }, { signal }) {
        const object = scene.objects.find(item => item.id === parameters.targetObjectId);
        if (!object?.visible || !object.focusTarget) throw new Error("CAMERA_TARGET_MISSING");
        const target = object.focusTarget;
        return { sceneId: scene.sceneId, shots: Array.from({ length: parameters.count }, (_, index) => {
            signal.throwIfAborted();
            const angle = index * Math.PI * 2 / parameters.count;
            return {
                name: `${object.name} · 环绕 ${index + 1}`,
                position: [target[0] + Math.sin(angle) * parameters.distance, target[1] + parameters.height, target[2] + Math.cos(angle) * parameters.distance],
                target, fov: 50, targetObjectId: object.id,
            };
        }) };
    },
});
