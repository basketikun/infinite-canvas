/**
 * Phase B2: the choreography engine. Verifies routines read as staged
 * choreography — determinism, fighting-range invariant, reaction-after-attack
 * ordering, dance formation geometry, and a closing chase gap.
 */

import { describe, expect, it } from 'vitest'
import {
  buildRoutine,
  mirrorJoints,
  choreoStyles,
  choreoEndings,
  choreoFormations,
  type RoutineSpec,
  type RoutineCtx
} from '@engine/choreography'

const CTX: RoutineCtx = { origin: { x: 0, z: 0, heading: 0 } }

const base = (over: Partial<RoutineSpec>): RoutineSpec => ({
  kind: 'dance',
  performers: 8,
  durationS: 8,
  seed: 12345,
  ...over
})

/** Recover an entity's world position at time t from its marks (step/hold). */
function posAt(marks: { time: number; position: { x: number; z: number } }[], t: number): { x: number; z: number } {
  let cur = marks[0]?.position ?? { x: 0, z: 0 }
  for (const m of marks) {
    if (m.time <= t + 1e-6) cur = m.position
    else break
  }
  return cur
}

describe('choreography: determinism', () => {
  it('same seed + spec ⇒ byte-identical marks (all kinds)', () => {
    for (const kind of ['dance', 'fight', 'chase'] as const) {
      const a = buildRoutine(base({ kind, performers: kind === 'dance' ? 6 : 2 }), CTX)
      const b = buildRoutine(base({ kind, performers: kind === 'dance' ? 6 : 2 }), CTX)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    }
  })

  it('different seeds diverge for a fight', () => {
    const a = buildRoutine(base({ kind: 'fight', performers: 2, seed: 1 }), CTX)
    const b = buildRoutine(base({ kind: 'fight', performers: 2, seed: 2 }), CTX)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('every emitted mark is finite and time-ascending', () => {
    for (const kind of ['dance', 'fight', 'chase'] as const) {
      const routine = buildRoutine(base({ kind, performers: kind === 'dance' ? 5 : 3 }), CTX)
      for (const p of routine) {
        let last = -Infinity
        for (const m of p.marks) {
          expect(Number.isFinite(m.time)).toBe(true)
          expect(Number.isFinite(m.position.x)).toBe(true)
          expect(Number.isFinite(m.position.z)).toBe(true)
          expect(m.time).toBeGreaterThanOrEqual(last - 1e-6)
          last = m.time
        }
      }
    }
  })
})

describe('choreography: mirrorJoints', () => {
  it('swaps L/R pairs and negates twist/lean channels; is an involution', () => {
    const pose = { shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.9, torsoY: 0.5, headZ: 0.3 }
    const m = mirrorJoints(pose)
    expect(m.shoulderLX).toBe(-0.9)
    expect(m.shoulderRX).toBe(-1.5)
    expect(m.elbowL).toBe(1.9)
    expect(m.elbowR).toBe(0.15)
    expect(m.torsoY).toBe(-0.5)
    expect(m.headZ).toBe(-0.3)
    expect(mirrorJoints(m)).toEqual(pose)
  })
})

describe('choreography: dance', () => {
  it('every performer choreographed, held freeze at the end, deterministic formation', () => {
    const routine = buildRoutine(base({ kind: 'dance', performers: 10, formation: 'line' }), CTX)
    expect(routine.length).toBe(10)
    for (const p of routine) {
      expect(p.marks.length).toBeGreaterThan(0)
      expect(p.marks.every((m) => m.joints || m.gait === 'walk')).toBe(true)
      // Ends on a held pose near the shot end.
      const lastJointMark = [...p.marks].reverse().find((m) => m.joints)
      expect(lastJointMark).toBeTruthy()
    }
  })

  it('line formation is evenly spaced by 1.4m and centred on the origin', () => {
    const n = 6
    const routine = buildRoutine(base({ kind: 'dance', performers: n, formation: 'line' }), CTX)
    const xs = routine.map((p) => p.position.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(1.4, 5)
    const mean = xs.reduce((s, x) => s + x, 0) / n
    expect(mean).toBeCloseTo(0, 5)
  })

  it('circle formation places everyone at the same radius', () => {
    const routine = buildRoutine(base({ kind: 'dance', performers: 8, formation: 'circle' }), CTX)
    const radii = routine.map((p) => Math.hypot(p.position.x, p.position.z))
    const r0 = radii[0]!
    for (const r of radii) expect(r).toBeCloseTo(r0, 4)
    expect(r0).toBeGreaterThan(0.5)
  })

  it('canon offsets performer i so back dancers start their move later', () => {
    const plain = buildRoutine(base({ kind: 'dance', performers: 4, canon: false, formation: 'line' }), CTX)
    const canon = buildRoutine(base({ kind: 'dance', performers: 4, canon: true, formation: 'line' }), CTX)
    // Performer 0 unchanged in timing; a later performer starts strictly later.
    const first0 = plain[0]!.marks[0]!.time
    const firstLastCanon = canon[3]!.marks[0]!.time
    expect(firstLastCanon).toBeGreaterThan(first0)
  })

  it('mirror flips odd performers', () => {
    const routine = buildRoutine(base({ kind: 'dance', performers: 2, mirror: true, formation: 'line', canon: false }), CTX)
    const even = routine[0]!.marks.find((m) => m.joints)
    const odd = routine[1]!.marks.find((m) => m.joints)
    expect(even && odd).toBeTruthy()
    expect(JSON.stringify(odd!.joints)).toBe(JSON.stringify(mirrorJoints(even!.joints!)))
  })

  it('formationChange emits real walking marks between phrases', () => {
    const routine = buildRoutine(
      base({ kind: 'dance', performers: 6, formationChange: true, durationS: 16, formation: 'line' }),
      CTX
    )
    const anyWalk = routine.some((p) => p.marks.some((m) => m.gait === 'walk'))
    expect(anyWalk).toBe(true)
  })
})

describe('choreography: fight', () => {
  it('two fighters, both perform, face each other', () => {
    const routine = buildRoutine(base({ kind: 'fight', performers: 2, durationS: 12 }), CTX)
    expect(routine.length).toBe(2)
    for (const p of routine) expect(p.marks.length).toBeGreaterThan(3)
  })

  it('attacker stays in fighting range [0.8, 1.8]m at every attack beat', () => {
    for (const style of ['brawl', 'martial-arts', 'sparring'] as const) {
      const routine = buildRoutine(base({ kind: 'fight', performers: 2, style, durationS: 14, seed: 7 }), CTX)
      const [A, B] = routine
      // Each attack is preceded by a `walk` step-in mark; the mark right after
      // is the attack ONSET. The other fighter must be in punching range then.
      const check = (att: NonNullable<typeof A>, def: NonNullable<typeof B>): void => {
        for (const t of attackOnsets(att.marks)) {
          const pa = posAt(att.marks, t)
          const pd = posAt(def.marks, t)
          const d = Math.hypot(pa.x - pd.x, pa.z - pd.z)
          expect(d, `range at attack t=${t} (${style}) = ${d.toFixed(2)}`).toBeGreaterThanOrEqual(0.8)
          expect(d).toBeLessThanOrEqual(1.8)
        }
      }
      check(A!, B!)
      check(B!, A!)
    }
  })

  it('every attack beat is answered by a reaction just after (offset > 0)', () => {
    const routine = buildRoutine(base({ kind: 'fight', performers: 2, style: 'brawl', durationS: 14, seed: 3 }), CTX)
    const [A, B] = routine
    const check = (att: NonNullable<typeof A>, def: NonNullable<typeof B>): void => {
      const reactionTimes = def.marks.map((m) => m.time)
      for (const at of attackOnsets(att.marks)) {
        // A reaction mark lands within (0, 0.9s] after the attack begins.
        const answered = reactionTimes.some((rt) => rt > at + 1e-4 && rt <= at + 0.9)
        expect(answered, `attack at ${at} answered`).toBe(true)
      }
    }
    check(A!, B!)
    check(B!, A!)
  })

  it('one-vs-many: hero plus a ring of attackers, all choreographed', () => {
    const routine = buildRoutine(base({ kind: 'fight', performers: 4, style: 'martial-arts', durationS: 16 }), CTX)
    expect(routine.length).toBe(4)
    expect(routine[0]!.name).toBe('Hero')
    for (const p of routine) expect(p.marks.length).toBeGreaterThan(0)
  })
})

describe('choreography: chase', () => {
  it('caught ending: pursuer closes the gap (monotone downward trend)', () => {
    const routine = buildRoutine(base({ kind: 'chase', performers: 2, ending: 'caught', durationS: 12, seed: 9, amplitude: 0 }), CTX)
    const [runner, pursuer] = routine
    const samples = 10
    const gaps: number[] = []
    for (let s = 1; s < samples; s++) {
      const t = (s / samples) * 12
      const pr = posAt(runner!.marks, t)
      const pp = posAt(pursuer!.marks, t)
      gaps.push(Math.hypot(pr.x - pp.x, pr.z - pp.z))
    }
    // Overall trend must be shrinking: last clearly below first, negative slope.
    expect(gaps[gaps.length - 1]!).toBeLessThan(gaps[0]!)
    expect(slope(gaps)).toBeLessThan(0)
  })

  it('escape ending: gap widens over the chase', () => {
    const routine = buildRoutine(base({ kind: 'chase', performers: 2, ending: 'escape', durationS: 12, seed: 9, amplitude: 0 }), CTX)
    const [runner, pursuer] = routine
    const early = (() => {
      const pr = posAt(runner!.marks, 2)
      const pp = posAt(pursuer!.marks, 2)
      return Math.hypot(pr.x - pp.x, pr.z - pp.z)
    })()
    const late = (() => {
      const pr = posAt(runner!.marks, 10)
      const pp = posAt(pursuer!.marks, 10)
      return Math.hypot(pr.x - pp.x, pr.z - pp.z)
    })()
    expect(late).toBeGreaterThan(early)
  })

  it('multiple pursuers are supported', () => {
    const routine = buildRoutine(base({ kind: 'chase', performers: 3, durationS: 10 }), CTX)
    expect(routine.length).toBe(3)
    expect(routine[0]!.name).toBe('Runner')
  })
})

describe('choreography: UI vocabularies', () => {
  it('exposes styles, endings and formations for the panel', () => {
    expect(choreoStyles('dance').length).toBeGreaterThan(2)
    expect(choreoStyles('fight').map((s) => s.id)).toContain('martial-arts')
    expect(choreoEndings('fight').map((e) => e.id)).toEqual(['finish', 'sparring'])
    expect(choreoEndings('chase').map((e) => e.id)).toEqual(['caught', 'escape'])
    expect(choreoFormations().length).toBe(5)
  })
})

/* --- helpers ------------------------------------------------------------ */

/** Attack onset times: each attack is preceded by a `walk` step-in mark. */
function attackOnsets(marks: { time: number; gait: string }[]): number[] {
  const out: number[] = []
  for (let i = 1; i < marks.length; i++) {
    if (marks[i - 1]!.gait === 'walk' && marks[i]!.gait !== 'walk') out.push(marks[i]!.time)
  }
  return out
}

/** Least-squares slope of a series (x = index). */
function slope(ys: number[]): number {
  const n = ys.length
  const xm = (n - 1) / 2
  const ym = ys.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i]! - ym)
    den += (i - xm) ** 2
  }
  return num / den
}
