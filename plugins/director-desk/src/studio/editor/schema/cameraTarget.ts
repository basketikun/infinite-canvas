import { Euler, Vector3 } from "three";
import { getGroundedLabelY } from "../runtime/mannequin/bodyTypes";
import type { DirectorObject, GeometryPrimitiveType } from "./directorProject";

const IMPORTED_MODEL_FOCUS_OFFSET_Y = 1;

const GEOMETRY_FOCUS_OFFSET_Y: Record<GeometryPrimitiveType, number> = {
  box: 0.5,
  sphere: 0.55,
  cylinder: 0.6,
  torus: 0.14,
  cone: 0.55,
  pyramid: 0.55,
};

function roundTuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) => Number(value.toFixed(6))) as [number, number, number];
}

export function isCameraFocusableObject(object: DirectorObject) {
  return object.visible && object.kind !== "camera" && object.kind !== "panorama";
}

export function getDirectorObjectFocusOffsetY(object: DirectorObject) {
  if (object.assetRefId) {
    return IMPORTED_MODEL_FOCUS_OFFSET_Y;
  }

  if (object.kind === "character") {
    const labelY =
      getGroundedLabelY(object.bodyType);

    return labelY / 2;
  }

  if (object.geometryType) {
    return GEOMETRY_FOCUS_OFFSET_Y[object.geometryType];
  }

  return IMPORTED_MODEL_FOCUS_OFFSET_Y;
}

export function getDirectorObjectFocusTarget(object: DirectorObject): [number, number, number] {
  const [scaleX, scaleY, scaleZ] = object.transform.scale;
  const offset = new Vector3(0, getDirectorObjectFocusOffsetY(object), 0)
    .multiply(new Vector3(scaleX, scaleY, scaleZ))
    .applyEuler(new Euler(...object.transform.rotation));
  const target = new Vector3(...object.transform.position).add(offset);

  return roundTuple(target);
}
