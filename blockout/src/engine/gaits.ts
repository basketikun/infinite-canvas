/**
 * Gaits: how an entity moves between marks, plausible speed ranges for the
 * speed sanity check, and stride lengths that drive the procedural walk
 * cycle (cycle phase = distance / stride).
 */

import type { GaitId } from './types'

export interface GaitSpec {
  id: GaitId
  name: string
  /** Plausible speed range m/s for a human-scale actor. */
  minSpeed: number
  maxSpeed: number
  /** Meters per full gait cycle (two steps). 0 = stationary pose. */
  strideLength: number
  /** Whether this gait travels; stationary gaits hold pose at a mark. */
  travels: boolean
}

export const GAITS: Record<GaitId, GaitSpec> = {
  stand: { id: 'stand', name: 'Stand', minSpeed: 0, maxSpeed: 0, strideLength: 0, travels: false },
  walk: { id: 'walk', name: 'Walk', minSpeed: 0.4, maxSpeed: 2.2, strideLength: 1.45, travels: true },
  jog: { id: 'jog', name: 'Jog', minSpeed: 2.0, maxSpeed: 4.0, strideLength: 2.0, travels: true },
  run: { id: 'run', name: 'Run', minSpeed: 3.5, maxSpeed: 9.0, strideLength: 3.6, travels: true },
  sit: { id: 'sit', name: 'Sit', minSpeed: 0, maxSpeed: 0, strideLength: 0, travels: false },
  lie: { id: 'lie', name: 'Lie down', minSpeed: 0, maxSpeed: 0, strideLength: 0, travels: false },
  crouch: { id: 'crouch', name: 'Crouch', minSpeed: 0, maxSpeed: 1.0, strideLength: 0.9, travels: true },
  gesture: { id: 'gesture', name: 'Talk / gesture', minSpeed: 0, maxSpeed: 0, strideLength: 0, travels: false },
  fall: { id: 'fall', name: 'Fall', minSpeed: 0, maxSpeed: 0, strideLength: 0, travels: false }
}

export type SpeedVerdict =
  | { ok: true }
  | { ok: false; kind: 'tooFast' | 'tooSlow'; impliedSpeed: number; suggestion: GaitId | 'addTime' }

/**
 * Speed sanity check for a travel leg. Scale multiplies plausible speeds
 * (vehicles/animals pass scale > 1; a car "walk" just means "drive").
 */
export function checkSpeed(gait: GaitId, impliedSpeed: number, speedScale = 1): SpeedVerdict {
  const spec = GAITS[gait]
  if (!spec.travels) {
    return impliedSpeed > 0.01
      ? { ok: false, kind: 'tooFast', impliedSpeed, suggestion: 'walk' }
      : { ok: true }
  }
  const max = spec.maxSpeed * speedScale
  const min = spec.minSpeed * speedScale
  if (impliedSpeed > max * 1.05) {
    const suggestion: GaitId | 'addTime' =
      gait === 'walk' ? 'jog' : gait === 'jog' ? 'run' : 'addTime'
    return { ok: false, kind: 'tooFast', impliedSpeed, suggestion }
  }
  if (min > 0 && impliedSpeed < min * 0.5 && impliedSpeed > 0.01) {
    const suggestion: GaitId | 'addTime' = gait === 'run' ? 'jog' : gait === 'jog' ? 'walk' : 'addTime'
    return { ok: false, kind: 'tooSlow', impliedSpeed, suggestion }
  }
  return { ok: true }
}
