const PANORAMA_FORWARD_ALIGNMENT_DEGREES = 90;
const PANORAMA_GROUND_OPACITY_CAP = 0.1;

export function getPanoramaRotationRadians(yaw: number) {
  return ((yaw + PANORAMA_FORWARD_ALIGNMENT_DEGREES) * Math.PI) / 180;
}

export function getEffectiveGroundOpacity(baseOpacity: number, hasPanorama: boolean) {
  if (!hasPanorama) return baseOpacity;
  return Math.min(baseOpacity, PANORAMA_GROUND_OPACITY_CAP);
}
