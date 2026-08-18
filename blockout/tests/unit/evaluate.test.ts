import { describe, expect, it } from 'vitest'
import { ShotEvaluator } from '@engine/evaluate'
import { createProject, createActorMark, createCameraMark, createEntity } from '@engine/schema'
import type { ProjectDoc, Scene, Shot } from '@engine/types'

/** Build a scene: one man walking (0,0,0) → (0,0,-10) over 0..5s; camera with 2 marks. */
function fixture(): { doc: ProjectDoc; scene: Scene; shot: Shot; entityId: string } {
  const doc = createProject('Test')
  const scene = doc.scenes[0]!
  const shot = scene.shots[0]!
  const entity = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
  scene.entities.push(entity)
  const take = scene.blocking[0]!
  const m1 = createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk')
  const m2 = createActorMark({ x: 0, y: 0, z: -10 }, 5, 'walk')
  m1.easeIn = 0
  m1.easeOut = 0
  m2.easeIn = 0
  m2.easeOut = 0
  take.tracks.push({ entityId: entity.id, marks: [m1, m2] })

  const c1 = createCameraMark({ x: 5, y: 1.6, z: 0 }, 0, 0, 0, 35)
  const c2 = createCameraMark({ x: 5, y: 1.6, z: -10 }, 5, Math.PI / 2, 0.1, 85)
  c1.easeIn = 0
  c1.easeOut = 0
  c2.easeIn = 0
  c2.easeOut = 0
  shot.camera.marks.push(c1, c2)
  shot.camera.seed = 42
  shot.duration = 5
  return { doc, scene, shot, entityId: entity.id }
}

describe('ShotEvaluator', () => {
  it('places the actor at marks at mark times', () => {
    const { scene, shot, entityId } = fixture()
    const ev = new ShotEvaluator(scene, shot)
    const at0 = ev.evaluate(0).entities.find((e) => e.entityId === entityId)!
    const at5 = ev.evaluate(5).entities.find((e) => e.entityId === entityId)!
    expect(at0.position.z).toBeCloseTo(0, 3)
    expect(at5.position.z).toBeCloseTo(-10, 1)
  })

  it('travels linearly with no easing: midpoint at half time', () => {
    const { scene, shot, entityId } = fixture()
    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2.5).entities.find((e) => e.entityId === entityId)!
    expect(mid.position.z).toBeCloseTo(-5, 1)
    expect(mid.speed).toBeCloseTo(2, 1)
    expect(mid.heading).toBeCloseTo(0, 2) // walking -Z
    expect(mid.gait).toBe('walk')
    expect(mid.distanceTravelled).toBeCloseTo(5, 1)
  })

  it('is a pure function of t (identical across evaluators and call order)', () => {
    const { scene, shot } = fixture()
    const a = new ShotEvaluator(scene, shot)
    const b = new ShotEvaluator(scene, shot)
    // Evaluate b out of order first — must not matter.
    b.evaluate(4.9)
    b.evaluate(0.3)
    const sa = a.evaluate(2.2)
    const sb = b.evaluate(2.2)
    expect(sa).toEqual(sb)
  })

  it('interpolates camera lens and orientation between marks', () => {
    const { scene, shot } = fixture()
    const ev = new ShotEvaluator(scene, shot)
    const cam0 = ev.evaluate(0).camera
    const camMid = ev.evaluate(2.5).camera
    const cam5 = ev.evaluate(5).camera
    expect(cam0.focalLength).toBeCloseTo(35, 4)
    expect(cam5.focalLength).toBeCloseTo(85, 4)
    expect(camMid.focalLength).toBeGreaterThan(35)
    expect(camMid.focalLength).toBeLessThan(85)
    expect(cam5.pan).toBeCloseTo(Math.PI / 2, 2)
    // vfov narrows as focal length grows
    expect(cam5.vfov).toBeLessThan(cam0.vfov)
  })

  it('holds at a mark during its hold window', () => {
    const { scene, shot, entityId } = fixture()
    const take = scene.blocking[0]!
    take.tracks[0]!.marks[0]!.hold = 2 // stay at start until t=2
    const ev = new ShotEvaluator(scene, shot)
    const at1 = ev.evaluate(1).entities.find((e) => e.entityId === entityId)!
    expect(at1.position.z).toBeCloseTo(0, 3)
    expect(at1.speed).toBe(0)
  })

  it('applies seeded rig noise deterministically', () => {
    const { scene, shot } = fixture()
    shot.camera.rig = 'handheld'
    shot.camera.rigIntensity = 1
    const a = new ShotEvaluator(scene, shot)
    const b = new ShotEvaluator(scene, shot)
    expect(a.evaluate(1.7).camera).toEqual(b.evaluate(1.7).camera)
    const otherSeed = structuredClone(shot)
    otherSeed.camera.seed = 999
    const c = new ShotEvaluator(scene, otherSeed)
    expect(a.evaluate(1.7).camera.pan).not.toBeCloseTo(c.evaluate(1.7).camera.pan, 8)
  })

  it('static entities stay put', () => {
    const { scene, shot } = fixture()
    const couch = createEntity('furniture.couch', 'Couch', { x: 3, y: 0, z: -2 })
    scene.entities.push(couch)
    const ev = new ShotEvaluator(scene, shot)
    const st = ev.evaluate(2.5).entities.find((e) => e.entityId === couch.id)!
    expect(st.position).toEqual({ x: 3, y: 0, z: -2 })
    expect(st.speed).toBe(0)
  })

  it('warns on implausible speeds', () => {
    const { scene, shot } = fixture()
    // 10m in 5s is a fine walk; make it 1 second — 10 m/s walk is absurd.
    const take = scene.blocking[0]!
    take.tracks[0]!.marks[1]!.time = 1
    shot.duration = 2
    const ev = new ShotEvaluator(scene, shot)
    const warnings = ev.warnings()
    expect(warnings.length).toBe(1)
    expect(warnings[0]!.verdict.kind).toBe('tooFast')
  })

  it('car-mounted camera follows the vehicle', () => {
    const { doc } = fixture()
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const car = createEntity('vehicle.suv', 'SUV', { x: 0, y: 0, z: 0 })
    scene.entities.push(car)
    const take = scene.blocking[0]!
    const m1 = createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk')
    const m2 = createActorMark({ x: 0, y: 0, z: -20 }, 5, 'walk')
    take.tracks.push({ entityId: car.id, marks: [m1, m2] })
    shot.camera.rig = 'carMount'
    shot.camera.mountEntityId = car.id
    shot.camera.marks = [createCameraMark({ x: 0, y: 1.5, z: 2 }, 0, 0, 0, 35)]
    const ev = new ShotEvaluator(scene, shot)
    const cam0 = ev.evaluate(0).camera
    const cam5 = ev.evaluate(5).camera
    // Camera stays ~2m behind the car as it travels -Z.
    expect(cam5.position.z).toBeLessThan(cam0.position.z - 15)
  })

  it('paths() exposes polylines for camera and actors', () => {
    const { scene, shot } = fixture()
    const ev = new ShotEvaluator(scene, shot)
    const paths = ev.paths()
    expect(paths.some((p) => p.entityId === 'camera')).toBe(true)
    expect(paths.filter((p) => p.entityId !== 'camera').length).toBeGreaterThan(0)
  })
})
