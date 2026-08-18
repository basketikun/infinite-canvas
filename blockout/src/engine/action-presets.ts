/**
 * Action-path preset library for Blockout — one-click motion paths for
 * NON-character performers: planes, helicopters, birds, cars, falling debris.
 *
 * The app calls `preset.generate(ctx)` and converts the returned
 * `ActionMarkSpec[]` into `ActorMark`s on the entity's track — position paths
 * with altitude that the evaluator interpolates (Catmull-Rom), while flying /
 * wheeled assets animate wings / rotors / wheels from the gait + speed. This is
 * how a user stages "a plane lands and taxis to a stop" or "a chunk of building
 * falls" in a single click.
 *
 * Presets are PURE data-shaping functions. They take the entity's current pose
 * (paths start from HERE) plus a duration and return a short, well-shaped list
 * of marks. No subject sampler — an action performer IS the thing that moves.
 *
 * Math conventions (must match the engine):
 *   - Meters. +X right, −Z forward. heading 0 faces −Z.
 *   - forward(θ) = (−sinθ, 0, −cosθ). Paths extend along ctx.start.heading's
 *     forward direction (the user aims the entity, then applies the action).
 *   - y is ALTITUDE (0 = ground); the evaluator preserves each mark's y.
 *   - First mark at t=0 EXACTLY at ctx.start, last at t=duration. 5–10 marks.
 *   - gait maps to animation intensity: 'run' = fast (rotor blur / fast wing
 *     flap / wheel spin), 'walk' = moderate, 'stand' = stopped. Use 'run' while
 *     airborne / fast, ease to 'walk' then 'stand' + hold for stops.
 *   - easeIn/easeOut 0.25 only where a move starts / ends gently (a landing
 *     rolls to a stop: big easeIn on the last mark); else 0. hold 0 except
 *     where a stop parks the entity.
 *
 * Pure module: imports only heading math from './path' and types from './types'
 * are unnecessary here (specs are self-contained). No DOM/three/Electron, no
 * Math.random / Date.now — variation comes from fixed constants.
 */

export interface ActionContext {
  /** Entity's current pose — paths start from HERE. */
  start: { x: number; y: number; z: number; heading: number }
  duration: number
}

export interface ActionMarkSpec {
  time: number
  position: { x: number; y: number; z: number }
  gait: 'walk' | 'jog' | 'run' | 'stand'
  easeIn: number
  easeOut: number
  hold: number
}

export type ActionCategory =
  | 'aircraft'
  | 'helicopter'
  | 'bird'
  | 'vehicle'
  | 'destruction'
  | 'object'
  | 'person'
  | 'animal'

export interface ActionPreset {
  id: string
  name: string
  category: ActionCategory
  /** One line: what happens, filmmaker terms. */
  description: string
  /** Catalog-id hints for the UI ("best on: vehicle.plane") — informational only, any entity may use any preset. */
  suggestedAssets: string[]
  generate(ctx: ActionContext): ActionMarkSpec[]
}

// ---------------------------------------------------------------------------
// Small vector / path helpers (local, pure).
// ---------------------------------------------------------------------------

interface P3 {
  x: number
  y: number
  z: number
}

type Gait = ActionMarkSpec['gait']

/** Unit forward vector for a heading (heading 0 faces −Z). */
function forward(heading: number): P3 {
  return { x: -Math.sin(heading), y: 0, z: -Math.cos(heading) }
}

/** Unit rightward vector for a heading (right of forward). */
function right(heading: number): P3 {
  // Right of heading = forward(heading − π/2).
  return forward(heading - Math.PI / 2)
}

/**
 * Point offset from the start along the entity's forward / right axes, at an
 * absolute altitude y. `fwd` = meters forward, `side` = meters to the right.
 */
function at(ctx: ActionContext, fwd: number, side: number, y: number): P3 {
  const f = forward(ctx.start.heading)
  const r = right(ctx.start.heading)
  return {
    x: ctx.start.x + f.x * fwd + r.x * side,
    y,
    z: ctx.start.z + f.z * fwd + r.z * side
  }
}

interface MarkBuild {
  t: number
  pos: P3
  gait: Gait
  /** Gentle start/stop easing on this mark (defaults 0). */
  easeIn?: number
  easeOut?: number
  hold?: number
}

/**
 * Assemble an ActionMarkSpec list. Forces the FIRST mark to sit exactly at
 * ctx.start (t=0) and clamps every y ≥ 0 (altitude never goes below ground).
 * Times are taken verbatim from the builds (callers keep them increasing).
 */
function build(ctx: ActionContext, marks: MarkBuild[]): ActionMarkSpec[] {
  const out = marks.map((m) => ({
    time: m.t,
    position: { x: m.pos.x, y: Math.max(0, m.pos.y), z: m.pos.z },
    gait: m.gait,
    easeIn: m.easeIn ?? 0,
    easeOut: m.easeOut ?? 0,
    hold: m.hold ?? 0
  }))
  // Pin the first mark to the exact start pose at t=0.
  out[0] = {
    time: 0,
    position: { x: ctx.start.x, y: Math.max(0, ctx.start.y), z: ctx.start.z },
    gait: out[0]!.gait,
    easeIn: out[0]!.easeIn,
    easeOut: out[0]!.easeOut,
    hold: out[0]!.hold
  }
  return out
}

/** Even times from 0..duration for a given count of marks (count ≥ 2). */
function times(count: number, duration: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((duration * i) / (count - 1))
  return out
}

// ---------------------------------------------------------------------------
// AIRCRAFT
// ---------------------------------------------------------------------------

const planeTakeoff: ActionPreset = {
  id: 'plane-takeoff',
  name: 'Plane Takeoff',
  category: 'aircraft',
  description: 'Ground roll accelerating down the runway, rotate, then climb out to altitude.',
  suggestedAssets: ['vehicle.plane', 'aircraft.jet'],
  generate(ctx) {
    const ts = times(7, ctx.duration)
    // Accelerating ground roll (~30m) then a climb to ~18m; distance grows
    // quadratically for the roll, linearly once airborne.
    const rollEnd = 30
    const totalFwd = 70
    const climbTo = 18
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        // Forward distance: quadratic ease so it accelerates from rest.
        const fwd = totalFwd * u * u
        // Rotate off the ground once past ~40% of the roll distance.
        const airborneU = fwd <= rollEnd ? 0 : (fwd - rollEnd) / (totalFwd - rollEnd)
        const y = climbTo * airborneU
        return {
          t,
          pos: at(ctx, fwd, 0, y),
          gait: 'run' as Gait,
          easeIn: i === 0 ? 0.25 : 0
        }
      })
    )
  }
}

const planeLanding: ActionPreset = {
  id: 'plane-landing',
  name: 'Plane Landing',
  category: 'aircraft',
  description: 'Descend on approach from the current altitude, touch down, and roll out to a full stop.',
  suggestedAssets: ['vehicle.plane', 'aircraft.jet'],
  generate(ctx) {
    // Assumes the user placed the plane IN THE AIR. Descend along heading to
    // touchdown, then roll out to a stop with a big easeIn on the last mark.
    const startY = Math.max(ctx.start.y, 6)
    const approachFwd = 55 // horizontal distance over the descent
    const rollFwd = 25 // ground roll after touchdown
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
      { t: ctx.duration * 0.25, pos: at(ctx, approachFwd * 0.4, 0, startY * 0.55), gait: 'run' },
      { t: ctx.duration * 0.5, pos: at(ctx, approachFwd * 0.8, 0, startY * 0.18), gait: 'run' },
      // Touchdown.
      { t: ctx.duration * 0.62, pos: at(ctx, approachFwd, 0, 0), gait: 'run' },
      // Roll out, decelerating.
      { t: ctx.duration * 0.82, pos: at(ctx, approachFwd + rollFwd * 0.7, 0, 0), gait: 'walk' },
      { t: ctx.duration, pos: at(ctx, approachFwd + rollFwd, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
    ]
    return build(ctx, raw)
  }
}

const planeFlyby: ActionPreset = {
  id: 'plane-flyby',
  name: 'Plane Flyby',
  category: 'aircraft',
  description: 'A fast, level pass at the current altitude — clamps up to a safe minimum if started low.',
  suggestedAssets: ['vehicle.plane', 'aircraft.jet'],
  generate(ctx) {
    const alt = Math.max(ctx.start.y, 8)
    const ts = times(6, ctx.duration)
    const total = 90 // fast level pass
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        return { t, pos: at(ctx, total * u, 0, alt), gait: 'run' as Gait }
      })
    )
  }
}

const planeBankedCircle: ActionPreset = {
  id: 'plane-banked-circle',
  name: 'Plane Banked Circle',
  category: 'aircraft',
  description: 'One full banked circle at altitude, curving back to finish near where it started.',
  suggestedAssets: ['vehicle.plane', 'aircraft.jet'],
  generate(ctx) {
    const alt = Math.max(ctx.start.y, 8)
    const radius = 25
    const ts = times(9, ctx.duration)
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    // Circle whose center is `radius` to the right; entity starts at angle π
    // (left edge) and sweeps a full turn, returning to start.
    const cx = ctx.start.x + r.x * radius
    const cz = ctx.start.z + r.z * radius
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const ang = Math.PI - 2 * Math.PI * u // start at left edge, full CW sweep
        // Position on the circle in the forward/right basis.
        const side = radius + radius * Math.cos(ang) // 0 at start, back to 0
        const along = radius * Math.sin(ang)
        return {
          t,
          pos: {
            x: cx - r.x * radius + r.x * side + f.x * along,
            y: alt,
            z: cz - r.z * radius + r.z * side + f.z * along
          },
          gait: 'run' as Gait
        }
      })
    )
  }
}

const planeCrashDive: ActionPreset = {
  id: 'plane-crash-dive',
  name: 'Plane Crash Dive',
  category: 'aircraft',
  description: 'A steep dive from altitude down to ground contact, then a short skid to a stop.',
  suggestedAssets: ['vehicle.plane', 'aircraft.jet'],
  generate(ctx) {
    const startY = Math.max(ctx.start.y, 8)
    const diveFwd = 45
    const skid = 10
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
      { t: ctx.duration * 0.3, pos: at(ctx, diveFwd * 0.45, 0, startY * 0.55), gait: 'run' },
      { t: ctx.duration * 0.55, pos: at(ctx, diveFwd * 0.85, 0, startY * 0.15), gait: 'run' },
      // Ground contact.
      { t: ctx.duration * 0.65, pos: at(ctx, diveFwd, 0, 0), gait: 'run' },
      // Skid, decelerating.
      { t: ctx.duration * 0.85, pos: at(ctx, diveFwd + skid * 0.7, 0, 0), gait: 'walk' },
      { t: ctx.duration, pos: at(ctx, diveFwd + skid, 0, 0), gait: 'stand', easeIn: 0.25, hold: 0.5 }
    ]
    return build(ctx, raw)
  }
}

// ---------------------------------------------------------------------------
// HELICOPTER
// ---------------------------------------------------------------------------

const heliTakeoff: ActionPreset = {
  id: 'heli-takeoff',
  name: 'Helicopter Takeoff',
  category: 'helicopter',
  description: 'A vertical lift-off to ~12m with a slight forward drift as it climbs.',
  suggestedAssets: ['vehicle.helicopter', 'aircraft.helicopter'],
  generate(ctx) {
    const climbTo = 12
    const drift = 6
    const ts = times(6, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        // Ease the rise so it lifts gently then accelerates up.
        const y = ctx.start.y + climbTo * (u * u * (3 - 2 * u))
        return {
          t,
          pos: at(ctx, drift * u, 0, y),
          gait: 'run' as Gait,
          easeIn: i === 0 ? 0.25 : 0
        }
      })
    )
  }
}

const heliLanding: ActionPreset = {
  id: 'heli-landing',
  name: 'Helicopter Landing',
  category: 'helicopter',
  description: 'Descend from the current altitude, settle onto the ground, and spin down to a stop.',
  suggestedAssets: ['vehicle.helicopter', 'aircraft.helicopter'],
  generate(ctx) {
    // Clamp: if started on the ground, rise first then land.
    const groundStart = ctx.start.y < 2
    const peakY = groundStart ? 10 : ctx.start.y
    const raw: MarkBuild[] = groundStart
      ? [
          { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
          { t: ctx.duration * 0.3, pos: at(ctx, 3, 0, peakY), gait: 'run' },
          { t: ctx.duration * 0.55, pos: at(ctx, 6, 0, peakY * 0.6), gait: 'run' },
          { t: ctx.duration * 0.8, pos: at(ctx, 8, 0, peakY * 0.15), gait: 'walk' },
          { t: ctx.duration, pos: at(ctx, 8, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
        ]
      : [
          { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
          { t: ctx.duration * 0.3, pos: at(ctx, 3, 0, peakY * 0.6), gait: 'run' },
          { t: ctx.duration * 0.6, pos: at(ctx, 6, 0, peakY * 0.25), gait: 'run' },
          { t: ctx.duration * 0.82, pos: at(ctx, 7, 0, peakY * 0.06), gait: 'walk' },
          { t: ctx.duration, pos: at(ctx, 7, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
        ]
    return build(ctx, raw)
  }
}

const heliOrbit: ActionPreset = {
  id: 'heli-orbit',
  name: 'Helicopter Orbit',
  category: 'helicopter',
  description: 'Circle a point of interest at the current altitude — the classic circling news chopper.',
  suggestedAssets: ['vehicle.helicopter', 'aircraft.helicopter'],
  generate(ctx) {
    const alt = Math.max(ctx.start.y, 8)
    const radius = 15
    const ts = times(9, ctx.duration)
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const ang = Math.PI - 2 * Math.PI * u
        const side = radius + radius * Math.cos(ang)
        const along = radius * Math.sin(ang)
        return {
          t,
          pos: {
            x: ctx.start.x + r.x * side + f.x * along,
            y: alt,
            z: ctx.start.z + r.z * side + f.z * along
          },
          gait: 'run' as Gait
        }
      })
    )
  }
}

const heliHoverHold: ActionPreset = {
  id: 'heli-hover-hold',
  name: 'Helicopter Hover Hold',
  category: 'helicopter',
  description: 'Hold position with a tiny drift as the rotors keep spinning — a hovering standby.',
  suggestedAssets: ['vehicle.helicopter', 'aircraft.helicopter'],
  generate(ctx) {
    const alt = Math.max(ctx.start.y, 0)
    const d = 0.6 // ±0.6m deterministic drift box
    // A small square-ish drift loop around start. Stays 'run' throughout.
    const offsets: Array<[number, number, number]> = [
      [0, 0, 0],
      [d, d * 0.5, d * 0.4],
      [0.2, -d, -d * 0.3],
      [-d, 0.3, d * 0.2],
      [-0.2, d * 0.6, -d * 0.5],
      [0, 0, 0]
    ]
    const ts = times(offsets.length, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const [side, up, fwd] = offsets[i]!
        return { t, pos: at(ctx, fwd, side, alt + up), gait: 'run' as Gait }
      })
    )
  }
}

// ---------------------------------------------------------------------------
// BIRD
// ---------------------------------------------------------------------------

const birdCircleSoar: ActionPreset = {
  id: 'bird-circle-soar',
  name: 'Bird Circle Soar',
  category: 'bird',
  description: 'Lazy circles on a thermal, drifting gently upward — a hawk riding the air.',
  suggestedAssets: ['animal.bird'],
  generate(ctx) {
    const baseY = Math.max(ctx.start.y, 6)
    const radius = 12
    const climb = 5
    const ts = times(9, ctx.duration)
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const ang = Math.PI - 2 * Math.PI * u
        const side = radius + radius * Math.cos(ang)
        const along = radius * Math.sin(ang)
        return {
          t,
          pos: {
            x: ctx.start.x + r.x * side + f.x * along,
            y: baseY + climb * u,
            z: ctx.start.z + r.z * side + f.z * along
          },
          gait: 'walk' as Gait // moderate flap while soaring
        }
      })
    )
  }
}

const birdSwoop: ActionPreset = {
  id: 'bird-swoop',
  name: 'Bird Swoop',
  category: 'bird',
  description: 'A dive toward the ground ahead, a low skim, then a climb back up — a hunting stoop.',
  suggestedAssets: ['animal.bird'],
  generate(ctx) {
    const startY = Math.max(ctx.start.y, 8)
    const skimY = 0.4 // low skim, stays clear of the ground
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
      { t: ctx.duration * 0.3, pos: at(ctx, 14, 0, startY * 0.4), gait: 'run' },
      // Skim near the ground.
      { t: ctx.duration * 0.5, pos: at(ctx, 24, 0, skimY), gait: 'run' },
      { t: ctx.duration * 0.7, pos: at(ctx, 34, 0, startY * 0.5), gait: 'run' },
      { t: ctx.duration, pos: at(ctx, 46, 0, startY), gait: 'walk' }
    ]
    return build(ctx, raw)
  }
}

const birdFlockPass: ActionPreset = {
  id: 'bird-flock-pass',
  name: 'Bird Flock Pass',
  category: 'bird',
  description: 'A fast, gently-waving S-path across the frame — a flock cutting through the air.',
  suggestedAssets: ['animal.bird'],
  generate(ctx) {
    const alt = Math.max(ctx.start.y, 5)
    const total = 32
    const wave = 4 // side-to-side amplitude
    const ts = times(8, ctx.duration)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const side = wave * Math.sin(u * Math.PI * 2)
        return { t, pos: at(ctx, total * u, side, alt), gait: 'run' as Gait }
      })
    )
  }
}

// ---------------------------------------------------------------------------
// VEHICLE
// ---------------------------------------------------------------------------

const carChaseWeave: ActionPreset = {
  id: 'car-chase-weave',
  name: 'Car Chase Weave',
  category: 'vehicle',
  description: 'A fast run forward with hard S-weaves — dodging through traffic in a chase.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.pickup'],
  generate(ctx) {
    const total = 70
    const wave = 3
    const ts = times(8, ctx.duration)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const side = wave * Math.sin(u * Math.PI * 3)
        return { t, pos: at(ctx, total * u, side, 0), gait: 'run' as Gait }
      })
    )
  }
}

const carDriftTurn: ActionPreset = {
  id: 'car-drift-turn',
  name: 'Car Drift Turn',
  category: 'vehicle',
  description: 'A fast approach into a sharp 90° turn on a wide drifting arc.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.motorcycle'],
  generate(ctx) {
    // Approach forward, then arc 90° to the right (heading derived from travel).
    const approach = 30
    const arcR = 14
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    // Arc center is to the right of the apex.
    const apex = {
      x: ctx.start.x + f.x * approach,
      z: ctx.start.z + f.z * approach
    }
    const cx = apex.x + r.x * arcR
    const cz = apex.z + r.z * arcR
    const raw: MarkBuild[] = []
    raw.push({ t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 })
    raw.push({ t: ctx.duration * 0.35, pos: at(ctx, approach, 0, 0), gait: 'run' })
    // Quarter-circle arc from apex (angle π from center along −right) sweeping
    // toward forward+right becoming the new heading.
    const arcSteps = 3
    for (let k = 1; k <= arcSteps; k++) {
      const u = k / arcSteps
      const ang = Math.PI - (Math.PI / 2) * u // π → π/2
      const px = cx + r.x * arcR * Math.cos(ang) + f.x * arcR * Math.sin(ang)
      const pz = cz + r.z * arcR * Math.cos(ang) + f.z * arcR * Math.sin(ang)
      raw.push({
        t: ctx.duration * (0.35 + 0.65 * u),
        pos: { x: px, y: 0, z: pz },
        gait: u >= 1 ? 'walk' : 'run',
        easeOut: u >= 1 ? 0.25 : 0
      })
    }
    return build(ctx, raw)
  }
}

const carScreechStop: ActionPreset = {
  id: 'car-screech-stop',
  name: 'Car Screech Stop',
  category: 'vehicle',
  description: 'A fast approach into a hard braking stop — tires screech, car parks dead.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.pickup'],
  generate(ctx) {
    const total = 55
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 },
      { t: ctx.duration * 0.4, pos: at(ctx, total * 0.45, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.7, pos: at(ctx, total * 0.85, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.88, pos: at(ctx, total * 0.98, 0, 0), gait: 'walk' },
      // Hard stop: big easeIn, park with a hold.
      { t: ctx.duration, pos: at(ctx, total, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1.5 }
    ]
    return build(ctx, raw)
  }
}

const carPullUpPark: ActionPreset = {
  id: 'car-pull-up-park',
  name: 'Car Pull-Up & Park',
  category: 'vehicle',
  description: 'A moderate approach curving to the side and easing to a parked stop at the curb.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.van'],
  generate(ctx) {
    const total = 32
    const sideOff = 5 // curve to the right into the "curb"
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'walk', easeIn: 0.25 },
      { t: ctx.duration * 0.35, pos: at(ctx, total * 0.4, 0, 0), gait: 'walk' },
      { t: ctx.duration * 0.65, pos: at(ctx, total * 0.75, sideOff * 0.5, 0), gait: 'walk' },
      { t: ctx.duration * 0.85, pos: at(ctx, total * 0.95, sideOff, 0), gait: 'walk' },
      { t: ctx.duration, pos: at(ctx, total, sideOff, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
    ]
    return build(ctx, raw)
  }
}

const carReverseEscape: ActionPreset = {
  id: 'car-reverse-escape',
  name: 'Car Reverse Escape',
  category: 'vehicle',
  description: 'A beat of stillness, then reverse hard and swing 180° into a getaway J-turn.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.pickup'],
  generate(ctx) {
    // Position-only path; heading is derived from travel so the swing reads as
    // a J-turn. Pause, reverse back along −heading, then arc 180° and drive off
    // the way it came.
    const back = 22 // reverse distance
    const arcR = 8
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    // Reverse point (behind start).
    const rev = { x: ctx.start.x - f.x * back, z: ctx.start.z - f.z * back }
    // Swing 180° around a center to the right of the reverse point, then the
    // car ends up facing +forward again, driving forward past the start.
    const cx = rev.x + r.x * arcR
    const cz = rev.z + r.z * arcR
    const raw: MarkBuild[] = []
    raw.push({ t: 0, pos: at(ctx, 0, 0, 0), gait: 'stand', hold: 0.5 })
    // Short pause hold captured by the first mark; begin reversing.
    raw.push({ t: ctx.duration * 0.15, pos: at(ctx, 0, 0, 0), gait: 'stand' })
    raw.push({ t: ctx.duration * 0.45, pos: { x: rev.x, y: 0, z: rev.z }, gait: 'run' })
    // 180° arc around center: from angle π (reverse point side) to angle 0.
    const arcSteps = 2
    for (let k = 1; k <= arcSteps; k++) {
      const u = k / arcSteps
      const ang = Math.PI - Math.PI * u
      const px = cx + r.x * arcR * Math.cos(ang)
      const pz = cz + r.z * arcR * Math.cos(ang)
      // Push slightly forward as it swings around.
      const along = arcR * Math.sin(ang)
      raw.push({
        t: ctx.duration * (0.45 + 0.35 * u),
        pos: { x: px + f.x * along, y: 0, z: pz + f.z * along },
        gait: 'run'
      })
    }
    // Drive away forward past the original start.
    raw.push({ t: ctx.duration, pos: at(ctx, 18, 0, 0), gait: 'run', easeOut: 0.25 })
    return build(ctx, raw)
  }
}

const motorcycleWeave: ActionPreset = {
  id: 'motorcycle-weave',
  name: 'Motorcycle Weave',
  category: 'vehicle',
  description: 'A fast run forward with tight, quick S-weaves — a bike threading between traffic.',
  suggestedAssets: ['vehicle.motorcycle', 'vehicle.sedan'],
  generate(ctx) {
    // Like car-chase-weave but tighter amplitude, higher frequency, faster.
    const total = 90
    const wave = 2
    const ts = times(10, ctx.duration)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const side = wave * Math.sin(u * Math.PI * 5)
        return { t, pos: at(ctx, total * u, side, 0), gait: 'run' as Gait }
      })
    )
  }
}

const boatWakeTurn: ActionPreset = {
  id: 'boat-wake-turn',
  name: 'Boat Wake Turn',
  category: 'vehicle',
  description: 'A fast run forward carving into a wide banked turn, throwing a long wake — still moving at the end.',
  suggestedAssets: ['vehicle.boat'],
  generate(ctx) {
    // Approach forward, then a wide 90° banked arc (heading derived from travel).
    const approach = 40
    const arcR = 25
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    const apex = {
      x: ctx.start.x + f.x * approach,
      z: ctx.start.z + f.z * approach
    }
    const cx = apex.x + r.x * arcR
    const cz = apex.z + r.z * arcR
    const raw: MarkBuild[] = []
    raw.push({ t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 })
    raw.push({ t: ctx.duration * 0.4, pos: at(ctx, approach, 0, 0), gait: 'run' })
    const arcSteps = 4
    for (let k = 1; k <= arcSteps; k++) {
      const u = k / arcSteps
      const ang = Math.PI - (Math.PI / 2) * u // π → π/2, a quarter turn
      const px = cx + r.x * arcR * Math.cos(ang) + f.x * arcR * Math.sin(ang)
      const pz = cz + r.z * arcR * Math.cos(ang) + f.z * arcR * Math.sin(ang)
      raw.push({
        t: ctx.duration * (0.4 + 0.6 * u),
        pos: { x: px, y: 0, z: pz },
        // Eases from a plane to a cruise but never fully stops (still leaving wake).
        gait: u >= 1 ? 'walk' : 'run'
      })
    }
    return build(ctx, raw)
  }
}

const trainPassThrough: ActionPreset = {
  id: 'train-pass-through',
  name: 'Train Pass-Through',
  category: 'vehicle',
  description: 'A long, steady, straight high-speed pass along the heading — a train roaring through frame.',
  suggestedAssets: ['vehicle.train'],
  generate(ctx) {
    const total = 120 // long, fast, dead straight
    const ts = times(7, ctx.duration)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        return { t, pos: at(ctx, total * u, 0, 0), gait: 'run' as Gait }
      })
    )
  }
}

const carJumpRamp: ActionPreset = {
  id: 'car-jump-ramp',
  name: 'Car Jump Ramp',
  category: 'vehicle',
  description: 'Approach, launch off a ramp into a ballistic arc peaking a few metres up, land and roll to a settle.',
  suggestedAssets: ['vehicle.sedan', 'vehicle.suv', 'vehicle.pickup'],
  generate(ctx) {
    const approach = 20 // ground approach to the ramp
    const airFwd = 24 // horizontal distance while airborne
    const roll = 12 // roll-out after landing
    const peak = 3.5 // ballistic peak height (clear airborne peak)
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 },
      // Hit the ramp on the ground.
      { t: ctx.duration * 0.3, pos: at(ctx, approach, 0, 0), gait: 'run' },
      // Apex of the jump.
      { t: ctx.duration * 0.45, pos: at(ctx, approach + airFwd * 0.5, 0, peak), gait: 'run' },
      // Land.
      { t: ctx.duration * 0.6, pos: at(ctx, approach + airFwd, 0, 0), gait: 'run' },
      // Roll out, decelerating.
      { t: ctx.duration * 0.8, pos: at(ctx, approach + airFwd + roll * 0.7, 0, 0), gait: 'walk' },
      { t: ctx.duration, pos: at(ctx, approach + airFwd + roll, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
    ]
    return build(ctx, raw)
  }
}

const truckJackknifeStop: ActionPreset = {
  id: 'truck-jackknife-stop',
  name: 'Truck Jackknife Stop',
  category: 'vehicle',
  description: 'A fast approach into a hard braking stop that swings the tail out to one side, then parks.',
  suggestedAssets: ['vehicle.truck', 'vehicle.van'],
  generate(ctx) {
    const total = 60
    const swing = 6 // tail breaks out to the right near the stop
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 },
      { t: ctx.duration * 0.4, pos: at(ctx, total * 0.5, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.7, pos: at(ctx, total * 0.85, 0, 0), gait: 'run' },
      // Tail breaks out as it brakes hard.
      { t: ctx.duration * 0.85, pos: at(ctx, total * 0.96, swing * 0.5, 0), gait: 'walk' },
      // Parked, jackknifed to the side.
      { t: ctx.duration, pos: at(ctx, total, swing, 0), gait: 'stand', easeIn: 0.25, hold: 1.5 }
    ]
    return build(ctx, raw)
  }
}

// ---------------------------------------------------------------------------
// DESTRUCTION / OBJECT
// ---------------------------------------------------------------------------

const debrisFall: ActionPreset = {
  id: 'debris-fall',
  name: 'Debris Fall',
  category: 'destruction',
  description: 'A chunk falls with a slight outward arc, bounces once, and settles on the ground.',
  suggestedAssets: ['primitive.box', 'primitive.cylinder', 'prop.rubble'],
  generate(ctx) {
    if (ctx.start.y < 2) {
      // Ground-level topple: small outward arc and settle (no real fall height).
      const raw: MarkBuild[] = [
        { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
        { t: ctx.duration * 0.3, pos: at(ctx, 1.2, 0.4, 0.6), gait: 'run' },
        { t: ctx.duration * 0.6, pos: at(ctx, 2.4, 0.7, 0.15), gait: 'walk' },
        { t: ctx.duration * 0.8, pos: at(ctx, 2.9, 0.8, 0.05), gait: 'walk' },
        { t: ctx.duration, pos: at(ctx, 3.1, 0.9, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
      ]
      return build(ctx, raw)
    }
    // Elevated: fall with slight outward drift, bounce ~0.5m, settle.
    const startY = ctx.start.y
    const outward = 3 // total outward (forward) drift while falling
    const bounceY = 0.5
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'run', easeIn: 0.25 },
      // Accelerating fall (quadratic on height).
      { t: ctx.duration * 0.3, pos: at(ctx, outward * 0.3, 0, startY * (1 - 0.3 * 0.3)), gait: 'run' },
      { t: ctx.duration * 0.5, pos: at(ctx, outward * 0.5, 0, startY * (1 - 0.5 * 0.5)), gait: 'run' },
      // First ground contact.
      { t: ctx.duration * 0.62, pos: at(ctx, outward * 0.65, 0, 0), gait: 'run' },
      // Bounce up.
      { t: ctx.duration * 0.75, pos: at(ctx, outward * 0.8, 0, bounceY), gait: 'walk' },
      // Settle.
      { t: ctx.duration, pos: at(ctx, outward, 0, 0), gait: 'stand', easeIn: 0.25, hold: 1 }
    ]
    return build(ctx, raw)
  }
}

const buildingTopple: ActionPreset = {
  id: 'building-topple',
  name: 'Building Topple',
  category: 'destruction',
  description: 'A wall or column leans out, accelerates, and crashes down along an arc to the ground.',
  suggestedAssets: ['primitive.box', 'prop.wall', 'prop.column'],
  generate(ctx) {
    // Falls "its height away" — the pivot topple lands roughly a height-length
    // out from the base. Use start.y as the piece height (min 4).
    const h = Math.max(ctx.start.y, 4)
    const reach = h // lands ~its height away
    const ts = times(6, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        // Quarter-arc pivot: outward = h·sin(θ), height = h·cos(θ) as θ 0→π/2,
        // accelerating (θ grows with u²).
        const theta = (Math.PI / 2) * (u * u)
        const outward = reach * Math.sin(theta)
        const y = h * Math.cos(theta)
        const last = ts.length - 1
        return {
          t,
          pos: at(ctx, outward, 0, i === 0 ? ctx.start.y : y),
          gait: i === last ? 'stand' : 'run',
          easeIn: i === 0 ? 0.25 : 0,
          hold: i === last ? 1 : 0
        }
      })
    )
  }
}

const objectThrownArc: ActionPreset = {
  id: 'object-thrown-arc',
  name: 'Object Thrown Arc',
  category: 'object',
  description: 'A ballistic arc forward, peaking above the start, landing with a small bounce to a stop.',
  suggestedAssets: ['primitive.box', 'primitive.sphere', 'prop.crate'],
  generate(ctx) {
    const range = 12
    const peak = 4 // above start.y
    const ts = times(7, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        // Flight for the first ~80% (parabola), then a small bounce + settle.
        if (u <= 0.8) {
          const p = u / 0.8 // 0..1 over the flight
          const fwd = range * p
          // Parabolic height from start.y up by `peak` and back to 0.
          const y = ctx.start.y + (4 * peak * p * (1 - p)) - ctx.start.y * (p * p)
          return { t, pos: at(ctx, fwd, 0, Math.max(0, y)), gait: 'run' as Gait, easeIn: i === 0 ? 0.25 : 0 }
        }
        // Bounce phase.
        const p = (u - 0.8) / 0.2 // 0..1
        const bounceY = 1.2 * Math.sin(Math.PI * p) * (1 - p)
        const last = ts.length - 1
        return {
          t,
          pos: at(ctx, range + 2 * p, 0, bounceY),
          gait: i === last ? 'stand' : 'walk',
          easeIn: i === last ? 0.25 : 0,
          hold: i === last ? 0.5 : 0
        }
      })
    )
  }
}

const objectTornadoSpiral: ActionPreset = {
  id: 'object-tornado-spiral',
  name: 'Object Tornado Spiral',
  category: 'object',
  description: 'A rising, expanding spiral — papers or debris caught and lofted by a whirlwind.',
  suggestedAssets: ['prop.paper', 'primitive.box', 'prop.rubble'],
  generate(ctx) {
    const climb = 14
    const maxR = 6
    const turns = 2.5
    const ts = times(10, ctx.duration)
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const ang = turns * 2 * Math.PI * u
        const radius = maxR * u // expands as it rises
        const side = radius * Math.cos(ang)
        const along = radius * Math.sin(ang)
        return {
          t,
          pos: {
            x: ctx.start.x + r.x * side + f.x * along,
            y: ctx.start.y + climb * u,
            z: ctx.start.z + r.z * side + f.z * along
          },
          gait: 'run' as Gait
        }
      })
    )
  }
}

// ---------------------------------------------------------------------------
// PERSON — one-click character locomotion paths (walk / run / stairs / hop)
// ---------------------------------------------------------------------------

const walkForward: ActionPreset = {
  id: 'walk-forward',
  name: 'Walk Forward',
  category: 'person',
  description: 'A steady walk straight ahead along the heading at ~1.4 m/s.',
  suggestedAssets: ['person.man', 'person.woman'],
  generate(ctx) {
    const speed = 1.4 // m/s
    const total = speed * ctx.duration
    const ts = times(7, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        const last = ts.length - 1
        return {
          t,
          pos: at(ctx, total * u, 0, 0),
          gait: 'walk' as Gait,
          easeIn: i === 0 ? 0.25 : 0,
          easeOut: i === last ? 0.25 : 0
        }
      })
    )
  }
}

const runForward: ActionPreset = {
  id: 'run-forward',
  name: 'Run Forward',
  category: 'person',
  description: 'A fast run straight ahead along the heading at ~5 m/s.',
  suggestedAssets: ['person.man', 'person.woman'],
  generate(ctx) {
    const speed = 5 // m/s
    const total = speed * ctx.duration
    const ts = times(7, ctx.duration)
    return build(
      ctx,
      ts.map((t, i) => {
        const u = t / ctx.duration
        const last = ts.length - 1
        return {
          t,
          pos: at(ctx, total * u, 0, 0),
          gait: 'run' as Gait,
          easeIn: i === 0 ? 0.25 : 0,
          easeOut: i === last ? 0.25 : 0
        }
      })
    )
  }
}

const walkUpStairs: ActionPreset = {
  id: 'walk-up-stairs',
  name: 'Walk Up Stairs',
  category: 'person',
  description: 'Climbs a staircase: eight even steps up ~1.4m of rise over ~6m forward, then a level hold at the top.',
  suggestedAssets: ['person.man', 'person.woman'],
  generate(ctx) {
    const steps = 8
    const riseEach = 0.17 // ~1.36m total rise
    const climbFwd = 6 // horizontal run of the climb
    const raw: MarkBuild[] = []
    // First mark at start (pinned by build()).
    raw.push({ t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'walk', easeIn: 0.25 })
    // Eight stepping marks, each advancing forward and rising one step.
    // Climb occupies ~85% of the duration; the last 15% is the level hold.
    const climbEnd = ctx.duration * 0.85
    for (let k = 1; k <= steps; k++) {
      const u = k / steps
      raw.push({
        t: climbEnd * u,
        pos: at(ctx, climbFwd * u, 0, ctx.start.y + riseEach * k),
        gait: 'walk'
      })
    }
    // Level hold at the top: step off onto the landing and stand.
    raw.push({
      t: ctx.duration,
      pos: at(ctx, climbFwd + 1.2, 0, ctx.start.y + riseEach * steps),
      gait: 'stand',
      easeIn: 0.25,
      hold: 1
    })
    return build(ctx, raw)
  }
}

const jumpForward: ActionPreset = {
  id: 'jump-forward',
  name: 'Jump Forward',
  category: 'person',
  description: 'Three forward hops — each arcs up ~0.5m while advancing ~1.2m.',
  suggestedAssets: ['person.man', 'person.woman'],
  generate(ctx) {
    const hops = 3
    const advanceEach = 1.2
    const peak = 0.5
    // Two marks per hop (peak + landing) plus the start.
    const raw: MarkBuild[] = []
    raw.push({ t: 0, pos: at(ctx, 0, 0, ctx.start.y), gait: 'jog', easeIn: 0.25 })
    const perHop = ctx.duration / hops
    for (let h = 0; h < hops; h++) {
      const baseFwd = advanceEach * h
      const t0 = perHop * h
      // Apex of the hop.
      raw.push({
        t: t0 + perHop * 0.5,
        pos: at(ctx, baseFwd + advanceEach * 0.5, 0, ctx.start.y + peak),
        gait: 'jog'
      })
      // Landing.
      const isLast = h === hops - 1
      raw.push({
        t: t0 + perHop,
        pos: at(ctx, baseFwd + advanceEach, 0, ctx.start.y),
        gait: isLast ? 'stand' : 'jog',
        easeOut: isLast ? 0.25 : 0,
        hold: isLast ? 0.5 : 0
      })
    }
    return build(ctx, raw)
  }
}

const doorBurstRun: ActionPreset = {
  id: 'door-burst-run',
  name: 'Door Burst Run',
  category: 'person',
  description: 'Explode forward from a standstill — a brief still beat, then accelerate hard into a full run.',
  suggestedAssets: ['person.man', 'person.woman'],
  generate(ctx) {
    const total = 42 // large forward distance
    const raw: MarkBuild[] = [
      // Brief still start (bursting through the door).
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'stand', easeIn: 0.25, hold: 0.3 },
      { t: ctx.duration * 0.12, pos: at(ctx, 0.6, 0, 0), gait: 'walk' },
      // Accelerate into a run (distance grows quadratically).
      { t: ctx.duration * 0.35, pos: at(ctx, total * 0.12, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.6, pos: at(ctx, total * 0.4, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.8, pos: at(ctx, total * 0.68, 0, 0), gait: 'run' },
      { t: ctx.duration, pos: at(ctx, total, 0, 0), gait: 'run', easeOut: 0.25 }
    ]
    return build(ctx, raw)
  }
}

// ---------------------------------------------------------------------------
// ANIMAL — quadruped locomotion paths (gallop, fetch)
// ---------------------------------------------------------------------------

const horseGallopLoop: ActionPreset = {
  id: 'horse-gallop-loop',
  name: 'Horse Gallop Loop',
  category: 'animal',
  description: 'A galloping travel around a large oval that returns near its start — a loop-friendly run.',
  suggestedAssets: ['animal.horse'],
  generate(ctx) {
    const radius = 20
    const ts = times(9, ctx.duration)
    const f = forward(ctx.start.heading)
    const r = right(ctx.start.heading)
    // Circle whose centre is `radius` to the right; start at angle π (near edge)
    // and sweep a full turn so the path returns to the start (loop-friendly).
    return build(
      ctx,
      ts.map((t) => {
        const u = t / ctx.duration
        const ang = Math.PI - 2 * Math.PI * u
        const side = radius + radius * Math.cos(ang) // 0 at start, back to 0
        const along = radius * Math.sin(ang)
        return {
          t,
          pos: {
            x: ctx.start.x + r.x * side + f.x * along,
            y: 0,
            z: ctx.start.z + r.z * side + f.z * along
          },
          gait: 'run' as Gait
        }
      })
    )
  }
}

const dogFetchRun: ActionPreset = {
  id: 'dog-fetch-run',
  name: 'Dog Fetch Run',
  category: 'animal',
  description: 'Run out forward, pause to grab the ball, then run back — ending near where it started.',
  suggestedAssets: ['animal.dog'],
  generate(ctx) {
    const out = 30 // distance out to the ball
    const raw: MarkBuild[] = [
      { t: 0, pos: at(ctx, 0, 0, 0), gait: 'run', easeIn: 0.25 },
      // Sprint out to the ball.
      { t: ctx.duration * 0.3, pos: at(ctx, out, 0, 0), gait: 'run' },
      // Grab it — a brief decelerating pause (the fetch).
      { t: ctx.duration * 0.45, pos: at(ctx, out + 2, 0, 0), gait: 'walk', hold: 0.4 },
      // Run back toward the start.
      { t: ctx.duration * 0.6, pos: at(ctx, out * 0.6, 0, 0), gait: 'run' },
      { t: ctx.duration * 0.85, pos: at(ctx, out * 0.2, 0, 0), gait: 'run' },
      // Arrive back near where it began.
      { t: ctx.duration, pos: at(ctx, 1, 0, 0), gait: 'walk', easeOut: 0.25 }
    ]
    return build(ctx, raw)
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ACTION_PRESETS: ActionPreset[] = [
  // aircraft
  planeTakeoff,
  planeLanding,
  planeFlyby,
  planeBankedCircle,
  planeCrashDive,
  // helicopter
  heliTakeoff,
  heliLanding,
  heliOrbit,
  heliHoverHold,
  // bird
  birdCircleSoar,
  birdSwoop,
  birdFlockPass,
  // vehicle
  carChaseWeave,
  carDriftTurn,
  carScreechStop,
  carPullUpPark,
  carReverseEscape,
  motorcycleWeave,
  boatWakeTurn,
  trainPassThrough,
  carJumpRamp,
  truckJackknifeStop,
  // destruction / object
  debrisFall,
  buildingTopple,
  objectThrownArc,
  objectTornadoSpiral,
  // person
  walkForward,
  runForward,
  walkUpStairs,
  jumpForward,
  doorBurstRun,
  // animal
  horseGallopLoop,
  dogFetchRun
]
