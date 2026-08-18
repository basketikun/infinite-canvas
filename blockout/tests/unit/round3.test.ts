/** Round-3 features: marriage (attached entities) resolution in the evaluator. */

import { describe, expect, it } from 'vitest'
import { ShotEvaluator } from '@engine/evaluate'
import { createProject, createEntity, createActorMark, createCameraMark } from '@engine/schema'
import type { Scene, Shot } from '@engine/types'

function movingVehicleFixture(): { scene: Scene; shot: Shot; carId: string } {
  const doc = createProject('M')
  const scene = doc.scenes[0]!
  const shot = scene.shots[0]!
  shot.duration = 4
  const car = createEntity('vehicle.suv', 'SUV', { x: 0, y: 0, z: 0 })
  scene.entities.push(car)
  const m1 = createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk')
  const m2 = createActorMark({ x: 0, y: 0, z: -8 }, 4, 'walk')
  m1.easeIn = m1.easeOut = m2.easeIn = m2.easeOut = 0
  scene.blocking[0]!.tracks.push({ entityId: car.id, marks: [m1, m2] })
  return { scene, shot, carId: car.id }
}

describe('marriage: attached entities ride their parent', () => {
  it('a rider follows a moving vehicle at its local offset', () => {
    const { scene, shot, carId } = movingVehicleFixture()
    const rider = createEntity('person.man', 'Rider', { x: 0.5, y: 0.8, z: 0 })
    rider.attachedTo = carId
    rider.attachedLocal = { x: 0.5, y: 0.8, z: 0, rotY: 0 }
    scene.entities.push(rider)

    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2)
    const car = mid.entities.find((e) => e.entityId === carId)!
    const r = mid.entities.find((e) => e.entityId === rider.id)!
    // Car travels -Z (heading 0): local +x offset stays +x in world.
    expect(r.position.z).toBeCloseTo(car.position.z, 3)
    expect(r.position.x).toBeCloseTo(car.position.x + 0.5, 3)
    expect(r.position.y).toBeCloseTo(0.8, 3)
    expect(r.heading).toBeCloseTo(car.heading, 5)
    // Riding: animation params follow the parent (no walking in place).
    expect(r.speed).toBeCloseTo(car.speed, 3)
  })

  it('local offsets rotate with the parent heading', () => {
    const doc = createProject('R')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const car = createEntity('vehicle.suv', 'SUV', { x: 0, y: 0, z: 0 })
    car.transform.rotationY = Math.PI / 2 // facing -X
    scene.entities.push(car)
    const rider = createEntity('person.man', 'Rider', { x: 0, y: 0, z: 0 })
    rider.attachedTo = car.id
    // 1m to the parent's local right (+x) — with heading π/2 that lands
    // at world (cos, -sin) = (0, -1) per the Y-rotation convention.
    rider.attachedLocal = { x: 1, y: 0, z: 0, rotY: 0 }
    scene.entities.push(rider)

    const ev = new ShotEvaluator(scene, shot)
    const st = ev.evaluate(0)
    const r = st.entities.find((e) => e.entityId === rider.id)!
    expect(r.position.x).toBeCloseTo(0, 4)
    expect(r.position.z).toBeCloseTo(-1, 4)
    expect(r.heading).toBeCloseTo(Math.PI / 2, 5)
  })

  it('chains settle: rider on cart married to a truck', () => {
    const { scene, shot, carId } = movingVehicleFixture()
    const cart = createEntity('prim.cube', 'Cart', { x: 0, y: 0, z: 1 })
    cart.attachedTo = carId
    cart.attachedLocal = { x: 0, y: 0, z: 1, rotY: 0 }
    scene.entities.push(cart)
    const rider = createEntity('person.man', 'Rider', { x: 0, y: 1, z: 1 })
    rider.attachedTo = cart.id
    rider.attachedLocal = { x: 0, y: 1, z: 0, rotY: 0 }
    scene.entities.push(rider)

    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2)
    const car = mid.entities.find((e) => e.entityId === carId)!
    const r = mid.entities.find((e) => e.entityId === rider.id)!
    expect(r.position.z).toBeCloseTo(car.position.z + 1, 2)
    expect(r.position.y).toBeCloseTo(1, 3)
  })

  it('an attached entity with its own marks ignores the marriage', () => {
    const { scene, shot, carId } = movingVehicleFixture()
    const walker = createEntity('person.man', 'Walker', { x: 5, y: 0, z: 5 })
    walker.attachedTo = carId
    walker.attachedLocal = { x: 0, y: 0, z: 0, rotY: 0 }
    scene.entities.push(walker)
    const w1 = createActorMark({ x: 5, y: 0, z: 5 }, 0, 'walk')
    const w2 = createActorMark({ x: 5, y: 0, z: 1 }, 4, 'walk')
    scene.blocking[0]!.tracks.push({ entityId: walker.id, marks: [w1, w2] })

    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2)
    const w = mid.entities.find((e) => e.entityId === walker.id)!
    // Follows its own track (x stays 5), not the car (which is at x 0).
    expect(w.position.x).toBeCloseTo(5, 2)
  })
})

describe('boarding & alighting (round 4)', () => {
  it('boarding: actor walks to the bus, then rides it', () => {
    const doc = createProject('B')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    shot.duration = 10
    const bus = createEntity('vehicle.bus', 'Bus', { x: 5, y: 0, z: 0 })
    scene.entities.push(bus)
    const b1 = createActorMark({ x: 5, y: 0, z: 0 }, 0, 'walk')
    b1.hold = 4
    const b2 = createActorMark({ x: 5, y: 0, z: -20 }, 10, 'walk')
    scene.blocking[0]!.tracks.push({ entityId: bus.id, marks: [b1, b2] })
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 2 })
    scene.entities.push(man)
    const m1 = createActorMark({ x: 0, y: 0, z: 2 }, 0, 'walk')
    const m2 = createActorMark({ x: 4.3, y: 0, z: 0.5 }, 3, 'walk')
    m2.attachTo = bus.id
    scene.blocking[0]!.tracks.push({ entityId: man.id, marks: [m1, m2] })

    const ev = new ShotEvaluator(scene, shot)
    const early = ev.evaluate(1.5).entities.find((e) => e.entityId === man.id)!
    expect(early.position.x).toBeLessThan(4)
    const late = ev.evaluate(8)
    const busLate = late.entities.find((e) => e.entityId === bus.id)!
    const manLate = late.entities.find((e) => e.entityId === man.id)!
    expect(busLate.position.z).toBeLessThan(-5)
    expect(manLate.position.z).toBeCloseTo(busLate.position.z + 0.5, 1)
    expect(manLate.position.x).toBeCloseTo(busLate.position.x - 0.7, 1)
    expect(manLate.speed).toBeCloseTo(busLate.speed, 3)
  })

  it('alighting: married rider follows the vehicle until his own marks begin', () => {
    const doc = createProject('A')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    shot.duration = 10
    const plane = createEntity('vehicle.plane', 'Plane', { x: 0, y: 0, z: 20 })
    scene.entities.push(plane)
    const p1 = createActorMark({ x: 0, y: 0, z: 20 }, 0, 'walk')
    const p2 = createActorMark({ x: 0, y: 0, z: 0 }, 5, 'walk')
    p2.hold = 5
    scene.blocking[0]!.tracks.push({ entityId: plane.id, marks: [p1, p2] })
    const pax = createEntity('person.man', 'Passenger', { x: 1, y: 0, z: 20 })
    pax.attachedTo = plane.id
    pax.attachedLocal = { x: 1, y: 0, z: 0, rotY: 0 }
    scene.entities.push(pax)
    const w1 = createActorMark({ x: 1, y: 0, z: 0 }, 6, 'walk')
    const w2 = createActorMark({ x: 8, y: 0, z: -3 }, 9, 'walk')
    scene.blocking[0]!.tracks.push({ entityId: pax.id, marks: [w1, w2] })

    const ev = new ShotEvaluator(scene, shot)
    const mid = ev.evaluate(2.5)
    const planeMid = mid.entities.find((e) => e.entityId === plane.id)!
    const paxMid = mid.entities.find((e) => e.entityId === pax.id)!
    expect(paxMid.position.z).toBeCloseTo(planeMid.position.z, 1)
    const off = ev.evaluate(8).entities.find((e) => e.entityId === pax.id)!
    expect(off.position.x).toBeGreaterThan(3)
  })
})

describe('180-degree line warnings (round 4)', () => {
  it('flags camera marks on opposite sides of the axis of action', () => {
    const doc = createProject('L')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const a = createEntity('person.man', 'A', { x: -2, y: 0, z: 0 })
    const b = createEntity('person.woman', 'B', { x: 2, y: 0, z: 0 })
    scene.entities.push(a, b)
    shot.camera.marks.push(
      createCameraMark({ x: 0, y: 1.6, z: 4 }, 0, 0, 0, 35),
      createCameraMark({ x: 0, y: 1.6, z: -4 }, 3, Math.PI, 0, 35)
    )
    const ev = new ShotEvaluator(scene, shot)
    const crossings = ev.lineCrossings()
    expect(crossings.length).toBe(1)
    expect(crossings[0]).toEqual({ fromMark: 1, toMark: 2 })
  })

  it('no warning when coverage stays on one side', () => {
    const doc = createProject('L2')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    scene.entities.push(
      createEntity('person.man', 'A', { x: -2, y: 0, z: 0 }),
      createEntity('person.woman', 'B', { x: 2, y: 0, z: 0 })
    )
    shot.camera.marks.push(
      createCameraMark({ x: -1, y: 1.6, z: 4 }, 0, 0, 0, 35),
      createCameraMark({ x: 3, y: 1.6, z: 2 }, 3, 0.4, 0, 35)
    )
    const ev = new ShotEvaluator(scene, shot)
    expect(ev.lineCrossings().length).toBe(0)
  })
})
