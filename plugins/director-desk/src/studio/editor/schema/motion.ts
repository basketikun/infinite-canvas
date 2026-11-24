import { LinearInterpolant, type Vector3Tuple } from "three";
import { sampleWalk, type WalkPose } from "../runtime/mannequin/walk";
import { getDirectorObjectFocusTarget } from "./cameraTarget";
import type { DirectorObject, DirectorProject, MotionPath } from "./directorProject";

export function motionDuration(objects: DirectorObject[]) {
  return objects.reduce((duration, object) => Math.max(duration, object.motionPath?.duration ?? 0), 0);
}

const strokes = new WeakMap<MotionPath, { length: number; groundLength: number; route: LinearInterpolant; ground: LinearInterpolant }>();

function getStroke(path: MotionPath) {
  const cached = strokes.get(path);
  if (cached) return cached;
  const distances = [0], groundDistances = [0], samples = [...path.offsets[0], 0], groundPoints = [...path.offsets[0]];
  let walked = 0, elevation = path.offsets[0][1];
  for (let i = 1; i < path.offsets.length; i++) {
    const [x, y, z] = path.offsets[i], [px, py, pz] = path.offsets[i - 1];
    distances.push(distances[i - 1] + Math.hypot(x - px, y - py, z - pz));
    const horizontal = Math.hypot(x - px, z - pz);
    if (horizontal) {
      walked += horizontal;
      elevation += y - py;
      groundDistances.push(walked);
      groundPoints.push(x, elevation, z);
    }
    samples.push(x, y, z, walked);
  }
  const stroke = {
    length: distances[distances.length - 1], groundLength: walked,
    route: new LinearInterpolant(distances, samples, 4), ground: new LinearInterpolant(groundDistances, groundPoints, 3),
  };
  strokes.set(path, stroke);
  return stroke;
}

// 播放姿态只用于取景，逐帧写入项目会污染撤销和自动保存。
export type PlaybackObject = DirectorObject & { walk?: WalkPose };
export function sceneAtTime(project: DirectorProject, time: number | null): Omit<DirectorProject, "objects"> & { objects: PlaybackObject[] } {
  if (time === null) return project;
  const objects = project.objects.map(object => {
    if (!object.motionPath) return object;
    const path = object.motionPath;
    const stroke = getStroke(path);
    const [x, y, z, distance] = stroke.route.evaluate(stroke.length * Math.min(time / path.duration, 1));
    const walk = object.kind === "character" && !object.assetRefId
      ? sampleWalk(object, stroke.ground, stroke.groundLength, distance, [x, y, z]) : undefined;
    const [px, py, pz] = object.transform.position;
    const position: Vector3Tuple = [px + x, py + y, pz + z];
    const rotation: Vector3Tuple = walk ? [0, walk.yaw, 0] : object.transform.rotation;
    return { ...object, walk, transform: { ...object.transform, position, rotation } };
  });
  const byId = new Map(objects.map(object => [object.id, object]));
  const rigs = new Map(objects.filter(object => object.linkedCameraId).map(object => [object.linkedCameraId, object]));
  const cameras = project.cameras.map(camera => {
    const rig = rigs.get(camera.id);
    const focus = camera.targetMode === "object" && camera.targetObjectId ? byId.get(camera.targetObjectId) : null;
    return { ...camera, transform: rig?.transform ?? camera.transform, target: focus ? getDirectorObjectFocusTarget(focus) : camera.target };
  });
  return { ...project, objects, cameras };
}
