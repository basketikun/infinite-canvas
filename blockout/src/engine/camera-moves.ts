/**
 * Camera-move preset library for Blockout — one-click classic camera moves.
 *
 * The app calls `preset.generate(ctx)` and converts the returned
 * `CameraMarkSpec[]` into `CameraMark`s on the active shot camera. Presets are
 * PURE data-shaping functions: they take a subject sampler (so a move can ride
 * a walking actor or a flying plane) plus the live camera state, and return a
 * short, well-shaped list of marks the app interpolates (Catmull-Rom) between.
 *
 * Math conventions (must match the engine):
 *   - Meters. +X right, −Z forward. heading 0 faces −Z.
 *   - forward(θ) = (−sinθ, 0, −cosθ).
 *   - Aim the camera from P at target T with:
 *       pan  = headingOf({ x: T.x−P.x, y: 0, z: T.z−P.z })
 *       tilt = atan2(T.y−P.y, hypot(T.x−P.x, T.z−P.z))   (positive tilts up)
 *   - Aim point for a subject = subject position + subjectHeight×0.8 up.
 *   - "Behind" a subject = pos − forward(heading)×d; "in front" = pos + …×d.
 *   - Positions stay ≥0.2m above y=0 unless the subject is airborne.
 *
 * Pure module: imports only heading math from './path' and types from './types'.
 * No DOM/three/Electron, no Math.random / Date.now.
 */

import { headingOf } from './path'

export interface SubjectSample {
  x: number
  y: number
  z: number
  heading: number
}

export interface CameraMoveContext {
  /** Subject pose at time t (0..duration) — includes vehicles/riders resolved. */
  subjectAt(t: number): SubjectSample
  /** Approximate subject height in meters (aim ~0.8× up it for people). */
  subjectHeight: number
  /** Live camera state at t=0 — presets should START near this where sensible. */
  camera: { x: number; y: number; z: number; pan: number; tilt: number; focalLength: number }
  duration: number
}

export interface CameraMarkSpec {
  time: number
  position: { x: number; y: number; z: number }
  pan: number
  tilt: number
  roll: number
  focalLength: number
  easeIn: number
  easeOut: number
  hold: number
}

export type CameraMoveCategory =
  | 'push & pull'
  | 'orbit & arc'
  | 'crane & boom'
  | 'aerial'
  | 'follow'
  | 'pan & scan'
  | 'stylized'

export interface CameraMovePreset {
  id: string
  name: string
  category: CameraMoveCategory
  /** One line, filmmaker language: what the move is and when to use it. */
  description: string
  /**
   * True → the app should also enable subject-tracking aim lock
   * (camera.trackEntityId) so pan/tilt stay glued to the subject even if the
   * user re-times marks. Generated pan/tilt should STILL aim at the subject
   * (a fallback for when tracking is off).
   */
  track: boolean
  generate(ctx: CameraMoveContext): CameraMarkSpec[]
}

// ---------------------------------------------------------------------------
// Small vector / aiming helpers (local, pure).
// ---------------------------------------------------------------------------

interface P3 {
  x: number
  y: number
  z: number
}

const TAU = Math.PI * 2

function hypot2(dx: number, dz: number): number {
  return Math.sqrt(dx * dx + dz * dz)
}

/** Unit forward vector for a heading (heading 0 faces −Z). */
function forward(heading: number): P3 {
  return { x: -Math.sin(heading), y: 0, z: -Math.cos(heading) }
}

/** Aim point for a subject: its position plus 0.8× its height, in world Y. */
function aimPoint(s: SubjectSample, subjectHeight: number): P3 {
  return { x: s.x, y: s.y + subjectHeight * 0.8, z: s.z }
}

/** pan/tilt that points the camera at P from position C. */
function aim(cam: P3, target: P3): { pan: number; tilt: number } {
  const dx = target.x - cam.x
  const dy = target.y - cam.y
  const dz = target.z - cam.z
  const pan = headingOf({ x: dx, y: 0, z: dz })
  const tilt = Math.atan2(dy, hypot2(dx, dz))
  return { pan, tilt }
}

/** Horizontal distance from camera to subject aim point. */
function planarDist(a: P3, b: P3): number {
  return hypot2(b.x - a.x, b.z - a.z)
}

/** Keep a camera position out of the floor unless the subject is airborne. */
function floorClamp(y: number, subjectAirborne: boolean): number {
  return subjectAirborne ? y : Math.max(0.2, y)
}

interface MarkBuild {
  t: number
  pos: P3
  aimAt: P3
  focalLength: number
  roll?: number
}

/**
 * Assemble a CameraMarkSpec list from per-mark build data. Applies the shared
 * conventions: easeIn/easeOut 0.25 on the first & last marks (0 elsewhere),
 * hold 0, and aims pan/tilt at each mark's aim point. `roll` defaults to 0.
 */
function build(marks: MarkBuild[], airborne: boolean): CameraMarkSpec[] {
  const last = marks.length - 1
  return marks.map((m, i) => {
    const pos = { x: m.pos.x, y: floorClamp(m.pos.y, airborne), z: m.pos.z }
    const { pan, tilt } = aim(pos, m.aimAt)
    const edge = i === 0 || i === last
    return {
      time: m.t,
      position: pos,
      pan,
      tilt,
      roll: m.roll ?? 0,
      focalLength: m.focalLength,
      easeIn: edge ? 0.25 : 0,
      easeOut: edge ? 0.25 : 0,
      hold: 0
    }
  })
}

/** Even times from 0..duration for a given count of marks (count ≥ 2). */
function times(count: number, duration: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((duration * i) / (count - 1))
  return out
}

/** Is the subject airborne at t=0? (Used to scale/allow low positions.) */
function isAirborne(ctx: CameraMoveContext): boolean {
  return ctx.subjectAt(0).y > 3
}

// ---------------------------------------------------------------------------
// PUSH & PULL
// ---------------------------------------------------------------------------

const slowPushIn: CameraMovePreset = {
  id: 'slow-push-in',
  name: 'Slow Push-In',
  category: 'push & pull',
  description: 'A gentle dolly drift from where the camera sits to about 2m off the subject — builds quiet intensity.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 0.5)
    const endDist = 2
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        // Approach along the camera's original bearing to the subject.
        const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
        const dir = forward(bearing)
        const y = ctx.camera.y + (target.y - ctx.camera.y) * u * 0.4
        return {
          t,
          pos: { x: target.x + dir.x * d, y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const crashIn: CameraMovePreset = {
  id: 'crash-in',
  name: 'Crash-In',
  category: 'push & pull',
  description: 'A fast push where most of the travel happens in the last third — a sudden lunge into the subject.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 0.6)
    const endDist = 1.2
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        // Ease toward the end — cube so most travel lands late.
        const eased = u * u * u
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * eased
        return {
          t,
          pos: { x: target.x + dir.x * d, y: ctx.camera.y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const pullBackReveal: CameraMovePreset = {
  id: 'pull-back-reveal',
  name: 'Pull-Back Reveal',
  category: 'push & pull',
  description: 'Recede from the subject while rising slightly to reveal the surrounding context — a classic opener or closer.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 2)
    const endDist = startDist + 12
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        const y = ctx.camera.y + 3 * u
        return {
          t,
          pos: { x: target.x + dir.x * d, y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const creepInLow: CameraMovePreset = {
  id: 'creep-in-low',
  name: 'Creep-In Low',
  category: 'push & pull',
  description: 'A slow push at knee height that makes the subject loom — menacing, low-angle approach.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 4)
    const endDist = 2.5
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const airborne = isAirborne(ctx)
    const kneeY = 0.5
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        return {
          t,
          pos: { x: target.x + dir.x * d, y: kneeY, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

// ---------------------------------------------------------------------------
// ORBIT & ARC
// ---------------------------------------------------------------------------

/**
 * Build an orbit around the subject: the orbit CENTER follows subjectAt(t) so
 * it works on movers. `sweep` is the total angle (radians, signed). Radius and
 * height come from the live camera's offset from the subject at t=0.
 */
function orbit(
  ctx: CameraMoveContext,
  sweep: number,
  count: number,
  opts?: { radiusScaleEnd?: number; roll?: (u: number) => number }
): CameraMarkSpec[] {
  const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
  const s0 = ctx.subjectAt(0)
  const center0 = { x: s0.x, y: s0.y, z: s0.z }
  const radius0 = Math.max(planarDist(cam, center0), 2)
  const startAz = headingOf({ x: cam.x - center0.x, y: 0, z: cam.z - center0.z })
  const camY = ctx.camera.y
  const airborne = isAirborne(ctx)
  const ts = times(count, ctx.duration)
  const radScaleEnd = opts?.radiusScaleEnd ?? 1
  return build(
    ts.map((t) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      const center = { x: s.x, y: s.y, z: s.z }
      const az = startAz + sweep * u
      const radius = radius0 * (1 + (radScaleEnd - 1) * u)
      // Azimuth is a heading measured from the subject to the camera.
      const off = forward(az)
      const target = aimPoint(s, ctx.subjectHeight)
      return {
        t,
        pos: { x: center.x + off.x * radius, y: camY, z: center.z + off.z * radius },
        aimAt: target,
        focalLength: ctx.camera.focalLength,
        roll: opts?.roll ? opts.roll(u) : 0
      }
    }),
    airborne
  )
}

const orbit90Left: CameraMovePreset = {
  id: 'orbit-90-left',
  name: 'Orbit 90° Left',
  category: 'orbit & arc',
  description: 'A quarter circle counter-clockwise around the subject at the current radius — reveals a new profile.',
  track: true,
  generate(ctx) {
    return orbit(ctx, Math.PI / 2, 6)
  }
}

const orbit90Right: CameraMovePreset = {
  id: 'orbit-90-right',
  name: 'Orbit 90° Right',
  category: 'orbit & arc',
  description: 'A quarter circle clockwise around the subject at the current radius — reveals the other profile.',
  track: true,
  generate(ctx) {
    return orbit(ctx, -Math.PI / 2, 6)
  }
}

const orbit180: CameraMovePreset = {
  id: 'orbit-180',
  name: 'Orbit 180°',
  category: 'orbit & arc',
  description: 'A half circle around the subject, ending on the far side — a sweeping change of vantage.',
  track: true,
  generate(ctx) {
    return orbit(ctx, Math.PI, 7)
  }
}

const orbit360: CameraMovePreset = {
  id: 'orbit-360',
  name: 'Orbit 360°',
  category: 'orbit & arc',
  description: 'A full circle around the subject, returning to the start azimuth — the hero-reveal spin.',
  track: true,
  generate(ctx) {
    return orbit(ctx, TAU, 9)
  }
}

const arcAndPush: CameraMovePreset = {
  id: 'arc-and-push',
  name: 'Arc & Push',
  category: 'orbit & arc',
  description: 'A quarter arc around the subject while the radius shrinks ~40% — orbits in and tightens at once.',
  track: true,
  generate(ctx) {
    return orbit(ctx, Math.PI / 2, 7, { radiusScaleEnd: 0.6 })
  }
}

// ---------------------------------------------------------------------------
// CRANE & BOOM
// ---------------------------------------------------------------------------

const craneUpReveal: CameraMovePreset = {
  id: 'crane-up-reveal',
  name: 'Crane-Up Reveal',
  category: 'crane & boom',
  description: 'Start at eye level, boom straight up to ~8m looking down as the world opens beneath the subject.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const radius = Math.max(planarDist(cam, startAim), 3)
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const y = s.y + ctx.subjectHeight * 0.9 + (8 - ctx.subjectHeight * 0.9) * u
        return {
          t,
          pos: { x: target.x + dir.x * radius, y, z: target.z + dir.z * radius },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const craneDownIntro: CameraMovePreset = {
  id: 'crane-down-intro',
  name: 'Crane-Down Intro',
  category: 'crane & boom',
  description: 'Descend from ~8m looking down to the subject at eye level — a graceful drop into the scene.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const radius = Math.max(planarDist(cam, startAim), 3)
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const y = 8 + (s.y + ctx.subjectHeight * 0.9 - 8) * u
        return {
          t,
          pos: { x: target.x + dir.x * radius, y, z: target.z + dir.z * radius },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const pedestalUp: CameraMovePreset = {
  id: 'pedestal-up',
  name: 'Pedestal Up',
  category: 'crane & boom',
  description: 'A straight vertical rise of ~3m holding aim on the subject — reframes head-to-toe without dolly.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const radius = Math.max(planarDist(cam, startAim), 2)
    const ts = times(6, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const y = ctx.camera.y + 3 * u
        return {
          t,
          pos: { x: target.x + dir.x * radius, y, z: target.z + dir.z * radius },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const boomOver: CameraMovePreset = {
  id: 'boom-over',
  name: 'Boom Over',
  category: 'crane & boom',
  description: 'Rise and pass directly overhead to the far side of the subject — a dramatic vault across.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const center0 = { x: s0.x, y: s0.y, z: s0.z }
    const bearing = headingOf({ x: cam.x - center0.x, y: 0, z: cam.z - center0.z })
    const nearDir = forward(bearing)
    const farDir = forward(bearing + Math.PI)
    const radius = Math.max(planarDist(cam, center0), 3)
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    const peakY = ctx.camera.y + 6
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        // Linear slide from near side (+radius) through 0 to far side (−radius).
        const along = 1 - 2 * u // +1 → −1
        const dir = along >= 0 ? nearDir : farDir
        const horiz = Math.abs(along) * radius
        // Arc the height up over the middle.
        const y = ctx.camera.y + (peakY - ctx.camera.y) * Math.sin(Math.PI * u)
        return {
          t,
          pos: { x: s.x + dir.x * horiz, y, z: s.z + dir.z * horiz },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

// ---------------------------------------------------------------------------
// AERIAL
// ---------------------------------------------------------------------------

const droneRisePullback: CameraMovePreset = {
  id: 'drone-rise-pullback',
  name: 'Drone Rise & Pull-Back',
  category: 'aerial',
  description: 'Climb to ~15m while receding ~20m — the classic drone ending that lifts away from the subject.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 3)
    const endDist = startDist + 20
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const ts = times(8, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        const y = ctx.camera.y + (15 - ctx.camera.y) * u + s.y * (1 - u)
        return {
          t,
          pos: { x: target.x + dir.x * d, y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const flyover: CameraMovePreset = {
  id: 'flyover',
  name: 'Flyover',
  category: 'aerial',
  description: 'Pass directly over the subject from front to behind at ~12m — a sweeping aerial transit.',
  track: true,
  generate(ctx) {
    const s0 = ctx.subjectAt(0)
    const heading = s0.heading
    const fwd = forward(heading)
    const startDist = 18
    const endDist = 18
    const altitude = 12
    const ts = times(8, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        // Start in FRONT of the subject (+forward), slide to BEHIND (−forward).
        const along = startDist + (-(startDist + endDist)) * u // +startDist → −endDist
        return {
          t,
          pos: { x: s.x + fwd.x * along, y: s.y + altitude, z: s.z + fwd.z * along },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const droneOrbitHigh: CameraMovePreset = {
  id: 'drone-orbit-high',
  name: 'Drone Orbit High',
  category: 'aerial',
  description: 'A wide 270° orbit at ~10m altitude looking down — a soaring survey around the subject.',
  track: true,
  generate(ctx) {
    const s0 = ctx.subjectAt(0)
    const center0 = { x: s0.x, y: s0.y, z: s0.z }
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const radius = Math.max(planarDist(cam, center0), 10)
    const startAz = headingOf({ x: cam.x - center0.x, y: 0, z: cam.z - center0.z })
    const sweep = (3 * Math.PI) / 2 // 270°
    const altitude = 10
    const ts = times(9, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const az = startAz + sweep * u
        const off = forward(az)
        return {
          t,
          pos: { x: s.x + off.x * radius, y: s.y + altitude, z: s.z + off.z * radius },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const topDownDescend: CameraMovePreset = {
  id: 'top-down-descend',
  name: 'Top-Down Descend',
  category: 'aerial',
  description: 'A straight vertical drop from ~20m to ~6m looking straight down — a god’s-eye descent.',
  track: true,
  generate(ctx) {
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    const straightDown = -Math.PI / 2 + 0.001
    const last = ts.length - 1
    return ts.map((t, i) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      const y = s.y + 20 + (6 - 20) * u
      const edge = i === 0 || i === last
      // Keep camera slightly off the vertical so pan is defined, but pin tilt
      // to straight-down as required.
      const pos = { x: s.x + 0.001, y, z: s.z }
      const pan = headingOf({ x: s.x - pos.x, y: 0, z: s.z - pos.z })
      return {
        time: t,
        position: floorClampSpec(pos, airborne),
        pan,
        tilt: straightDown,
        roll: 0,
        focalLength: ctx.camera.focalLength,
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

function floorClampSpec(pos: P3, airborne: boolean): P3 {
  return { x: pos.x, y: floorClamp(pos.y, airborne), z: pos.z }
}

// ---------------------------------------------------------------------------
// FOLLOW
// ---------------------------------------------------------------------------

const followBehind: CameraMovePreset = {
  id: 'follow-behind',
  name: 'Follow Behind',
  category: 'follow',
  description: 'Ride ~4m behind the subject at ~1.8m, glued to its heading — the drone-chasing-a-plane shot.',
  track: true,
  generate(ctx) {
    const airborne = isAirborne(ctx)
    const scale = airborne ? 2.5 : 1
    const distance = 4 * scale
    const height = 1.8 * scale
    const ts = times(8, ctx.duration)
    return build(
      ts.map((t) => {
        const s = ctx.subjectAt(t)
        const back = forward(s.heading)
        const target = aimPoint(s, ctx.subjectHeight)
        return {
          t,
          pos: { x: s.x - back.x * distance, y: s.y + height, z: s.z - back.z * distance },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const leadTheSubject: CameraMovePreset = {
  id: 'lead-the-subject',
  name: 'Lead the Subject',
  category: 'follow',
  description: 'Travel ~4m in front of the subject aiming back at it — leads the move and reads the face.',
  track: true,
  generate(ctx) {
    const airborne = isAirborne(ctx)
    const scale = airborne ? 2.5 : 1
    const distance = 4 * scale
    const height = 1.8 * scale
    const ts = times(8, ctx.duration)
    return build(
      ts.map((t) => {
        const s = ctx.subjectAt(t)
        const fwd = forward(s.heading)
        const target = aimPoint(s, ctx.subjectHeight)
        return {
          t,
          pos: { x: s.x + fwd.x * distance, y: s.y + height, z: s.z + fwd.z * distance },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

function sideTrack(ctx: CameraMoveContext, sign: number): CameraMarkSpec[] {
  const airborne = isAirborne(ctx)
  const scale = airborne ? 2.5 : 1
  const distance = 4 * scale
  const height = airborne ? 1.8 * scale : 1.6
  const ts = times(8, ctx.duration)
  return build(
    ts.map((t) => {
      const s = ctx.subjectAt(t)
      // Right of heading = forward(heading − π/2); left = +π/2.
      const side = forward(s.heading - (sign * Math.PI) / 2)
      const target = aimPoint(s, ctx.subjectHeight)
      return {
        t,
        pos: { x: s.x + side.x * distance, y: s.y + height, z: s.z + side.z * distance },
        aimAt: target,
        focalLength: ctx.camera.focalLength
      }
    }),
    airborne
  )
}

const sideTrackLeft: CameraMovePreset = {
  id: 'side-track-left',
  name: 'Side-Track Left',
  category: 'follow',
  description: 'Travel alongside the subject ~4m off its left flank — a lateral tracking shot.',
  track: true,
  generate(ctx) {
    return sideTrack(ctx, 1)
  }
}

const sideTrackRight: CameraMovePreset = {
  id: 'side-track-right',
  name: 'Side-Track Right',
  category: 'follow',
  description: 'Travel alongside the subject ~4m off its right flank — a lateral tracking shot.',
  track: true,
  generate(ctx) {
    return sideTrack(ctx, -1)
  }
}

// ---------------------------------------------------------------------------
// PAN & SCAN
// ---------------------------------------------------------------------------

const staticPanAcross: CameraMovePreset = {
  id: 'static-pan-across',
  name: 'Static Pan Across',
  category: 'pan & scan',
  description: 'Camera holds position and pans from 25° left of the subject to 25° right — surveys a line of action.',
  track: false,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    const spread = (25 * Math.PI) / 180
    const last = ts.length - 1
    return ts.map((t, i) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      const target = aimPoint(s, ctx.subjectHeight)
      const base = aim(cam, target)
      const pan = base.pan - spread + 2 * spread * u
      const edge = i === 0 || i === last
      return {
        time: t,
        position: floorClampSpec(cam, airborne),
        pan,
        tilt: base.tilt,
        roll: 0,
        focalLength: ctx.camera.focalLength,
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

const whipPan: CameraMovePreset = {
  id: 'whip-pan',
  name: 'Whip Pan',
  category: 'pan & scan',
  description: 'Hold on the subject, then a violent 90° pan in ~0.4s mid-shot, then settle — a snappy scene cut.',
  track: false,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const airborne = isAirborne(ctx)
    const s0 = ctx.subjectAt(0)
    const base = aim(cam, aimPoint(s0, ctx.subjectHeight))
    const whip = Math.PI / 2 // 90°
    const dur = ctx.duration
    const mid = dur / 2
    // Tight mark spacing around the whip so the change lands in ~0.4s.
    const raw = [
      { t: 0, pan: base.pan },
      { t: Math.max(0.001, mid - 0.25), pan: base.pan },
      { t: mid - 0.2, pan: base.pan },
      { t: mid + 0.2, pan: base.pan + whip },
      { t: mid + 0.25, pan: base.pan + whip },
      { t: dur, pan: base.pan + whip }
    ]
    // Guard against tiny/short durations: clamp & sort-unique the times.
    const pts = raw
      .map((p) => ({ ...p, t: Math.min(dur, Math.max(0, p.t)) }))
      .sort((a, b) => a.t - b.t)
    const last = pts.length - 1
    return pts.map((p, i) => {
      const edge = i === 0 || i === last
      // Nudge duplicate times to keep strictly increasing.
      const tt = i > 0 && p.t <= pts[i - 1]!.t ? pts[i - 1]!.t + 0.001 : p.t
      pts[i]!.t = tt
      return {
        time: tt,
        position: floorClampSpec(cam, airborne),
        pan: p.pan,
        tilt: base.tilt,
        roll: 0,
        focalLength: ctx.camera.focalLength,
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

const slowTiltReveal: CameraMovePreset = {
  id: 'slow-tilt-reveal',
  name: 'Slow Tilt Reveal',
  category: 'pan & scan',
  description: 'Start tilted down at the ground before the subject, tilt up to meet their eyes — a reveal from the feet.',
  track: false,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    const last = ts.length - 1
    return ts.map((t, i) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      // Ground point a little in front of the camera → subject aim point.
      const groundTarget: P3 = { x: s.x, y: 0, z: s.z }
      const headTarget = aimPoint(s, ctx.subjectHeight)
      const startTilt = aim(cam, groundTarget).tilt
      const endTilt = aim(cam, headTarget).tilt
      const pan = aim(cam, headTarget).pan
      const tilt = startTilt + (endTilt - startTilt) * u
      const edge = i === 0 || i === last
      return {
        time: t,
        position: floorClampSpec(cam, airborne),
        pan,
        tilt,
        roll: 0,
        focalLength: ctx.camera.focalLength,
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

// ---------------------------------------------------------------------------
// STYLIZED
// ---------------------------------------------------------------------------

function clampFocal(fl: number, lo = 12, hi = 135): number {
  return Math.min(hi, Math.max(lo, fl))
}

const vertigoDollyZoom: CameraMovePreset = {
  id: 'vertigo-dolly-zoom',
  name: 'Vertigo Dolly-Zoom',
  category: 'stylized',
  description: 'Push in while the lens widens so the subject stays the same size — the disorienting Vertigo effect.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    // Start from a distance ≥6m; move in to 55% of it.
    const startDist = Math.max(planarDist(cam, startAim), 6)
    const endDist = startDist * 0.55
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const fl0 = Math.max(ctx.camera.focalLength, 24)
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        // Keep subject apparent size constant: fl(t) = fl0 · dist(t)/dist0.
        const fl = clampFocal(fl0 * (d / startDist))
        return {
          t,
          pos: { x: target.x + dir.x * d, y: ctx.camera.y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: fl
        }
      }),
      airborne
    )
  }
}

const dutchOrbit: CameraMovePreset = {
  id: 'dutch-orbit',
  name: 'Dutch Orbit',
  category: 'stylized',
  description: 'A 90° orbit with the horizon rolling to a ±0.3rad dutch tilt — unsettling, stylized motion.',
  track: true,
  generate(ctx) {
    return orbit(ctx, Math.PI / 2, 7, { roll: (u) => 0.3 * u })
  }
}

const snapZoomPunch: CameraMovePreset = {
  id: 'snap-zoom-punch',
  name: 'Snap-Zoom Punch',
  category: 'stylized',
  description: 'Static frame; the lens snaps 35→85mm over three tight marks mid-shot — a punch-in zoom accent.',
  track: false,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const airborne = isAirborne(ctx)
    const dur = ctx.duration
    const mid = dur / 2
    const raw = [
      { t: 0, fl: 35 },
      { t: Math.max(0.001, mid - 0.15), fl: 35 },
      { t: mid, fl: 55 },
      { t: mid + 0.15, fl: 85 },
      { t: dur, fl: 85 }
    ]
    const pts = raw
      .map((p) => ({ ...p, t: Math.min(dur, Math.max(0, p.t)) }))
      .sort((a, b) => a.t - b.t)
    const last = pts.length - 1
    return pts.map((p, i) => {
      const tt = i > 0 && p.t <= pts[i - 1]!.t ? pts[i - 1]!.t + 0.001 : p.t
      pts[i]!.t = tt
      const s = ctx.subjectAt(tt)
      const target = aimPoint(s, ctx.subjectHeight)
      const base = aim(cam, target)
      const edge = i === 0 || i === last
      return {
        time: tt,
        position: floorClampSpec(cam, airborne),
        pan: base.pan,
        tilt: base.tilt,
        roll: 0,
        focalLength: clampFocal(p.fl, 12, 135),
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

// ---------------------------------------------------------------------------
// ADDITIONAL PRESETS (v5.x expansion) — grouped by category.
// ---------------------------------------------------------------------------

// --- follow ---------------------------------------------------------------

const leadFollowFront: CameraMovePreset = {
  id: 'lead-follow-front',
  name: 'Lead-Follow Front',
  category: 'follow',
  description: 'Travel ~4m directly in front of the subject facing back at it — a front-lead tracking shot that reads the face while leading the move.',
  track: true,
  generate(ctx) {
    const airborne = isAirborne(ctx)
    const scale = airborne ? 2.5 : 1
    const distance = 4 * scale
    const height = airborne ? 1.8 * scale : 1.6
    const ts = times(8, ctx.duration)
    return build(
      ts.map((t) => {
        const s = ctx.subjectAt(t)
        const fwd = forward(s.heading)
        const target = aimPoint(s, ctx.subjectHeight)
        return {
          t,
          pos: { x: s.x + fwd.x * distance, y: s.y + height, z: s.z + fwd.z * distance },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const lowLeadTiltUp: CameraMovePreset = {
  id: 'low-lead-tilt-up',
  name: 'Low Lead Tilt-Up',
  category: 'follow',
  description: 'Lead the subject low to the ground (~0.4m) tilting up to meet it as it approaches — a heroic low-angle lead.',
  track: true,
  generate(ctx) {
    const airborne = isAirborne(ctx)
    const distance = 4
    const lowY = 0.4
    const ts = times(8, ctx.duration)
    return build(
      ts.map((t) => {
        const s = ctx.subjectAt(t)
        const fwd = forward(s.heading)
        const target = aimPoint(s, ctx.subjectHeight)
        return {
          t,
          pos: { x: s.x + fwd.x * distance, y: lowY, z: s.z + fwd.z * distance },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

const sideDollyPast: CameraMovePreset = {
  id: 'side-dolly-past',
  name: 'Side-Dolly Past',
  category: 'follow',
  description: 'A lateral dolly ~4m off the subject’s flank that overtakes it — starts slightly behind, ends slightly ahead, aiming at it throughout.',
  track: true,
  generate(ctx) {
    const airborne = isAirborne(ctx)
    const flank = 4
    const height = airborne ? 4 : 1.6
    const behind = 6 // meters behind at start
    const ahead = 6 // meters ahead at end
    const ts = times(8, ctx.duration)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const fwd = forward(s.heading)
        const side = forward(s.heading - Math.PI / 2) // right flank
        const along = -behind + (behind + ahead) * u // behind → ahead
        return {
          t,
          pos: {
            x: s.x + side.x * flank + fwd.x * along,
            y: s.y + height,
            z: s.z + side.z * flank + fwd.z * along
          },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

// --- orbit & arc ----------------------------------------------------------

/**
 * Orbit variant that lets the caller drive the camera height per mark (the
 * base `orbit` helper pins Y to the live camera Y). Used for low/high arcs.
 */
function orbitAt(
  ctx: CameraMoveContext,
  sweep: number,
  count: number,
  yAt: (camY: number, s: SubjectSample) => number
): CameraMarkSpec[] {
  const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
  const s0 = ctx.subjectAt(0)
  const center0 = { x: s0.x, y: s0.y, z: s0.z }
  const radius0 = Math.max(planarDist(cam, center0), 2)
  const startAz = headingOf({ x: cam.x - center0.x, y: 0, z: cam.z - center0.z })
  const camY = ctx.camera.y
  const airborne = isAirborne(ctx)
  const ts = times(count, ctx.duration)
  return build(
    ts.map((t) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      const az = startAz + sweep * u
      const off = forward(az)
      const target = aimPoint(s, ctx.subjectHeight)
      return {
        t,
        pos: { x: s.x + off.x * radius0, y: yAt(camY, s), z: s.z + off.z * radius0 },
        aimAt: target,
        focalLength: ctx.camera.focalLength
      }
    }),
    airborne
  )
}

const orbit45Low: CameraMovePreset = {
  id: 'orbit-45-low',
  name: 'Orbit 45° Low',
  category: 'orbit & arc',
  description: 'A 45° arc around the subject at a low camera height (~0.5m) — a ground-level profile change looking up.',
  track: true,
  generate(ctx) {
    return orbitAt(ctx, Math.PI / 4, 6, () => 0.5)
  }
}

const orbit45High: CameraMovePreset = {
  id: 'orbit-45-high',
  name: 'Orbit 45° High',
  category: 'orbit & arc',
  description: 'A 45° arc around the subject raised ~4m above the start height, looking down — the high companion to Orbit 45° Low.',
  track: true,
  generate(ctx) {
    return orbitAt(ctx, Math.PI / 4, 6, (camY) => camY + 4)
  }
}

// --- crane & boom ---------------------------------------------------------

/**
 * A helical move: orbit `sweep` while the radius scales toward `radScaleEnd`
 * and the camera height eases from the live camera Y toward `endY`.
 */
function spiral(
  ctx: CameraMoveContext,
  sweep: number,
  radScaleEnd: number,
  endY: (camY: number, s0: SubjectSample) => number,
  count: number
): CameraMarkSpec[] {
  const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
  const s0 = ctx.subjectAt(0)
  const center0 = { x: s0.x, y: s0.y, z: s0.z }
  const radius0 = Math.max(planarDist(cam, center0), 2)
  const startAz = headingOf({ x: cam.x - center0.x, y: 0, z: cam.z - center0.z })
  const camY = ctx.camera.y
  const yEnd = endY(camY, s0)
  const airborne = isAirborne(ctx)
  const ts = times(count, ctx.duration)
  return build(
    ts.map((t) => {
      const u = t / ctx.duration
      const s = ctx.subjectAt(t)
      const az = startAz + sweep * u
      const radius = radius0 * (1 + (radScaleEnd - 1) * u)
      const off = forward(az)
      const target = aimPoint(s, ctx.subjectHeight)
      return {
        t,
        pos: { x: s.x + off.x * radius, y: camY + (yEnd - camY) * u, z: s.z + off.z * radius },
        aimAt: target,
        focalLength: ctx.camera.focalLength
      }
    }),
    airborne
  )
}

const spiralInDescend: CameraMovePreset = {
  id: 'spiral-in-descend',
  name: 'Spiral-In Descend',
  category: 'crane & boom',
  description: 'Orbit ~180° while the radius tightens ~45% and the camera descends toward the subject’s eyeline — a closing spiral onto the face.',
  track: true,
  generate(ctx) {
    // End height at subject eye height (aim point height).
    return spiral(ctx, Math.PI, 0.55, (_camY, s0) => s0.y + ctx.subjectHeight * 0.8, 7)
  }
}

const spiralOutAscend: CameraMovePreset = {
  id: 'spiral-out-ascend',
  name: 'Spiral-Out Ascend',
  category: 'crane & boom',
  description: 'Orbit ~180° while the radius blooms ~1.8× and the camera rises ~4m — an opening spiral that reveals the surroundings.',
  track: true,
  generate(ctx) {
    return spiral(ctx, Math.PI, 1.8, (camY) => camY + 4, 7)
  }
}

const pedestalUpSlow: CameraMovePreset = {
  id: 'pedestal-up-slow',
  name: 'Pedestal Up (Slow)',
  category: 'crane & boom',
  description: 'A gentle ~2m vertical rise holding aim on the subject — a softer, shorter boom than the standard pedestal.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const radius = Math.max(planarDist(cam, startAim), 2)
    const ts = times(6, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const y = ctx.camera.y + 2 * u
        return {
          t,
          pos: { x: target.x + dir.x * radius, y, z: target.z + dir.z * radius },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

// --- aerial ---------------------------------------------------------------

const overheadTrackFollow: CameraMovePreset = {
  id: 'overhead-track-follow',
  name: 'Overhead Track-Follow',
  category: 'aerial',
  description: 'Ride ~8m directly above the subject looking straight down and moving with it — a top-down following shot.',
  track: true,
  generate(ctx) {
    const ts = times(7, ctx.duration)
    const airborne = isAirborne(ctx)
    const straightDown = -Math.PI / 2 + 0.001
    const altitude = 8
    const last = ts.length - 1
    return ts.map((t, i) => {
      const s = ctx.subjectAt(t)
      const y = s.y + altitude
      const edge = i === 0 || i === last
      // Keep camera slightly off vertical so pan stays defined; pin tilt down.
      const pos = { x: s.x + 0.001, y, z: s.z }
      const pan = headingOf({ x: s.x - pos.x, y: 0, z: s.z - pos.z })
      return {
        time: t,
        position: floorClampSpec(pos, airborne),
        pan,
        tilt: straightDown,
        roll: 0,
        focalLength: ctx.camera.focalLength,
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

const droneStrafeReveal: CameraMovePreset = {
  id: 'drone-strafe-reveal',
  name: 'Drone Strafe Reveal',
  category: 'aerial',
  description: 'At ~10m altitude, strafe laterally ~20m across the subject’s flank while aiming at it — a sideways drone reveal.',
  track: true,
  generate(ctx) {
    const s0 = ctx.subjectAt(0)
    const heading = s0.heading
    const altitude = 10
    const span = 20
    const ts = times(8, ctx.duration)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        // Perpendicular to the subject's heading (right flank direction).
        const side = forward(heading - Math.PI / 2)
        const along = -span / 2 + span * u
        return {
          t,
          pos: { x: s.x + side.x * along, y: s.y + altitude, z: s.z + side.z * along },
          aimAt: target,
          focalLength: ctx.camera.focalLength
        }
      }),
      airborne
    )
  }
}

// --- stylized -------------------------------------------------------------

const crashZoomOut: CameraMovePreset = {
  id: 'crash-zoom-out',
  name: 'Crash-Zoom Out',
  category: 'stylized',
  description: 'Static frame; the lens snaps 85→35mm over three tight marks mid-shot — a jarring pull-back zoom accent.',
  track: false,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const airborne = isAirborne(ctx)
    const dur = ctx.duration
    const mid = dur / 2
    const raw = [
      { t: 0, fl: 85 },
      { t: Math.max(0.001, mid - 0.15), fl: 85 },
      { t: mid, fl: 60 },
      { t: mid + 0.15, fl: 35 },
      { t: dur, fl: 35 }
    ]
    const pts = raw
      .map((p) => ({ ...p, t: Math.min(dur, Math.max(0, p.t)) }))
      .sort((a, b) => a.t - b.t)
    const last = pts.length - 1
    return pts.map((p, i) => {
      const tt = i > 0 && p.t <= pts[i - 1]!.t ? pts[i - 1]!.t + 0.001 : p.t
      pts[i]!.t = tt
      const s = ctx.subjectAt(tt)
      const target = aimPoint(s, ctx.subjectHeight)
      const base = aim(cam, target)
      const edge = i === 0 || i === last
      return {
        time: tt,
        position: floorClampSpec(cam, airborne),
        pan: base.pan,
        tilt: base.tilt,
        roll: 0,
        focalLength: clampFocal(p.fl, 12, 135),
        easeIn: edge ? 0.25 : 0,
        easeOut: edge ? 0.25 : 0,
        hold: 0
      }
    })
  }
}

const pushInDutchRoll: CameraMovePreset = {
  id: 'push-in-dutch-roll',
  name: 'Push-In Dutch Roll',
  category: 'stylized',
  description: 'A slow push toward the subject while the horizon rolls into a ±0.3rad dutch tilt — mounting unease.',
  track: true,
  generate(ctx) {
    const cam: P3 = { x: ctx.camera.x, y: ctx.camera.y, z: ctx.camera.z }
    const ts = times(7, ctx.duration)
    const s0 = ctx.subjectAt(0)
    const startAim = aimPoint(s0, ctx.subjectHeight)
    const startDist = Math.max(planarDist(cam, startAim), 0.5)
    const endDist = 2
    const bearing = headingOf({ x: cam.x - startAim.x, y: 0, z: cam.z - startAim.z })
    const dir = forward(bearing)
    const airborne = isAirborne(ctx)
    return build(
      ts.map((t) => {
        const u = t / ctx.duration
        const s = ctx.subjectAt(t)
        const target = aimPoint(s, ctx.subjectHeight)
        const d = startDist + (endDist - startDist) * u
        const y = ctx.camera.y + (target.y - ctx.camera.y) * u * 0.4
        return {
          t,
          pos: { x: target.x + dir.x * d, y, z: target.z + dir.z * d },
          aimAt: target,
          focalLength: ctx.camera.focalLength,
          roll: 0.3 * u
        }
      }),
      airborne
    )
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CAMERA_MOVE_PRESETS: CameraMovePreset[] = [
  // push & pull
  slowPushIn,
  crashIn,
  pullBackReveal,
  creepInLow,
  // orbit & arc
  orbit90Left,
  orbit90Right,
  orbit180,
  orbit360,
  arcAndPush,
  orbit45Low,
  orbit45High,
  // crane & boom
  craneUpReveal,
  craneDownIntro,
  pedestalUp,
  boomOver,
  spiralInDescend,
  spiralOutAscend,
  pedestalUpSlow,
  // aerial
  droneRisePullback,
  flyover,
  droneOrbitHigh,
  topDownDescend,
  overheadTrackFollow,
  droneStrafeReveal,
  // follow
  followBehind,
  leadTheSubject,
  sideTrackLeft,
  sideTrackRight,
  leadFollowFront,
  lowLeadTiltUp,
  sideDollyPast,
  // pan & scan
  staticPanAcross,
  whipPan,
  slowTiltReveal,
  // stylized
  vertigoDollyZoom,
  dutchOrbit,
  snapZoomPunch,
  crashZoomOut,
  pushInDutchRoll
]
