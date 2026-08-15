import { describe, expect, it } from 'vitest'
import {
  ACTION_PRESETS,
  type ActionContext,
  type ActionMarkSpec,
  type ActionPreset
} from '@engine/action-presets'

const DUR = 8

/** Ground-level fixture: at origin, facing −Z. */
function groundCtx(): ActionContext {
  return { start: { x: 0, y: 0, z: 0, heading: 0 }, duration: DUR }
}

/** Airborne fixture: 12m up, same pose. */
function airborneCtx(): ActionContext {
  return { start: { x: 0, y: 12, z: 0, heading: 0 }, duration: DUR }
}

function finite(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n)
}

function byId(id: string): ActionPreset {
  const p = ACTION_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`missing preset ${id}`)
  return p
}

/** Meters travelled from the start along ctx.start.heading forward (−Z here). */
function forwardOf(m: ActionMarkSpec): number {
  // heading 0 forward = −Z, so forward distance = −z.
  return -m.position.z
}

describe('action presets — universal contract (both fixtures)', () => {
  for (const preset of ACTION_PRESETS) {
    for (const [label, mk] of [
      ['ground', groundCtx],
      ['airborne', airborneCtx]
    ] as const) {
      describe(`${preset.id} [${label}]`, () => {
        const ctx = mk()
        const marks = preset.generate(ctx)

        it('returns ≥5 marks', () => {
          expect(marks.length).toBeGreaterThanOrEqual(5)
        })

        it('first mark at t=0 exactly at start position', () => {
          expect(marks[0]!.time).toBeCloseTo(0, 9)
          expect(marks[0]!.position.x).toBeCloseTo(ctx.start.x, 6)
          expect(marks[0]!.position.y).toBeCloseTo(Math.max(0, ctx.start.y), 6)
          expect(marks[0]!.position.z).toBeCloseTo(ctx.start.z, 6)
        })

        it('last mark at t=duration', () => {
          expect(marks[marks.length - 1]!.time).toBeCloseTo(DUR, 6)
        })

        it('times strictly increasing', () => {
          for (let i = 1; i < marks.length; i++) {
            expect(marks[i]!.time).toBeGreaterThan(marks[i - 1]!.time)
          }
        })

        it('all positions finite and y ≥ 0', () => {
          for (const m of marks) {
            expect(finite(m.position.x)).toBe(true)
            expect(finite(m.position.y)).toBe(true)
            expect(finite(m.position.z)).toBe(true)
            expect(m.position.y).toBeGreaterThanOrEqual(0)
          }
        })

        it('ease/hold values sane', () => {
          for (const m of marks) {
            expect(m.easeIn).toBeGreaterThanOrEqual(0)
            expect(m.easeOut).toBeGreaterThanOrEqual(0)
            expect(m.hold).toBeGreaterThanOrEqual(0)
          }
        })

        it('gait is a valid value', () => {
          for (const m of marks) {
            expect(['walk', 'jog', 'run', 'stand']).toContain(m.gait)
          }
        })
      })
    }
  }
})

describe('action presets — registry', () => {
  it('has at least 20 presets', () => {
    expect(ACTION_PRESETS.length).toBeGreaterThanOrEqual(20)
  })

  it('has 33 presets', () => {
    expect(ACTION_PRESETS.length).toBe(33)
  })

  it('all preset ids are unique', () => {
    const ids = ACTION_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every declared category is represented', () => {
    const cats = new Set(ACTION_PRESETS.map((p) => p.category))
    for (const c of ['aircraft', 'helicopter', 'bird', 'vehicle', 'destruction', 'object']) {
      expect(cats.has(c as never)).toBe(true)
    }
  })

  it('each preset has a non-empty name, description, and suggestedAssets', () => {
    for (const p of ACTION_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
      expect(Array.isArray(p.suggestedAssets)).toBe(true)
      expect(p.suggestedAssets.length).toBeGreaterThan(0)
    }
  })
})

describe('action presets — targeted behavior', () => {
  it('plane-takeoff ends ≥10m altitude and moved ≥25m along −Z', () => {
    const marks = byId('plane-takeoff').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeGreaterThanOrEqual(10)
    expect(forwardOf(last)).toBeGreaterThanOrEqual(25)
  })

  it('plane-landing (airborne) ends on the ground with final gait stand', () => {
    const marks = byId('plane-landing').generate(airborneCtx())
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeCloseTo(0, 6)
    expect(last.gait).toBe('stand')
  })

  it('heli-takeoff ends ≥8m altitude', () => {
    const marks = byId('heli-takeoff').generate(groundCtx())
    expect(marks[marks.length - 1]!.position.y).toBeGreaterThanOrEqual(8)
  })

  it('heli-landing from the ground rises first, then lands stopped', () => {
    const marks = byId('heli-landing').generate(groundCtx())
    const peak = Math.max(...marks.map((m) => m.position.y))
    expect(peak).toBeGreaterThan(4)
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeCloseTo(0, 6)
    expect(last.gait).toBe('stand')
  })

  it('heli-hover-hold stays airborne, near start, and always run', () => {
    const marks = byId('heli-hover-hold').generate(airborneCtx())
    for (const m of marks) {
      expect(m.gait).toBe('run')
      const planar = Math.hypot(m.position.x, m.position.z)
      expect(planar).toBeLessThanOrEqual(1.5)
    }
  })

  it('car-screech-stop last mark holds > 0 with gait stand', () => {
    const marks = byId('car-screech-stop').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(last.hold).toBeGreaterThan(0)
    expect(last.gait).toBe('stand')
  })

  it('debris-fall (airborne) bounces (local y min then rise) and ends y≈0', () => {
    const marks = byId('debris-fall').generate(airborneCtx())
    const ys = marks.map((m) => m.position.y)
    // Find a local minimum followed by a rise (the bounce).
    let bounced = false
    for (let i = 1; i < ys.length - 1; i++) {
      if (ys[i]! <= ys[i - 1]! && ys[i + 1]! > ys[i]!) bounced = true
    }
    expect(bounced).toBe(true)
    expect(marks[marks.length - 1]!.position.y).toBeCloseTo(0, 6)
  })

  it('debris-fall (ground) starts at ground and settles at ground', () => {
    const marks = byId('debris-fall').generate(groundCtx())
    expect(marks[0]!.position.y).toBeCloseTo(0, 6)
    expect(marks[marks.length - 1]!.position.y).toBeCloseTo(0, 6)
  })

  it('object-thrown-arc peaks above start.y + 2', () => {
    const marks = byId('object-thrown-arc').generate(groundCtx())
    const peak = Math.max(...marks.map((m) => m.position.y))
    expect(peak).toBeGreaterThan(groundCtx().start.y + 2)
  })

  it('building-topple lands on the ground away from the base', () => {
    const marks = byId('building-topple').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeCloseTo(0, 6)
    expect(Math.hypot(last.position.x, last.position.z)).toBeGreaterThan(2)
    expect(last.gait).toBe('stand')
  })

  it('bird presets stay y ≥ 0.3 everywhere', () => {
    for (const id of ['bird-circle-soar', 'bird-swoop', 'bird-flock-pass']) {
      const marks = byId(id).generate(groundCtx())
      // Skip the pinned first mark (sits exactly at start = ground).
      for (let i = 1; i < marks.length; i++) {
        expect(marks[i]!.position.y).toBeGreaterThanOrEqual(0.3)
      }
    }
  })

  it('plane-flyby clamps altitude up to ≥8m from a low start', () => {
    const marks = byId('plane-flyby').generate(groundCtx())
    // Interior/last marks (not the pinned start) fly at ≥8m.
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]!.position.y).toBeGreaterThanOrEqual(8)
    }
  })

  it('plane-banked-circle returns near its start position', () => {
    const marks = byId('plane-banked-circle').generate(airborneCtx())
    const first = marks[0]!.position
    const last = marks[marks.length - 1]!.position
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeLessThan(4)
  })

  it('walk-up-stairs ends y in [1.2, 1.6] with non-decreasing y until the top hold', () => {
    const marks = byId('walk-up-stairs').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeGreaterThanOrEqual(1.2)
    expect(last.position.y).toBeLessThanOrEqual(1.6)
    expect(last.gait).toBe('stand')
    // y is monotonically non-decreasing over the whole climb-then-hold.
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]!.position.y).toBeGreaterThanOrEqual(marks[i - 1]!.position.y - 1e-9)
    }
  })

  it('run-forward covers ≥30m over 8s at run gait', () => {
    const marks = byId('run-forward').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(forwardOf(last)).toBeGreaterThanOrEqual(30)
    for (const m of marks) expect(m.gait).toBe('run')
  })

  it('walk-forward advances forward at a walk (~1.4 m/s)', () => {
    const marks = byId('walk-forward').generate(groundCtx())
    const last = marks[marks.length - 1]!
    // ~1.4 m/s × 8s ≈ 11.2m.
    expect(forwardOf(last)).toBeGreaterThan(9)
    expect(forwardOf(last)).toBeLessThan(13)
    for (const m of marks) expect(m.gait).toBe('walk')
  })

  it('jump-forward arcs up repeatedly and lands stopped', () => {
    const marks = byId('jump-forward').generate(groundCtx())
    const peak = Math.max(...marks.map((m) => m.position.y))
    expect(peak).toBeGreaterThan(0.3)
    const last = marks[marks.length - 1]!
    expect(last.position.y).toBeCloseTo(0, 6)
    expect(last.gait).toBe('stand')
    expect(forwardOf(last)).toBeGreaterThan(3)
  })

  it('car-jump-ramp has a clear airborne peak (y > 1) then lands at y ≈ 0', () => {
    const marks = byId('car-jump-ramp').generate(groundCtx())
    const peak = Math.max(...marks.map((m) => m.position.y))
    expect(peak).toBeGreaterThan(1)
    expect(marks[marks.length - 1]!.position.y).toBeCloseTo(0, 6)
  })

  it('train-pass-through drives a long straight pass (>80m) all at run gait', () => {
    const marks = byId('train-pass-through').generate(groundCtx())
    const last = marks[marks.length - 1]!
    expect(forwardOf(last)).toBeGreaterThan(80)
    for (const m of marks) expect(m.gait).toBe('run')
  })
})

describe('action presets — person category', () => {
  it("registers the 'person' category and its four presets", () => {
    const cats = new Set(ACTION_PRESETS.map((p) => p.category))
    expect(cats.has('person' as never)).toBe(true)
    for (const id of ['walk-forward', 'run-forward', 'walk-up-stairs', 'jump-forward']) {
      expect(ACTION_PRESETS.some((p) => p.id === id)).toBe(true)
    }
  })

  it('person presets suggest person assets', () => {
    for (const id of ['walk-forward', 'run-forward', 'walk-up-stairs', 'jump-forward']) {
      const p = byId(id)
      expect(p.suggestedAssets).toContain('person.man')
      expect(p.suggestedAssets).toContain('person.woman')
    }
  })
})

describe('action presets — animal category', () => {
  it("registers the 'animal' category", () => {
    const cats = new Set(ACTION_PRESETS.map((p) => p.category))
    expect(cats.has('animal' as never)).toBe(true)
  })

  it("horse-gallop-loop and dog-fetch-run exist with category 'animal'", () => {
    for (const id of ['horse-gallop-loop', 'dog-fetch-run']) {
      const p = byId(id)
      expect(p.category).toBe('animal')
    }
  })

  it('horse-gallop-loop returns near its start (loop-friendly)', () => {
    const marks = byId('horse-gallop-loop').generate(groundCtx())
    const first = marks[0]!.position
    const last = marks[marks.length - 1]!.position
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeLessThan(4)
  })
})
