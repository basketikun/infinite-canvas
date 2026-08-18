/**
 * Camera optics. Real sensor widths + focal lengths → field of view, so
 * "35mm on Super 35" frames like it does on set.
 */

import type { AspectId, SensorId, ShotSizeId } from './types'

export interface SensorFormat {
  id: SensorId
  name: string
  /** Active gate width in mm. */
  width: number
  /** Active gate height in mm — a crop can never exceed this. */
  height: number
}

export const SENSORS: Record<SensorId, SensorFormat> = {
  super16: { id: 'super16', name: 'Super 16', width: 12.52, height: 7.41 },
  super35: { id: 'super35', name: 'Super 35', width: 24.89, height: 18.66 },
  fullFrame: { id: 'fullFrame', name: 'Full Frame / VistaVision', width: 36.0, height: 24.0 },
  imax65: { id: 'imax65', name: '65mm / IMAX', width: 52.63, height: 23.01 }
}

export const LENS_SET = [12, 16, 24, 35, 50, 85, 100, 135]

export const ASPECT_RATIOS: Record<AspectId, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '2.39:1': 2.39,
  '4:3': 4 / 3,
  '1:1': 1
}

/**
 * Vertical FOV in radians, crop-to-aspect model: a wide delivery aspect
 * crops the gate vertically; a portrait aspect crops it horizontally. The
 * used height is therefore bounded by the physical gate height — a 9:16
 * crop of Super 35 uses the full 18.66mm height with a narrowed width, it
 * does not invent a 44mm-tall sensor.
 */
export function verticalFov(sensorId: SensorId, focalLength: number, aspect: AspectId): number {
  const sensor = SENSORS[sensorId]
  const aspectRatio = ASPECT_RATIOS[aspect]
  const usedHeight = Math.min(sensor.height, sensor.width / aspectRatio)
  return 2 * Math.atan(usedHeight / (2 * focalLength))
}

export function horizontalFov(sensorId: SensorId, focalLength: number): number {
  const sensor = SENSORS[sensorId]
  return 2 * Math.atan(sensor.width / (2 * focalLength))
}

export interface ShotSizeSpec {
  id: ShotSizeId
  name: string
  /**
   * Portion of a standing subject that should be visible, expressed as a
   * fraction of subject height measured DOWN from the top of the head.
   * (MS ≈ waist-up ≈ 0.45 of a person.)
   */
  visibleFraction: number
  /** How much of the frame height the visible portion should fill. */
  fillFraction: number
}

export const SHOT_SIZES: Record<ShotSizeId, ShotSizeSpec> = {
  EWS: { id: 'EWS', name: 'Extreme Wide', visibleFraction: 1, fillFraction: 0.25 },
  WS: { id: 'WS', name: 'Wide', visibleFraction: 1, fillFraction: 0.65 },
  FS: { id: 'FS', name: 'Full Shot', visibleFraction: 1, fillFraction: 0.92 },
  MS: { id: 'MS', name: 'Medium', visibleFraction: 0.45, fillFraction: 0.92 },
  MCU: { id: 'MCU', name: 'Medium Close-Up', visibleFraction: 0.3, fillFraction: 0.92 },
  CU: { id: 'CU', name: 'Close-Up', visibleFraction: 0.18, fillFraction: 0.9 },
  ECU: { id: 'ECU', name: 'Extreme Close-Up', visibleFraction: 0.08, fillFraction: 0.95 }
}

export interface FramingResult {
  /** Camera distance from the subject's framed region, meters. */
  distance: number
  /** World height (Y) the camera should be at / look toward. */
  targetHeight: number
}

/**
 * Auto-framing: at the given lens/sensor/aspect, how far from the subject
 * must the camera be to achieve the shot size, and at what height should it
 * aim? subjectHeight = world height of subject in meters.
 */
export function frameSubject(
  size: ShotSizeId,
  subjectHeight: number,
  sensorId: SensorId,
  focalLength: number,
  aspect: AspectId
): FramingResult {
  const spec = SHOT_SIZES[size]
  const vfov = verticalFov(sensorId, focalLength, aspect)
  const visibleHeight = subjectHeight * spec.visibleFraction
  const frameHeightAtSubject = visibleHeight / spec.fillFraction
  const distance = frameHeightAtSubject / (2 * Math.tan(vfov / 2))
  // Aim at the vertical center of the visible region (top of head down).
  const targetHeight = subjectHeight - visibleHeight / 2
  return { distance, targetHeight }
}

/** Depth of field: simple hyperfocal-flavored blur amount for the preview. */
export function dofBlurAmount(
  focusDistance: number,
  subjectDistance: number,
  focalLength: number
): number {
  // Not physically exact — a monotonic, stable proxy that reads correctly:
  // longer lenses and bigger focus misses blur more.
  const miss = Math.abs(subjectDistance - focusDistance) / Math.max(focusDistance, 0.1)
  const lensFactor = focalLength / 35
  return Math.min(1, miss * lensFactor * 0.8)
}
