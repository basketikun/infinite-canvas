export const POSE_PRESET_IDS = [
  "stand",
  "t-pose",
  "walk",
  "run",
  "sit",
  "crouch",
  "kneel-one",
  "kneel-two",
  "hands-on-hips",
  "lean",
  "bow",
  "think",
  "fight",
  "kick",
  "throw",
  "push",
  "wave",
  "reach",
  "cross-arms",
  "phone",
] as const;

export type PosePresetId = (typeof POSE_PRESET_IDS)[number];
