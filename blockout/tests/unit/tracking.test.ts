/** v2.1: camera aim-lock (trackEntityId) in the evaluator. */

import { describe, expect, it } from 'vitest'
import { ShotEvaluator } from '@engine/evaluate'
import { createProject, createEntity, createActorMark, createCameraMark } from '@engine/schema'
import { headingOf } from '@engine/path'

function fixture() {
  const doc = createProject('T')
  const scene = doc.scenes[0]!
  const shot = scene.shots[0]!
  shot.duration = 4
  shot.camera.rigIntensity = 0 // no noise — assert exact aim
  const runner = createEntity('person.man', 'Runner', { x: -6, y: 0, z: -4 })
  scene.entities.push(runner)
  const m1 = createActorMark({ x: -6, y: 0, z: -4 }, 0, 'run')
  const m2 = createActorMark({ x: 6, y: 0, z: -4 }, 4, 'run')
  m1.easeIn = m1.easeOut = m2.easeIn = m2.easeOut = 0
  scene.blocking[0]!.tracks.push({ entityId: runner.id, marks: [m1, m2] })
  // Static camera position, deliberately aimed the WRONG way by its mark.
  shot.camera.marks.push(createCameraMark({ x: 0, y: 1.6, z: 4 }, 0, Math.PI, 0.5, 35))
  return { scene, shot, runnerId: runner.id }
}

describe('camera aim lock (track subject)', () => {
  it('pan follows the subject across the frame; mark pan is overridden', () => {
    const { scene, shot, runnerId } = fixture()
    shot.camera.trackEntityId = runnerId
    const ev = new ShotEvaluator(scene, shot)

    const at = (t: number) => {
      const st = ev.evaluate(t)
      const cam = st.camera
      const subject = st.entities.find((e) => e.entityId === runnerId)!
      const expectedPan = headingOf({
        x: subject.position.x - cam.position.x,
        y: 0,
        z: subject.position.z - cam.position.z
      })
      return { pan: cam.pan, expectedPan, tilt: cam.tilt }
    }

    const early = at(0.2)
    const late = at(3.8)
    expect(early.pan).toBeCloseTo(early.expectedPan, 4)
    expect(late.pan).toBeCloseTo(late.expectedPan, 4)
    // The subject crossed the frame — the aim must have swung with it.
    expect(Math.abs(late.pan - early.pan)).toBeGreaterThan(0.5)
    // Slightly above the camera's aim point? No — subject chest is below the
    // lens here, so the camera tilts gently down, never the mark's 0.5 up.
    expect(early.tilt).toBeLessThan(0.1)
  })

  it('without tracking, the mark aim is respected', () => {
    const { scene, shot } = fixture()
    const ev = new ShotEvaluator(scene, shot)
    const cam = ev.evaluate(2).camera
    expect(cam.pan).toBeCloseTo(Math.PI, 5)
    expect(cam.tilt).toBeCloseTo(0.5, 5)
  })

  it('tracking follows an airborne subject in tilt too', () => {
    const { scene, shot, runnerId } = fixture()
    shot.camera.trackEntityId = runnerId
    // Lift the runner's second mark into the air (jetpack, why not).
    const track = scene.blocking[0]!.tracks.find((t) => t.entityId === runnerId)!
    track.marks[1]!.position.y = 12
    const ev = new ShotEvaluator(scene, shot)
    const tiltEarly = ev.evaluate(0.2).camera.tilt
    const tiltLate = ev.evaluate(3.9).camera.tilt
    expect(tiltLate).toBeGreaterThan(tiltEarly + 0.3) // looking well up by the end
  })
})
