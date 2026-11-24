import type { CharacterBodyType } from "../../schema/directorProject";

export type { CharacterBodyType };

export const DEFAULT_CHARACTER_BODY_TYPE: CharacterBodyType = "mannequin";

export interface CharacterBodyProportions {
  hipY: number;
  pelvisRadius: number;
  pelvisScale: [number, number, number];
  legSpread: number;
  torsoLowerRadius: number;
  torsoUpperRadius: number;
  torsoLowerHeight: number;
  torsoUpperHeight: number;
  torsoLowerScale: [number, number, number];
  torsoUpperScale: [number, number, number];
  shoulderWidth: number;
  shoulderRadius: number;
  upperArmRadius: number;
  upperArmLength: number;
  forearmRadius: number;
  forearmLength: number;
  elbowRadius: number;
  wristRadius: number;
  handRadius: number;
  handScale: [number, number, number];
  thighRadius: number;
  thighLength: number;
  calfRadius: number;
  calfLength: number;
  kneeRadius: number;
  ankleRadius: number;
  footRadius: number;
  footLength: number;
  footScale: [number, number, number];
  neckRadius: number;
  neckHeight: number;
  headRadius: number;
  headScale: [number, number, number];
  faceOffsetZ: number;
  eyeRadius: number;
  noseScale: [number, number, number];
  mouthScale: [number, number, number];
  jointRadiusScale: number;
}

export interface CharacterBodyPreset {
  bodyType: CharacterBodyType;
  label: string;
  defaultScale: [number, number, number];
  labelAnchorY: number;
  proportions: CharacterBodyProportions;
}

const BASE_PROPORTIONS: CharacterBodyProportions = {
  hipY: 0.74,
  pelvisRadius: 0.26,
  pelvisScale: [1.34, 0.58, 0.8],
  legSpread: 0.18,
  torsoLowerRadius: 0.18,
  torsoUpperRadius: 0.22,
  torsoLowerHeight: 0.26,
  torsoUpperHeight: 0.48,
  torsoLowerScale: [0.95, 0.96, 0.78],
  torsoUpperScale: [1.42, 1.08, 0.88],
  shoulderWidth: 0.42,
  shoulderRadius: 0.14,
  upperArmRadius: 0.085,
  upperArmLength: 0.34,
  forearmRadius: 0.074,
  forearmLength: 0.3,
  elbowRadius: 0.09,
  wristRadius: 0.074,
  handRadius: 0.095,
  handScale: [0.72, 1, 0.9],
  thighRadius: 0.11,
  thighLength: 0.42,
  calfRadius: 0.095,
  calfLength: 0.4,
  kneeRadius: 0.1,
  ankleRadius: 0.08,
  footRadius: 0.095,
  footLength: 0.22,
  footScale: [0.95, 0.55, 1.42],
  neckRadius: 0.1,
  neckHeight: 0.18,
  headRadius: 0.24,
  headScale: [0.78, 1, 0.72],
  faceOffsetZ: 0.18,
  eyeRadius: 0.022,
  noseScale: [0.42, 0.58, 0.32],
  mouthScale: [0.55, 0.1, 0.08],
  jointRadiusScale: 1,
};

function preset(
  bodyType: CharacterBodyType,
  label: string,
  labelAnchorY: number,
  patch: Partial<CharacterBodyProportions> = {},
  defaultScale: [number, number, number] = [1, 1, 1]
): CharacterBodyPreset {
  return {
    bodyType,
    defaultScale,
    label,
    labelAnchorY,
    proportions: {
      ...BASE_PROPORTIONS,
      ...patch,
    },
  };
}

export const CHARACTER_BODY_PRESETS: CharacterBodyPreset[] = [
  preset("mannequin", "男性素体", 2.62),
  preset("female", "女性素体", 2.52, {
    pelvisScale: [1.42, 0.56, 0.78],
    torsoLowerRadius: 0.16,
    torsoUpperRadius: 0.2,
    torsoLowerScale: [0.86, 0.98, 0.72],
    torsoUpperScale: [1.2, 1.04, 0.8],
    shoulderWidth: 0.37,
    shoulderRadius: 0.12,
    upperArmRadius: 0.074,
    forearmRadius: 0.066,
    thighRadius: 0.1,
    calfRadius: 0.082,
    headScale: [0.76, 1, 0.7],
  }),
  preset("broad", "宽厚素体", 2.76, {
    pelvisScale: [1.46, 0.62, 0.86],
    torsoLowerScale: [1.05, 0.98, 0.84],
    torsoUpperScale: [1.58, 1.08, 0.94],
    torsoUpperRadius: 0.27,
    torsoUpperHeight: 0.52,
    shoulderWidth: 0.52,
    shoulderRadius: 0.16,
    upperArmRadius: 0.105,
    forearmRadius: 0.09,
    thighRadius: 0.125,
    calfRadius: 0.108,
    headRadius: 0.25,
  }),
  preset("muscular", "健壮素体", 2.7, {
    pelvisScale: [1.25, 0.56, 0.78],
    torsoLowerRadius: 0.17,
    torsoUpperRadius: 0.28,
    torsoLowerScale: [0.95, 0.96, 0.78],
    torsoUpperScale: [1.62, 1.06, 0.9],
    shoulderWidth: 0.5,
    shoulderRadius: 0.17,
    upperArmRadius: 0.11,
    forearmRadius: 0.095,
    thighRadius: 0.13,
    calfRadius: 0.11,
  }),
  preset("slim", "纤细素体", 2.58, {
    pelvisScale: [1.08, 0.5, 0.7],
    torsoLowerRadius: 0.14,
    torsoUpperRadius: 0.17,
    torsoLowerScale: [0.78, 0.96, 0.68],
    torsoUpperScale: [1.04, 1.02, 0.72],
    shoulderWidth: 0.34,
    shoulderRadius: 0.105,
    upperArmRadius: 0.06,
    forearmRadius: 0.052,
    thighRadius: 0.082,
    calfRadius: 0.068,
    headRadius: 0.225,
  }),
  preset("teen", "少年素体", 2.28, {
    hipY: 0.64,
    pelvisRadius: 0.22,
    pelvisScale: [1.18, 0.52, 0.74],
    legSpread: 0.15,
    torsoLowerRadius: 0.15,
    torsoLowerHeight: 0.22,
    torsoUpperRadius: 0.18,
    torsoUpperHeight: 0.4,
    torsoLowerScale: [0.82, 0.94, 0.7],
    torsoUpperScale: [1.1, 1.02, 0.76],
    shoulderWidth: 0.34,
    shoulderRadius: 0.105,
    upperArmRadius: 0.065,
    upperArmLength: 0.28,
    forearmRadius: 0.056,
    forearmLength: 0.25,
    thighRadius: 0.088,
    thighLength: 0.35,
    calfRadius: 0.076,
    calfLength: 0.33,
    headRadius: 0.23,
    headScale: [0.82, 1.05, 0.76],
  }),
  preset("child", "儿童素体", 1.82, {
    hipY: 0.5,
    pelvisRadius: 0.18,
    pelvisScale: [1.05, 0.48, 0.72],
    legSpread: 0.12,
    torsoLowerRadius: 0.13,
    torsoLowerHeight: 0.18,
    torsoUpperRadius: 0.15,
    torsoUpperHeight: 0.3,
    torsoLowerScale: [0.76, 0.9, 0.68],
    torsoUpperScale: [0.98, 0.98, 0.72],
    shoulderWidth: 0.28,
    shoulderRadius: 0.085,
    upperArmRadius: 0.052,
    upperArmLength: 0.2,
    forearmRadius: 0.046,
    forearmLength: 0.18,
    elbowRadius: 0.06,
    wristRadius: 0.05,
    handRadius: 0.07,
    thighRadius: 0.07,
    thighLength: 0.24,
    calfRadius: 0.062,
    calfLength: 0.22,
    kneeRadius: 0.065,
    ankleRadius: 0.054,
    footRadius: 0.07,
    footLength: 0.16,
    headRadius: 0.255,
    headScale: [0.9, 1.08, 0.82],
  }),
  preset("chibi", "二头身", 1.38, {
    hipY: 0.36,
    pelvisRadius: 0.16,
    pelvisScale: [1.05, 0.48, 0.78],
    legSpread: 0.1,
    torsoLowerRadius: 0.12,
    torsoLowerHeight: 0.12,
    torsoUpperRadius: 0.14,
    torsoUpperHeight: 0.22,
    torsoLowerScale: [0.86, 0.82, 0.74],
    torsoUpperScale: [0.96, 0.92, 0.78],
    shoulderWidth: 0.24,
    shoulderRadius: 0.07,
    upperArmRadius: 0.044,
    upperArmLength: 0.14,
    forearmRadius: 0.038,
    forearmLength: 0.12,
    elbowRadius: 0.048,
    wristRadius: 0.04,
    handRadius: 0.06,
    thighRadius: 0.056,
    thighLength: 0.15,
    calfRadius: 0.05,
    calfLength: 0.14,
    kneeRadius: 0.052,
    ankleRadius: 0.042,
    footRadius: 0.06,
    footLength: 0.12,
    footScale: [1.12, 0.62, 1.55],
    neckRadius: 0.065,
    neckHeight: 0.06,
    headRadius: 0.34,
    headScale: [0.96, 1.04, 0.88],
    faceOffsetZ: 0.25,
    eyeRadius: 0.026,
    noseScale: [0.34, 0.46, 0.28],
    mouthScale: [0.45, 0.1, 0.07],
    jointRadiusScale: 0.9,
  }),
];

export const BODY_TYPE_OPTIONS = CHARACTER_BODY_PRESETS.map(({ bodyType, label }) => ({
  bodyType,
  label,
}));

export function normalizeBodyType(value?: string | null): CharacterBodyType {
  return CHARACTER_BODY_PRESETS.some((preset) => preset.bodyType === value)
    ? (value as CharacterBodyType)
    : DEFAULT_CHARACTER_BODY_TYPE;
}

export function getBodyPreset(value?: string | null): CharacterBodyPreset {
  const bodyType = normalizeBodyType(value);
  return CHARACTER_BODY_PRESETS.find((preset) => preset.bodyType === bodyType) ?? CHARACTER_BODY_PRESETS[0];
}

export function legDimensions(p: CharacterBodyProportions) {
  const thigh = p.thighLength + p.thighRadius + p.kneeRadius;
  const shin = p.calfLength + p.calfRadius + p.ankleRadius;
  const hip = p.hipY - p.pelvisRadius * 0.35;
  const sole = p.footRadius + 0.045 + p.footRadius * p.footScale[2];
  return { thigh, shin, hip, groundOffset: thigh + shin + sole - hip };
}

export function getGroundedLabelY(value?: string | null): number {
  const preset = getBodyPreset(value);
  return preset.labelAnchorY + legDimensions(preset.proportions).groundOffset * preset.defaultScale[1];
}
