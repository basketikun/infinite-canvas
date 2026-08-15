import { describe, expect, it } from 'vitest'
import {
  CAMERA_MOVE_PRESETS,
  type CameraMoveContext,
  type CameraMarkSpec,
  type SubjectSample
} from '@engine/camera-moves'

// Moving-subject fixture: subject walks along −Z at 2 m/s, facing forward.
function makeCtx(): CameraMoveContext {
  return {
    subjectAt(t: number): SubjectSample {
      return { x: 0, y: 0, z: -2 * t, heading: 0 }
    },
    subjectHeight: 1.75,
    camera: { x: 0, y: 1.6, z: 6, pan: 0, tilt: 0, focalLength: 35 },
    duration: 8
  }
}

const DUR = 8

function finite(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n)
}

describe('camera-move presets — universal contract', () => {
  for (const preset of CAMERA_MOVE_PRESETS) {
    describe(preset.id, () => {
      const marks = preset.generate(makeCtx())

      it('returns ≥5 marks', () => {
        expect(marks.length).toBeGreaterThanOrEqual(5)
      })

      it('first mark at time 0, last at duration', () => {
        expect(marks[0]!.time).toBeCloseTo(0, 6)
        expect(marks[marks.length - 1]!.time).toBeCloseTo(DUR, 6)
      })

      it('times strictly increasing', () => {
        for (let i = 1; i < marks.length; i++) {
          expect(marks[i]!.time).toBeGreaterThan(marks[i - 1]!.time)
        }
      })

      it('all position components finite', () => {
        for (const m of marks) {
          expect(finite(m.position.x)).toBe(true)
          expect(finite(m.position.y)).toBe(true)
          expect(finite(m.position.z)).toBe(true)
          expect(finite(m.pan)).toBe(true)
          expect(finite(m.tilt)).toBe(true)
          expect(finite(m.roll)).toBe(true)
        }
      })

      it('focalLength within 8–300', () => {
        for (const m of marks) {
          expect(m.focalLength).toBeGreaterThanOrEqual(8)
          expect(m.focalLength).toBeLessThanOrEqual(300)
        }
      })

      it('edge marks eased, interior not', () => {
        const last = marks.length - 1
        expect(marks[0]!.easeIn).toBeCloseTo(0.25, 6)
        expect(marks[last]!.easeOut).toBeCloseTo(0.25, 6)
        for (let i = 1; i < last; i++) {
          expect(marks[i]!.easeIn).toBe(0)
          expect(marks[i]!.easeOut).toBe(0)
        }
      })

      it('hold is 0 on every mark', () => {
        for (const m of marks) expect(m.hold).toBe(0)
      })
    })
  }
})

function byId(id: string): CameraMarkSpec[] {
  const preset = CAMERA_MOVE_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`missing preset ${id}`)
  return preset.generate(makeCtx())
}

// Azimuth of the camera relative to the subject at a given mark's time.
function azimuthAt(m: CameraMarkSpec, ctx: CameraMoveContext): number {
  const s = ctx.subjectAt(m.time)
  return Math.atan2(-(m.position.x - s.x), -(m.position.z - s.z))
}

describe('camera-move presets — targeted behavior', () => {
  it('has at least 22 presets', () => {
    expect(CAMERA_MOVE_PRESETS.length).toBeGreaterThanOrEqual(22)
  })

  it('has 39 presets', () => {
    expect(CAMERA_MOVE_PRESETS.length).toBe(39)
  })

  it('all preset ids are unique', () => {
    const ids = CAMERA_MOVE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('orbit-360 returns near its start azimuth relative to the subject', () => {
    const ctx = makeCtx()
    const marks = byId('orbit-360')
    const startAz = azimuthAt(marks[0]!, ctx)
    const endAz = azimuthAt(marks[marks.length - 1]!, ctx)
    // Wrap the difference into (−π, π]; full circle should return ~0.
    let diff = endAz - startAz
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    expect(Math.abs(diff)).toBeLessThan(0.15)
  })

  it('follow-behind stays ~4m from the subject and moves with it', () => {
    const ctx = makeCtx()
    const marks = byId('follow-behind')
    for (const m of marks) {
      const s = ctx.subjectAt(m.time)
      const planar = Math.hypot(m.position.x - s.x, m.position.z - s.z)
      // ~4m with 25% slack.
      expect(planar).toBeGreaterThan(4 * 0.75)
      expect(planar).toBeLessThan(4 * 1.25)
    }
    // Rides the subject downstream: last mark further along −Z than first.
    expect(marks[marks.length - 1]!.position.z).toBeLessThan(marks[0]!.position.z)
  })

  it('vertigo-dolly-zoom focalLength strictly decreases and ends < 0.75× initial', () => {
    const marks = byId('vertigo-dolly-zoom')
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]!.focalLength).toBeLessThan(marks[i - 1]!.focalLength)
    }
    expect(marks[marks.length - 1]!.focalLength).toBeLessThan(marks[0]!.focalLength * 0.75)
  })

  it('flyover crosses the subject (sign of camZ − subjZ flips)', () => {
    const ctx = makeCtx()
    const marks = byId('flyover')
    const signs = marks.map((m) => {
      const s = ctx.subjectAt(m.time)
      return Math.sign(m.position.z - s.z)
    })
    const hasPos = signs.some((s) => s > 0)
    const hasNeg = signs.some((s) => s < 0)
    expect(hasPos && hasNeg).toBe(true)
  })

  it('whip-pan has a ≥1.2 rad pan change within ≤1s of shot time', () => {
    const marks = byId('whip-pan')
    let found = false
    for (let i = 1; i < marks.length; i++) {
      const dt = marks[i]!.time - marks[i - 1]!.time
      const dpan = Math.abs(marks[i]!.pan - marks[i - 1]!.pan)
      if (dpan >= 1.2 && dt <= 1) found = true
    }
    expect(found).toBe(true)
  })

  it('crash-zoom-out focalLength ends wider than it starts', () => {
    const marks = byId('crash-zoom-out')
    expect(marks[marks.length - 1]!.focalLength).toBeLessThan(marks[0]!.focalLength)
    // Never increases across the shot.
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]!.focalLength).toBeLessThanOrEqual(marks[i - 1]!.focalLength)
    }
  })

  it('spiral-in-descend tightens and drops toward the subject', () => {
    const ctx = makeCtx()
    const marks = byId('spiral-in-descend')
    const first = marks[0]!
    const last = marks[marks.length - 1]!
    const sFirst = ctx.subjectAt(first.time)
    const sLast = ctx.subjectAt(last.time)
    const planarFirst = Math.hypot(first.position.x - sFirst.x, first.position.z - sFirst.z)
    const planarLast = Math.hypot(last.position.x - sLast.x, last.position.z - sLast.z)
    expect(planarLast).toBeLessThan(planarFirst)
    expect(last.position.y).toBeLessThan(first.position.y)
  })

  it('top-down-descend tilt ≈ −π/2', () => {
    const marks = byId('top-down-descend')
    for (const m of marks) {
      expect(m.tilt).toBeCloseTo(-Math.PI / 2, 2)
    }
  })

  it('every declared category is represented', () => {
    const cats = new Set(CAMERA_MOVE_PRESETS.map((p) => p.category))
    for (const c of [
      'push & pull',
      'orbit & arc',
      'crane & boom',
      'aerial',
      'follow',
      'pan & scan',
      'stylized'
    ]) {
      expect(cats.has(c as never)).toBe(true)
    }
  })
})
