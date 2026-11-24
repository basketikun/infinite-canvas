import { Vector3 } from "three";
import type { DirectorCameraShot } from "./directorProject";

export interface CameraViewSnapshot {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

export const VIEWPORT_CAMERA_ASPECT = 16 / 9;
export const VIEWPORT_CAMERA_VISUAL_SCALE = 0.35;
export const VIEWPORT_CAMERA_FRUSTUM_DEPTH = 5.2 * VIEWPORT_CAMERA_VISUAL_SCALE;
export const VIEWPORT_CAMERA_FRUSTUM_FRAME_WIDTH = 3.2 * VIEWPORT_CAMERA_VISUAL_SCALE;

export const DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT: CameraViewSnapshot = {
  fov: 50,
  position: [0, 1.55, 5.4],
  target: [0, 1.05, 0],
};

function getForwardDirection(position: [number, number, number], target: [number, number, number]) {
  const direction = new Vector3(...target).sub(new Vector3(...position));
  return direction.lengthSq() === 0 ? new Vector3(0, 0, -1) : direction.normalize();
}

function toTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

export function getCameraViewSnapshotFromShot(camera: DirectorCameraShot): CameraViewSnapshot {
  const rigPosition = new Vector3(...camera.transform.position);
  const forward = getForwardDirection(camera.transform.position, camera.target);
  const viewPosition = rigPosition.add(forward.multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH));

  return {
    fov: camera.fov,
    position: toTuple(viewPosition),
    target: camera.target,
  };
}

export function getCameraRigPositionFromViewSnapshot(snapshot: CameraViewSnapshot): [number, number, number] {
  const viewPosition = new Vector3(...snapshot.position);
  const forward = getForwardDirection(snapshot.position, snapshot.target);
  const rigPosition = viewPosition.sub(forward.multiplyScalar(VIEWPORT_CAMERA_FRUSTUM_DEPTH));

  return toTuple(rigPosition);
}
