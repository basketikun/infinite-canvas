/** Regression tests for the adversarial-audit findings. */

import { describe, expect, it } from 'vitest'
import { verticalFov, SENSORS } from '@engine/camera'
import { sanitizeName, uniqueName } from '@engine/strings'
import { generatePrompt } from '@engine/prompt'
import { getProfile } from '@engine/profiles'
import { ShotEvaluator } from '@engine/evaluate'
import { createProject, createEntity, createActorMark, createCameraMark } from '@engine/schema'

describe('audit fix: 9:16 optics cannot exceed the physical gate (finding 4)', () => {
  it('vertical crop is bounded by gate height', () => {
    const vfov916 = verticalFov('super35', 35, '9:16')
    const maxPhysical = 2 * Math.atan(SENSORS.super35.height / (2 * 35))
    expect(vfov916).toBeLessThanOrEqual(maxPhysical + 1e-9)
  })

  it('16:9 on Super 35 is unchanged (crop < gate height)', () => {
    const expected = 2 * Math.atan(SENSORS.super35.width / (16 / 9) / (2 * 35))
    expect(verticalFov('super35', 35, '16:9')).toBeCloseTo(expected, 9)
  })
})

describe('v5 prompt: simple motion-reference directive, no choreography dump', () => {
  function fixture() {
    const doc = createProject('P')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    man.label = { text: 'HERO', color: '#e5484d' }
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [
        createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk'),
        createActorMark({ x: 0, y: 0, z: -6 }, 4, 'run')
      ]
    })
    shot.camera.marks.push(
      createCameraMark({ x: 0, y: 1.6, z: 5 }, 0, 0, 0, 35),
      createCameraMark({ x: 2, y: 1.6, z: 2 }, 4, 0.6, 0, 50)
    )
    return { scene, shot }
  }

  it('video-reference profiles get the plain motion-reference instruction', () => {
    const { scene, shot } = fixture()
    const prompt = generatePrompt(scene, shot, getProfile('seedance-2'))
    expect(prompt).toContain('strictly as a motion reference')
    expect(prompt).toContain('character blocking and movement')
    expect(prompt).toContain('camera blocking, movement, and tracking')
    expect(prompt).toContain('HERO')
    expect(prompt).toContain('35mm')
  })

  it('never narrates marks, timings, or per-leg camera moves', () => {
    const { scene, shot } = fixture()
    const prompt = generatePrompt(scene, shot, getProfile('seedance-2'))
    for (const banned of ['mark 1', 'mark 2', 'arriving at', 'pans left', 'pans right', 'pushes in', '0s to', 'total 5']) {
      expect(prompt, `prompt must not contain "${banned}"`).not.toContain(banned)
    }
    // Short enough to paste and extend — a few sentences, not an essay.
    expect(prompt.length).toBeLessThan(600)
  })
})

describe('audit fix: unicode-safe names, never empty, unique (finding 8)', () => {
  it('keeps unicode letters', () => {
    expect(sanitizeName('追跡')).toBe('追跡')
    expect(sanitizeName('Scène 1')).toBe('Scène-1')
  })

  it('never returns empty and is deterministic', () => {
    const a = sanitizeName('!!!')
    expect(a.length).toBeGreaterThan(0)
    expect(sanitizeName('!!!')).toBe(a)
    expect(sanitizeName('???')).not.toBe(sanitizeName('!!!!'))
  })

  it('uniqueName suffixes collisions', () => {
    const used = new Set<string>()
    expect(uniqueName('Thug', used)).toBe('Thug')
    expect(uniqueName('Thug', used)).toBe('Thug-2')
    expect(uniqueName('Thug', used)).toBe('Thug-3')
  })
})

describe('audit fix: hold overlapping the next mark no longer teleports (finding 15)', () => {
  it('truncates the hold to leave a real travel window', () => {
    const doc = createProject('H')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    scene.entities.push(man)
    const m1 = createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk')
    m1.hold = 10 // extends past the next mark's arrival at t=3
    const m2 = createActorMark({ x: 0, y: 0, z: -6 }, 3, 'walk')
    scene.blocking[0]!.tracks.push({ entityId: man.id, marks: [m1, m2] })
    shot.duration = 5
    const ev = new ShotEvaluator(scene, shot)
    // Just before arrival the actor must be travelling, not snapping.
    const nearArrival = ev.evaluate(2.99).entities.find((e) => e.entityId === man.id)!
    expect(nearArrival.position.z).toBeLessThan(-4)
    const atArrival = ev.evaluate(3.0).entities.find((e) => e.entityId === man.id)!
    expect(atArrival.position.z).toBeCloseTo(-6, 1)
  })
})

describe('pose per mark: joints interpolate between marks', () => {
  it('holds pose at a mark and blends across a leg', () => {
    const doc = createProject('J')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    scene.entities.push(man)
    const m1 = createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk')
    m1.joints = { shoulderLX: -1.0 }
    m1.easeIn = 0
    m1.easeOut = 0
    const m2 = createActorMark({ x: 0, y: 0, z: -4 }, 4, 'walk')
    m2.joints = { shoulderLX: 0, elbowR: 1.0 }
    m2.easeIn = 0
    m2.easeOut = 0
    scene.blocking[0]!.tracks.push({ entityId: man.id, marks: [m1, m2] })
    shot.duration = 5
    const ev = new ShotEvaluator(scene, shot)

    const at0 = ev.evaluate(0).entities.find((e) => e.entityId === man.id)!
    expect(at0.joints?.shoulderLX).toBeCloseTo(-1.0, 5)

    const mid = ev.evaluate(2).entities.find((e) => e.entityId === man.id)!
    expect(mid.joints?.shoulderLX).toBeCloseTo(-0.5, 1)
    expect(mid.joints?.elbowR).toBeCloseTo(0.5, 1)

    const at4 = ev.evaluate(4.5).entities.find((e) => e.entityId === man.id)!
    expect(at4.joints?.shoulderLX).toBeCloseTo(0, 5)
    expect(at4.joints?.elbowR).toBeCloseTo(1.0, 5)
  })

  it('unposed actors carry no joints allocation', () => {
    const doc = createProject('NJ')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [createActorMark({ x: 0, y: 0, z: 0 }, 0), createActorMark({ x: 0, y: 0, z: -4 }, 4)]
    })
    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2).entities.find((e) => e.entityId === man.id)!
    expect(mid.joints).toBeUndefined()
  })
})
