import { layoutResultSchema, sceneSummarySchema, type LayoutResult } from "../../../api/camera-layouts";
import type { DirectorProject } from "./directorProject";
import { getDirectorObjectFocusTarget, isCameraFocusableObject } from "./cameraTarget";

export function getSceneSummary(project: DirectorProject, selectedObjectIds: string[], sceneId: string) {
    const { position, rotation, scale } = project.scene;
    return sceneSummarySchema.parse({
        sceneId, transform: { position, rotation, scale: [scale, scale, scale] }, selectedObjectIds,
        objects: project.objects.map(object => ({
            id: object.id, name: object.name, kind: object.kind, visible: object.visible, transform: object.transform,
            focusTarget: isCameraFocusableObject(object) ? getDirectorObjectFocusTarget(object) : null,
        })),
        cameras: project.cameras.map(camera => ({
            id: camera.id, name: camera.name, position: camera.transform.position, target: camera.target,
            fov: camera.fov, targetObjectId: camera.targetMode === "object" ? camera.targetObjectId : null,
        })),
    });
}

export function validateCameraLayout(project: DirectorProject, input: LayoutResult) {
    const result = layoutResultSchema.parse(input);
    // 在改变任何镜头前，检查全部目标；对象移动后使用当前焦点。
    return result.shots.map(shot => {
        if (shot.targetObjectId === null) return shot;
        const target = project.objects.find(object => object.id === shot.targetObjectId && isCameraFocusableObject(object));
        if (!target) throw new Error("CAMERA_TARGET_MISSING");
        return { ...shot, target: getDirectorObjectFocusTarget(target) };
    });
}
