/**
 * Crowd & sequence director: one-click choreographed groups. Generates the
 * ENTITIES (people, cars) and their TRACKS (marks with gaits, altitude, and
 * joint keyframes) for a whole staged sequence — a 20-dancer number, a bar
 * brawl, a foot chase, a car chase — which the app drops into the scene as
 * a single undoable step. Everything stays editable afterwards: each
 * performer is a normal entity with normal marks.
 *
 * Pure module (no DOM/three/Electron, no randomness) — variation comes from
 * per-index trigonometry so the same options always stage the same crowd.
 */

import { MOTION_PRESETS, type MotionPreset } from './motions'

export type SequenceType = 'dance' | 'fight' | 'footChase' | 'carChase'

export interface SequenceOptions {
  type: SequenceType
  /** How many performers (clamped 2–60). */
  count: number
  /**
   * Per type: dance → a dance MotionPreset id or 'mixed'; fight → 'paired'
   * or 'mob'; footChase → 'straight' or 'weaving'; carChase → 'pursuit' or
   * 'weaving'.
   */
  style: string
  /** Where to stage it and which way the sequence faces/travels. */
  origin: { x: number; z: number; heading: number }
  /** Shot duration — choreography fills it. */
  duration: number
}

export interface SequenceMarkSpec {
  time: number
  position: { x: number; y: number; z: number }
  gait: 'walk' | 'jog' | 'run' | 'stand'
  easeIn: number
  easeOut: number
  hold: number
  joints?: Record<string, number>
}

export interface SequenceEntitySpec {
  assetId: string
  name: string
  position: { x: number; y: number; z: number }
  rotationY: number
  label?: { text: string; color: string }
  marks: SequenceMarkSpec[]
}

/** Hard cap so a 60-dancer number can't explode the timeline. */
const MAX_MARKS_PER_ENTITY = 40

const clampCount = (n: number): number => Math.max(2, Math.min(60, Math.round(n)))

/** Rotate a local offset (right = +lx, forward = +lz) into world space. */
function place(
  origin: { x: number; z: number; heading: number },
  lx: number,
  lz: number
): { x: number; z: number } {
  const cos = Math.cos(origin.heading)
  const sin = Math.sin(origin.heading)
  // right(θ) = (cosθ, 0, -sinθ); forward(θ) = (-sinθ, 0, -cosθ)
  return {
    x: origin.x + lx * cos - lz * sin,
    z: origin.z - lx * sin - lz * cos
  }
}

/** Deterministic per-index jitter in [-1, 1]. */
const jitter = (i: number, salt: number): number => Math.sin(i * 12.9898 + salt * 78.233) % 1

function dancePresets(): MotionPreset[] {
  return MOTION_PRESETS.filter((p) => p.category === 'dance')
}

function fightPresets(ids: string[], fallback: string[]): MotionPreset[] {
  const found = ids
    .map((id) => MOTION_PRESETS.find((p) => p.id === id))
    .filter((p): p is MotionPreset => !!p)
  if (found.length > 0) return found
  return fallback
    .map((id) => MOTION_PRESETS.find((p) => p.id === id))
    .filter((p): p is MotionPreset => !!p)
}

/**
 * Lay a motion's keyframes down as joint marks starting at `startT`,
 * looping to fill the window. Keyframe `move` offsets (jumps, crawls) are
 * applied relative to `pos` along `heading`. Returns the time it finished.
 */
function appendMotion(
  marks: SequenceMarkSpec[],
  preset: MotionPreset,
  pos: { x: number; y: number; z: number },
  startT: number,
  endT: number,
  heading = 0
): number {
  let t = startT
  const cycle = preset.duration + (preset.loop ? 0.05 : 0.4)
  const fwd = { x: -Math.sin(heading), z: -Math.cos(heading) }
  while (t <= endT + 1e-6 && marks.length < MAX_MARKS_PER_ENTITY) {
    for (const kf of preset.keyframes) {
      const time = t + kf.t
      if (time > endT + 1e-6 || marks.length >= MAX_MARKS_PER_ENTITY) break
      const forward = kf.move?.forward ?? 0
      const up = kf.move?.up ?? 0
      marks.push({
        time,
        position: {
          x: pos.x + fwd.x * forward,
          y: Math.max(0, pos.y + up),
          z: pos.z + fwd.z * forward
        },
        gait: 'stand',
        easeIn: 0,
        easeOut: 0,
        hold: 0,
        joints: { ...kf.joints }
      })
    }
    if (!preset.loop && t + cycle + preset.duration > endT) break
    t += cycle
  }
  return t
}

/* ------------------------------- dance --------------------------------- */

function danceSequence(opts: SequenceOptions): SequenceEntitySpec[] {
  const count = clampCount(opts.count)
  const styles = dancePresets()
  const chosen =
    opts.style === 'mixed' ? null : (styles.find((p) => p.id === opts.style) ?? styles[0] ?? null)
  const out: SequenceEntitySpec[] = []
  const cols = Math.min(6, Math.ceil(Math.sqrt(count * 1.4)))
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const rowWidth = Math.min(cols, count - row * cols)
    const lx = (col - (rowWidth - 1) / 2) * 1.8 + jitter(i, 1) * 0.15
    const lz = -row * 2.0 + jitter(i, 2) * 0.15
    const pos3 = place(opts.origin, lx, lz)
    const preset = chosen ?? styles[i % Math.max(1, styles.length)]!
    const marks: SequenceMarkSpec[] = []
    if (preset) {
      // Ripple: back rows start a beat later — reads as staged choreography.
      const ripple = row * 0.12
      appendMotion(marks, preset, { x: pos3.x, y: 0, z: pos3.z }, ripple, opts.duration)
    }
    out.push({
      assetId: i % 2 === 0 ? 'person.man' : 'person.woman',
      name: `Dancer ${i + 1}`,
      position: { x: pos3.x, y: 0, z: pos3.z },
      rotationY: opts.origin.heading,
      marks
    })
  }
  return out
}

/* ------------------------------- fight --------------------------------- */

function fightSequence(opts: SequenceOptions): SequenceEntitySpec[] {
  const count = clampCount(opts.count)
  const strikes = fightPresets(
    ['jab-cross', 'roundhouse-kick', 'haymaker', 'uppercut', 'front-kick-combo', 'high-kick'],
    ['jab-cross', 'haymaker', 'uppercut', 'high-kick']
  )
  const reactions = fightPresets(
    ['hit-reaction-head', 'hit-reaction-body', 'stumble-back-fall', 'block-and-dodge'],
    ['block-and-dodge', 'knocked-down']
  )
  const out: SequenceEntitySpec[] = []

  if (opts.style === 'mob') {
    // One defender in the middle, everyone else circles in and strikes.
    const center = place(opts.origin, 0, 0)
    const defender: SequenceEntitySpec = {
      assetId: 'person.man',
      name: 'Defender',
      position: { x: center.x, y: 0, z: center.z },
      rotationY: opts.origin.heading,
      label: { text: 'HERO', color: '#3b82f6' },
      marks: []
    }
    // Dodges through most of it, goes down near the end.
    const dodge = reactions.find((p) => p.id === 'block-and-dodge') ?? reactions[0]
    const fall =
      reactions.find((p) => p.id === 'stumble-back-fall') ??
      fightPresets(['knocked-down'], ['knocked-down'])[0]
    if (dodge) {
      const downAt = Math.max(1, opts.duration - (fall?.duration ?? 1.5) - 0.2)
      appendMotion(defender.marks, dodge, defender.position, 0, downAt)
      if (fall) appendMotion(defender.marks, fall, defender.position, downAt + 0.1, opts.duration)
    }
    out.push(defender)
    for (let i = 1; i < count; i++) {
      const angle = (i / (count - 1)) * Math.PI * 2
      const r = 1.5 + (i % 3) * 0.7
      const pos = place(opts.origin, Math.sin(angle) * r, Math.cos(angle) * r)
      const facing = Math.atan2(-(center.x - pos.x), -(center.z - pos.z))
      const strike = strikes[i % strikes.length]!
      const marks: SequenceMarkSpec[] = []
      appendMotion(marks, strike, { x: pos.x, y: 0, z: pos.z }, (i - 1) * 0.35, opts.duration)
      out.push({
        assetId: i % 2 === 0 ? 'person.man' : 'person.woman',
        name: `Attacker ${i}`,
        position: { x: pos.x, y: 0, z: pos.z },
        rotationY: facing,
        marks
      })
    }
    return out
  }

  // Paired brawl: clusters of duels scattered around the origin.
  const pairs = Math.floor(count / 2)
  for (let p = 0; p < pairs; p++) {
    const clusterAngle = p * 2.399963 // golden angle — even, non-grid scatter
    const clusterR = p === 0 ? 0 : 1.6 + 1.35 * Math.sqrt(p)
    const cx = Math.sin(clusterAngle) * clusterR
    const cz = Math.cos(clusterAngle) * clusterR
    // Each duel fights along its own local axis so the brawl reads chaotic.
    const duelAxis = jitter(p, 3) * Math.PI
    const half = 0.7
    const a = place(opts.origin, cx + Math.sin(duelAxis) * half, cz + Math.cos(duelAxis) * half)
    const b = place(opts.origin, cx - Math.sin(duelAxis) * half, cz - Math.cos(duelAxis) * half)
    const faceAB = Math.atan2(-(b.x - a.x), -(b.z - a.z))
    const faceBA = faceAB + Math.PI
    const strike = strikes[p % strikes.length]!
    const reaction = reactions[p % reactions.length]!
    const offset = (p % 4) * 0.3

    const attacker: SequenceEntitySpec = {
      assetId: p % 2 === 0 ? 'person.man' : 'person.woman',
      name: `Fighter ${p * 2 + 1}`,
      position: { x: a.x, y: 0, z: a.z },
      rotationY: faceAB,
      marks: []
    }
    appendMotion(attacker.marks, strike, attacker.position, offset, opts.duration)

    const defender: SequenceEntitySpec = {
      assetId: p % 2 === 0 ? 'person.woman' : 'person.man',
      name: `Fighter ${p * 2 + 2}`,
      position: { x: b.x, y: 0, z: b.z },
      rotationY: faceBA,
      marks: []
    }
    // Reactions land a beat after the strikes start.
    appendMotion(defender.marks, reaction, defender.position, offset + strike.duration * 0.5, opts.duration)
    out.push(attacker, defender)
  }
  // Odd one out spectates, cheering.
  if (count % 2 === 1) {
    const pos = place(opts.origin, 0, 2.5)
    const cheer = fightPresets(['cheer-jump', 'arms-up-party'], ['arms-up-party'])[0]
    const spectator: SequenceEntitySpec = {
      assetId: 'person.man',
      name: 'Spectator',
      position: { x: pos.x, y: 0, z: pos.z },
      rotationY: opts.origin.heading + Math.PI,
      marks: []
    }
    if (cheer) appendMotion(spectator.marks, cheer, spectator.position, 0.5, opts.duration)
    out.push(spectator)
  }
  return out
}

/* ----------------------------- foot chase ------------------------------ */

function footChaseSequence(opts: SequenceOptions): SequenceEntitySpec[] {
  const count = clampCount(opts.count)
  const runSpeed = 5.2
  const length = Math.min(70, runSpeed * opts.duration * 0.9)
  const weaving = opts.style === 'weaving'
  const out: SequenceEntitySpec[] = []
  for (let i = 0; i < count; i++) {
    // Leader out front; pursuers in a staggered wedge behind.
    const backset = i === 0 ? 0 : 2.2 + i * 1.6
    const lateral = i === 0 ? 0 : jitter(i, 4) * 1.6
    const startL = place(opts.origin, lateral, -0 - backset)
    const marks: SequenceMarkSpec[] = []
    const steps = 5
    for (let s2 = 0; s2 <= steps; s2++) {
      const f = s2 / steps
      const along = f * length - backset
      const wob = weaving ? Math.sin(f * Math.PI * 2 + i * 0.9) * 2.2 : 0
      const p = place(opts.origin, lateral + wob, along)
      marks.push({
        time: f * opts.duration,
        position: { x: s2 === 0 ? startL.x : p.x, y: 0, z: s2 === 0 ? startL.z : p.z },
        gait: 'run',
        easeIn: s2 === steps ? 0.25 : 0,
        easeOut: s2 === 0 ? 0.25 : 0,
        hold: 0
      })
    }
    out.push({
      assetId: i % 2 === 0 ? 'person.man' : 'person.woman',
      name: i === 0 ? 'Runner' : `Pursuer ${i}`,
      position: { x: startL.x, y: 0, z: startL.z },
      rotationY: opts.origin.heading,
      label: i === 0 ? { text: 'RUNNER', color: '#e5484d' } : undefined,
      marks
    })
  }
  return out
}

/* ------------------------------ car chase ------------------------------ */

const CHASE_CARS = ['vehicle.sedan', 'vehicle.suv', 'vehicle.pickup', 'vehicle.van']

function carChaseSequence(opts: SequenceOptions): SequenceEntitySpec[] {
  const count = clampCount(opts.count)
  const speed = 17
  const length = Math.min(160, speed * opts.duration * 0.9)
  const weaving = opts.style === 'weaving'
  const out: SequenceEntitySpec[] = []
  for (let i = 0; i < count; i++) {
    const backset = i * 7.5
    const lane = i === 0 ? 0 : ((i % 3) - 1) * 2.6
    const start = place(opts.origin, lane, -backset)
    const marks: SequenceMarkSpec[] = []
    const steps = 5
    for (let s2 = 0; s2 <= steps; s2++) {
      const f = s2 / steps
      const along = f * length - backset
      const wob = weaving ? Math.sin(f * Math.PI * 2.5 + i * 1.3) * 2.8 : lane * (1 - f * 0.3)
      const p = place(opts.origin, i === 0 && !weaving ? 0 : wob, along)
      marks.push({
        time: f * opts.duration,
        position: { x: s2 === 0 ? start.x : p.x, y: 0, z: s2 === 0 ? start.z : p.z },
        gait: 'run',
        easeIn: 0,
        easeOut: s2 === 0 ? 0.25 : 0,
        hold: 0
      })
    }
    out.push({
      assetId: CHASE_CARS[i % CHASE_CARS.length]!,
      name: i === 0 ? 'Lead car' : `Chase car ${i}`,
      position: { x: start.x, y: 0, z: start.z },
      rotationY: opts.origin.heading,
      label: i === 0 ? { text: 'LEAD', color: '#e5484d' } : undefined,
      marks
    })
  }
  return out
}

/* -------------------------------- entry -------------------------------- */

/** Styles offered per sequence type (dance styles come from the library). */
export function sequenceStyles(type: SequenceType): { id: string; name: string }[] {
  switch (type) {
    case 'dance':
      return [
        { id: 'mixed', name: 'Mixed styles' },
        ...dancePresets().map((p) => ({ id: p.id, name: p.name }))
      ]
    case 'fight':
      return [
        { id: 'paired', name: 'Paired brawl' },
        { id: 'mob', name: 'Mob vs one' }
      ]
    case 'footChase':
    case 'carChase':
      return [
        { id: 'straight', name: 'Straight pursuit' },
        { id: 'weaving', name: 'Weaving' }
      ]
  }
}

/**
 * Choreograph ONE performer with a motion preset at a fixed spot — used to
 * restyle already-staged performers (swap the dance, change the strike)
 * without restaging the crowd. Returns null for unknown preset ids.
 */
export function choreographMotion(
  presetId: string,
  pos: { x: number; y: number; z: number },
  heading: number,
  duration: number,
  startT = 0
): SequenceMarkSpec[] | null {
  const preset = MOTION_PRESETS.find((p) => p.id === presetId)
  if (!preset) return null
  const marks: SequenceMarkSpec[] = []
  appendMotion(marks, preset, pos, startT, duration, heading)
  return marks
}

export function generateSequence(opts: SequenceOptions): SequenceEntitySpec[] {
  switch (opts.type) {
    case 'dance':
      return danceSequence(opts)
    case 'fight':
      return fightSequence(opts)
    case 'footChase':
      return footChaseSequence(opts)
    case 'carChase':
      return carChaseSequence(opts)
  }
}
