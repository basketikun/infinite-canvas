import { create } from "zustand";
import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import { GEOMETRY_PRIMITIVE_OPTIONS } from "../schema/directorProject";
import type {
  DirectorAssetRef,
  DirectorAssetSource,
  CharacterBodyType,
  DirectorAssetKind,
  DirectorCameraCapture,
  DirectorCameraShot,
  DirectorObject,
  DirectorProject,
  DirectorTransform,
  GeometryPrimitiveType,
  MotionPath,
  PanoramaProjectionMode,
  SceneSettings,
  ViewMode,
} from "../schema/directorProject";
import type { PosePresetId } from "../schema/poseSchema";
import { getDirectorObjectFocusTarget } from "../schema/cameraTarget";
import { validateCameraLayout } from "../schema/cameraLayouts";
import type { LayoutResult } from "../../../api/camera-layouts";
import { DEFAULT_CHARACTER_BODY_TYPE, normalizeBodyType } from "../runtime/mannequin/bodyTypes";
import {
  DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT,
  getCameraRigPositionFromViewSnapshot,
} from "../schema/cameraGeometry";
import type { ViewportAspectRatio } from "../schema/viewportAspectRatio";

export type TransformMode = "translate" | "rotate" | "scale";

export interface ImportedAssetInput {
  kind: DirectorAssetKind;
  name: string;
  fileName: string;
  url: string;
  addToScene?: boolean;
  assetSource?: DirectorAssetSource;
  projectionMode?: PanoramaProjectionMode;
}

export interface CameraShotSnapshot {
  fov: number;
  position: [number, number, number];
  target: [number, number, number];
}

export interface CrowdCharactersInput {
  bodyType?: CharacterBodyType;
  rows: number;
  columns: number;
  spacing: number;
}

export interface DirectorUiState {
  viewMode: ViewMode;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedCrowdId: string | null;
  directorInspectorMode: "auto" | "scene";
  transformMode: TransformMode;
  viewportAspectRatio: ViewportAspectRatio;
  viewportRuleOfThirdsEnabled: boolean;
  viewportPanelsCollapsed: boolean;
}

export interface DirectorState extends DirectorUiState {
  project: DirectorProject;
}

export interface DirectorClipboardEntry {
  object: DirectorObject;
  camera?: DirectorCameraShot;
}

interface DirectorInternalState {
  clipboard: DirectorClipboardEntry[];
  clipboardPasteCount: number;
  undoStack: DirectorState[];
  undoBatchDepth: number;
  undoBatchSnapshot: DirectorState | null;
  undoBatchHasTrackedChanges: boolean;
}

export interface DirectorActions {
  setViewMode: (mode: ViewMode) => void;
  setTransformMode: (mode: TransformMode) => void;
  setViewportAspectRatio: (ratio: ViewportAspectRatio) => void;
  setViewportRuleOfThirdsEnabled: (enabled: boolean) => void;
  toggleViewportPanelsCollapsed: () => void;
  setViewportPanelsCollapsed: (collapsed: boolean) => void;
  selectObject: (id: string | null) => void;
  selectCrowd: (crowdId: string | null) => void;
  toggleObjectSelection: (id: string) => void;
  openSceneInspector: () => void;
  updateScene: (patch: Partial<SceneSettings>) => void;
  removePanoramaAsset: () => void;
  removeImportedAsset: (assetId: string) => void;
  updateObjectTransform: (id: string, patch: Partial<DirectorTransform>) => void;
  updateCrowdTransform: (crowdId: string, patch: Partial<DirectorTransform>) => void;
  setMotionPath: (id: string, path?: MotionPath) => void;
  updateObjectName: (id: string, name: string) => void;
  updateCrowdLabel: (crowdId: string, label: string) => void;
  updateObjectColor: (id: string, color: string) => void;
  updateCrowdColor: (crowdId: string, color: string) => void;
  updateCharacterBodyType: (id: string, bodyType: CharacterBodyType) => void;
  updateUniformScale: (id: string, scale: number) => void;
  updateCrowdUniformScale: (crowdId: string, scale: number) => void;
  addImportedAsset: (input: ImportedAssetInput) => void;
  addObjectFromAsset: (assetId: string) => string | null;
  addPresetCharacter: (bodyType?: CharacterBodyType) => void;
  addCrowdCharacters: (input: CrowdCharactersInput) => string[];
  addGeometryPrimitive: (geometryType: GeometryPrimitiveType) => void;
  addCameraShot: (snapshot?: CameraShotSnapshot) => string;
  applyCameraLayout: (result: LayoutResult) => void;
  deleteSelectedObject: () => void;
  toggleObjectVisible: (id: string) => void;
  toggleObjectLocked: (id: string) => void;
  applyPosePreset: (id: string, presetId: PosePresetId) => void;
  applyCrowdPosePreset: (crowdId: string, presetId: PosePresetId) => void;
  updatePoseControl: (id: string, key: string, value: number) => void;
  updateCrowdPoseControl: (crowdId: string, key: string, value: number) => void;
  setActiveCamera: (cameraId: string) => void;
  addCameraCaptures: (cameraId: string | null | undefined, dataUrls: string[]) => void;
  updateCamera: (
    cameraId: string,
    patch: Partial<DirectorCameraShot> & {
      transform?: DirectorTransform;
      target?: [number, number, number];
    }
  ) => void;
  beginUndoBatch: () => void;
  endUndoBatch: () => void;
  copySelectedObjects: () => void;
  pasteClipboardObjects: () => void;
  undo: () => void;
  replaceProject: (project: DirectorProject) => void;
}

type DirectorRuntimeState = DirectorState & DirectorInternalState;

export type DirectorStore = DirectorRuntimeState & DirectorActions;

const DEFAULT_SCENE: SceneSettings = {
  scale: 1,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  backgroundColor: "#000000",
  panoramaYaw: 0,
  panoramaRadius: 60,
  showLabels: true,
  snapToGrid: false,
  showGround: true,
  groundOpacity: 0.4,
  groundHeight: 0,
};

const CHARACTER_COLOR_PALETTE = [
  "#4F8EF7",
  "#E0524D",
  "#E91E63",
  "#F2A900",
  "#9C4DCC",
  "#12B886",
  "#00B8D9",
  "#FF7A45",
];
const GEOMETRY_PRIMITIVE_COLOR = "#d7e7ff";
const ADDED_MODEL_WORLD_SPACING = 1.25;
const COPY_PASTE_POSITION_OFFSET = 0.6;
const UNDO_STACK_LIMIT = 80;
const DEFAULT_UI_STATE: DirectorUiState = {
  viewMode: "director",
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedCrowdId: null,
  directorInspectorMode: "auto",
  transformMode: "translate",
  viewportAspectRatio: "auto",
  viewportRuleOfThirdsEnabled: false,
  viewportPanelsCollapsed: false,
};

function createTransform(
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): DirectorTransform {
  return { position, rotation, scale };
}

function roundTransformValue(value: number) {
  return Number(value.toFixed(6));
}

function roundTransformTuple(values: [number, number, number]): [number, number, number] {
  return values.map((value) => roundTransformValue(value)) as [number, number, number];
}

function formatSceneItemName(prefix: "角色" | "机位", index: number) {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function getNextSequentialId(existingIds: string[], prefix: string, minimumIndex = 1) {
  let maxIndex = minimumIndex - 1;

  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;

    const suffix = id.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    maxIndex = Math.max(maxIndex, Number.parseInt(suffix, 10));
  }

  return `${prefix}${maxIndex + 1}`;
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function extractPersistedDirectorState(state: DirectorRuntimeState): DirectorState {
  return cloneJsonValue({
    viewMode: state.viewMode,
    selectedObjectId: state.selectedObjectId,
    selectedObjectIds: state.selectedObjectIds,
    selectedCrowdId: state.selectedCrowdId,
    directorInspectorMode: state.directorInspectorMode,
    transformMode: state.transformMode,
    viewportAspectRatio: state.viewportAspectRatio,
    viewportRuleOfThirdsEnabled: state.viewportRuleOfThirdsEnabled,
    viewportPanelsCollapsed: state.viewportPanelsCollapsed,
    project: state.project,
  });
}

function createRuntimeStateFromPersistedState(state: DirectorState): DirectorRuntimeState {
  const snapshot = cloneJsonValue(state);

  return {
    ...snapshot,
    clipboard: [],
    clipboardPasteCount: 0,
    undoStack: [],
    undoBatchDepth: 0,
    undoBatchSnapshot: null,
    undoBatchHasTrackedChanges: false,
  };
}

function createUndoStackEntry(state: DirectorRuntimeState) {
  return extractPersistedDirectorState(state);
}

export function createDefaultDirectorProject(): DirectorProject {
  const camera: DirectorCameraShot = {
    id: "cam_1",
    name: formatSceneItemName("机位", 1),
    fov: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.fov,
    transform: createTransform(getCameraRigPositionFromViewSnapshot(DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT)),
    targetMode: "manual",
    target: DEFAULT_DIRECTOR_CAMERA_VIEW_SNAPSHOT.target,
    lastCaptureUrl: null,
    captures: [],
  };

  const role: DirectorObject = {
    id: "char_default_a",
    name: formatSceneItemName("角色", 1),
    kind: "character",
    visible: true,
    locked: false,
    bodyType: DEFAULT_CHARACTER_BODY_TYPE,
    color: "#4F8EF7",
    transform: createTransform([0, 0, 0]),
    characterRig: {
      rigType: "ue4-mannequin",
      posePresetId: "stand",
      controls: {},
    },
  };

  const cameraObject: DirectorObject = {
    id: "cam_object_1",
    name: camera.name,
    kind: "camera",
    visible: true,
    locked: false,
    linkedCameraId: camera.id,
    transform: camera.transform,
  };

  return {
    version: 1,
    scene: DEFAULT_SCENE,
    assets: [],
    objects: [role, cameraObject],
    cameras: [camera],
    activeCameraId: camera.id,
    panoramaAssetId: null,
  };
}

export function createInitialDirectorState(): DirectorState {
  return {
    ...DEFAULT_UI_STATE,
    project: createDefaultDirectorProject(),
  };
}

function updateObjectById(
  objects: DirectorObject[],
  id: string,
  updater: (item: DirectorObject) => DirectorObject
) {
  return objects.map((item) => (item.id === id ? updater(item) : item));
}

function getNextCharacterColor(objects: DirectorObject[]) {
  const usedColors = new Set(objects.filter((item) => item.kind === "character").map((item) => item.color));
  const unusedColor = CHARACTER_COLOR_PALETTE.find((color) => !usedColors.has(color));

  if (unusedColor) return unusedColor;

  const characterCount = objects.filter((item) => item.kind === "character").length;
  return CHARACTER_COLOR_PALETTE[characterCount % CHARACTER_COLOR_PALETTE.length];
}

function getGeometryPrimitiveLabel(geometryType: GeometryPrimitiveType) {
  return GEOMETRY_PRIMITIVE_OPTIONS.find((option) => option.type === geometryType)?.label ?? "几何模型";
}

function getAddedModelColumnOffset(index: number) {
  const side = index % 2 === 1 ? -1 : 1;
  const step = Math.ceil(index / 2);

  return side * step * ADDED_MODEL_WORLD_SPACING;
}

function getCrowdCharacterPositions(rows: number, columns: number, spacing: number) {
  const safeRows = Math.max(1, rows);
  const safeColumns = Math.max(1, columns);
  const safeSpacing = Math.max(0.1, spacing);
  const xOffset = ((safeColumns - 1) * safeSpacing) / 2;
  const zOffset = ((safeRows - 1) * safeSpacing) / 2;
  const positions: Array<[number, number, number]> = [];

  for (let rowIndex = 0; rowIndex < safeRows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < safeColumns; columnIndex += 1) {
      positions.push([
        Number((columnIndex * safeSpacing - xOffset).toFixed(4)),
        0,
        Number((rowIndex * safeSpacing - zOffset).toFixed(4)),
      ]);
    }
  }

  return positions;
}

function getCrowdCharacterOffset(objects: DirectorObject[], spacing: number): [number, number, number] {
  const safeSpacing = Math.max(0.1, spacing);
  const characterPositions = objects
    .filter((item) => item.kind === "character")
    .map((item) => item.transform.position);
  const maxZ = characterPositions.length ? Math.max(...characterPositions.map((position) => position[2])) : 0;

  return [0, 0, Number((maxZ + safeSpacing * 2).toFixed(4))];
}

function formatCrowdLabel(rows: number, columns: number) {
  return `群众（${rows}x${columns}）`;
}

function buildPresetCharacterObject(
  state: DirectorRuntimeState,
  bodyType: CharacterBodyType,
  position: [number, number, number],
  crowdMetadata?: {
    crowdId: string;
    crowdLabel: string;
  }
) {
  const characterCount = state.project.objects.filter((item) => item.kind === "character").length;
  const characterIndex = characterCount + 1;
  const objectId = getNextSequentialId(
    state.project.objects.map((item) => item.id),
    "char_preset_",
    characterIndex
  );
  const normalizedBodyType = normalizeBodyType(bodyType);

  return {
    id: objectId,
    name: formatSceneItemName("角色", characterIndex),
    kind: "character" as const,
    visible: true,
    locked: false,
    bodyType: normalizedBodyType,
    color: getNextCharacterColor(state.project.objects),
    crowdId: crowdMetadata?.crowdId,
    crowdLabel: crowdMetadata?.crowdLabel,
    transform: createTransform(position),
    characterRig: {
      rigType: "ue4-mannequin" as const,
      posePresetId: "stand",
      controls: {},
    },
  } satisfies DirectorObject;
}

function formatCameraCaptureName(cameraName: string, captureIndex: number) {
  return `${cameraName}-截图${String(captureIndex).padStart(2, "0")}`;
}

function buildCameraCaptures(camera: DirectorCameraShot, dataUrls: string[]) {
  const existingCaptures = camera.captures ?? [];

  return dataUrls.map((dataUrl, indexOffset): DirectorCameraCapture => {
    const captureIndex = existingCaptures.length + indexOffset + 1;

    return {
      id: `${camera.id}-capture-${String(captureIndex).padStart(2, "0")}`,
      index: captureIndex,
      name: formatCameraCaptureName(camera.name, captureIndex),
      dataUrl,
    };
  });
}

function createDisplayNameFromFileName(fileName: string) {
  return fileName.replace(/\.(fbx|obj|jpe?g|png|webp)$/i, "");
}

function createSceneObjectFromAsset(asset: DirectorAssetRef, existingObjects: DirectorObject[]) {
  const nextObjectId = getNextSequentialId(
    existingObjects.map((item) => item.id),
    "obj_",
    existingObjects.length + 1
  );

  return {
    id: nextObjectId,
    name: asset.name ?? createDisplayNameFromFileName(asset.fileName),
    kind: asset.kind,
    visible: true,
    locked: false,
    assetRefId: asset.id,
    transform: createTransform([0, 0, 0]),
  } satisfies DirectorObject;
}

function refreshCamerasFocusedOnObject(cameras: DirectorCameraShot[], object: DirectorObject) {
  return cameras.map((camera) =>
    camera.targetMode === "object" && camera.targetObjectId === object.id
      ? {
          ...camera,
          target: getDirectorObjectFocusTarget(object),
        }
      : camera
  );
}

function refreshCamerasFocusedOnObjects(
  cameras: DirectorCameraShot[],
  objects: DirectorObject[],
  focusedObjectIds: Iterable<string>
) {
  const focusedIdSet = new Set(focusedObjectIds);
  if (focusedIdSet.size === 0) return cameras;

  const objectsById = new Map(objects.map((item) => [item.id, item]));

  return cameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId || !focusedIdSet.has(camera.targetObjectId)) {
      return camera;
    }

    const targetObject = objectsById.get(camera.targetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
}

function getCrowdMemberObjects(objects: DirectorObject[], crowdId: string) {
  return objects.filter((item) => item.kind === "character" && item.crowdId === crowdId);
}

function getCrowdMemberIds(objects: DirectorObject[], crowdId: string) {
  return getCrowdMemberObjects(objects, crowdId).map((item) => item.id);
}

export function getCrowdAnchorTransform(objects: DirectorObject[], crowdId: string): DirectorTransform | null {
  const crowdMembers = getCrowdMemberObjects(objects, crowdId);
  if (!crowdMembers.length) return null;

  const position = crowdMembers.reduce(
    (accumulator, item) => {
      accumulator[0] += item.transform.position[0];
      accumulator[1] += item.transform.position[1];
      accumulator[2] += item.transform.position[2];
      return accumulator;
    },
    [0, 0, 0] as [number, number, number]
  );
  const memberCount = crowdMembers.length;
  const anchorPosition = roundTransformTuple([
    position[0] / memberCount,
    position[1] / memberCount,
    position[2] / memberCount,
  ]);
  const referenceMember = crowdMembers[0];

  return createTransform(
    anchorPosition,
    [...referenceMember.transform.rotation] as [number, number, number],
    [...referenceMember.transform.scale] as [number, number, number]
  );
}

function getNextCrowdId(objects: DirectorObject[]) {
  return getNextSequentialId(
    objects.map((item) => item.crowdId).filter((item): item is string => typeof item === "string"),
    "crowd_",
    1
  );
}

function applyCrowdTransformPatch(
  objects: DirectorObject[],
  crowdId: string,
  patch: Partial<DirectorTransform>
) {
  const anchor = getCrowdAnchorTransform(objects, crowdId);
  if (!anchor) {
    return {
      objects,
      changedObjectIds: [],
    };
  }

  const nextPosition = patch.position ?? anchor.position;
  const nextRotation = patch.rotation ?? anchor.rotation;
  const nextScale = patch.scale ?? anchor.scale;
  const deltaRotation: [number, number, number] = [
    nextRotation[0] - anchor.rotation[0],
    nextRotation[1] - anchor.rotation[1],
    nextRotation[2] - anchor.rotation[2],
  ];
  const scaleRatio: [number, number, number] = [
    anchor.scale[0] === 0 ? 1 : nextScale[0] / anchor.scale[0],
    anchor.scale[1] === 0 ? 1 : nextScale[1] / anchor.scale[1],
    anchor.scale[2] === 0 ? 1 : nextScale[2] / anchor.scale[2],
  ];
  const anchorPosition = anchor.position;
  const changedObjectIds = getCrowdMemberIds(objects, crowdId);
  const changedIdSet = new Set(changedObjectIds);

  return {
    changedObjectIds,
    objects: objects.map((item) => {
      if (!changedIdSet.has(item.id)) return item;

      const offsetX = (item.transform.position[0] - anchorPosition[0]) * scaleRatio[0];
      const offsetY = (item.transform.position[1] - anchorPosition[1]) * scaleRatio[1];
      const offsetZ = (item.transform.position[2] - anchorPosition[2]) * scaleRatio[2];
      const cosX = Math.cos(deltaRotation[0]);
      const sinX = Math.sin(deltaRotation[0]);
      const cosY = Math.cos(deltaRotation[1]);
      const sinY = Math.sin(deltaRotation[1]);
      const cosZ = Math.cos(deltaRotation[2]);
      const sinZ = Math.sin(deltaRotation[2]);

      const x1 = offsetX;
      const y1 = offsetY * cosX - offsetZ * sinX;
      const z1 = offsetY * sinX + offsetZ * cosX;

      const x2 = x1 * cosY + z1 * sinY;
      const y2 = y1;
      const z2 = -x1 * sinY + z1 * cosY;

      const x3 = x2 * cosZ - y2 * sinZ;
      const y3 = x2 * sinZ + y2 * cosZ;
      const z3 = z2;

      return {
        ...item,
        transform: {
          position: roundTransformTuple([
            nextPosition[0] + x3,
            nextPosition[1] + y3,
            nextPosition[2] + z3,
          ]),
          rotation: roundTransformTuple([
            item.transform.rotation[0] + deltaRotation[0],
            item.transform.rotation[1] + deltaRotation[1],
            item.transform.rotation[2] + deltaRotation[2],
          ]),
          scale: roundTransformTuple([
            item.transform.scale[0] * scaleRatio[0],
            item.transform.scale[1] * scaleRatio[1],
            item.transform.scale[2] * scaleRatio[2],
          ]),
        },
      };
    }),
  };
}

function getOrderedSelectedObjectIds(state: DirectorState) {
  if (state.selectedObjectIds.length) return state.selectedObjectIds;
  return state.selectedObjectId ? [state.selectedObjectId] : [];
}

function createObjectIdForDuplicate(existingObjects: DirectorObject[], source: DirectorObject) {
  if (source.kind === "camera") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "cam_object_",
      existingObjects.filter((item) => item.kind === "camera").length + 1
    );
  }

  if (source.kind === "character") {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      "char_paste_",
      existingObjects.filter((item) => item.kind === "character").length + 1
    );
  }

  if (source.geometryType) {
    return getNextSequentialId(
      existingObjects.map((item) => item.id),
      `geo_${source.geometryType}_copy_`,
      existingObjects.length + 1
    );
  }

  return getNextSequentialId(existingObjects.map((item) => item.id), "obj_", existingObjects.length + 1);
}

function applyPositionOffset(position: [number, number, number], offset: number): [number, number, number] {
  return [position[0] + offset, position[1], position[2] + offset];
}

function applyOffsetToTransform(transform: DirectorTransform, offset: number): DirectorTransform {
  return {
    ...transform,
    position: applyPositionOffset(transform.position, offset),
  };
}

function buildClipboardEntries(state: DirectorState): DirectorClipboardEntry[] {
  const selectedObjectIds = getOrderedSelectedObjectIds(state);
  if (!selectedObjectIds.length) return [];

  return selectedObjectIds.flatMap((objectId) => {
    const object = state.project.objects.find((item) => item.id === objectId);
    if (!object) return [];

    const camera =
      object.kind === "camera" && object.linkedCameraId
        ? state.project.cameras.find((item) => item.id === object.linkedCameraId)
        : undefined;

    return [
      {
        object: cloneJsonValue(object),
        camera: camera ? cloneJsonValue(camera) : undefined,
      },
    ];
  });
}

function pasteClipboardEntries(state: DirectorRuntimeState): DirectorRuntimeState {
  if (state.clipboard.length === 0) return state;

  const pasteIteration = state.clipboardPasteCount + 1;
  const offset = COPY_PASTE_POSITION_OFFSET * pasteIteration;
  const nextObjects = [...state.project.objects];
  const nextCameras = [...state.project.cameras];
  const idMap = new Map<string, string>();
  const crowdIdMap = new Map<string, string>();
  const pastedObjectIds: string[] = [];

  function getPastedCrowdId(sourceCrowdId: string) {
    const existing = crowdIdMap.get(sourceCrowdId);
    if (existing) return existing;

    const nextCrowdId = getNextCrowdId(nextObjects);
    crowdIdMap.set(sourceCrowdId, nextCrowdId);
    return nextCrowdId;
  }

  state.clipboard.forEach((entry) => {
    if (entry.object.kind === "camera" && entry.camera) {
      const cameraIndex = nextCameras.length + 1;
      const nextCameraId = getNextSequentialId(
        nextCameras.map((item) => item.id),
        "cam_",
        cameraIndex
      );
      const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
      idMap.set(entry.object.id, nextObjectId);
      if (entry.object.linkedCameraId) {
        idMap.set(entry.object.linkedCameraId, nextCameraId);
      }

      const targetObjectId = entry.camera.targetObjectId ? idMap.get(entry.camera.targetObjectId) : null;
      const nextCamera: DirectorCameraShot = {
        ...entry.camera,
        id: nextCameraId,
        name: formatSceneItemName("机位", cameraIndex),
        transform: applyOffsetToTransform(entry.camera.transform, offset),
        target:
          entry.camera.targetMode === "manual" ? applyPositionOffset(entry.camera.target, offset) : entry.camera.target,
        targetObjectId: targetObjectId ?? entry.camera.targetObjectId ?? null,
        captures: [],
        lastCaptureUrl: null,
      };
      const nextCameraObject: DirectorObject = {
        ...entry.object,
        id: nextObjectId,
        name: nextCamera.name,
        linkedCameraId: nextCamera.id,
        transform: nextCamera.transform,
      };

      nextCameras.push(nextCamera);
      nextObjects.push(nextCameraObject);
      pastedObjectIds.push(nextObjectId);
      return;
    }

    const nextObjectId = createObjectIdForDuplicate(nextObjects, entry.object);
    idMap.set(entry.object.id, nextObjectId);
    const nextCharacterCount =
      entry.object.kind === "character" ? nextObjects.filter((item) => item.kind === "character").length + 1 : null;
    const duplicatedObject: DirectorObject = {
      ...entry.object,
      id: nextObjectId,
      name:
        entry.object.kind === "character" && nextCharacterCount
          ? formatSceneItemName("角色", nextCharacterCount)
          : entry.object.name,
      crowdId: entry.object.crowdId ? getPastedCrowdId(entry.object.crowdId) : entry.object.crowdId,
      transform: applyOffsetToTransform(entry.object.transform, offset),
    };

    nextObjects.push(duplicatedObject);
    pastedObjectIds.push(nextObjectId);
  });

  const nextObjectsById = new Map(nextObjects.map((item) => [item.id, item]));
  const normalizedCameras = nextCameras.map((camera) => {
    if (camera.targetMode !== "object" || !camera.targetObjectId) return camera;

    const mappedTargetObjectId = idMap.get(camera.targetObjectId) ?? camera.targetObjectId;
    const targetObject = nextObjectsById.get(mappedTargetObjectId);
    if (!targetObject) {
      return {
        ...camera,
        targetMode: "manual" as const,
        targetObjectId: null,
      };
    }

    return {
      ...camera,
      targetObjectId: mappedTargetObjectId,
      target: getDirectorObjectFocusTarget(targetObject),
    };
  });
  const lastPastedObject = pastedObjectIds.length
    ? nextObjects.find((item) => item.id === pastedObjectIds[pastedObjectIds.length - 1])
    : null;
  const pastedCrowdIds = Array.from(
    new Set(
      pastedObjectIds
        .map((objectId) => nextObjects.find((item) => item.id === objectId)?.crowdId)
        .filter((crowdId): crowdId is string => typeof crowdId === "string")
    )
  );

  return {
    ...state,
    selectedObjectId: pastedObjectIds[pastedObjectIds.length - 1] ?? null,
    selectedObjectIds: pastedObjectIds,
    selectedCrowdId: pastedCrowdIds.length === 1 ? pastedCrowdIds[0] : null,
    directorInspectorMode: "auto",
    clipboardPasteCount: pasteIteration,
    project: {
      ...state.project,
      objects: nextObjects,
      cameras: normalizedCameras,
      activeCameraId:
        lastPastedObject?.kind === "camera"
          ? lastPastedObject.linkedCameraId ?? state.project.activeCameraId
          : state.project.activeCameraId,
    },
  };
}

function isSameDirectorState(a: DirectorState, b: DirectorState) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function trimUndoStack(stack: DirectorState[]) {
  return stack.length > UNDO_STACK_LIMIT ? stack.slice(stack.length - UNDO_STACK_LIMIT) : stack;
}

export const useDirectorStore = create<DirectorStore>((set, get) => {
  const initialRuntimeState = createRuntimeStateFromPersistedState(
    createInitialDirectorState()
  );

  function commitMutation(
    updater: (state: DirectorRuntimeState) => DirectorRuntimeState,
    options: { trackUndo?: boolean } = {}
  ) {
    const { trackUndo = true } = options;

    set((state) => {
      const currentState = state as DirectorRuntimeState;
      const previousSnapshot = createUndoStackEntry(currentState);
      const nextState = updater(currentState);
      const nextSnapshot = extractPersistedDirectorState(nextState);
      const didChange = !isSameDirectorState(previousSnapshot, nextSnapshot);

      if (!didChange) {
        return {
          ...nextState,
          undoStack: trackUndo ? currentState.undoStack : nextState.undoStack,
          undoBatchDepth: nextState.undoBatchDepth,
          undoBatchSnapshot: nextState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: nextState.undoBatchHasTrackedChanges,
        };
      }

      const shouldCaptureUndoBatchSnapshot =
        trackUndo && currentState.undoBatchDepth > 0 && currentState.undoBatchSnapshot === null;
      const nextUndoStack =
        trackUndo && currentState.undoBatchDepth === 0
          ? trimUndoStack([...currentState.undoStack, previousSnapshot])
          : nextState.undoStack;
      const runtimeState: DirectorRuntimeState = {
        ...nextState,
        undoStack: nextUndoStack,
        undoBatchSnapshot: shouldCaptureUndoBatchSnapshot ? previousSnapshot : nextState.undoBatchSnapshot,
        undoBatchHasTrackedChanges:
          trackUndo && currentState.undoBatchDepth > 0 ? true : nextState.undoBatchHasTrackedChanges,
      };


      return runtimeState;
    });
  }

  function commitUiMutation(updater: (state: DirectorRuntimeState) => DirectorRuntimeState) {
    commitMutation(updater, { trackUndo: false });
  }

  return {
    ...initialRuntimeState,
    beginUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;

        return {
          ...currentState,
          undoBatchDepth: currentState.undoBatchDepth + 1,
          undoBatchSnapshot: currentState.undoBatchDepth === 0 ? createUndoStackEntry(currentState) : currentState.undoBatchSnapshot,
          undoBatchHasTrackedChanges: currentState.undoBatchDepth === 0 ? false : currentState.undoBatchHasTrackedChanges,
        };
      });
    },
    endUndoBatch: () => {
      set((state) => {
        const currentState = state as DirectorRuntimeState;
        if (currentState.undoBatchDepth === 0) return currentState;

        const nextUndoBatchDepth = currentState.undoBatchDepth - 1;
        if (nextUndoBatchDepth > 0) {
          return {
            ...currentState,
            undoBatchDepth: nextUndoBatchDepth,
          };
        }

        const currentSnapshot = extractPersistedDirectorState(currentState);
        const shouldPushUndoEntry =
          currentState.undoBatchHasTrackedChanges &&
          currentState.undoBatchSnapshot !== null &&
          !isSameDirectorState(currentState.undoBatchSnapshot, currentSnapshot);

        return {
          ...currentState,
          undoStack: shouldPushUndoEntry
            ? trimUndoStack([...currentState.undoStack, currentState.undoBatchSnapshot!])
            : currentState.undoStack,
          undoBatchDepth: 0,
          undoBatchSnapshot: null,
          undoBatchHasTrackedChanges: false,
        };
      });
    },
    setTransformMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        transformMode: mode,
      })),
    setViewportAspectRatio: (ratio) =>
      commitUiMutation((state) => ({
        ...state,
        viewportAspectRatio: ratio,
      })),
    setViewportRuleOfThirdsEnabled: (enabled) =>
      commitUiMutation((state) => ({
        ...state,
        viewportRuleOfThirdsEnabled: enabled,
      })),
    toggleViewportPanelsCollapsed: () =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: !state.viewportPanelsCollapsed,
      })),
    setViewportPanelsCollapsed: (collapsed) =>
      commitUiMutation((state) => ({
        ...state,
        viewportPanelsCollapsed: collapsed,
      })),
    setViewMode: (mode) =>
      commitUiMutation((state) => ({
        ...state,
        viewMode: mode,
        project: {
          ...state.project,
          activeCameraId:
            mode === "camera"
              ? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null
              : state.project.activeCameraId,
        },
      })),
    selectObject: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);

        return {
          ...state,
          selectedObjectId: id,
          selectedObjectIds: id ? [id] : [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject?.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    selectCrowd: (crowdId) =>
      commitUiMutation((state) => {
        if (!crowdId) {
          return {
            ...state,
            selectedCrowdId: null,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const crowdMemberIds = getCrowdMemberIds(state.project.objects, crowdId);
        if (!crowdMemberIds.length) return state;

        return {
          ...state,
          selectedCrowdId: crowdId,
          selectedObjectId: crowdMemberIds[crowdMemberIds.length - 1] ?? null,
          selectedObjectIds: crowdMemberIds,
          directorInspectorMode: "auto",
        };
      }),
    toggleObjectSelection: (id) =>
      commitUiMutation((state) => {
        const selectedObject = state.project.objects.find((item) => item.id === id);
        if (!selectedObject) return state;

        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        const nextSelectedObjectIds = selectedObjectIds.includes(id)
          ? selectedObjectIds.filter((itemId) => itemId !== id)
          : [...selectedObjectIds, id];
        const nextSelectedObjectId = nextSelectedObjectIds[nextSelectedObjectIds.length - 1] ?? null;

        return {
          ...state,
          selectedObjectId: nextSelectedObjectId,
          selectedObjectIds: nextSelectedObjectIds,
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            activeCameraId:
              selectedObject.kind === "camera" && selectedObject.linkedCameraId
                ? selectedObject.linkedCameraId
                : state.project.activeCameraId,
          },
        };
      }),
    openSceneInspector: () =>
      commitUiMutation((state) => ({
        ...state,
        directorInspectorMode: "scene",
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
      })),
    updateScene: (patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            ...patch,
          },
        },
      })),
    removePanoramaAsset: () =>
      commitMutation((state) => {
        const panoramaAssetId = state.project.panoramaAssetId;
        if (!panoramaAssetId) return state;

        return {
          ...state,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== panoramaAssetId),
            panoramaAssetId: null,
          },
        };
      }),
    removeImportedAsset: (assetId) =>
      commitMutation((state) => {
        const targetAsset = state.project.assets.find((item) => item.id === assetId);
        if (!targetAsset || targetAsset.sourceType !== "model") return state;


        const removedObjectIds = new Set(
          state.project.objects.filter((item) => item.assetRefId === assetId).map((item) => item.id)
        );
        const nextObjects = state.project.objects.filter((item) => item.assetRefId !== assetId);
        const nextCameras = state.project.cameras.map((camera) =>
          camera.targetObjectId && removedObjectIds.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const selectedObjectIds = state.selectedObjectIds.filter((id) => !removedObjectIds.has(id));
        const selectedObjectId =
          state.selectedObjectId && removedObjectIds.has(state.selectedObjectId)
            ? selectedObjectIds[selectedObjectIds.length - 1] ?? null
            : state.selectedObjectId;

        return {
          ...state,
          selectedObjectId,
          selectedObjectIds,
          selectedCrowdId: null,
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => item.id !== assetId),
            objects: nextObjects,
            cameras: nextCameras,
          },
        };
      }),
    setMotionPath: (id, motionPath) => commitMutation(state => ({
      ...state,
      project: { ...state.project, objects: updateObjectById(state.project.objects, id, item => item.locked ? item : { ...item, motionPath }) },
    })),
    updateObjectTransform: (id, patch) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextTransform = currentObject
          ? {
              position: patch.position ?? currentObject.transform.position,
              rotation: patch.rotation ?? currentObject.transform.rotation,
              scale: patch.scale ?? currentObject.transform.scale,
            }
          : null;
        const nextObject = currentObject && nextTransform ? { ...currentObject, transform: nextTransform } : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                position: patch.position ?? item.transform.position,
                rotation: patch.rotation ?? item.transform.rotation,
                scale: patch.scale ?? item.transform.scale,
              },
            })),
            cameras:
              currentObject?.kind === "camera" && currentObject.linkedCameraId && nextTransform
                ? state.project.cameras.map((camera) =>
                    camera.id === currentObject.linkedCameraId
                      ? {
                          ...camera,
                          transform: nextTransform,
                        }
                      : camera
                  )
                : nextObject
                  ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject)
                  : state.project.cameras,
          },
        };
      }),
    updateCrowdTransform: (crowdId, patch) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, patch);
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    updateObjectName: (id, name) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            name,
          })),
        },
      })),
    updateCrowdLabel: (crowdId, label) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  crowdLabel: label,
                }
              : item
          ),
        },
      })),
    updateObjectColor: (id, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            color,
          })),
        },
      })),
    updateCrowdColor: (crowdId, color) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  color,
                }
              : item
          ),
        },
      })),
    updateCharacterBodyType: (id, bodyType) =>
      commitMutation((state) => {
        const normalizedBodyType = normalizeBodyType(bodyType);
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject =
          currentObject?.kind === "character"
            ? {
                ...currentObject,
                bodyType: normalizedBodyType,
              }
            : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) =>
              item.kind === "character"
                ? {
                    ...item,
                    bodyType: normalizedBodyType,
                  }
                : item
            ),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateUniformScale: (id, scale) =>
      commitMutation((state) => {
        const currentObject = state.project.objects.find((item) => item.id === id);
        const nextObject = currentObject
          ? {
              ...currentObject,
              transform: {
                ...currentObject.transform,
                scale: [scale, scale, scale] as [number, number, number],
              },
            }
          : null;

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              transform: {
                ...item.transform,
                scale: [scale, scale, scale],
              },
            })),
            cameras: nextObject ? refreshCamerasFocusedOnObject(state.project.cameras, nextObject) : state.project.cameras,
          },
        };
      }),
    updateCrowdUniformScale: (crowdId, scale) =>
      commitMutation((state) => {
        const nextTransformState = applyCrowdTransformPatch(state.project.objects, crowdId, {
          scale: [scale, scale, scale],
        });
        if (nextTransformState.changedObjectIds.length === 0) return state;

        return {
          ...state,
          project: {
            ...state.project,
            objects: nextTransformState.objects,
            cameras: refreshCamerasFocusedOnObjects(
              state.project.cameras,
              nextTransformState.objects,
              nextTransformState.changedObjectIds
            ),
          },
        };
      }),
    addImportedAsset: (input) =>
      commitMutation((state) => {
        const assetId = getNextSequentialId(
          state.project.assets.map((item) => item.id),
          "asset_",
          state.project.assets.length + 1
        );
        const nextAsset = {
          id: assetId,
          kind: input.kind,
          sourceType: input.kind === "panorama" ? "image" : "model",
          fileName: input.fileName,
          name: input.name,
          url: input.url,
          assetSource: input.kind === "panorama" ? undefined : (input.assetSource ?? "local"),
          projectionMode: input.projectionMode,
        } satisfies DirectorAssetRef;

        if (input.kind === "panorama") {
          return {
            ...state,
            directorInspectorMode: "scene",
            selectedObjectId: null,
            selectedObjectIds: [],
            selectedCrowdId: null,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
              panoramaAssetId: assetId,
            },
          };
        }

        if (input.addToScene === false) {

          return {
            ...state,
            project: {
              ...state.project,
              assets: [...state.project.assets, nextAsset],
            },
          };
        }

        const nextObject = createSceneObjectFromAsset(nextAsset, state.project.objects);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: [...state.project.assets, nextAsset],
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addObjectFromAsset: (assetId) => {
      let nextObjectId: string | null = null;

      commitMutation((state) => {
        const asset = state.project.assets.find((item) => item.id === assetId);
        if (!asset || asset.sourceType !== "model" || asset.kind === "panorama") return state;

        const nextObject = createSceneObjectFromAsset(asset, state.project.objects);
        nextObjectId = nextObject.id;

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      });

      return nextObjectId;
    },
    addPresetCharacter: (bodyType = DEFAULT_CHARACTER_BODY_TYPE) =>
      commitMutation((state) => {
        const presetCharacterCount = state.project.objects.filter(
          (item) => item.kind === "character" && item.id.startsWith("char_preset_")
        ).length;
        const presetCharacterIndex = presetCharacterCount + 1;
        const row = Math.floor((presetCharacterIndex - 1) / 4);
        const x = getAddedModelColumnOffset(presetCharacterIndex - row * 4);
        const z = row * 0.8;
        const nextObject = buildPresetCharacterObject(state, bodyType, [x, 0, z]);

        return {
          ...state,
          selectedObjectId: nextObject.id,
          selectedObjectIds: [nextObject.id],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addCrowdCharacters: ({ bodyType = DEFAULT_CHARACTER_BODY_TYPE, rows, columns, spacing }) => {
      const createdIds: string[] = [];

      commitMutation((state) => {
        const positions = getCrowdCharacterPositions(rows, columns, spacing);
        const offset = getCrowdCharacterOffset(state.project.objects, spacing);
        const nextObjects = [...state.project.objects];
        const crowdLabel = formatCrowdLabel(rows, columns);
        const crowdId = getNextCrowdId(state.project.objects);

        positions.forEach((position) => {
          const nextState = {
            ...state,
            project: {
              ...state.project,
              objects: nextObjects,
            },
          } as DirectorRuntimeState;
          const nextObject = buildPresetCharacterObject(nextState, bodyType, [
            Number((position[0] + offset[0]).toFixed(4)),
            Number((position[1] + offset[1]).toFixed(4)),
            Number((position[2] + offset[2]).toFixed(4)),
          ], {
            crowdId,
            crowdLabel,
          });
          nextObjects.push(nextObject);
          createdIds.push(nextObject.id);
        });

        if (!createdIds.length) return state;

        return {
          ...state,
          selectedObjectId: createdIds[createdIds.length - 1] ?? null,
          selectedObjectIds: createdIds,
          selectedCrowdId: crowdId,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: nextObjects,
          },
        };
      });

      return createdIds;
    },
    addGeometryPrimitive: (geometryType) =>
      commitMutation((state) => {
        const geometryObjects = state.project.objects.filter((item) => item.kind === "prop" && item.geometryType);
        const geometryIndex = geometryObjects.length + 1;
        const sameTypeCount = geometryObjects.filter((item) => item.geometryType === geometryType).length;
        const row = Math.floor((geometryIndex - 1) / 4);
        const column = (geometryIndex - 1) % 4;
        const x = column * 1.15 - 1.725;
        const z = row * 0.75 + 1.15;
        const label = getGeometryPrimitiveLabel(geometryType);
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          `geo_${geometryType}_`,
          geometryIndex
        );
        const nextObject: DirectorObject = {
          id: objectId,
          name: sameTypeCount === 0 ? label : `${label}${String(sameTypeCount + 1).padStart(2, "0")}`,
          kind: "prop",
          visible: true,
          locked: false,
          geometryType,
          color: GEOMETRY_PRIMITIVE_COLOR,
          transform: createTransform([x, 0, z]),
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            objects: [...state.project.objects, nextObject],
          },
        };
      }),
    addCameraShot: (snapshot) => {
      let nextCameraId = "";

      commitMutation((state) => {
        const cameraIndex = state.project.cameras.length + 1;
        const cameraId = getNextSequentialId(
          state.project.cameras.map((item) => item.id),
          "cam_",
          cameraIndex
        );
        const objectId = getNextSequentialId(
          state.project.objects.map((item) => item.id),
          "cam_object_",
          cameraIndex
        );
        nextCameraId = cameraId;
        const transform = createTransform(
          snapshot ? getCameraRigPositionFromViewSnapshot(snapshot) : [cameraIndex * 1.2, 2.2, 9]
        );
        const nextCamera: DirectorCameraShot = {
          id: cameraId,
          name: formatSceneItemName("机位", cameraIndex),
          fov: snapshot?.fov ?? 50,
          transform,
          targetMode: "manual",
          target: snapshot?.target ?? [0, 1.2, 0],
          lastCaptureUrl: null,
          captures: [],
        };
        const nextCameraObject: DirectorObject = {
          id: objectId,
          name: nextCamera.name,
          kind: "camera",
          visible: true,
          locked: false,
          linkedCameraId: cameraId,
          transform,
        };

        return {
          ...state,
          selectedObjectId: objectId,
          selectedObjectIds: [objectId],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            cameras: [...state.project.cameras, nextCamera],
            activeCameraId: cameraId,
            objects: [...state.project.objects, nextCameraObject],
          },
        };
      });

      return nextCameraId;
    },
    applyCameraLayout: (result) => commitMutation((state) => {
      const shots = validateCameraLayout(state.project, result);
      if (!shots.length) return state;
      const cameras = [...state.project.cameras];
      const objects = [...state.project.objects];
      for (const shot of shots) {
        const index = cameras.length + 1;
        const cameraId = getNextSequentialId(cameras.map(item => item.id), "cam_", index);
        const objectId = getNextSequentialId(objects.map(item => item.id), "cam_object_", index);
        // 公共布局的位置已是机架坐标，无需经过视口相机的偏移换算。
        const transform = createTransform(shot.position);
        cameras.push({
          id: cameraId, name: shot.name, fov: shot.fov, transform, target: shot.target,
          targetMode: shot.targetObjectId === null ? "manual" : "object", targetObjectId: shot.targetObjectId,
          lastCaptureUrl: null, captures: [],
        });
        objects.push({ id: objectId, name: shot.name, kind: "camera", visible: true, locked: false, linkedCameraId: cameraId, transform });
      }
      const selectedObjectId = objects[objects.length - 1].id;
      return {
        ...state, selectedObjectId, selectedObjectIds: [selectedObjectId], selectedCrowdId: null, directorInspectorMode: "auto",
        project: { ...state.project, cameras, objects, activeCameraId: cameras[cameras.length - 1].id },
      };
    }),
    deleteSelectedObject: () =>
      commitMutation((state) => {
        const selectedObjectIds = getOrderedSelectedObjectIds(state);
        if (!selectedObjectIds.length) return state;

        const selectedObjects = state.project.objects.filter((item) => selectedObjectIds.includes(item.id));
        if (!selectedObjects.length) {
          return {
            ...state,
            selectedObjectId: null,
            selectedObjectIds: [],
          };
        }

        const linkedCameraIds = new Set(
          selectedObjects
            .filter((item) => item.kind === "camera" && item.linkedCameraId)
            .map((item) => item.linkedCameraId)
        );
        const nextCameras = linkedCameraIds.size
          ? state.project.cameras.filter((camera) => !linkedCameraIds.has(camera.id))
          : state.project.cameras;
        const selectedObjectIdSet = new Set(selectedObjectIds);
        const nextFocusedCameras = nextCameras.map((camera) =>
          camera.targetObjectId && selectedObjectIdSet.has(camera.targetObjectId)
            ? {
                ...camera,
                targetMode: "manual" as const,
                targetObjectId: null,
              }
            : camera
        );
        const nextActiveCameraId =
          state.project.activeCameraId && linkedCameraIds.has(state.project.activeCameraId)
            ? nextFocusedCameras[0]?.id ?? null
            : state.project.activeCameraId;
        const nextObjects = state.project.objects.filter((item) => !selectedObjectIds.includes(item.id));
        const assetsById = new Map(state.project.assets.map((item) => [item.id, item]));
        const remainingAssetRefIds = new Set(
          nextObjects.map((item) => item.assetRefId).filter((assetRefId): assetRefId is string => Boolean(assetRefId))
        );
        const removedAssetRefIds = new Set(
          selectedObjects
            .map((item) => item.assetRefId)
            .filter(
              (assetRefId): assetRefId is string => {
                if (typeof assetRefId !== "string" || remainingAssetRefIds.has(assetRefId)) return false;
                return assetsById.get(assetRefId)?.assetSource !== "local";
              }
            )
        );

        return {
          ...state,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedCrowdId: null,
          directorInspectorMode: "auto",
          project: {
            ...state.project,
            assets: state.project.assets.filter((item) => !removedAssetRefIds.has(item.id)),
            objects: nextObjects,
            cameras: nextFocusedCameras,
            activeCameraId: nextActiveCameraId,
          },
        };
      }),
    toggleObjectVisible: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            visible: !item.visible,
          })),
        },
      })),
    toggleObjectLocked: (id) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            locked: !item.locked,
          })),
        },
      })),
    applyPosePreset: (id, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: updateObjectById(state.project.objects, id, (item) => ({
              ...item,
              characterRig: item.characterRig
                ? {
                    ...item.characterRig,
                    posePresetId: presetId,
                    controls: preset ? { ...preset.controls } : item.characterRig.controls,
                  }
                : item.characterRig,
            })),
          },
        };
      }),
    applyCrowdPosePreset: (crowdId, presetId) =>
      commitMutation((state) => {
        const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId);

        return {
          ...state,
          project: {
            ...state.project,
            objects: state.project.objects.map((item) =>
              item.kind === "character" && item.crowdId === crowdId
                ? {
                    ...item,
                    characterRig: item.characterRig
                      ? {
                          ...item.characterRig,
                          posePresetId: presetId,
                          controls: preset ? { ...preset.controls } : item.characterRig.controls,
                        }
                      : item.characterRig,
                  }
                : item
            ),
          },
        };
      }),
    updatePoseControl: (id, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: updateObjectById(state.project.objects, id, (item) => ({
            ...item,
            characterRig: item.characterRig
              ? {
                  ...item.characterRig,
                  controls: {
                    ...item.characterRig.controls,
                    [key]: value,
                  },
                }
              : item.characterRig,
            })),
        },
      })),
    updateCrowdPoseControl: (crowdId, key, value) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          objects: state.project.objects.map((item) =>
            item.kind === "character" && item.crowdId === crowdId
              ? {
                  ...item,
                  characterRig: item.characterRig
                    ? {
                        ...item.characterRig,
                        controls: {
                          ...item.characterRig.controls,
                          [key]: value,
                        },
                      }
                    : item.characterRig,
                }
              : item
          ),
        },
      })),
    setActiveCamera: (cameraId) =>
      commitUiMutation((state) => {
        const selectedObjectId =
          state.project.objects.find((item) => item.kind === "camera" && item.linkedCameraId === cameraId)?.id ??
          null;

        return {
          ...state,
          project: {
            ...state.project,
            activeCameraId: cameraId,
          },
          selectedObjectId,
          selectedObjectIds: selectedObjectId ? [selectedObjectId] : [],
          selectedCrowdId: null,
        };
      }),
    addCameraCaptures: (cameraId, dataUrls) =>
      commitMutation((state) => {
        if (dataUrls.length === 0) return state;

        const targetCameraId = cameraId ?? state.project.activeCameraId ?? state.project.cameras[0]?.id ?? null;
        if (!targetCameraId) return state;

        let updated = false;
        const cameras = state.project.cameras.map((camera) => {
          if (camera.id !== targetCameraId) return camera;

          updated = true;
          const nextCaptures = buildCameraCaptures(camera, dataUrls);

          return {
            ...camera,
            lastCaptureUrl: nextCaptures[nextCaptures.length - 1]?.dataUrl ?? camera.lastCaptureUrl ?? null,
            captures: [...(camera.captures ?? []), ...nextCaptures],
          };
        });

        if (!updated) return state;

        return {
          ...state,
          project: {
            ...state.project,
            cameras,
          },
        };
      }),
    updateCamera: (cameraId, patch) =>
      commitMutation((state) => ({
        ...state,
        project: {
          ...state.project,
          cameras: state.project.cameras.map((item) =>
            item.id === cameraId
              ? {
                  ...item,
                  ...patch,
                  transform: patch.transform ?? item.transform,
                  target: patch.target ?? item.target,
                }
              : item
          ),
          objects: state.project.objects.map((item) =>
            item.kind === "camera" && item.linkedCameraId === cameraId && patch.transform
              ? { ...item, transform: patch.transform }
              : item
          ),
        },
      })),
    copySelectedObjects: () => {
      const currentState = get() as DirectorRuntimeState;
      const clipboard = buildClipboardEntries(currentState);
      set({
        ...currentState,
        clipboard,
        clipboardPasteCount: 0,
      });
    },
    pasteClipboardObjects: () => commitMutation((state) => pasteClipboardEntries(state)),
    undo: () => {
      const currentState = get() as DirectorRuntimeState;
      const previousState = currentState.undoStack[currentState.undoStack.length - 1];
      if (!previousState) return;

      const runtimeState = createRuntimeStateFromPersistedState(previousState);
      set({
        ...runtimeState,
        clipboard: currentState.clipboard,
        clipboardPasteCount: currentState.clipboardPasteCount,
        undoStack: currentState.undoStack.slice(0, -1),
      });
    },
    replaceProject: (project) =>
      commitMutation((state) => ({
        ...state,
        project: cloneJsonValue(project),
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedCrowdId: null,
        directorInspectorMode: "auto",
      })),
  };
});
