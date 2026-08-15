/**
 * Deterministic randomness. Rig noise must replay identically across
 * playback, export, and machines, so all randomness flows from stored seeds.
 */

/** mulberry32 PRNG — small, fast, good enough for camera noise. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 1D value noise: smooth interpolation between lattice randoms.
 * Continuous in t, deterministic per (seed, channel).
 */
export class ValueNoise1D {
  private lattice = new Map<number, number>()
  private rngFor: (i: number) => number

  constructor(seed: number, channel: number) {
    // Derive per-lattice-point values from seed+channel without storing state.
    this.rngFor = (i: number) => {
      const r = mulberry32(((seed * 2654435761) ^ (channel * 40503) ^ (i * 2246822519)) >>> 0)
      return r()
    }
  }

  private at(i: number): number {
    let v = this.lattice.get(i)
    if (v === undefined) {
      v = this.rngFor(i) * 2 - 1
      this.lattice.set(i, v)
    }
    return v
  }

  /** Sample noise in [-1, 1] at time t (lattice spacing = 1). */
  sample(t: number): number {
    const i = Math.floor(t)
    const f = t - i
    const u = f * f * (3 - 2 * f) // smoothstep
    return this.at(i) * (1 - u) + this.at(i + 1) * u
  }
}

/** Fractal (multi-octave) noise for organic handheld motion. */
export class FractalNoise1D {
  private octaves: ValueNoise1D[]

  constructor(seed: number, channel: number, octaveCount = 3) {
    this.octaves = []
    for (let o = 0; o < octaveCount; o++) {
      this.octaves.push(new ValueNoise1D(seed, channel * 16 + o))
    }
  }

  /** Sample in roughly [-1, 1]; frequency in Hz given t in seconds. */
  sample(t: number, frequency: number): number {
    let amp = 1
    let freq = frequency
    let sum = 0
    let norm = 0
    for (const oct of this.octaves) {
      sum += oct.sample(t * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.1
    }
    return sum / norm
  }
}
