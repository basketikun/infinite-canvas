export const VIEWPORT_ASPECT_RATIO_OPTIONS = [
  { id: "auto", label: "自动", value: null },
  { id: "1:1", label: "1:1", value: 1 },
  { id: "2:1", label: "2:1", value: 2 },
  { id: "3:4", label: "3:4", value: 3 / 4 },
  { id: "4:3", label: "4:3", value: 4 / 3 },
  { id: "16:9", label: "16:9", value: 16 / 9 },
  { id: "21:9", label: "21:9", value: 21 / 9 },
  { id: "9:16", label: "9:16", value: 9 / 16 },
] as const;

export type ViewportAspectRatio = (typeof VIEWPORT_ASPECT_RATIO_OPTIONS)[number]["id"];

export function getViewportAspectRatioValue(ratio: ViewportAspectRatio) {
  return VIEWPORT_ASPECT_RATIO_OPTIONS.find((option) => option.id === ratio)?.value ?? null;
}
