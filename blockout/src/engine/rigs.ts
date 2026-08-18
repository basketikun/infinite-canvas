/**
 * Camera rigs: a motion character layered on top of the mark-to-mark path.
 * All noise is seeded (stored on the shot) so playback and export replay
 * identically everywhere.
 */

import { FractalNoise1D } from './random'
import type { RigId } from './types'

export interface RigSpec {
  id: RigId
  name: string
  /** Positional noise amplitude in meters at intensity 1. */
  posAmp: number
  /** Rotational noise amplitude in radians at intensity 1. */
  rotAmp: number
  /** Base noise frequency in Hz. */
  frequency: number
  /** Octaves — more = jitterier. */
  octaves: number
  description: string
}

export const RIGS: Record<RigId, RigSpec> = {
  sticks: {
    id: 'sticks', name: 'Sticks (locked off)',
    posAmp: 0, rotAmp: 0, frequency: 0, octaves: 1,
    description: 'Tripod. No movement noise; pans/tilts between marks only.'
  },
  dolly: {
    id: 'dolly', name: 'Dolly',
    posAmp: 0.005, rotAmp: 0.0005, frequency: 0.4, octaves: 1,
    description: 'Rail-smooth tracking with near-imperceptible weight.'
  },
  steadicam: {
    id: 'steadicam', name: 'Steadicam',
    posAmp: 0.03, rotAmp: 0.004, frequency: 0.5, octaves: 2,
    description: 'Floating glide with a gentle low-frequency drift.'
  },
  handheld: {
    id: 'handheld', name: 'Handheld',
    posAmp: 0.045, rotAmp: 0.018, frequency: 1.8, octaves: 3,
    description: 'Operator energy. Intensity slider goes doc-style to Bourne.'
  },
  crane: {
    id: 'crane', name: 'Crane / Jib',
    posAmp: 0.01, rotAmp: 0.001, frequency: 0.3, octaves: 1,
    description: 'Sweeping arcs; slight boom settle.'
  },
  drone: {
    id: 'drone', name: 'Drone',
    posAmp: 0.05, rotAmp: 0.002, frequency: 0.25, octaves: 2,
    description: 'Large-scale smooth flight with mild aerial drift.'
  },
  carMount: {
    id: 'carMount', name: 'Car mount',
    posAmp: 0.02, rotAmp: 0.006, frequency: 2.5, octaves: 3,
    description: 'Parented to a vehicle or actor; road vibration.'
  }
}

export interface RigOffset {
  dx: number
  dy: number
  dz: number
  dpan: number
  dtilt: number
  droll: number
}

/** Stateless-per-shot noise generator; construct once per (shot, seed). */
export class RigNoise {
  private channels: FractalNoise1D[]
  private spec: RigSpec

  constructor(rig: RigId, seed: number) {
    this.spec = RIGS[rig]
    this.channels = []
    for (let c = 0; c < 6; c++) {
      this.channels.push(new FractalNoise1D(seed, c + 1, this.spec.octaves))
    }
  }

  offsetAt(t: number, intensity: number): RigOffset {
    const s = this.spec
    if (s.posAmp === 0 && s.rotAmp === 0) {
      return { dx: 0, dy: 0, dz: 0, dpan: 0, dtilt: 0, droll: 0 }
    }
    const p = s.posAmp * intensity
    const r = s.rotAmp * intensity
    const f = s.frequency
    return {
      dx: this.channels[0]!.sample(t, f) * p,
      dy: this.channels[1]!.sample(t, f) * p * 0.7,
      dz: this.channels[2]!.sample(t, f) * p * 0.5,
      dpan: this.channels[3]!.sample(t, f) * r,
      dtilt: this.channels[4]!.sample(t, f) * r * 0.8,
      droll: this.channels[5]!.sample(t, f) * r * 0.35
    }
  }
}
