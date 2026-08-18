/**
 * The heart of Blockout: state(t).
 *
 * ShotEvaluator compiles a (scene, shot) pair into precomputed travel legs
 * and answers "where is everything at time t?" as a PURE function — no wall
 * clock, no incremental state. Playback, video export, stills, and glTF
 * baking all call the same evaluator, which is what makes exports
 * deterministic across machines.
 */

import { assetSpec, entityHeight } from './assets'
import { verticalFov } from './camera'
import { easedProgress, lerp, lerpAngle, smoothstep } from './easing'
import { GAITS, checkSpeed, type SpeedVerdict } from './gaits'
import { Path, headingOf } from './path'
import { RigNoise } from './rigs'
import type {
  ActorMark,
  CameraMark,
  CameraState,
  Entity,
  EntityState,
  GaitId,
  MarkBase,
  Scene,
  Shot,
  ShotState,
  V3
} from './types'

/**
 * Interpolate two joint-offset maps (missing keys read as 0). Returns
 * undefined when both sides are empty so unposed actors stay allocation-free.
 */
function lerpJoints(
  from: Record<string, number> | undefined,
  to: Record<string, number> | undefined,
  u: number
): Record<string, number> | undefined {
  if (!from && !to) return undefined
  const out: Record<string, number> = {}
  const keys = new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])
  for (const key of keys) {
    out[key] = (from?.[key] ?? 0) + ((to?.[key] ?? 0) - (from?.[key] ?? 0)) * u
  }
  return out
}

interface Leg<M extends MarkBase> {
  from: M
  to: M
  departTime: number
  arriveTime: number
  path: Path
  /** Cumulative travel distance at the start of this leg. */
  distanceBefore: number
}

function buildLegs<M extends MarkBase>(marks: M[]): Leg<M>[] {
  const sorted = [...marks].sort((a, b) => a.time - b.time)
  const legs: Leg<M>[] = []
  let distanceBefore = 0
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i]!
    const to = sorted[i + 1]!
    // A hold reaching past the next mark's arrival would leave a 1ms
    // teleport; truncate the hold so there is always a real travel window.
    const departTime = Math.min(from.time + from.hold, Math.max(from.time, to.time - 0.1))
    const arriveTime = Math.max(to.time, departTime + 0.001)
    const points: V3[] = [from.position, ...(to.via ?? []), to.position]
    const path = new Path(points)
    legs.push({ from, to, departTime, arriveTime, path, distanceBefore })
    distanceBefore += path.length
  }
  return legs
}

/** Evaluate a mark track at time t: position, heading, progress info. */
function evaluateTrack<M extends MarkBase>(
  marks: M[],
  legs: Leg<M>[],
  t: number
): {
  position: V3
  travelHeading: number | null
  distanceTravelled: number
  speed: number
  leg: Leg<M> | null
  /** Mark we are at / most recently arrived at (null while travelling). */
  atMark: M | null
  legProgress: number
} {
  const sorted = [...marks].sort((a, b) => a.time - b.time)
  const first = sorted[0]!
  // Only handle "before the first mark" here — holding AT a mark is the
  // legs loop's job, which respects the truncated departure time (a hold
  // reaching past the next mark's arrival is shortened, not honored).
  if (legs.length === 0 || t <= first.time) {
    return {
      position: first.position,
      travelHeading: null,
      distanceTravelled: 0,
      speed: 0,
      leg: null,
      atMark: first,
      legProgress: 0
    }
  }
  for (const leg of legs) {
    if (t < leg.departTime) {
      // Holding at leg.from
      return {
        position: leg.from.position,
        travelHeading: null,
        distanceTravelled: leg.distanceBefore,
        speed: 0,
        leg: null,
        atMark: leg.from,
        legProgress: 0
      }
    }
    if (t <= leg.arriveTime) {
      const u = (t - leg.departTime) / (leg.arriveTime - leg.departTime)
      const progress = easedProgress(u, leg.from.easeOut, leg.to.easeIn)
      const d = progress * leg.path.length
      // Finite-difference instantaneous speed (pure in t).
      const du = 0.001
      const p2 = easedProgress(Math.min(1, u + du), leg.from.easeOut, leg.to.easeIn)
      const speed =
        ((p2 - progress) * leg.path.length) / (du * (leg.arriveTime - leg.departTime))
      return {
        position: leg.path.pointAt(d),
        travelHeading: leg.path.length > 0.001 ? leg.path.headingAt(d) : null,
        distanceTravelled: leg.distanceBefore + d,
        speed,
        leg,
        atMark: null,
        legProgress: u
      }
    }
  }
  const last = legs[legs.length - 1]!
  return {
    position: last.to.position,
    travelHeading: null,
    distanceTravelled: last.distanceBefore + last.path.length,
    speed: 0,
    leg: null,
    atMark: last.to,
    legProgress: 1
  }
}

export interface SpeedWarning {
  entityId: string | 'camera'
  entityName: string
  fromMarkId: string
  toMarkId: string
  legIndex: number
  verdict: Exclude<SpeedVerdict, { ok: true }>
  gait: GaitId
}

export class ShotEvaluator {
  readonly scene: Scene
  readonly shot: Shot
  private cameraLegs: Leg<CameraMark>[]
  private entityLegs = new Map<string, { entity: Entity; marks: ActorMark[]; legs: Leg<ActorMark>[] }>()
  private rigNoise: RigNoise
  private staticEntities: Entity[] = []

  constructor(scene: Scene, shot: Shot) {
    this.scene = scene
    this.shot = shot
    this.cameraLegs = shot.camera.marks.length >= 2 ? buildLegs(shot.camera.marks) : []
    this.rigNoise = new RigNoise(shot.camera.rig, shot.camera.seed)

    const take = scene.blocking.find((b) => b.id === shot.blockingTakeId) ?? scene.blocking[0]
    const tracked = new Set<string>()
    if (take) {
      for (const track of take.tracks) {
        const entity = scene.entities.find((e) => e.id === track.entityId)
        if (!entity || track.marks.length === 0) continue
        tracked.add(entity.id)
        this.entityLegs.set(entity.id, {
          entity,
          marks: track.marks,
          legs: track.marks.length >= 2 ? buildLegs(track.marks) : []
        })
        const sorted = [...track.marks].sort((a, b) => a.time - b.time)
        this.trackFirstTime.set(entity.id, sorted[0]!.time)
        // Boarding marks: on arrival, the entity rides the target entity.
        for (const mark of sorted) {
          if (mark.attachTo) {
            this.boardMarks.set(entity.id, [...(this.boardMarks.get(entity.id) ?? []), mark])
          }
        }
      }
    }
    this.staticEntities = scene.entities.filter((e) => !tracked.has(e.id))
  }

  /** First mark time per tracked entity (marriage applies before this). */
  private trackFirstTime = new Map<string, number>()
  /** Boarding marks per entity, in time order. */
  private boardMarks = new Map<string, import('./types').ActorMark[]>()
  /** Cached boarding offsets, keyed by mark id (pure per document). */
  private boardOffsets = new Map<string, { x: number; y: number; z: number; rotY: number }>()

  /** Position + heading of one entity at time t (for boarding offsets). */
  private poseOf(entityId: string, t: number): { position: V3; heading: number } {
    const trackInfo = this.entityLegs.get(entityId)
    if (trackInfo) {
      const r = evaluateTrack(trackInfo.marks, trackInfo.legs, t)
      const heading =
        r.travelHeading ??
        r.atMark?.arriveHeading ??
        this.lastTravelHeading(trackInfo.legs, t) ??
        trackInfo.entity.transform.rotationY
      return { position: r.position, heading }
    }
    const entity = this.scene.entities.find((e) => e.id === entityId)
    return entity
      ? { position: entity.transform.position, heading: entity.transform.rotationY }
      : { position: { x: 0, y: 0, z: 0 }, heading: 0 }
  }

  /**
   * Boarding: after arriving at a mark with attachTo, the entity follows the
   * target vehicle at the offset captured at boarding time — walk to the bus
   * door at mark 3, then ride the bus wherever it goes.
   */
  private resolveBoardings(entities: EntityState[], time: number): void {
    if (this.boardMarks.size === 0) return
    const byId = new Map(entities.map((e) => [e.entityId, e]))
    for (const [entityId, marks] of this.boardMarks) {
      // Latest boarding already reached at this time wins.
      let active: import('./types').ActorMark | null = null
      for (const m of marks) if (time >= m.time) active = m
      if (!active?.attachTo) continue
      const rider = byId.get(entityId)
      const vehicle = byId.get(active.attachTo)
      if (!rider || !vehicle) continue

      let offset = this.boardOffsets.get(active.id)
      if (!offset) {
        const vAtBoard = this.poseOf(active.attachTo, active.time)
        const dx = active.position.x - vAtBoard.position.x
        const dz = active.position.z - vAtBoard.position.z
        const cos = Math.cos(vAtBoard.heading)
        const sin = Math.sin(vAtBoard.heading)
        offset = {
          x: dx * cos - dz * sin,
          y: active.position.y - vAtBoard.position.y,
          z: dx * sin + dz * cos,
          rotY: active.arriveHeading !== undefined ? active.arriveHeading - vAtBoard.heading : 0
        }
        this.boardOffsets.set(active.id, offset)
      }

      const cos = Math.cos(vehicle.heading)
      const sin = Math.sin(vehicle.heading)
      rider.position = {
        x: vehicle.position.x + offset.x * cos + offset.z * sin,
        y: vehicle.position.y + offset.y,
        z: vehicle.position.z - offset.x * sin + offset.z * cos
      }
      rider.heading = vehicle.heading + offset.rotY
      rider.gait = 'stand'
      rider.speed = vehicle.speed
      rider.distanceTravelled = vehicle.distanceTravelled
      if (active.joints) rider.joints = { ...active.joints }
    }
  }

  evaluate(t: number): ShotState {
    const time = Math.min(Math.max(0, t), this.shot.duration)
    const entities: EntityState[] = []

    for (const { entity, marks, legs } of this.entityLegs.values()) {
      const r = evaluateTrack(marks, legs, time)
      const arriveHeading = r.atMark?.arriveHeading
      const heading =
        r.travelHeading ?? arriveHeading ?? this.lastTravelHeading(legs, time) ?? entity.transform.rotationY
      // Gait: while travelling, the gait of the mark we travel toward;
      // while holding, the gait of the mark we're at.
      const gait: GaitId = r.leg ? r.leg.to.gait : (r.atMark?.gait ?? 'stand')
      const spec = GAITS[gait]
      // Joints: hold the mark's pose at a mark; interpolate between the
      // departure and arrival marks' poses while travelling (eased with the
      // same curve as the travel itself so limbs land with the body).
      const joints = r.leg
        ? lerpJoints(
            r.leg.from.joints,
            r.leg.to.joints,
            easedProgress(r.legProgress, r.leg.from.easeOut, r.leg.to.easeIn)
          )
        : r.atMark?.joints
          ? { ...r.atMark.joints }
          : undefined
      entities.push({
        entityId: entity.id,
        position: r.position,
        heading,
        gait: r.leg && spec.travels ? gait : r.leg ? 'walk' : gait,
        distanceTravelled: r.distanceTravelled,
        speed: r.speed,
        joints
      })
    }

    for (const entity of this.staticEntities) {
      entities.push({
        entityId: entity.id,
        position: entity.transform.position,
        heading: entity.transform.rotationY,
        gait: 'stand',
        distanceTravelled: 0,
        speed: 0
      })
    }

    this.resolveBoardings(entities, time)
    this.resolveMarriages(entities, time)

    return { time, camera: this.evaluateCamera(time, entities), entities }
  }

  /**
   * Married entities ride their parent: world pose = parent pose ∘ the local
   * offset captured at marry time. Own blocking marks override the marriage.
   * Multiple passes resolve chains (rider on cart on truck); marry-time
   * cycle guards keep this finite.
   */
  private resolveMarriages(entities: EntityState[], time: number): void {
    const byId = new Map(entities.map((e) => [e.entityId, e]))
    for (let pass = 0; pass < 4; pass++) {
      let changed = false
      for (const entity of this.scene.entities) {
        if (!entity.attachedTo || !entity.attachedLocal) continue
        // Own marks win — but only once they begin: a married rider with a
        // track starting at t=8 rides the vehicle until 8s, then walks its
        // own marks (stepping OFF the plane after it lands).
        const firstMark = this.trackFirstTime.get(entity.id)
        if (firstMark !== undefined && time >= firstMark) continue
        const child = byId.get(entity.id)
        const parent = byId.get(entity.attachedTo)
        if (!child || !parent) continue
        const local = entity.attachedLocal
        const cosH = Math.cos(parent.heading)
        const sinH = Math.sin(parent.heading)
        const nx = parent.position.x + local.x * cosH + local.z * sinH
        const ny = parent.position.y + local.y
        const nz = parent.position.z - local.x * sinH + local.z * cosH
        const nh = parent.heading + local.rotY
        if (
          Math.abs(child.position.x - nx) > 1e-9 ||
          Math.abs(child.position.y - ny) > 1e-9 ||
          Math.abs(child.position.z - nz) > 1e-9 ||
          Math.abs(child.heading - nh) > 1e-9
        ) {
          changed = true
        }
        child.position = { x: nx, y: ny, z: nz }
        child.heading = nh
        // Ride the parent's motion for animation purposes (a married cart's
        // wheels spin with the truck); the pose itself comes from params.pose.
        child.speed = parent.speed
        child.distanceTravelled = parent.distanceTravelled
      }
      if (!changed) break
    }
  }

  private lastTravelHeading<M extends MarkBase>(legs: Leg<M>[], t: number): number | null {
    // Heading held after finishing a leg = tangent at that leg's end.
    let latest: Leg<M> | null = null
    for (const leg of legs) {
      if (t >= leg.arriveTime && leg.path.length > 0.001) latest = leg
    }
    if (!latest) return null
    return latest.path.headingAt(latest.path.length)
  }

  private evaluateCamera(time: number, entities: EntityState[]): CameraState {
    const cam = this.shot.camera
    const marks = cam.marks

    let position: V3
    let pan: number
    let tilt: number
    let roll: number
    let focalLength: number
    let focusDistance: number | undefined

    if (marks.length === 0) {
      // Sane default: eye-height, pulled back, aimed at origin.
      position = { x: 5, y: 1.6, z: 5 }
      pan = headingOf({ x: -5, y: 0, z: -5 })
      tilt = 0
      roll = 0
      focalLength = 35
      focusDistance = undefined
    } else if (marks.length === 1) {
      const m = marks[0]!
      position = m.position
      pan = m.pan
      tilt = m.tilt
      roll = m.roll
      focalLength = m.focalLength
      focusDistance = m.focusDistance
    } else {
      const r = evaluateTrack(marks, this.cameraLegs, time)
      position = r.position
      if (r.leg) {
        const u = smoothstep(easedProgress(r.legProgress, r.leg.from.easeOut, r.leg.to.easeIn))
        pan = lerpAngle(r.leg.from.pan, r.leg.to.pan, u)
        tilt = lerpAngle(r.leg.from.tilt, r.leg.to.tilt, u)
        roll = lerpAngle(r.leg.from.roll, r.leg.to.roll, u)
        focalLength = lerp(r.leg.from.focalLength, r.leg.to.focalLength, u)
        const f0 = r.leg.from.focusDistance
        const f1 = r.leg.to.focusDistance
        focusDistance = f0 !== undefined && f1 !== undefined ? lerp(f0, f1, u) : (f1 ?? f0)
      } else {
        const m = r.atMark!
        pan = m.pan
        tilt = m.tilt
        roll = m.roll
        focalLength = m.focalLength
        focusDistance = m.focusDistance
      }
    }

    // Car mount: marks are in the mount entity's local frame.
    if (cam.rig === 'carMount' && cam.mountEntityId) {
      const mount = entities.find((e) => e.entityId === cam.mountEntityId)
      if (mount) {
        // Rotate the camera's local offset by the mount's heading
        // (Y-rotation: x' = x cosθ + z sinθ, z' = -x sinθ + z cosθ).
        const cosH = Math.cos(mount.heading)
        const sinH = Math.sin(mount.heading)
        const lx = position.x
        const lz = position.z
        position = {
          x: mount.position.x + lx * cosH + lz * sinH,
          y: mount.position.y + position.y,
          z: mount.position.z - lx * sinH + lz * cosH
        }
        pan = pan + mount.heading
      }
    }

    // Aim lock: point at the tracked subject regardless of how the position
    // moves (marks, recorded flights, mounts, presets) — the drone-following-
    // the-plane shot. Runs after mounts (aim from the FINAL position) and
    // before rig noise so handheld/steadicam texture still layers on top.
    // If marks set a focusDistance, focus is pulled to the subject's live
    // distance; deep focus (undefined) stays deep.
    if (cam.trackEntityId) {
      const subject = entities.find((e) => e.entityId === cam.trackEntityId)
      const docEntity = this.scene.entities.find((e) => e.id === cam.trackEntityId)
      if (subject && docEntity) {
        const aimUp = entityHeight(docEntity.assetId, docEntity.transform.scale, docEntity.params) * 0.8
        const dx = subject.position.x - position.x
        const dy = subject.position.y + aimUp - position.y
        const dz = subject.position.z - position.z
        const flat = Math.hypot(dx, dz)
        if (flat > 1e-4 || Math.abs(dy) > 1e-4) {
          pan = headingOf({ x: dx, y: 0, z: dz })
          tilt = Math.atan2(dy, Math.max(flat, 1e-4))
          if (focusDistance !== undefined) {
            focusDistance = Math.max(0.3, Math.hypot(dx, dy, dz))
          }
        }
      }
    }

    const noise = this.rigNoise.offsetAt(time, cam.rigIntensity)
    return {
      position: {
        x: position.x + noise.dx,
        y: position.y + noise.dy,
        z: position.z + noise.dz
      },
      pan: pan + noise.dpan,
      tilt: tilt + noise.dtilt,
      roll: roll + noise.droll,
      focalLength,
      focusDistance,
      vfov: verticalFov(cam.sensorId, focalLength, this.shot.aspect)
    }
  }

  /** Speed sanity warnings for every travel leg in the shot's blocking. */
  warnings(): SpeedWarning[] {
    const out: SpeedWarning[] = []
    for (const { entity, legs } of this.entityLegs.values()) {
      const spec = assetSpec(entity.assetId)
      legs.forEach((leg, i) => {
        const duration = leg.arriveTime - leg.departTime
        if (duration <= 0 || leg.path.length < 0.05) return
        const impliedSpeed = leg.path.length / duration
        const verdict = checkSpeed(leg.to.gait, impliedSpeed, spec.speedScale)
        if (!verdict.ok) {
          out.push({
            entityId: entity.id,
            entityName: entity.label?.text || entity.name,
            fromMarkId: leg.from.id,
            toMarkId: leg.to.id,
            legIndex: i,
            verdict,
            gait: leg.to.gait
          })
        }
      })
    }
    return out
  }

  /**
   * 180°-rule check: if consecutive camera marks sit on opposite sides of
   * the axis of action (the line between the two principal people, sampled
   * at each mark's time), the cut/move crosses the line and screen direction
   * flips. Returns the mark indices (1-based) of each crossing.
   */
  lineCrossings(): { fromMark: number; toMark: number }[] {
    const people = this.scene.entities.filter((e) => e.assetId.startsWith('person.'))
    if (people.length < 2) return []
    const a = people[0]!.id
    const b = people[1]!.id
    const marks = [...this.shot.camera.marks].sort((x, y) => x.time - y.time)
    if (marks.length < 2) return []

    const sideAt = (camPos: V3, t: number): number => {
      const pa = this.poseOf(a, t).position
      const pb = this.poseOf(b, t).position
      const axisX = pb.x - pa.x
      const axisZ = pb.z - pa.z
      if (axisX * axisX + axisZ * axisZ < 0.01) return 0 // subjects overlap
      const relX = camPos.x - pa.x
      const relZ = camPos.z - pa.z
      const cross = axisX * relZ - axisZ * relX
      return Math.abs(cross) < 0.2 ? 0 : Math.sign(cross)
    }

    const crossings: { fromMark: number; toMark: number }[] = []
    let prevSide = 0
    let prevIndex = 0
    marks.forEach((mark, i) => {
      const side = sideAt(mark.position, mark.time)
      if (side !== 0) {
        if (prevSide !== 0 && side !== prevSide) {
          crossings.push({ fromMark: prevIndex + 1, toMark: i + 1 })
        }
        prevSide = side
        prevIndex = i
      }
    })
    return crossings
  }

  /** Path polylines for viewport/diagram rendering. */
  paths(): { entityId: string | 'camera'; color?: string; points: V3[] }[] {
    const out: { entityId: string | 'camera'; color?: string; points: V3[] }[] = []
    for (const { entity, legs } of this.entityLegs.values()) {
      for (const leg of legs) {
        out.push({ entityId: entity.id, color: entity.label?.color, points: leg.path.polyline() })
      }
    }
    for (const leg of this.cameraLegs) {
      out.push({ entityId: 'camera', points: leg.path.polyline() })
    }
    return out
  }

  /** Subject height helper for auto-framing UIs. */
  subjectHeight(entityId: string): number {
    const e = this.scene.entities.find((x) => x.id === entityId)
    if (!e) return 1.7
    return entityHeight(e.assetId, e.transform.scale, e.params)
  }
}
