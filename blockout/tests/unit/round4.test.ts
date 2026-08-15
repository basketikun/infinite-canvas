/** Round-4 features: flying objects (mark altitude) and motion-preset data. */

import { describe, expect, it } from 'vitest'
import { ShotEvaluator } from '@engine/evaluate'
import { createProject, createEntity, createActorMark } from '@engine/schema'
import { MOTION_PRESETS } from '@engine/motions'

describe('flying objects: mark altitude drives the evaluator', () => {
  it('an object with raised marks travels through the air', () => {
    const doc = createProject('F')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    shot.duration = 4
    const plate = createEntity('prop.plate', 'Plate', { x: 0, y: 0, z: 0 })
    scene.entities.push(plate)
    const m1 = createActorMark({ x: 0, y: 0.8, z: 0 }, 0, 'walk')
    const m2 = createActorMark({ x: 4, y: 3, z: -2 }, 4, 'walk')
    m1.easeIn = m1.easeOut = m2.easeIn = m2.easeOut = 0
    scene.blocking[0]!.tracks.push({ entityId: plate.id, marks: [m1, m2] })

    const ev = new ShotEvaluator(scene, shot)
    const start = ev.evaluate(0).entities.find((e) => e.entityId === plate.id)!
    const mid = ev.evaluate(2).entities.find((e) => e.entityId === plate.id)!
    const end = ev.evaluate(4).entities.find((e) => e.entityId === plate.id)!
    expect(start.position.y).toBeCloseTo(0.8, 2)
    expect(end.position.y).toBeCloseTo(3, 2)
    // Mid-flight it is strictly between the two altitudes — really flying.
    expect(mid.position.y).toBeGreaterThan(0.8)
    expect(mid.position.y).toBeLessThan(3.01)
  })
})

describe('motion presets: data invariants the renderer relies on', () => {
  it('every keyframe of a motion carries every joint the motion touches', () => {
    // Missing keys read as 0 in the interpolator, which pops limbs to
    // neutral mid-move — the library must keep keys present throughout.
    for (const p of MOTION_PRESETS) {
      const allJoints = new Set<string>()
      for (const kf of p.keyframes) Object.keys(kf.joints).forEach((j) => allJoints.add(j))
      for (const kf of p.keyframes) {
        for (const j of allJoints) {
          expect(
            Object.prototype.hasOwnProperty.call(kf.joints, j),
            `${p.id} keyframe @${kf.t}s missing joint ${j}`
          ).toBe(true)
        }
      }
    }
  })

  it('keyframes are ordered, start at 0, and end at the stated duration', () => {
    for (const p of MOTION_PRESETS) {
      expect(p.keyframes.length).toBeGreaterThanOrEqual(2)
      expect(p.keyframes[0]!.t).toBe(0)
      for (let i = 1; i < p.keyframes.length; i++) {
        expect(p.keyframes[i]!.t).toBeGreaterThan(p.keyframes[i - 1]!.t)
      }
      expect(p.keyframes[p.keyframes.length - 1]!.t).toBeCloseTo(p.duration, 5)
    }
  })

  it('covers every motion category', () => {
    const cats = new Set(MOTION_PRESETS.map((p) => p.category))
    for (const c of ['fight', 'dance', 'gesture', 'stunt', 'sport', 'everyday'])
      expect(cats.has(c as never)).toBe(true)
  })

  // The renderer's animatePerson (builders.ts) only applies these joint keys as
  // pose overrides; anything else is silently ignored and would never render.
  const LEGAL_JOINTS = new Set([
    'shoulderLX', 'shoulderRX', 'shoulderLZ', 'shoulderRZ',
    'elbowL', 'elbowR',
    'hipLX', 'hipRX', 'hipLZ', 'hipRZ',
    'kneeL', 'kneeR',
    'torsoX', 'torsoY', 'torsoZ',
    'headX', 'headY', 'headZ',
  ])

  it('only references joints the renderer knows how to apply', () => {
    for (const p of MOTION_PRESETS) {
      for (const kf of p.keyframes) {
        for (const j of Object.keys(kf.joints)) {
          expect(LEGAL_JOINTS.has(j), `${p.id} references unknown joint ${j}`).toBe(true)
        }
      }
    }
  })

  it('keeps joint values within a sane range (no rig explosions)', () => {
    for (const p of MOTION_PRESETS) {
      for (const kf of p.keyframes) {
        for (const [j, v] of Object.entries(kf.joints)) {
          expect(Number.isFinite(v), `${p.id} @${kf.t}s ${j} is not finite`).toBe(true)
          expect(Math.abs(v), `${p.id} @${kf.t}s ${j}=${v} out of range`).toBeLessThan(3.2)
        }
      }
    }
  })

  it('unique preset ids', () => {
    const ids = MOTION_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
