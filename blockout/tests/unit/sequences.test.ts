/** v2.2: the crowd/sequence director. */

import { describe, expect, it } from 'vitest'
import { generateSequence, sequenceStyles, type SequenceOptions } from '@engine/sequences'

const base = (over: Partial<SequenceOptions>): SequenceOptions => ({
  type: 'dance',
  count: 12,
  style: 'mixed',
  origin: { x: 0, z: 0, heading: 0 },
  duration: 8,
  ...over
})

describe('sequence director', () => {
  it('dance: N dancers, all choreographed with joint marks, deterministic', () => {
    const a = generateSequence(base({ count: 20 }))
    const b = generateSequence(base({ count: 20 }))
    expect(a.length).toBe(20)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)) // same options → same crowd
    for (const d of a) {
      expect(d.marks.length).toBeGreaterThan(0)
      expect(d.marks.length).toBeLessThanOrEqual(40)
      expect(d.marks.every((m) => m.joints && Object.keys(m.joints).length > 0)).toBe(true)
      expect(d.marks.every((m) => m.gait === 'stand')).toBe(true)
    }
    // Formation spreads out — no two dancers on the same spot.
    const seen = new Set(a.map((d) => `${d.position.x.toFixed(2)}|${d.position.z.toFixed(2)}`))
    expect(seen.size).toBe(20)
  })

  it('dance: a specific style gives every dancer the same first pose', () => {
    const styles = sequenceStyles('dance').filter((s) => s.id !== 'mixed')
    expect(styles.length).toBeGreaterThanOrEqual(3)
    const crowd = generateSequence(base({ count: 6, style: styles[0]!.id }))
    const firstJoints = JSON.stringify(crowd[0]!.marks[0]!.joints)
    for (const d of crowd) expect(JSON.stringify(d.marks[0]!.joints)).toBe(firstJoints)
  })

  it('fight paired: pairs face each other and both perform', () => {
    const crowd = generateSequence(base({ type: 'fight', count: 8, style: 'paired' }))
    expect(crowd.length).toBe(8)
    for (let p = 0; p < 4; p++) {
      const a = crowd[p * 2]!
      const bF = crowd[p * 2 + 1]!
      // Facing roughly opposite directions.
      const diff = Math.abs(
        Math.atan2(Math.sin(a.rotationY - bF.rotationY), Math.cos(a.rotationY - bF.rotationY))
      )
      expect(diff).toBeGreaterThan(Math.PI * 0.9)
      expect(a.marks.length).toBeGreaterThan(0)
      expect(bF.marks.length).toBeGreaterThan(0)
      // Close enough to trade blows.
      const dist = Math.hypot(a.position.x - bF.position.x, a.position.z - bF.position.z)
      expect(dist).toBeLessThan(2.5)
    }
  })

  it('fight mob: one labelled hero, attackers ring around', () => {
    const crowd = generateSequence(base({ type: 'fight', count: 9, style: 'mob' }))
    expect(crowd.length).toBe(9)
    expect(crowd[0]!.label?.text).toBe('HERO')
    for (const attacker of crowd.slice(1)) {
      const dist = Math.hypot(
        attacker.position.x - crowd[0]!.position.x,
        attacker.position.z - crowd[0]!.position.z
      )
      expect(dist).toBeGreaterThan(1.0)
      expect(dist).toBeLessThan(5)
    }
  })

  it('foot chase: labelled runner leads, everyone sprints the full shot', () => {
    const crowd = generateSequence(base({ type: 'footChase', count: 5, style: 'straight' }))
    expect(crowd[0]!.label?.text).toBe('RUNNER')
    for (const r of crowd) {
      expect(r.marks[0]!.time).toBe(0)
      expect(r.marks[r.marks.length - 1]!.time).toBeCloseTo(8, 5)
      expect(r.marks.some((m) => m.gait === 'run')).toBe(true)
      // Travels forward (heading 0 → -Z).
      expect(r.marks[r.marks.length - 1]!.position.z).toBeLessThan(r.marks[0]!.position.z - 10)
    }
    // Pursuers start behind the runner.
    expect(crowd[1]!.position.z).toBeGreaterThan(crowd[0]!.position.z)
  })

  it('car chase: cars from the vehicle catalog, staggered convoy', () => {
    const crowd = generateSequence(base({ type: 'carChase', count: 4, style: 'weaving' }))
    expect(crowd.every((c) => c.assetId.startsWith('vehicle.'))).toBe(true)
    expect(crowd[0]!.label?.text).toBe('LEAD')
    for (let i = 1; i < crowd.length; i++) {
      expect(crowd[i]!.position.z).toBeGreaterThan(crowd[i - 1]!.position.z)
    }
    // Weaving: some lateral movement mid-chase.
    const lead = crowd[1]!
    const xs = lead.marks.map((m) => m.position.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.5)
  })

  it('count clamps to 2..60 and origin/heading relocate the whole stage', () => {
    expect(generateSequence(base({ count: 1 })).length).toBe(2)
    expect(generateSequence(base({ count: 200 })).length).toBe(60)
    const moved = generateSequence(
      base({ count: 4, origin: { x: 50, z: -30, heading: Math.PI / 2 } })
    )
    for (const d of moved) {
      expect(Math.hypot(d.position.x - 50, d.position.z + 30)).toBeLessThan(15)
      expect(d.rotationY).toBeCloseTo(Math.PI / 2, 5)
    }
  })
})
