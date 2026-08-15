import { describe, expect, it } from 'vitest'
import { easedProgress, lerpAngle, smoothstep } from '@engine/easing'
import { Path, headingOf, v3 } from '@engine/path'
import { checkSpeed } from '@engine/gaits'
import { RigNoise } from '@engine/rigs'
import { mulberry32, FractalNoise1D } from '@engine/random'

describe('easing', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easedProgress(0, 0.3, 0.3)).toBe(0)
    expect(easedProgress(1, 0.3, 0.3)).toBeCloseTo(1, 9)
  })

  it('is monotonically increasing', () => {
    let prev = -1
    for (let u = 0; u <= 1.0001; u += 0.01) {
      const p = easedProgress(u, 0.25, 0.4)
      expect(p).toBeGreaterThanOrEqual(prev)
      prev = p
    }
  })

  it('handles zero easing (linear)', () => {
    expect(easedProgress(0.5, 0, 0)).toBeCloseTo(0.5, 9)
  })

  it('handles overlapping ease fractions without exceeding bounds', () => {
    const p = easedProgress(0.5, 0.9, 0.9)
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1)
    expect(easedProgress(1, 0.9, 0.9)).toBeCloseTo(1, 6)
  })

  it('lerpAngle takes the short way around', () => {
    expect(lerpAngle(0.1, Math.PI * 2 - 0.1, 0.5)).toBeCloseTo(0, 6)
  })

  it('smoothstep clamps', () => {
    expect(smoothstep(-1)).toBe(0)
    expect(smoothstep(2)).toBe(1)
  })
})

describe('path', () => {
  it('straight path has correct length and midpoint', () => {
    const p = new Path([v3(0, 0, 0), v3(0, 0, -10)])
    expect(p.length).toBeCloseTo(10, 3)
    const mid = p.pointAt(5)
    expect(mid.z).toBeCloseTo(-5, 2)
    expect(mid.x).toBeCloseTo(0, 3)
  })

  it('heading convention: travelling -Z is heading 0', () => {
    expect(headingOf(v3(0, 0, -1))).toBeCloseTo(0, 9)
    // three.js: rotation.y = heading; +x travel is -π/2 under this convention
    expect(headingOf(v3(1, 0, 0))).toBeCloseTo(-Math.PI / 2, 9)
  })

  it('via points bend the path and lengthen it', () => {
    const straight = new Path([v3(0, 0, 0), v3(0, 0, -10)])
    const bent = new Path([v3(0, 0, 0), v3(4, 0, -5), v3(0, 0, -10)])
    expect(bent.length).toBeGreaterThan(straight.length)
    // The bend passes near the via point
    const mid = bent.pointAt(bent.length / 2)
    expect(mid.x).toBeGreaterThan(2)
  })

  it('clamps distances outside [0, length]', () => {
    const p = new Path([v3(0, 0, 0), v3(0, 0, -10)])
    expect(p.pointAt(-5).z).toBeCloseTo(0, 6)
    expect(p.pointAt(999).z).toBeCloseTo(-10, 6)
  })
})

describe('speed sanity', () => {
  it('flags an impossible walk and suggests jogging', () => {
    const v = checkSpeed('walk', 3.5)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.kind).toBe('tooFast')
      expect(v.suggestion).toBe('jog')
    }
  })

  it('accepts a normal walk', () => {
    expect(checkSpeed('walk', 1.4).ok).toBe(true)
  })

  it('scales plausible speeds for vehicles', () => {
    expect(checkSpeed('walk', 15, 15).ok).toBe(true) // 15 m/s "walk" for a car
    expect(checkSpeed('walk', 15, 1).ok).toBe(false)
  })

  it('flags a crawl-speed run', () => {
    const v = checkSpeed('run', 1.0)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.kind).toBe('tooSlow')
  })
})

describe('seeded randomness', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const c = mulberry32(43)
    const seqA = [a(), a(), a()]
    const seqB = [b(), b(), b()]
    const seqC = [c(), c(), c()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
  })

  it('fractal noise is continuous and bounded', () => {
    const n = new FractalNoise1D(7, 1, 3)
    let prev = n.sample(0, 2)
    for (let t = 0.01; t < 2; t += 0.01) {
      const v = n.sample(t, 2)
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01)
      expect(Math.abs(v - prev)).toBeLessThan(0.35) // no jumps
      prev = v
    }
  })

  it('rig noise replays identically for the same seed', () => {
    const a = new RigNoise('handheld', 123)
    const b = new RigNoise('handheld', 123)
    const c = new RigNoise('handheld', 124)
    expect(a.offsetAt(1.234, 1)).toEqual(b.offsetAt(1.234, 1))
    expect(a.offsetAt(1.234, 1)).not.toEqual(c.offsetAt(1.234, 1))
  })

  it('sticks rig produces zero noise', () => {
    const n = new RigNoise('sticks', 5)
    const o = n.offsetAt(2, 1)
    expect(o.dx).toBe(0)
    expect(o.dpan).toBe(0)
  })
})
