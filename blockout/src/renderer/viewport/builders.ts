/**
 * Procedural grey-box builders for the Blockout viewport.
 *
 * Every ASSET_CATALOG id maps to a low-poly MeshLambertMaterial group here,
 * plus mark/label sprites. Conventions:
 *   - Origin at ground (y=0), +Y up, FORWARD IS -Z (models face -Z).
 *   - Real-world scale in meters (heights from the asset catalog).
 *   - Deterministic: no Math.random(); animate() is a pure function of AnimInput.
 */

import * as THREE from 'three'
import type { GaitId } from '@engine/types'
import { assetSpec } from '@engine/assets'

export interface AnimInput {
  gait: GaitId
  /** Gait cycle fraction [0..1) — drives limb swing. */
  phase: number
  /** Current speed m/s. */
  speed: number
  /** Meters travelled since shot start — drives wheel rotation. */
  distance: number
  /** Shot time in seconds — for idle motions (gesture sway, club lights). */
  time: number
  /**
   * Per-joint pose offsets in radians, applied AFTER the gait pose (people
   * only). Keys: shoulderLX/RX (arm forward/up, negative raises), shoulderLZ/RZ
   * (arm out to the side), elbowL/R (bend), hipLX/RX (leg forward/back),
   * hipLZ/RZ (leg abduction, positive = outward), kneeL/R (bend), torsoX (lean),
   * torsoY (twist), torsoZ (lateral lean, positive = right), headX (nod),
   * headY (turn), headZ (tilt, positive = right).
   */
  overrides?: Record<string, number>
}

export interface BuiltAsset {
  group: THREE.Group
  /** Standing height in meters (from the catalog spec). */
  height: number
  /** Present for things that move/animate; called every frame. MUST be deterministic — a pure function of AnimInput, no internal accumulating state, no Math.random at animation time. */
  animate?: (input: AnimInput) => void
  /** Tint all meshes toward a hex color (label color), or restore original when null. */
  setTint: (color: string | null) => void
}

// ---------------------------------------------------------------------------
// Materials & helpers
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2
const BASE_GREY = 0x8a8a92

/** Meshes carry their original color so setTint can restore it. */
interface TintUserData {
  origColor?: number
}

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color })
}

/** Box mesh centered on its own origin, shadow-enabled, tint-aware. */
function box(w: number, h: number, d: number, color = BASE_GREY): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

function cyl(rt: number, rb: number, h: number, color = BASE_GREY, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

function sphere(r: number, color = BASE_GREY, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

function capsule(r: number, len: number, color = BASE_GREY): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat(color))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

/** Ground plane: receives shadows only, never casts. */
function ground(w: number, d: number, color: number, y = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color))
  m.rotation.x = -Math.PI / 2
  m.position.y = y
  m.castShadow = false
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  return m
}

/** Wheel: a cylinder rotated to spin around X (axle along X). */
function wheel(radius: number, width: number, color = 0x2c2c30): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 14), mat(color))
  m.rotation.z = Math.PI / 2
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = color
  m.name = 'wheel'
  return m
}

function grp(x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(x, y, z)
  return g
}

/** Build a setTint closure that walks all mesh materials in `root`. */
function makeSetTint(root: THREE.Object3D): (color: string | null) => void {
  const tintColor = new THREE.Color()
  return (color: string | null) => {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!(mesh.isMesh ?? false)) return
      const material = mesh.material
      // Only tint standard lit/basic materials that carry a stored original.
      const ud = mesh.userData as TintUserData
      if (ud.origColor === undefined) return
      const applyTo = (mm: THREE.Material) => {
        const cm = mm as THREE.MeshLambertMaterial
        if (!cm.color) return
        if (color === null) {
          cm.color.setHex(ud.origColor as number)
        } else {
          tintColor.set(color)
          cm.color.setHex(ud.origColor as number).lerp(tintColor, 0.65)
        }
      }
      if (Array.isArray(material)) material.forEach(applyTo)
      else if (material) applyTo(material)
    })
  }
}

function numParam(params: Record<string, number | string> | undefined, key: string, def: number): number {
  const v = params?.[key]
  return typeof v === 'number' ? v : def
}

// ---------------------------------------------------------------------------
// PERSON — articulated capsule mannequin
// ---------------------------------------------------------------------------

interface PersonJoints {
  root: THREE.Group // child of group; we tip THIS for lie/fall, not the group
  torso: THREE.Group
  head: THREE.Group
  hipL: THREE.Group
  hipR: THREE.Group
  kneeL: THREE.Group
  kneeR: THREE.Group
  shoulderL: THREE.Group
  shoulderR: THREE.Group
  elbowL: THREE.Group
  elbowR: THREE.Group
  legLen: number
  scale: number
  baseLean: number // constant forward lean (elderly)
}

function buildPerson(assetId: string, params?: Record<string, number | string>): BuiltAsset {
  const spec = assetSpec(assetId)
  const hMul = Math.min(1.2, Math.max(0.8, numParam(params, 'height', 1)))
  const buildMul = Math.min(1.3, Math.max(0.8, numParam(params, 'build', 1)))
  const H = spec.height * hMul
  const s = H / 1.78 // normalize proportions to a 1.78m reference
  const w = buildMul

  const legLen = H * 0.47
  const headR = H * 0.13 * 0.5
  const torsoLen = H - legLen - headR * 2
  const bodyW = 0.34 * s * w

  const group = new THREE.Group()
  group.name = assetId

  const root = grp(0, 0, 0)
  group.add(root)

  // Pelvis sits at top of legs.
  const pelvisY = legLen
  const pelvis = grp(0, pelvisY, 0)
  root.add(pelvis)

  const pelvisMesh = box(bodyW, 0.18 * s, 0.2 * s, 0x83838b)
  pelvisMesh.position.y = 0.02 * s
  pelvis.add(pelvisMesh)

  // Torso pivots at pelvis, extends up.
  const torso = grp(0, 0.08 * s, 0)
  pelvis.add(torso)
  const torsoMesh = capsule(bodyW * 0.5, torsoLen * 0.7, 0x8f8f97)
  torsoMesh.position.y = torsoLen * 0.5
  torso.add(torsoMesh)

  // Neck + head.
  const head = grp(0, torsoLen, 0)
  torso.add(head)
  const neck = cyl(0.05 * s, 0.05 * s, 0.08 * s, 0x83838b)
  neck.position.y = 0.04 * s
  head.add(neck)
  const headMesh = sphere(headR, 0x94949c)
  headMesh.position.y = headR + 0.06 * s
  head.add(headMesh)

  // Arms — shoulders at top of torso.
  const shoulderY = torsoLen * 0.92
  const armR = 0.055 * s * w
  const upperArmLen = torsoLen * 0.5
  const lowerArmLen = torsoLen * 0.48

  const mkArm = (side: number) => {
    const shoulder = grp(side * bodyW * 0.55, shoulderY, 0)
    torso.add(shoulder)
    const upper = capsule(armR, upperArmLen * 0.7, 0x88888f)
    upper.position.y = -upperArmLen * 0.5
    shoulder.add(upper)
    const elbow = grp(0, -upperArmLen, 0)
    shoulder.add(elbow)
    const lower = capsule(armR * 0.9, lowerArmLen * 0.7, 0x8c8c94)
    lower.position.y = -lowerArmLen * 0.5
    elbow.add(lower)
    return { shoulder, elbow }
  }
  const armL = mkArm(-1)
  const armR2 = mkArm(1)

  // Legs — hips at pelvis.
  const legR = 0.075 * s * w
  const upperLegLen = legLen * 0.52
  const lowerLegLen = legLen * 0.48

  const mkLeg = (side: number) => {
    const hip = grp(side * bodyW * 0.28, 0, 0)
    pelvis.add(hip)
    const upper = capsule(legR, upperLegLen * 0.7, 0x86868e)
    upper.position.y = -upperLegLen * 0.5
    hip.add(upper)
    const knee = grp(0, -upperLegLen, 0)
    hip.add(knee)
    const lower = capsule(legR * 0.85, lowerLegLen * 0.7, 0x8a8a92)
    lower.position.y = -lowerLegLen * 0.5
    knee.add(lower)
    // Foot.
    const foot = box(legR * 2, 0.06 * s, 0.22 * s, 0x6f6f76)
    foot.position.set(0, -lowerLegLen + 0.03 * s, -0.05 * s)
    knee.add(foot)
    return { hip, knee }
  }
  const legL = mkLeg(-1)
  const legR3 = mkLeg(1)

  const baseLean = assetId === 'person.elderly' ? 0.18 : 0

  const j: PersonJoints = {
    root,
    torso,
    head,
    hipL: legL.hip,
    hipR: legR3.hip,
    kneeL: legL.knee,
    kneeR: legR3.knee,
    shoulderL: armL.shoulder,
    shoulderR: armR2.shoulder,
    elbowL: armL.elbow,
    elbowR: armR2.elbow,
    legLen,
    scale: s,
    baseLean
  }

  const setTint = makeSetTint(group)
  const animate = (input: AnimInput) => animatePerson(j, input)
  // Prime a neutral pose.
  animate({ gait: 'stand', phase: 0, speed: 0, distance: 0, time: 0 })

  return { group, height: H, animate, setTint }
}

function resetPersonPose(j: PersonJoints): void {
  j.root.rotation.set(0, 0, 0)
  j.root.position.set(0, 0, 0)
  j.torso.rotation.set(0, 0, 0)
  j.head.rotation.set(0, 0, 0)
  j.hipL.rotation.set(0, 0, 0)
  j.hipR.rotation.set(0, 0, 0)
  j.kneeL.rotation.set(0, 0, 0)
  j.kneeR.rotation.set(0, 0, 0)
  j.shoulderL.rotation.set(0, 0, 0)
  j.shoulderR.rotation.set(0, 0, 0)
  j.elbowL.rotation.set(0, 0, 0)
  j.elbowR.rotation.set(0, 0, 0)
}

function animatePerson(j: PersonJoints, input: AnimInput): void {
  resetPersonPose(j)
  const t = input.time
  const p = input.phase
  const swing = Math.sin(p * TAU)
  j.torso.rotation.x = j.baseLean

  switch (input.gait) {
    case 'stand':
    case 'gesture': {
      // Neutral with tiny breathing bob.
      j.root.position.y = Math.sin(t * 1.5) * 0.005
      if (input.gait === 'gesture') {
        // One forearm raised, gently waving.
        j.shoulderR.rotation.x = -2.3
        j.elbowR.rotation.z = Math.sin(t * 2) * 0.3
        j.elbowR.rotation.x = -0.4
      }
      break
    }
    case 'walk':
    case 'jog':
    case 'run': {
      const amp = input.gait === 'walk' ? 0.5 : input.gait === 'jog' ? 0.8 : 1.1
      const bobAmp = input.gait === 'walk' ? 0.02 : input.gait === 'jog' ? 0.04 : 0.06
      const legAngle = swing * amp
      j.hipL.rotation.x = legAngle
      j.hipR.rotation.x = -legAngle
      // Opposite arms counter-swing.
      j.shoulderL.rotation.x = -legAngle * 0.8
      j.shoulderR.rotation.x = legAngle * 0.8
      // Lower legs bend on the back-swing.
      j.kneeL.rotation.x = -Math.max(0, -Math.sin(p * TAU)) * 0.8
      j.kneeR.rotation.x = -Math.max(0, -Math.sin(p * TAU + Math.PI)) * 0.8
      j.elbowL.rotation.x = -0.3
      j.elbowR.rotation.x = -0.3
      j.root.position.y = Math.abs(swing) * bobAmp
      if (input.gait === 'run') j.torso.rotation.x = j.baseLean + 0.15
      break
    }
    case 'crouch': {
      const drop = j.legLen * 0.3
      j.root.position.y = -drop
      j.hipL.rotation.x = 0.9
      j.hipR.rotation.x = 0.9
      j.kneeL.rotation.x = -1.4
      j.kneeR.rotation.x = -1.4
      j.torso.rotation.x = j.baseLean + 0.3
      if (input.speed > 0) {
        const legAngle = swing * 0.25
        j.hipL.rotation.x += legAngle
        j.hipR.rotation.x -= legAngle
      }
      break
    }
    case 'sit': {
      const chairH = 0.45 * j.scale
      j.root.position.y = -(j.legLen - chairH)
      // Thighs horizontal, lower legs vertical.
      j.hipL.rotation.x = -Math.PI / 2
      j.hipR.rotation.x = -Math.PI / 2
      j.kneeL.rotation.x = Math.PI / 2
      j.kneeR.rotation.x = Math.PI / 2
      j.torso.rotation.x = j.baseLean
      break
    }
    case 'lie': {
      // Tip the whole body flat; pelvis raised so body rests on ground.
      j.root.rotation.x = -Math.PI / 2
      j.root.position.y = 0.18 * j.scale
      j.root.position.z = j.legLen * 0.5
      break
    }
    case 'fall': {
      // Fallen backward, arms up.
      j.root.rotation.x = 1.4
      j.root.position.y = 0.25 * j.scale
      j.root.position.z = -j.legLen * 0.3
      j.shoulderL.rotation.x = -2.2
      j.shoulderR.rotation.x = -2.2
      j.hipL.rotation.x = 0.3
      j.hipR.rotation.x = -0.2
      break
    }
  }

  // Manual pose offsets on top of the gait (fight/dance blocking).
  const ov = input.overrides
  if (ov) {
    j.shoulderL.rotation.x += ov.shoulderLX ?? 0
    j.shoulderR.rotation.x += ov.shoulderRX ?? 0
    j.shoulderL.rotation.z += ov.shoulderLZ ?? 0
    j.shoulderR.rotation.z -= ov.shoulderRZ ?? 0
    j.elbowL.rotation.x -= ov.elbowL ?? 0
    j.elbowR.rotation.x -= ov.elbowR ?? 0
    j.hipL.rotation.x += ov.hipLX ?? 0
    j.hipR.rotation.x += ov.hipRX ?? 0
    // Leg abduction (out to the side); mirrored on the right like the arms so
    // positive reads as "outward" on both legs.
    j.hipL.rotation.z += ov.hipLZ ?? 0
    j.hipR.rotation.z -= ov.hipRZ ?? 0
    j.kneeL.rotation.x -= ov.kneeL ?? 0
    j.kneeR.rotation.x -= ov.kneeR ?? 0
    j.torso.rotation.x += ov.torsoX ?? 0
    j.torso.rotation.y += ov.torsoY ?? 0
    // Lateral lean/tilt (positive = right); sign matches the arm-mirror frame.
    j.torso.rotation.z -= ov.torsoZ ?? 0
    j.head.rotation.x += ov.headX ?? 0
    j.head.rotation.y += ov.headY ?? 0
    j.head.rotation.z -= ov.headZ ?? 0
  }
}

// ---------------------------------------------------------------------------
// ANIMALS
// ---------------------------------------------------------------------------

interface QuadJoints {
  legs: THREE.Group[] // FL, FR, BL, BR
  head: THREE.Group
  tail: THREE.Group
}

function buildQuadruped(assetId: string): BuiltAsset {
  const spec = assetSpec(assetId)
  const H = spec.height
  const s = H / 0.6
  // Body length proportional to height.
  const bodyLen = H * 1.7
  const bodyR = H * 0.28
  const legH = H * 0.55

  const group = new THREE.Group()
  group.name = assetId

  const bodyY = legH
  const body = capsule(bodyR, bodyLen - bodyR * 2, 0x87878f)
  body.rotation.x = Math.PI / 2
  body.position.set(0, bodyY, 0)
  group.add(body)

  // Legs — hip pivots at body underside, forward is -Z.
  const legR = H * 0.08
  const legZFront = -bodyLen * 0.32
  const legZBack = bodyLen * 0.32
  const legX = bodyR * 0.7
  const legs: THREE.Group[] = []
  const mkLeg = (x: number, z: number) => {
    const hip = grp(x, bodyY, z)
    group.add(hip)
    const seg = capsule(legR, legH * 0.6, 0x82828a)
    seg.position.y = -legH * 0.5
    hip.add(seg)
    legs.push(hip)
    return hip
  }
  mkLeg(-legX, legZFront) // FL
  mkLeg(legX, legZFront) // FR
  mkLeg(-legX, legZBack) // BL
  mkLeg(legX, legZBack) // BR

  // Neck + head at front (-Z).
  const neckPivot = grp(0, bodyY + bodyR * 0.3, legZFront - bodyR * 0.4)
  group.add(neckPivot)
  const neck = capsule(bodyR * 0.5, H * 0.4, 0x84848c)
  neck.rotation.x = 0.6
  neck.position.set(0, H * 0.2, -H * 0.12)
  neckPivot.add(neck)
  const head = grp(0, H * 0.42, -H * 0.28)
  neckPivot.add(head)
  const headMesh = box(bodyR * 0.9, bodyR * 0.85, bodyR * 1.2, 0x8f8f97)
  head.add(headMesh)
  const snout = box(bodyR * 0.5, bodyR * 0.4, bodyR * 0.5, 0x86868e)
  snout.position.set(0, -bodyR * 0.1, -bodyR * 0.85)
  head.add(snout)

  // Tail at back (+Z).
  const tail = grp(0, bodyY + bodyR * 0.4, legZBack + bodyR * 0.3)
  group.add(tail)
  const tailMesh = capsule(bodyR * 0.22, H * 0.5, 0x82828a)
  tailMesh.rotation.x = -0.8
  tailMesh.position.set(0, H * 0.1, H * 0.18)
  tail.add(tailMesh)

  void s
  const j: QuadJoints = { legs, head: neckPivot, tail }
  const setTint = makeSetTint(group)
  const animate = (input: AnimInput) => {
    const swing = Math.sin(input.phase * TAU)
    const amp = Math.min(1, 0.2 + input.speed * 0.15)
    // Diagonal pairs: FL+BR together, FR+BL opposite.
    const legList = j.legs
    if (legList[0]) legList[0].rotation.x = swing * amp
    if (legList[3]) legList[3].rotation.x = swing * amp
    if (legList[1]) legList[1].rotation.x = -swing * amp
    if (legList[2]) legList[2].rotation.x = -swing * amp
    if (input.speed <= 0.01) {
      // Idle head bob when standing.
      j.head.rotation.x = Math.sin(input.time * 1.2) * 0.08
    } else {
      j.head.rotation.x = 0
    }
    j.tail.rotation.x = Math.sin(input.time * 3 + input.phase * TAU) * 0.15
  }
  animate({ gait: 'stand', phase: 0, speed: 0, distance: 0, time: 0 })

  return { group, height: H, animate, setTint }
}

function buildBird(assetId: string): BuiltAsset {
  const spec = assetSpec(assetId)
  const H = spec.height
  const bodyR = H * 0.35

  const group = new THREE.Group()
  group.name = assetId

  const core = grp(0, H, 0)
  group.add(core)
  const body = capsule(bodyR, bodyR * 1.4, 0x8b8b93)
  body.rotation.z = Math.PI / 2
  core.add(body)
  const head = sphere(bodyR * 0.7, 0x94949c)
  head.position.set(0, bodyR * 0.4, -bodyR * 1.1)
  core.add(head)
  const beak = cyl(0.001, bodyR * 0.2, bodyR * 0.5, 0xc0a050, 6)
  beak.rotation.x = -Math.PI / 2
  beak.position.set(0, bodyR * 0.35, -bodyR * 1.6)
  core.add(beak)

  const wingL = grp(-bodyR * 0.6, bodyR * 0.2, 0)
  const wingR = grp(bodyR * 0.6, bodyR * 0.2, 0)
  core.add(wingL)
  core.add(wingR)
  const mkWing = (side: number, g: THREE.Group) => {
    const w = box(bodyR * 2, bodyR * 0.1, bodyR * 1.2, 0x86868e)
    w.position.x = side * bodyR
    g.add(w)
  }
  mkWing(-1, wingL)
  mkWing(1, wingR)

  const setTint = makeSetTint(group)
  const animate = (input: AnimInput) => {
    const moving = input.speed > 0.1
    // Fly at height when moving, otherwise perch on ground.
    core.position.y = moving ? H : bodyR
    if (input.speed > 0) {
      const flap = Math.sin(input.time * 10) * 0.9
      wingL.rotation.z = flap
      wingR.rotation.z = -flap
    } else {
      // Glide.
      wingL.rotation.z = 0.15
      wingR.rotation.z = -0.15
    }
  }
  animate({ gait: 'stand', phase: 0, speed: 0, distance: 0, time: 0 })

  return { group, height: H, animate, setTint }
}

// ---------------------------------------------------------------------------
// VEHICLES
// ---------------------------------------------------------------------------

/** Attach wheel-spin animate to a group with named 'wheel' meshes. */
function wheeledAnimate(group: THREE.Group, radius: number): (input: AnimInput) => void {
  const wheels: THREE.Mesh[] = []
  group.traverse((o) => {
    if (o.name === 'wheel') wheels.push(o as THREE.Mesh)
  })
  return (input: AnimInput) => {
    const rot = input.distance / radius
    for (const wm of wheels) {
      // Wheel is rotated Z=90°; spin lives on its local X-equivalent via rotation.x on a holder is cleaner,
      // but we spin the mesh around its axle (local Y before the Z rotation → world X). Set rotation order:
      wm.rotation.x = rot
    }
  }
}

function buildSedan(): BuiltAsset {
  const group = new THREE.Group()
  const L = 4.6
  const W = 1.85
  const bodyH = 0.7
  const wr = 0.34
  const lower = box(W, bodyH, L, 0x7f7f87)
  lower.position.y = wr + bodyH * 0.5
  group.add(lower)
  const cabin = box(W * 0.9, 0.55, L * 0.5, 0x8d8d95)
  cabin.position.set(0, wr + bodyH + 0.28, -L * 0.05)
  group.add(cabin)
  addWheels(group, W, L, wr, 0.25)
  return finalizeWheeled(group, 1.45, wr)
}

function buildSUV(): BuiltAsset {
  const group = new THREE.Group()
  const L = 4.8
  const W = 1.95
  const bodyH = 1.15
  const wr = 0.38
  const body = box(W, bodyH, L, 0x7f7f87)
  body.position.y = wr + bodyH * 0.5
  group.add(body)
  const cabin = box(W * 0.94, 0.5, L * 0.55, 0x8d8d95)
  cabin.position.set(0, wr + bodyH + 0.1, -L * 0.02)
  group.add(cabin)
  addWheels(group, W, L, wr, 0.26)
  return finalizeWheeled(group, 1.8, wr)
}

function buildPickup(): BuiltAsset {
  const group = new THREE.Group()
  const L = 5.3
  const W = 1.95
  const wr = 0.4
  const chassisH = 0.5
  const chassis = box(W, chassisH, L, 0x76767e)
  chassis.position.y = wr + chassisH * 0.5
  group.add(chassis)
  const cab = box(W, 0.85, L * 0.4, 0x8d8d95)
  cab.position.set(0, wr + chassisH + 0.42, -L * 0.22)
  group.add(cab)
  // Open bed walls (back = +Z).
  const bedH = 0.45
  const bedFloorY = wr + chassisH
  const sideL = box(0.08, bedH, L * 0.5, 0x808088)
  sideL.position.set(-W * 0.5 + 0.04, bedFloorY + bedH * 0.5, L * 0.2)
  group.add(sideL)
  const sideR = sideL.clone()
  sideR.position.x = W * 0.5 - 0.04
  group.add(sideR)
  const tail = box(W, bedH, 0.08, 0x808088)
  tail.position.set(0, bedFloorY + bedH * 0.5, L * 0.45)
  group.add(tail)
  addWheels(group, W, L, wr, 0.25)
  return finalizeWheeled(group, 1.9, wr)
}

function buildVan(): BuiltAsset {
  const group = new THREE.Group()
  const L = 5.4
  const W = 2.0
  const bodyH = 1.9
  const wr = 0.38
  const body = box(W, bodyH, L, 0x84848c)
  body.position.y = wr + bodyH * 0.5
  group.add(body)
  // Sloped nose hint.
  const nose = box(W, 0.7, L * 0.15, 0x7c7c84)
  nose.position.set(0, wr + 0.35, -L * 0.5 + L * 0.075)
  group.add(nose)
  addWheels(group, W, L, wr, 0.28)
  return finalizeWheeled(group, 2.2, wr)
}

function buildBus(): BuiltAsset {
  const group = new THREE.Group()
  const L = 12
  const W = 2.5
  const bodyH = 2.7
  const wr = 0.5
  const body = box(W, bodyH, L, 0x83838b)
  body.position.y = wr + bodyH * 0.5
  group.add(body)
  // Inset window band.
  const band = box(W + 0.02, 0.7, L * 0.9, 0x5a5a64)
  band.position.set(0, wr + bodyH * 0.62, 0)
  group.add(band)
  addWheels(group, W, L, wr, 0.35, [-L * 0.35, L * 0.32])
  return finalizeWheeled(group, 3.2, wr)
}

function buildTruck(): BuiltAsset {
  const group = new THREE.Group()
  const wr = 0.5
  // Tractor at front (-Z).
  const tractor = box(2.4, 2.6, 5, 0x81818a)
  tractor.position.set(0, wr + 1.3, -3.5)
  group.add(tractor)
  const stack = cyl(0.08, 0.08, 1.0, 0x50505a)
  stack.position.set(-1.0, wr + 2.6 + 0.5, -4.5)
  group.add(stack)
  // Trailer.
  const trailer = box(2.5, 2.8, 9, 0x8a8a92)
  trailer.position.set(0, wr + 1.6, 2.5)
  group.add(trailer)
  addWheels(group, 2.4, 5, wr, 0.4, [-4.2])
  addWheels(group, 2.5, 9, wr, 0.4, [4.5, 6.2])
  return finalizeWheeled(group, 3.8, wr)
}

function buildTank(): BuiltAsset {
  const group = new THREE.Group()
  const L = 7
  const W = 3.4
  // Treads as boxes.
  const treadH = 0.9
  const treadL = box(0.7, treadH, L, 0x4c4c54)
  treadL.position.set(-W * 0.5 + 0.35, treadH * 0.5, 0)
  group.add(treadL)
  const treadR = treadL.clone()
  treadR.position.x = W * 0.5 - 0.35
  group.add(treadR)
  // Hull.
  const hull = box(W - 0.4, 0.8, L * 0.9, 0x77777f)
  hull.position.y = treadH + 0.4
  group.add(hull)
  // Turret.
  const turret = cyl(1.1, 1.3, 0.7, 0x82828a, 10)
  turret.position.set(0, treadH + 0.8 + 0.35, 0.3)
  group.add(turret)
  // Barrel pointing forward (-Z).
  const barrel = cyl(0.12, 0.12, 3.2, 0x60606a)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, treadH + 1.15, -1.8)
  group.add(barrel)
  return finalizeStatic(group, 2.4)
}

function buildTrain(): BuiltAsset {
  const group = new THREE.Group()
  const L = 20
  const W = 3.0
  const bodyH = 3.0
  const undercarriage = box(W, 0.5, L, 0x55555f)
  undercarriage.position.y = 0.4
  group.add(undercarriage)
  const body = box(W, bodyH, L * 0.98, 0x85858d)
  body.position.y = 0.65 + bodyH * 0.5
  group.add(body)
  // Slight roof curve via a low, wide box on top.
  const roof = box(W * 0.9, 0.35, L * 0.96, 0x8f8f97)
  roof.position.y = 0.65 + bodyH + 0.1
  group.add(roof)
  const band = box(W + 0.02, 0.7, L * 0.9, 0x5a5a64)
  band.position.y = 0.65 + bodyH * 0.62
  group.add(band)
  // Rail wheels.
  const wr = 0.45
  addWheels(group, W, L, wr, 0.35, [-L * 0.35, L * 0.35], 0.4)
  return finalizeWheeled(group, 3.6, wr)
}

function buildMotorcycle(): BuiltAsset {
  const group = new THREE.Group()
  const wr = 0.33
  const L = 2.0
  const frame = box(0.25, 0.4, L * 0.7, 0x7c7c84)
  frame.position.set(0, wr + 0.35, 0)
  group.add(frame)
  const tank = box(0.3, 0.3, 0.6, 0x8a8a92)
  tank.position.set(0, wr + 0.6, -0.2)
  group.add(tank)
  const seat = box(0.28, 0.12, 0.6, 0x50505a)
  seat.position.set(0, wr + 0.62, 0.4)
  group.add(seat)
  // Handlebar.
  const bar = box(0.55, 0.05, 0.05, 0x60606a)
  bar.position.set(0, wr + 0.75, -L * 0.5 + 0.1)
  group.add(bar)
  const fw = wheel(wr, 0.12)
  fw.position.set(0, wr, -L * 0.5)
  group.add(fw)
  const bw = wheel(wr, 0.14)
  bw.position.set(0, wr, L * 0.5)
  group.add(bw)
  return finalizeWheeled(group, 1.3, wr)
}

function buildBicycle(): BuiltAsset {
  const group = new THREE.Group()
  const wr = 0.34
  const L = 1.7
  const bar = box(0.05, 0.05, L * 0.8, 0x77777f)
  bar.position.set(0, wr + 0.55, 0)
  group.add(bar)
  const seatPost = box(0.04, 0.4, 0.04, 0x77777f)
  seatPost.position.set(0, wr + 0.55, L * 0.35)
  group.add(seatPost)
  const seat = box(0.12, 0.06, 0.25, 0x50505a)
  seat.position.set(0, wr + 0.78, L * 0.35)
  group.add(seat)
  const handle = box(0.4, 0.05, 0.05, 0x60606a)
  handle.position.set(0, wr + 0.75, -L * 0.4)
  group.add(handle)
  const fw = wheel(wr, 0.05, 0x3a3a42)
  fw.position.set(0, wr, -L * 0.45)
  group.add(fw)
  const bw = wheel(wr, 0.05, 0x3a3a42)
  bw.position.set(0, wr, L * 0.45)
  group.add(bw)
  return finalizeWheeled(group, 1.1, wr)
}

function buildPlane(): BuiltAsset {
  const group = new THREE.Group()
  const fuseLen = 20
  const fuseR = 1.4
  const yLift = 2.5
  const fuse = capsule(fuseR, fuseLen - fuseR * 2, 0x8b8b93)
  fuse.rotation.x = Math.PI / 2
  fuse.position.y = yLift
  group.add(fuse)
  // Wings along X.
  const wing = box(18, 0.4, 3, 0x83838b)
  wing.position.set(0, yLift, 1)
  group.add(wing)
  // Tail fin (vertical).
  const fin = box(0.3, 2.5, 2, 0x85858d)
  fin.position.set(0, yLift + 1.4, fuseLen * 0.42)
  group.add(fin)
  const hstab = box(6, 0.3, 1.6, 0x83838b)
  hstab.position.set(0, yLift + 0.3, fuseLen * 0.44)
  group.add(hstab)
  return finalizeStatic(group, 5.5)
}

function buildBoat(): BuiltAsset {
  const group = new THREE.Group()
  const L = 6
  const W = 2.2
  const hullH = 1.0
  const hull = box(W, hullH, L, 0x7d7d85)
  hull.position.y = hullH * 0.5
  group.add(hull)
  // Tapered bow hint (-Z).
  const bow = box(W * 0.5, hullH, 1.2, 0x7d7d85)
  bow.position.set(0, hullH * 0.5, -L * 0.5 - 0.3)
  bow.rotation.y = 0
  group.add(bow)
  const cabin = box(W * 0.8, 0.9, L * 0.35, 0x8d8d95)
  cabin.position.set(0, hullH + 0.45, L * 0.05)
  group.add(cabin)
  return finalizeStatic(group, 2.0)
}

/**
 * Add 4 (or more) wheels. zPairs optionally overrides axle Z positions;
 * default two axles near front/back. Extra z entries add more axles.
 */
function addWheels(
  group: THREE.Group,
  W: number,
  L: number,
  radius: number,
  width: number,
  zAxles?: number[],
  inset = 0.0
): void {
  const axles = zAxles ?? [-L * 0.32, L * 0.32]
  const x = W * 0.5 - width * 0.5 - inset
  for (const z of axles) {
    const l = wheel(radius, width)
    l.position.set(-x, radius, z)
    group.add(l)
    const r = wheel(radius, width)
    r.position.set(x, radius, z)
    group.add(r)
  }
}

function finalizeWheeled(group: THREE.Group, height: number, wheelRadius: number): BuiltAsset {
  const setTint = makeSetTint(group)
  const animate = wheeledAnimate(group, wheelRadius)
  return { group, height, animate, setTint }
}

function finalizeStatic(group: THREE.Group, height: number): BuiltAsset {
  const setTint = makeSetTint(group)
  return { group, height, setTint }
}

// ---------------------------------------------------------------------------
// FURNITURE
// ---------------------------------------------------------------------------

function buildFurniture(assetId: string): BuiltAsset {
  const group = new THREE.Group()
  group.name = assetId
  let height = 0.8

  switch (assetId) {
    case 'furniture.bed': {
      height = 0.6
      const frame = box(1.6, 0.35, 2.0, 0x7a7a82)
      frame.position.y = 0.175
      group.add(frame)
      const mattress = box(1.5, 0.2, 1.9, 0x9a9aa2)
      mattress.position.y = 0.45
      group.add(mattress)
      const pillow = box(1.3, 0.12, 0.4, 0xa4a4ac)
      pillow.position.set(0, 0.6, -0.7)
      group.add(pillow)
      break
    }
    case 'furniture.couch': {
      height = 0.85
      const base = box(2.2, 0.4, 0.9, 0x82828a)
      base.position.y = 0.2
      group.add(base)
      const backrest = box(2.2, 0.5, 0.2, 0x86868e)
      backrest.position.set(0, 0.55, 0.35)
      group.add(backrest)
      const seatCush = box(2.0, 0.15, 0.7, 0x92929a)
      seatCush.position.set(0, 0.47, -0.05)
      group.add(seatCush)
      const armL = box(0.2, 0.5, 0.9, 0x7c7c84)
      armL.position.set(-1.0, 0.45, 0)
      group.add(armL)
      const armR = armL.clone()
      armR.position.x = 1.0
      group.add(armR)
      break
    }
    case 'furniture.armchair': {
      height = 0.9
      const base = box(0.8, 0.4, 0.8, 0x82828a)
      base.position.y = 0.2
      group.add(base)
      const seat = box(0.7, 0.15, 0.7, 0x92929a)
      seat.position.y = 0.47
      group.add(seat)
      const backrest = box(0.8, 0.55, 0.18, 0x86868e)
      backrest.position.set(0, 0.62, 0.31)
      group.add(backrest)
      const armL = box(0.15, 0.4, 0.8, 0x7c7c84)
      armL.position.set(-0.4, 0.5, 0)
      group.add(armL)
      const armR = armL.clone()
      armR.position.x = 0.4
      group.add(armR)
      break
    }
    case 'furniture.diningTable': {
      height = 0.76
      tableTop(group, 1.8, 0.9, 0.76, 0.05)
      tableLegs(group, 1.8, 0.9, 0.76)
      break
    }
    case 'furniture.kitchenTable': {
      height = 0.9
      tableTop(group, 1.2, 0.8, 0.9, 0.05)
      tableLegs(group, 1.2, 0.8, 0.9)
      break
    }
    case 'furniture.desk': {
      height = 0.75
      tableTop(group, 1.4, 0.7, 0.75, 0.05)
      // Modesty panel + side panels.
      const modesty = box(1.3, 0.5, 0.04, 0x7c7c84)
      modesty.position.set(0, 0.45, 0.32)
      group.add(modesty)
      const sideL = box(0.05, 0.72, 0.7, 0x7c7c84)
      sideL.position.set(-0.67, 0.36, 0)
      group.add(sideL)
      const sideR = sideL.clone()
      sideR.position.x = 0.67
      group.add(sideR)
      break
    }
    case 'furniture.sideTable': {
      height = 0.55
      tableTop(group, 0.5, 0.5, 0.55, 0.04)
      tableLegs(group, 0.5, 0.5, 0.55)
      break
    }
    case 'furniture.lamp': {
      height = 1.6
      const baseD = cyl(0.18, 0.2, 0.05, 0x60606a)
      baseD.position.y = 0.025
      group.add(baseD)
      const pole = cyl(0.02, 0.02, 1.4, 0x70707a)
      pole.position.y = 0.7
      group.add(pole)
      const shade = cyl(0.22, 0.12, 0.3, 0xb0b0b8, 14)
      shade.position.y = 1.5
      group.add(shade)
      break
    }
    case 'furniture.chair': {
      height = 0.9
      buildSimpleChair(group)
      break
    }
    case 'furniture.stool': {
      height = 0.65
      const seat = cyl(0.18, 0.18, 0.06, 0x8d8d95)
      seat.position.y = 0.62
      group.add(seat)
      for (const [sx, sz] of [
        [-0.13, -0.13],
        [0.13, -0.13],
        [-0.13, 0.13],
        [0.13, 0.13]
      ] as [number, number][]) {
        const leg = cyl(0.02, 0.02, 0.6, 0x70707a)
        leg.position.set(sx, 0.3, sz)
        group.add(leg)
      }
      break
    }
    case 'furniture.bar': {
      height = 1.1
      const body = box(2.4, 1.1, 0.6, 0x7a7a82)
      body.position.y = 0.55
      group.add(body)
      const top = box(2.5, 0.06, 0.7, 0x9a9aa2)
      top.position.y = 1.1
      group.add(top)
      break
    }
    case 'furniture.counter': {
      height = 0.95
      const body = box(2.0, 0.9, 0.65, 0x7a7a82)
      body.position.y = 0.45
      group.add(body)
      const top = box(2.05, 0.05, 0.7, 0x9a9aa2)
      top.position.y = 0.95
      group.add(top)
      break
    }
    case 'furniture.shelf': {
      height = 1.9
      const sideL = box(0.05, 1.9, 0.5, 0x74747c)
      sideL.position.set(-0.45, 0.95, 0)
      group.add(sideL)
      const sideR = sideL.clone()
      sideR.position.x = 0.45
      group.add(sideR)
      for (let i = 0; i < 5; i++) {
        const shelf = box(0.9, 0.04, 0.5, 0x8a8a92)
        shelf.position.set(0, 0.1 + i * 0.45, 0)
        group.add(shelf)
      }
      break
    }
    case 'furniture.tv': {
      height = 0.75
      const stand = box(0.6, 0.4, 0.35, 0x70707a)
      stand.position.y = 0.2
      group.add(stand)
      const screen = box(1.1, 0.62, 0.06, 0x2a2a30)
      screen.position.y = 0.72
      group.add(screen)
      break
    }
    case 'furniture.tableSetting': {
      height = 0.12
      const surface = grp(0, 0, 0)
      group.add(surface)
      for (const [px, pz] of [
        [-0.3, 0],
        [0.3, 0],
        [0, -0.15]
      ] as [number, number][]) {
        const plate = cyl(0.12, 0.12, 0.02, 0xb0b0b8, 12)
        plate.position.set(px, 0.01, pz)
        surface.add(plate)
        const glass = cyl(0.03, 0.035, 0.1, 0x9a9aa2, 8)
        glass.position.set(px + 0.15, 0.05, pz - 0.1)
        surface.add(glass)
      }
      break
    }
    case 'furniture.door': {
      height = 2.1
      const frameL = box(0.1, 2.1, 0.15, 0x74747c)
      frameL.position.set(-0.45, 1.05, 0)
      group.add(frameL)
      const frameR = frameL.clone()
      frameR.position.x = 0.45
      group.add(frameR)
      const frameTop = box(1.0, 0.12, 0.15, 0x74747c)
      frameTop.position.set(0, 2.04, 0)
      group.add(frameTop)
      const panel = box(0.8, 2.0, 0.06, 0x8a8a92)
      panel.position.set(0, 1.0, 0)
      group.add(panel)
      const knob = sphere(0.04, 0xc0c0c8, 8)
      knob.position.set(0.3, 1.0, 0.05)
      group.add(knob)
      break
    }
    case 'furniture.window': {
      height = 1.4
      const frame = box(1.2, 1.4, 0.12, 0x74747c)
      frame.position.y = 0.7
      group.add(frame)
      const pane = box(1.0, 1.2, 0.06, 0xbcc4cc)
      pane.position.set(0, 0.7, 0.04)
      group.add(pane)
      break
    }
    case 'furniture.fridge': {
      height = 1.8
      const body = box(0.7, 1.8, 0.7, 0x9a9aa2)
      body.position.y = 0.9
      group.add(body)
      // Door split line + 2 handles.
      const split = box(0.72, 0.02, 0.02, 0x60606a)
      split.position.set(0, 1.15, 0.35)
      group.add(split)
      for (const y of [0.6, 1.5]) {
        const handle = box(0.04, 0.35, 0.06, 0x50505a)
        handle.position.set(0.28, y, 0.37)
        group.add(handle)
      }
      break
    }
    case 'furniture.stove': {
      height = 0.9
      const body = box(0.7, 0.85, 0.65, 0x82828a)
      body.position.y = 0.425
      group.add(body)
      const top = box(0.72, 0.05, 0.67, 0x3a3a42)
      top.position.y = 0.875
      group.add(top)
      // 4 burners.
      for (const [bx, bz] of [
        [-0.16, -0.15],
        [0.16, -0.15],
        [-0.16, 0.15],
        [0.16, 0.15]
      ] as [number, number][]) {
        const burner = cyl(0.09, 0.09, 0.02, 0x20202a, 12)
        burner.position.set(bx, 0.9, bz)
        group.add(burner)
      }
      // Oven door.
      const door = box(0.6, 0.45, 0.03, 0x6a6a72)
      door.position.set(0, 0.35, 0.33)
      group.add(door)
      break
    }
    case 'furniture.sinkCounter': {
      height = 0.9
      const body = box(1.2, 0.85, 0.6, 0x7a7a82)
      body.position.y = 0.425
      group.add(body)
      const top = box(1.24, 0.06, 0.64, 0x9a9aa2)
      top.position.y = 0.88
      group.add(top)
      // Recessed basin.
      const basin = box(0.5, 0.12, 0.4, 0x50505a)
      basin.position.set(0, 0.86, 0)
      group.add(basin)
      // Faucet.
      const spout = cyl(0.02, 0.02, 0.2, 0xb0b0b8, 8)
      spout.position.set(0, 1.0, -0.18)
      group.add(spout)
      const spoutArm = box(0.03, 0.03, 0.14, 0xb0b0b8)
      spoutArm.position.set(0, 1.09, -0.12)
      group.add(spoutArm)
      break
    }
    case 'furniture.toilet': {
      height = 0.75
      const base = box(0.36, 0.4, 0.5, 0x9a9aa2)
      base.position.set(0, 0.2, 0.05)
      group.add(base)
      const bowl = cyl(0.2, 0.18, 0.14, 0xa4a4ac, 12)
      bowl.position.set(0, 0.42, -0.05)
      group.add(bowl)
      const tank = box(0.38, 0.4, 0.16, 0x9a9aa2)
      tank.position.set(0, 0.55, 0.28)
      group.add(tank)
      break
    }
    case 'furniture.bathtub': {
      height = 0.6
      const shell = box(1.7, 0.6, 0.8, 0x9a9aa2)
      shell.position.y = 0.3
      group.add(shell)
      const inner = box(1.5, 0.4, 0.62, 0xb4b4bc)
      inner.position.y = 0.42
      group.add(inner)
      break
    }
    case 'furniture.showerStall': {
      height = 2.1
      const tray = box(0.9, 0.1, 0.9, 0x9a9aa2)
      tray.position.y = 0.05
      group.add(tray)
      // 2 glass walls (back +Z, side -X).
      const back = box(0.9, 2.0, 0.04, 0xbcc4cc)
      back.position.set(0, 1.05, 0.43)
      group.add(back)
      const side = box(0.04, 2.0, 0.9, 0xbcc4cc)
      side.position.set(-0.43, 1.05, 0)
      group.add(side)
      const head = cyl(0.06, 0.06, 0.05, 0xb0b0b8, 10)
      head.position.set(-0.35, 1.9, 0.35)
      group.add(head)
      break
    }
    case 'furniture.officeChair': {
      height = 1.1
      // 5-star wheeled base.
      const column = cyl(0.03, 0.03, 0.45, 0x40404a)
      column.position.y = 0.4
      group.add(column)
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU
        const spoke = box(0.05, 0.04, 0.28, 0x40404a)
        spoke.position.set(Math.sin(a) * 0.14, 0.06, Math.cos(a) * 0.14)
        spoke.rotation.y = a
        group.add(spoke)
        const caster = cyl(0.04, 0.04, 0.04, 0x2c2c32, 8)
        caster.rotation.z = Math.PI / 2
        caster.position.set(Math.sin(a) * 0.28, 0.04, Math.cos(a) * 0.28)
        group.add(caster)
      }
      const seat = box(0.46, 0.1, 0.46, 0x40404a)
      seat.position.y = 0.65
      group.add(seat)
      const backrest = box(0.44, 0.55, 0.08, 0x40404a)
      backrest.position.set(0, 0.95, 0.2)
      group.add(backrest)
      break
    }
    case 'furniture.filingCabinet': {
      height = 1.3
      const body = box(0.45, 1.3, 0.6, 0x82828a)
      body.position.y = 0.65
      group.add(body)
      for (let i = 0; i < 3; i++) {
        const drawer = box(0.42, 0.02, 0.02, 0x50505a)
        drawer.position.set(0, 0.35 + i * 0.42, 0.31)
        group.add(drawer)
        const handle = box(0.14, 0.03, 0.04, 0x50505a)
        handle.position.set(0, 0.45 + i * 0.42, 0.32)
        group.add(handle)
      }
      break
    }
    case 'furniture.whiteboard': {
      height = 1.8
      // Stand legs.
      for (const sx of [-0.7, 0.7]) {
        const leg = box(0.05, 1.8, 0.05, 0x70707a)
        leg.position.set(sx, 0.9, 0)
        group.add(leg)
      }
      const board = box(1.6, 1.0, 0.05, 0xe8e8ec)
      board.position.set(0, 1.2, 0.03)
      group.add(board)
      const frame = box(1.7, 1.1, 0.03, 0x70707a)
      frame.position.set(0, 1.2, 0.0)
      group.add(frame)
      break
    }
    case 'furniture.podium': {
      height = 1.15
      const body = box(0.55, 1.1, 0.4, 0x7a6a52)
      body.position.y = 0.55
      group.add(body)
      const top = box(0.6, 0.06, 0.45, 0x8a7a62)
      top.position.set(0, 1.12, 0)
      top.rotation.x = -0.15
      group.add(top)
      break
    }
    case 'furniture.monitor': {
      height = 0.55
      const base = box(0.2, 0.02, 0.15, 0x40404a)
      base.position.y = 0.01
      group.add(base)
      const stand = box(0.04, 0.2, 0.04, 0x40404a)
      stand.position.y = 0.12
      group.add(stand)
      const screen = box(0.6, 0.36, 0.03, 0x2a2a30)
      screen.position.y = 0.4
      group.add(screen)
      break
    }
    case 'furniture.pianoUpright': {
      height = 1.25
      const body = box(1.5, 1.2, 0.6, 0x2c2c32)
      body.position.y = 0.6
      group.add(body)
      // Keyboard shelf.
      const keys = box(1.4, 0.06, 0.3, 0xe8e8ec)
      keys.position.set(0, 0.78, 0.42)
      group.add(keys)
      const keysBack = box(1.4, 0.2, 0.15, 0x2c2c32)
      keysBack.position.set(0, 0.85, 0.36)
      group.add(keysBack)
      break
    }
    case 'furniture.poolTable': {
      height = 0.8
      const bed = box(2.4, 0.2, 1.3, 0x2f6a3f)
      bed.position.y = 0.7
      group.add(bed)
      // Rails.
      const railT = box(2.5, 0.1, 0.1, 0x5a4a3a)
      railT.position.set(0, 0.8, 0.65)
      group.add(railT)
      const railB = railT.clone()
      railB.position.z = -0.65
      group.add(railB)
      const railL = box(0.1, 0.1, 1.3, 0x5a4a3a)
      railL.position.set(-1.2, 0.8, 0)
      group.add(railL)
      const railR = railL.clone()
      railR.position.x = 1.2
      group.add(railR)
      for (const [lx, lz] of [
        [-1.1, -0.55],
        [1.1, -0.55],
        [-1.1, 0.55],
        [1.1, 0.55]
      ] as [number, number][]) {
        const leg = box(0.14, 0.6, 0.14, 0x5a4a3a)
        leg.position.set(lx, 0.3, lz)
        group.add(leg)
      }
      break
    }
    case 'furniture.hospitalBed': {
      height = 0.9
      const frame = box(0.9, 0.2, 2.0, 0x9a9aa2)
      frame.position.y = 0.5
      group.add(frame)
      const mattress = box(0.85, 0.15, 1.9, 0xb4b4bc)
      mattress.position.y = 0.68
      group.add(mattress)
      // Raised head section.
      const head = box(0.85, 0.15, 0.6, 0xb4b4bc)
      head.position.set(0, 0.78, -0.75)
      head.rotation.x = -0.4
      group.add(head)
      // Head & foot rails.
      const headRail = box(0.9, 0.4, 0.05, 0x70707a)
      headRail.position.set(0, 0.75, -1.0)
      group.add(headRail)
      const footRail = box(0.9, 0.35, 0.05, 0x70707a)
      footRail.position.set(0, 0.7, 1.0)
      group.add(footRail)
      for (const [lx, lz] of [
        [-0.4, -0.9],
        [0.4, -0.9],
        [-0.4, 0.9],
        [0.4, 0.9]
      ] as [number, number][]) {
        const leg = box(0.06, 0.4, 0.06, 0x70707a)
        leg.position.set(lx, 0.2, lz)
        group.add(leg)
      }
      break
    }
    case 'furniture.wheelchair': {
      height = 1.0
      const seat = box(0.5, 0.08, 0.5, 0x40404a)
      seat.position.y = 0.5
      group.add(seat)
      const backrest = box(0.5, 0.55, 0.06, 0x40404a)
      backrest.position.set(0, 0.78, 0.25)
      group.add(backrest)
      // Large rear wheels.
      for (const sx of [-0.32, 0.32]) {
        const bw = wheel(0.3, 0.04, 0x2c2c32)
        bw.position.set(sx, 0.3, 0.1)
        group.add(bw)
      }
      // Small front casters.
      for (const sx of [-0.24, 0.24]) {
        const fw = wheel(0.1, 0.04, 0x2c2c32)
        fw.position.set(sx, 0.1, -0.4)
        group.add(fw)
      }
      // Armrests.
      for (const sx of [-0.27, 0.27]) {
        const arm = box(0.05, 0.3, 0.4, 0x50505a)
        arm.position.set(sx, 0.65, 0)
        group.add(arm)
      }
      break
    }
    case 'furniture.crib': {
      height = 1.0
      const mattress = box(0.7, 0.1, 1.2, 0xb4b4bc)
      mattress.position.y = 0.45
      group.add(mattress)
      // Slatted rails on 4 sides.
      const rail = (w: number, d: number, x: number, z: number) => {
        const top = box(w, 0.05, d, 0x8a7a62)
        top.position.set(x, 1.0, z)
        group.add(top)
        const bot = box(w, 0.05, d, 0x8a7a62)
        bot.position.set(x, 0.35, z)
        group.add(bot)
      }
      rail(0.8, 0.05, 0, -0.65)
      rail(0.8, 0.05, 0, 0.65)
      rail(0.05, 1.3, -0.4, 0)
      rail(0.05, 1.3, 0.4, 0)
      // A few vertical slats.
      for (let i = -3; i <= 3; i++) {
        const slat = box(0.03, 0.65, 0.03, 0x8a7a62)
        slat.position.set(i * 0.11, 0.67, -0.65)
        group.add(slat)
        const slat2 = slat.clone()
        slat2.position.z = 0.65
        group.add(slat2)
      }
      break
    }
    case 'furniture.fireplace': {
      height = 1.4
      const body = box(1.6, 1.4, 0.6, 0x7a7a82)
      body.position.y = 0.7
      group.add(body)
      // Recessed opening.
      const opening = box(0.9, 0.8, 0.1, 0x1a1a1a)
      opening.position.set(0, 0.55, 0.28)
      group.add(opening)
      // Emissive inner glow.
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.5, 0.15),
        new THREE.MeshBasicMaterial({ color: 0xff6820, transparent: true, opacity: 0.85 })
      )
      glow.position.set(0, 0.4, 0.26)
      glow.castShadow = false
      glow.receiveShadow = false
      group.add(glow)
      // Mantel.
      const mantel = box(1.7, 0.12, 0.7, 0x8a8a92)
      mantel.position.set(0, 1.42, 0)
      group.add(mantel)
      break
    }
    case 'furniture.chandelier': {
      height = 2.7
      // Built from the top down so origin stays at floor; geometry hangs high.
      const hangY = 2.4
      const chain = cyl(0.02, 0.02, 0.3, 0x60606a, 6)
      chain.position.y = hangY + 0.15
      group.add(chain)
      const hub = sphere(0.12, 0xc0a860, 10)
      hub.position.y = hangY
      group.add(hub)
      // Ring of candle arms.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU
        const armX = Math.sin(a) * 0.35
        const armZ = Math.cos(a) * 0.35
        const arm = box(0.04, 0.04, 0.35, 0xc0a860)
        arm.position.set(armX * 0.5, hangY - 0.05, armZ * 0.5)
        arm.rotation.y = a
        group.add(arm)
        const cup = cyl(0.05, 0.04, 0.06, 0xc0a860, 8)
        cup.position.set(armX, hangY - 0.08, armZ)
        group.add(cup)
        const flame = new THREE.Mesh(
          new THREE.SphereGeometry(0.04, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xffcc60 })
        )
        flame.position.set(armX, hangY + 0.02, armZ)
        flame.castShadow = false
        group.add(flame)
      }
      break
    }
    case 'furniture.rug': {
      height = 0.02
      const rug = new THREE.Mesh(new THREE.PlaneGeometry(2, 3), mat(0x8a5a52))
      rug.rotation.x = -Math.PI / 2
      rug.position.y = 0.01
      rug.castShadow = false
      rug.receiveShadow = true
      ;(rug.userData as TintUserData).origColor = 0x8a5a52
      group.add(rug)
      // Inner border stripe.
      const border = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.7), mat(0x9a6a62))
      border.rotation.x = -Math.PI / 2
      border.position.y = 0.011
      border.castShadow = false
      border.receiveShadow = true
      ;(border.userData as TintUserData).origColor = 0x9a6a62
      group.add(border)
      break
    }
    case 'furniture.curtain': {
      height = 2.4
      // 3 offset wavy slabs suggesting folds.
      const offsets = [-0.5, 0, 0.5]
      const depths = [0.06, -0.06, 0.06]
      for (let i = 0; i < 3; i++) {
        const panel = box(0.55, 2.4, 0.05, 0x6a6a82)
        panel.position.set(offsets[i] ?? 0, 1.2, depths[i] ?? 0)
        panel.rotation.y = (i - 1) * 0.08
        group.add(panel)
      }
      const rod = cyl(0.03, 0.03, 1.8, 0x8a7a62, 8)
      rod.rotation.z = Math.PI / 2
      rod.position.y = 2.42
      group.add(rod)
      break
    }
    case 'furniture.bookshelfFull': {
      height = 1.9
      const sideL = box(0.05, 1.9, 0.5, 0x74747c)
      sideL.position.set(-0.45, 0.95, 0)
      group.add(sideL)
      const sideR = sideL.clone()
      sideR.position.x = 0.45
      group.add(sideR)
      const bookColors = [0xb04030, 0x3060a0, 0x408040, 0xc0a040, 0x8040a0, 0x40a0a0]
      for (let i = 0; i < 5; i++) {
        const shelfY = 0.1 + i * 0.45
        const shelf = box(0.9, 0.04, 0.5, 0x8a8a92)
        shelf.position.set(0, shelfY, 0)
        group.add(shelf)
        // Row of colored book spines above each shelf.
        for (let b = 0; b < 8; b++) {
          const bw2 = 0.06 + (b % 3) * 0.015
          const bh2 = 0.28 + ((b + i) % 3) * 0.03
          const book = box(bw2, bh2, 0.32, bookColors[(b + i) % bookColors.length])
          book.position.set(-0.38 + b * 0.1, shelfY + 0.02 + bh2 * 0.5, 0)
          book.rotation.z = b === 6 ? 0.25 : 0
          group.add(book)
        }
      }
      break
    }
    case 'furniture.doorOpen': {
      height = 2.1
      const frameL = box(0.1, 2.1, 0.15, 0x74747c)
      frameL.position.set(-0.45, 1.05, 0)
      group.add(frameL)
      const frameR = frameL.clone()
      frameR.position.x = 0.45
      group.add(frameR)
      const frameTop = box(1.0, 0.12, 0.15, 0x74747c)
      frameTop.position.set(0, 2.04, 0)
      group.add(frameTop)
      // Panel hinged at left jamb, swung 80° open toward -Z.
      const hinge = grp(-0.4, 1.0, 0)
      hinge.rotation.y = (80 * Math.PI) / 180
      group.add(hinge)
      const panel = box(0.8, 2.0, 0.06, 0x8a8a92)
      panel.position.set(0.4, 0, 0)
      hinge.add(panel)
      const knob = sphere(0.04, 0xc0c0c8, 8)
      knob.position.set(0.7, 0, 0.05)
      hinge.add(knob)
      break
    }
    default: {
      // Unknown furniture id → simple box at spec height.
      const spec = assetSpec(assetId)
      height = spec.height
      const b = box(0.6, height, 0.6)
      b.position.y = height * 0.5
      group.add(b)
    }
  }

  return finalizeStatic(group, height)
}

function tableTop(group: THREE.Group, w: number, d: number, top: number, thick: number): void {
  const t = box(w, thick, d, 0x8d8d95)
  t.position.y = top - thick * 0.5
  group.add(t)
}

function tableLegs(group: THREE.Group, w: number, d: number, top: number): void {
  const lx = w * 0.5 - 0.08
  const lz = d * 0.5 - 0.08
  const legH = top - 0.05
  for (const [sx, sz] of [
    [-lx, -lz],
    [lx, -lz],
    [-lx, lz],
    [lx, lz]
  ] as [number, number][]) {
    const leg = box(0.06, legH, 0.06, 0x70707a)
    leg.position.set(sx, legH * 0.5, sz)
    group.add(leg)
  }
}

function buildSimpleChair(group: THREE.Group): void {
  const seat = box(0.42, 0.06, 0.42, 0x8d8d95)
  seat.position.y = 0.45
  group.add(seat)
  const backrest = box(0.42, 0.45, 0.05, 0x86868e)
  backrest.position.set(0, 0.68, 0.19)
  group.add(backrest)
  const lx = 0.16
  const lz = 0.16
  for (const [sx, sz] of [
    [-lx, -lz],
    [lx, -lz],
    [-lx, lz],
    [lx, lz]
  ] as [number, number][]) {
    const leg = box(0.05, 0.45, 0.05, 0x70707a)
    leg.position.set(sx, 0.225, sz)
    group.add(leg)
  }
}

// ---------------------------------------------------------------------------
// PROPS — hand/table scale + outdoor/set dressing
// ---------------------------------------------------------------------------

/** Emissive (self-lit) mesh for flames/glows. Not tint-aware by design. */
function emissive(geo: THREE.BufferGeometry, color: number, opacity = 1): THREE.Mesh {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity })
  )
  m.castShadow = false
  m.receiveShadow = false
  return m
}

function buildProp(assetId: string): BuiltAsset {
  const group = new THREE.Group()
  group.name = assetId
  let height = 0.3
  let animate: ((input: AnimInput) => void) | undefined

  switch (assetId) {
    case 'prop.phone': {
      height = 0.15
      const body = box(0.07, 0.15, 0.008, 0x2a2a30)
      body.position.y = 0.075
      group.add(body)
      const screen = box(0.06, 0.13, 0.004, 0x4a6a9a)
      screen.position.set(0, 0.075, 0.006)
      group.add(screen)
      break
    }
    case 'prop.laptop': {
      height = 0.25
      const base = box(0.34, 0.02, 0.24, 0x82828a)
      base.position.set(0, 0.01, 0.12)
      group.add(base)
      const keys = box(0.3, 0.005, 0.18, 0x50505a)
      keys.position.set(0, 0.022, 0.13)
      group.add(keys)
      // Open screen hinged at back (-Z).
      const hinge = grp(0, 0.02, 0)
      hinge.rotation.x = -1.9
      group.add(hinge)
      const lid = box(0.34, 0.24, 0.015, 0x82828a)
      lid.position.set(0, 0.12, 0)
      hinge.add(lid)
      const disp = box(0.3, 0.2, 0.005, 0x3a5a8a)
      disp.position.set(0, 0.12, 0.011)
      hinge.add(disp)
      break
    }
    case 'prop.cup': {
      height = 0.1
      const body = cyl(0.04, 0.032, 0.1, 0xd0d0d8, 12)
      body.position.y = 0.05
      group.add(body)
      break
    }
    case 'prop.mug': {
      height = 0.1
      const body = cyl(0.042, 0.042, 0.1, 0xb0b0b8, 12)
      body.position.y = 0.05
      group.add(body)
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.03, 0.008, 6, 12),
        mat(0xb0b0b8)
      )
      ;(handle.userData as TintUserData).origColor = 0xb0b0b8
      handle.castShadow = true
      handle.position.set(0.05, 0.05, 0)
      group.add(handle)
      break
    }
    case 'prop.bowl': {
      height = 0.08
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 8, 0, TAU, 0, Math.PI / 2),
        mat(0xc0c0c8)
      )
      ;(body.userData as TintUserData).origColor = 0xc0c0c8
      body.castShadow = true
      body.receiveShadow = true
      body.rotation.x = Math.PI
      body.position.y = 0.08
      group.add(body)
      break
    }
    case 'prop.plate': {
      height = 0.03
      const body = cyl(0.13, 0.11, 0.02, 0xd0d0d8, 16)
      body.position.y = 0.01
      group.add(body)
      const rim = cyl(0.09, 0.09, 0.015, 0xc0c0c8, 16)
      rim.position.y = 0.02
      group.add(rim)
      break
    }
    case 'prop.bottle': {
      height = 0.3
      const body = cyl(0.04, 0.04, 0.2, 0x2f6a4f, 12)
      body.position.y = 0.1
      group.add(body)
      const shoulder = cyl(0.018, 0.04, 0.06, 0x2f6a4f, 12)
      shoulder.position.y = 0.23
      group.add(shoulder)
      const neck = cyl(0.015, 0.015, 0.06, 0x2f6a4f, 10)
      neck.position.y = 0.28
      group.add(neck)
      break
    }
    case 'prop.wineglass': {
      height = 0.2
      const base = cyl(0.04, 0.04, 0.008, 0xc8ccd4, 12)
      base.position.y = 0.004
      group.add(base)
      const stem = cyl(0.006, 0.006, 0.1, 0xc8ccd4, 8)
      stem.position.y = 0.055
      group.add(stem)
      const bowl = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 8, 0, TAU, 0, Math.PI / 2),
        mat(0xc8ccd4)
      )
      ;(bowl.userData as TintUserData).origColor = 0xc8ccd4
      bowl.castShadow = true
      bowl.rotation.x = Math.PI
      bowl.position.y = 0.15
      group.add(bowl)
      break
    }
    case 'prop.book': {
      height = 0.22
      // Standing on a table, spine up.
      const body = box(0.16, 0.22, 0.04, 0xb04030)
      body.position.y = 0.11
      group.add(body)
      const pages = box(0.15, 0.2, 0.03, 0xe8e8e0)
      pages.position.set(0.005, 0.11, 0)
      group.add(pages)
      break
    }
    case 'prop.newspaper': {
      height = 0.02
      const sheet = box(0.3, 0.02, 0.4, 0xd8d8d0)
      sheet.position.y = 0.01
      group.add(sheet)
      const fold = box(0.3, 0.005, 0.01, 0x808078)
      fold.position.set(0, 0.023, 0)
      group.add(fold)
      break
    }
    case 'prop.briefcase': {
      height = 0.35
      const body = box(0.44, 0.32, 0.12, 0x5a4a3a)
      body.position.y = 0.16
      group.add(body)
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
        mat(0x3a2a1a)
      )
      ;(handle.userData as TintUserData).origColor = 0x3a2a1a
      handle.castShadow = true
      handle.position.set(0, 0.32, 0)
      group.add(handle)
      break
    }
    case 'prop.suitcase': {
      height = 0.7
      const body = box(0.45, 0.7, 0.24, 0x3a4a6a)
      body.position.y = 0.35
      group.add(body)
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI),
        mat(0x2a2a30)
      )
      ;(handle.userData as TintUserData).origColor = 0x2a2a30
      handle.castShadow = true
      handle.position.set(0, 0.7, 0)
      group.add(handle)
      // Wheels.
      for (const sx of [-0.18, 0.18]) {
        const w = cyl(0.04, 0.04, 0.03, 0x2a2a30, 8)
        w.rotation.z = Math.PI / 2
        w.position.set(sx, 0.03, 0.1)
        group.add(w)
      }
      break
    }
    case 'prop.backpack': {
      height = 0.5
      const body = box(0.3, 0.45, 0.18, 0x30506a)
      body.position.y = 0.25
      group.add(body)
      const pocket = box(0.22, 0.2, 0.1, 0x3a5a74)
      pocket.position.set(0, 0.18, 0.12)
      group.add(pocket)
      // Straps.
      for (const sx of [-0.09, 0.09]) {
        const strap = box(0.04, 0.35, 0.03, 0x28455c)
        strap.position.set(sx, 0.28, -0.1)
        group.add(strap)
      }
      break
    }
    case 'prop.umbrella': {
      height = 0.9
      const shaft = cyl(0.012, 0.012, 0.8, 0x40404a, 8)
      shaft.position.y = 0.4
      group.add(shaft)
      // Furled canopy.
      const canopy = cyl(0.04, 0.015, 0.55, 0x30303a, 8)
      canopy.position.y = 0.62
      group.add(canopy)
      const handle = new THREE.Mesh(
        new THREE.TorusGeometry(0.03, 0.01, 6, 10, Math.PI),
        mat(0x5a4a3a)
      )
      ;(handle.userData as TintUserData).origColor = 0x5a4a3a
      handle.castShadow = true
      handle.rotation.y = Math.PI / 2
      handle.position.set(0, 0.02, 0.03)
      group.add(handle)
      break
    }
    case 'prop.hat': {
      height = 0.15
      const brim = cyl(0.2, 0.2, 0.02, 0x3a2a2a, 16)
      brim.position.y = 0.01
      group.add(brim)
      const crown = cyl(0.1, 0.11, 0.12, 0x3a2a2a, 14)
      crown.position.y = 0.08
      group.add(crown)
      const band = cyl(0.113, 0.113, 0.03, 0x1a1a1a, 14)
      band.position.y = 0.04
      group.add(band)
      break
    }
    case 'prop.baseballBat': {
      height = 0.9
      const bat = cyl(0.035, 0.015, 0.9, 0xa07a4a, 10)
      bat.position.y = 0.45
      group.add(bat)
      break
    }
    case 'prop.sword': {
      height = 1.0
      const blade = box(0.03, 0.8, 0.008, 0xc0c4cc)
      blade.position.y = 0.55
      group.add(blade)
      const guard = box(0.16, 0.03, 0.03, 0x8a7a3a)
      guard.position.y = 0.14
      group.add(guard)
      const grip = cyl(0.018, 0.018, 0.12, 0x3a2a1a, 8)
      grip.position.y = 0.07
      group.add(grip)
      const pommel = sphere(0.025, 0x8a7a3a, 8)
      pommel.position.y = 0.0
      group.add(pommel)
      break
    }
    case 'prop.torch': {
      height = 0.2
      const body = cyl(0.025, 0.03, 0.16, 0x2a2a30, 12)
      body.position.y = 0.08
      group.add(body)
      const head = cyl(0.04, 0.03, 0.05, 0x50505a, 12)
      head.position.y = 0.185
      group.add(head)
      const lens = emissive(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 12), 0xfff0c0)
      lens.position.y = 0.21
      group.add(lens)
      break
    }
    case 'prop.candle': {
      height = 0.15
      const holder = cyl(0.04, 0.045, 0.02, 0xc0a860, 12)
      holder.position.y = 0.01
      group.add(holder)
      const stick = cyl(0.02, 0.02, 0.1, 0xe8e0d0, 10)
      stick.position.y = 0.07
      group.add(stick)
      const flame = emissive(new THREE.SphereGeometry(0.02, 8, 8), 0xffcc50)
      flame.scale.y = 1.8
      flame.position.y = 0.14
      group.add(flame)
      break
    }
    case 'prop.lantern': {
      height = 0.3
      const base = cyl(0.06, 0.07, 0.03, 0x40404a, 12)
      base.position.y = 0.015
      group.add(base)
      const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12),
        new THREE.MeshBasicMaterial({ color: 0xffdd80, transparent: true, opacity: 0.7 })
      )
      glass.castShadow = false
      glass.position.y = 0.11
      group.add(glass)
      const top = cyl(0.04, 0.07, 0.05, 0x40404a, 12)
      top.position.y = 0.2
      group.add(top)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.03, 0.006, 6, 10),
        mat(0x40404a)
      )
      ;(ring.userData as TintUserData).origColor = 0x40404a
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.27
      group.add(ring)
      break
    }
    case 'prop.pictureFrame': {
      height = 0.4
      const frame = box(0.32, 0.4, 0.03, 0x8a7a4a)
      frame.position.y = 0.2
      group.add(frame)
      const pic = box(0.26, 0.34, 0.01, 0x6a8aa0)
      pic.position.set(0, 0.2, 0.02)
      group.add(pic)
      break
    }
    case 'prop.poster': {
      height = 0.9
      const sheet = box(0.6, 0.9, 0.01, 0xb04840)
      sheet.position.y = 0.45
      group.add(sheet)
      const band = box(0.6, 0.2, 0.012, 0x304860)
      band.position.set(0, 0.7, 0.006)
      group.add(band)
      break
    }
    case 'prop.mirror': {
      height = 1.0
      const frame = box(0.7, 1.0, 0.04, 0x9a8a6a)
      frame.position.y = 0.5
      group.add(frame)
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.9, 0.02),
        new THREE.MeshLambertMaterial({ color: 0xd0dce4 })
      )
      ;(glass.userData as TintUserData).origColor = 0xd0dce4
      glass.castShadow = true
      glass.position.set(0, 0.5, 0.03)
      group.add(glass)
      break
    }
    case 'prop.clock': {
      height = 0.4
      const face = cyl(0.2, 0.2, 0.04, 0xe8e8ec, 20)
      face.rotation.x = Math.PI / 2
      face.position.y = 0.2
      group.add(face)
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.2, 0.02, 8, 24),
        mat(0x40404a)
      )
      ;(rim.userData as TintUserData).origColor = 0x40404a
      rim.castShadow = true
      rim.position.y = 0.2
      group.add(rim)
      // Hands.
      const hh = box(0.015, 0.1, 0.01, 0x20202a)
      hh.position.set(0, 0.23, 0.03)
      group.add(hh)
      const mh = box(0.012, 0.15, 0.01, 0x20202a)
      mh.position.set(0.05, 0.2, 0.03)
      mh.rotation.z = -1.0
      group.add(mh)
      break
    }
    case 'prop.ball': {
      height = 0.22
      const b = sphere(0.11, 0xd05030, 16)
      b.position.y = 0.11
      group.add(b)
      break
    }
    case 'prop.balloon': {
      height = 0.4
      const skin = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 14), mat(0xd03040))
      ;(skin.userData as TintUserData).origColor = 0xd03040
      skin.castShadow = true
      skin.scale.y = 1.15
      skin.position.y = 0.85
      group.add(skin)
      const knot = cyl(0.02, 0.005, 0.03, 0xd03040, 6)
      knot.position.y = 0.7
      group.add(knot)
      // String down to ground.
      const string = cyl(0.003, 0.003, 0.7, 0xcccccc, 4)
      string.position.y = 0.35
      group.add(string)
      break
    }
    case 'prop.microphone': {
      height = 1.5
      // Tripod base.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU
        const leg = cyl(0.015, 0.015, 0.3, 0x2a2a30, 6)
        leg.position.set(Math.sin(a) * 0.12, 0.14, Math.cos(a) * 0.12)
        leg.rotation.x = 0.35
        leg.rotation.y = -a
        group.add(leg)
      }
      const pole = cyl(0.018, 0.018, 1.35, 0x40404a, 8)
      pole.position.y = 0.72
      group.add(pole)
      const mic = capsule(0.035, 0.08, 0x1a1a1a)
      mic.position.y = 1.46
      group.add(mic)
      break
    }
    case 'prop.guitar': {
      height = 1.0
      // Body (rounded via flattened sphere).
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), mat(0x8a5a2a))
      ;(body.userData as TintUserData).origColor = 0x8a5a2a
      body.castShadow = true
      body.scale.set(1, 1.15, 0.28)
      body.position.y = 0.25
      group.add(body)
      const hole = cyl(0.05, 0.05, 0.06, 0x2a1a0a, 12)
      hole.rotation.x = Math.PI / 2
      hole.position.set(0, 0.28, 0.05)
      group.add(hole)
      const neck = box(0.05, 0.6, 0.03, 0x5a3a1a)
      neck.position.y = 0.68
      group.add(neck)
      const head = box(0.07, 0.12, 0.025, 0x3a2a1a)
      head.position.y = 1.0
      group.add(head)
      break
    }
    case 'prop.camera': {
      height = 0.3
      const body = box(0.2, 0.18, 0.16, 0x2a2a30)
      body.position.y = 0.15
      group.add(body)
      const lens = cyl(0.06, 0.06, 0.1, 0x1a1a1a, 14)
      lens.rotation.x = Math.PI / 2
      lens.position.set(0, 0.15, -0.13)
      group.add(lens)
      // 2 film reels on top.
      for (const sx of [-0.05, 0.05]) {
        const reel = cyl(0.06, 0.06, 0.03, 0x40404a, 14)
        reel.position.set(sx, 0.27, 0)
        group.add(reel)
      }
      const handle = box(0.03, 0.12, 0.03, 0x40404a)
      handle.position.set(0, 0.06, 0.1)
      group.add(handle)
      break
    }
    case 'prop.tripod': {
      height = 1.5
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU
        const leg = cyl(0.02, 0.02, 1.5, 0x40404a, 6)
        leg.position.set(Math.sin(a) * 0.35, 0.72, Math.cos(a) * 0.35)
        leg.rotation.x = 0.24
        leg.rotation.y = -a
        group.add(leg)
      }
      const head = box(0.1, 0.08, 0.1, 0x2a2a30)
      head.position.y = 1.46
      group.add(head)
      const plate = box(0.12, 0.02, 0.14, 0x2a2a30)
      plate.position.y = 1.51
      group.add(plate)
      break
    }
    case 'prop.tree': {
      height = 3.5
      const trunk = cyl(0.18, 0.25, 1.6, 0x5a4030, 10)
      trunk.position.y = 0.8
      group.add(trunk)
      const c1 = sphere(1.1, 0x4a7040, 12)
      c1.position.y = 2.2
      group.add(c1)
      const c2 = sphere(0.85, 0x548048, 12)
      c2.position.set(0.4, 2.9, -0.2)
      group.add(c2)
      break
    }
    case 'prop.bush': {
      height = 0.8
      const positions: [number, number, number, number][] = [
        [0, 0.35, 0, 0.45],
        [-0.35, 0.3, 0.1, 0.35],
        [0.3, 0.3, -0.15, 0.38]
      ]
      for (const [x, y, z, r] of positions) {
        const b = sphere(r, 0x4a6a3a, 10)
        b.position.set(x, y, z)
        group.add(b)
      }
      break
    }
    case 'prop.rock': {
      height = 0.8
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x7a7a80))
      ;(rock.userData as TintUserData).origColor = 0x7a7a80
      rock.castShadow = true
      rock.receiveShadow = true
      rock.scale.set(1.4, 0.85, 1.1)
      rock.rotation.set(0.3, 0.7, 0.2)
      rock.position.y = 0.35
      group.add(rock)
      break
    }
    case 'prop.streetlightSingle': {
      height = 4.0
      const base = cyl(0.14, 0.18, 0.3, 0x40404a, 10)
      base.position.y = 0.15
      group.add(base)
      const pole = cyl(0.08, 0.1, 3.8, 0x55555f, 10)
      pole.position.y = 2.0
      group.add(pole)
      // Arm reaching forward (-Z).
      const arm = box(0.08, 0.08, 1.2, 0x55555f)
      arm.position.set(0, 3.9, -0.5)
      group.add(arm)
      const lamp = box(0.35, 0.15, 0.5, 0x2a2a30)
      lamp.position.set(0, 3.85, -1.0)
      group.add(lamp)
      const glow = emissive(new THREE.BoxGeometry(0.3, 0.05, 0.44), 0xfff0c0, 0.9)
      glow.position.set(0, 3.77, -1.0)
      group.add(glow)
      break
    }
    case 'prop.trafficLight': {
      height = 3.0
      const pole = cyl(0.08, 0.1, 3.0, 0x40404a, 10)
      pole.position.y = 1.5
      group.add(pole)
      const boxHousing = box(0.28, 0.8, 0.24, 0x2a2a30)
      boxHousing.position.set(0, 2.8, 0.15)
      group.add(boxHousing)
      const lightColors = [0xd03030, 0xd0c030, 0x30b040]
      for (let i = 0; i < 3; i++) {
        const light = emissive(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12), lightColors[i] ?? 0xffffff, 0.95)
        light.rotation.x = Math.PI / 2
        light.position.set(0, 3.05 - i * 0.25, 0.28)
        group.add(light)
      }
      break
    }
    case 'prop.stopSign': {
      height = 2.1
      const pole = cyl(0.04, 0.04, 2.1, 0x9a9aa2, 8)
      pole.position.y = 1.05
      group.add(pole)
      const sign = cyl(0.3, 0.3, 0.03, 0xc02020, 8)
      sign.rotation.x = Math.PI / 2
      sign.position.y = 1.9
      group.add(sign)
      break
    }
    case 'prop.fireHydrant': {
      height = 0.8
      const body = cyl(0.12, 0.14, 0.55, 0xc03020, 12)
      body.position.y = 0.28
      group.add(body)
      const cap = sphere(0.12, 0xc03020, 12)
      cap.scale.y = 0.6
      cap.position.y = 0.55
      group.add(cap)
      // Side nozzles.
      for (const sx of [-1, 1]) {
        const noz = cyl(0.05, 0.05, 0.08, 0xa02818, 8)
        noz.rotation.z = Math.PI / 2
        noz.position.set(sx * 0.14, 0.35, 0)
        group.add(noz)
      }
      const front = cyl(0.05, 0.05, 0.08, 0xa02818, 8)
      front.rotation.x = Math.PI / 2
      front.position.set(0, 0.35, -0.14)
      group.add(front)
      break
    }
    case 'prop.mailbox': {
      height = 1.1
      const post = box(0.08, 0.9, 0.08, 0x5a4a3a)
      post.position.y = 0.45
      group.add(post)
      const boxBody = box(0.25, 0.28, 0.45, 0x30506a)
      boxBody.position.set(0, 1.0, 0.05)
      group.add(boxBody)
      // Rounded top hint.
      const top = cyl(0.125, 0.125, 0.45, 0x30506a, 12)
      top.rotation.z = Math.PI / 2
      top.rotation.y = Math.PI / 2
      top.position.set(0, 1.14, 0.05)
      group.add(top)
      break
    }
    case 'prop.trashcan': {
      height = 0.9
      const body = cyl(0.24, 0.2, 0.85, 0x556055, 14)
      body.position.y = 0.425
      group.add(body)
      const lid = cyl(0.26, 0.26, 0.06, 0x445044, 14)
      lid.position.y = 0.88
      group.add(lid)
      break
    }
    case 'prop.dumpster': {
      height = 1.3
      const body = box(2.0, 1.2, 1.3, 0x3a5a3a)
      body.position.y = 0.6
      group.add(body)
      const lid = box(2.05, 0.1, 1.35, 0x2a4a2a)
      lid.position.y = 1.25
      group.add(lid)
      // Small wheels.
      for (const sx of [-0.85, 0.85]) {
        const w = cyl(0.12, 0.12, 0.08, 0x1a1a1a, 8)
        w.rotation.z = Math.PI / 2
        w.position.set(sx, 0.12, 0.5)
        group.add(w)
      }
      break
    }
    case 'prop.trafficCone': {
      height = 0.5
      const base = box(0.3, 0.03, 0.3, 0xd05020)
      base.position.y = 0.015
      group.add(base)
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.47, 12), mat(0xd85828))
      ;(cone.userData as TintUserData).origColor = 0xd85828
      cone.castShadow = true
      cone.position.y = 0.26
      group.add(cone)
      const stripe = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.08, 12), mat(0xe8e8e8))
      ;(stripe.userData as TintUserData).origColor = 0xe8e8e8
      stripe.position.y = 0.32
      group.add(stripe)
      break
    }
    case 'prop.barrier': {
      height = 1.1
      // A-frame roadwork barrier.
      const rail = box(2.0, 0.25, 0.06, 0xd05020)
      rail.position.set(0, 0.95, 0)
      group.add(rail)
      const rail2 = box(2.0, 0.1, 0.06, 0xe8e8e8)
      rail2.position.set(0, 0.55, 0)
      group.add(rail2)
      for (const sx of [-0.8, 0.8]) {
        const legF = box(0.06, 1.0, 0.06, 0x9a9aa2)
        legF.position.set(sx, 0.5, -0.25)
        legF.rotation.x = -0.25
        group.add(legF)
        const legB = box(0.06, 1.0, 0.06, 0x9a9aa2)
        legB.position.set(sx, 0.5, 0.25)
        legB.rotation.x = 0.25
        group.add(legB)
      }
      break
    }
    case 'prop.fence': {
      height = 2.0
      // 2m segment: 2 posts + slats.
      for (const sx of [-0.55, 0.55]) {
        const post = box(0.1, 2.0, 0.1, 0x6a5a4a)
        post.position.set(sx, 1.0, 0)
        group.add(post)
      }
      for (let i = 0; i < 7; i++) {
        const slat = box(0.12, 1.7, 0.03, 0x8a7a5a)
        slat.position.set(-0.5 + i * 0.166, 0.9, 0)
        group.add(slat)
      }
      const railT = box(1.2, 0.06, 0.06, 0x6a5a4a)
      railT.position.set(0, 1.6, 0)
      group.add(railT)
      const railB = railT.clone()
      railB.position.y = 0.4
      group.add(railB)
      break
    }
    case 'prop.bench': {
      height = 0.8
      const seat = box(1.6, 0.06, 0.42, 0x7a5a3a)
      seat.position.y = 0.45
      group.add(seat)
      const backrest = box(1.6, 0.35, 0.06, 0x7a5a3a)
      backrest.position.set(0, 0.65, 0.2)
      group.add(backrest)
      for (const sx of [-0.7, 0.7]) {
        const leg = box(0.08, 0.45, 0.4, 0x40404a)
        leg.position.set(sx, 0.225, 0)
        group.add(leg)
      }
      break
    }
    case 'prop.phoneBooth': {
      height = 2.4
      const body = box(1.0, 2.4, 1.0, 0xb02020)
      body.position.y = 1.2
      group.add(body)
      // Glass panels (recessed).
      for (const [x, z, w, d] of [
        [0, -0.5, 0.8, 0.04],
        [-0.5, 0, 0.04, 0.8],
        [0.5, 0, 0.04, 0.8]
      ] as [number, number, number, number][]) {
        const pane = box(w, 1.6, d, 0xbcc4cc)
        pane.position.set(x, 1.3, z)
        group.add(pane)
      }
      const roof = box(1.1, 0.15, 1.1, 0x901818)
      roof.position.y = 2.45
      group.add(roof)
      break
    }
    case 'prop.atm': {
      height = 1.6
      const body = box(0.6, 1.6, 0.5, 0x30506a)
      body.position.y = 0.8
      group.add(body)
      const screen = box(0.4, 0.3, 0.04, 0x1a2a3a)
      screen.position.set(0, 1.25, 0.26)
      group.add(screen)
      const keypad = box(0.35, 0.2, 0.03, 0x40404a)
      keypad.position.set(0, 0.95, 0.26)
      keypad.rotation.x = -0.4
      group.add(keypad)
      break
    }
    case 'prop.vendingMachine': {
      height = 1.9
      const body = box(0.9, 1.9, 0.75, 0xc02830)
      body.position.y = 0.95
      group.add(body)
      // Glass front with product grid.
      const glass = box(0.6, 1.4, 0.04, 0x223040)
      glass.position.set(-0.1, 1.05, 0.38)
      group.add(glass)
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
          const item = box(0.14, 0.14, 0.02, 0x8a8a92)
          item.position.set(-0.28 + c * 0.18, 0.55 + r * 0.32, 0.4)
          group.add(item)
        }
      }
      const slot = box(0.22, 0.5, 0.04, 0x1a1a1a)
      slot.position.set(0.28, 0.9, 0.38)
      group.add(slot)
      break
    }
    case 'prop.shoppingCart': {
      height = 1.0
      // Basket (open box of slats via a tapered box).
      const basket = box(0.5, 0.4, 0.7, 0x9a9aa2)
      basket.position.set(0, 0.65, 0.05)
      group.add(basket)
      const handle = box(0.5, 0.03, 0.03, 0xc03030)
      handle.position.set(0, 0.95, 0.45)
      group.add(handle)
      // 4 caster wheels.
      for (const [wx, wz] of [
        [-0.22, -0.3],
        [0.22, -0.3],
        [-0.22, 0.35],
        [0.22, 0.35]
      ] as [number, number][]) {
        const w = cyl(0.06, 0.06, 0.04, 0x1a1a1a, 8)
        w.rotation.z = Math.PI / 2
        w.position.set(wx, 0.06, wz)
        group.add(w)
      }
      // Frame legs.
      for (const [wx, wz] of [
        [-0.22, -0.3],
        [0.22, -0.3],
        [-0.22, 0.35],
        [0.22, 0.35]
      ] as [number, number][]) {
        const leg = box(0.03, 0.4, 0.03, 0x70707a)
        leg.position.set(wx, 0.3, wz)
        group.add(leg)
      }
      break
    }
    case 'prop.ladder': {
      height = 2.4
      // Leaning against something: tilt back around the foot.
      const lean = grp(0, 0, 0)
      lean.rotation.x = 0.25
      group.add(lean)
      for (const sx of [-0.25, 0.25]) {
        const rail = box(0.05, 2.4, 0.05, 0xa0803a)
        rail.position.set(sx, 1.2, 0)
        lean.add(rail)
      }
      for (let i = 0; i < 7; i++) {
        const rung = box(0.55, 0.04, 0.04, 0xb0904a)
        rung.position.set(0, 0.3 + i * 0.32, 0)
        lean.add(rung)
      }
      break
    }
    case 'prop.scaffold': {
      height = 4.0
      const W = 2.0
      const D = 1.2
      // 4 posts.
      for (const [px, pz] of [
        [-W / 2, -D / 2],
        [W / 2, -D / 2],
        [-W / 2, D / 2],
        [W / 2, D / 2]
      ] as [number, number][]) {
        const post = box(0.08, 4.0, 0.08, 0x55555f)
        post.position.set(px, 2.0, pz)
        group.add(post)
      }
      // 2 platform levels + cross braces.
      for (const level of [2.0, 4.0]) {
        const deck = box(W, 0.08, D, 0x8a7a5a)
        deck.position.set(0, level, 0)
        group.add(deck)
        // Rails on the upper deck edges.
        const railF = box(W, 0.05, 0.05, 0x70707a)
        railF.position.set(0, level + 1.0, -D / 2)
        group.add(railF)
        const railB = railF.clone()
        railB.position.z = D / 2
        group.add(railB)
      }
      break
    }
    case 'prop.crate': {
      height = 0.8
      const body = box(0.8, 0.8, 0.8, 0x9a7a4a)
      body.position.y = 0.4
      group.add(body)
      // Edge frame slats.
      for (const [ex, ez] of [
        [-0.38, -0.38],
        [0.38, -0.38],
        [-0.38, 0.38],
        [0.38, 0.38]
      ] as [number, number][]) {
        const edge = box(0.06, 0.82, 0.06, 0x7a5a2a)
        edge.position.set(ex, 0.4, ez)
        group.add(edge)
      }
      break
    }
    case 'prop.barrel': {
      height = 0.9
      const body = cyl(0.28, 0.28, 0.9, 0x8a6a3a, 14)
      body.position.y = 0.45
      group.add(body)
      // Ring bands.
      for (const y of [0.2, 0.7]) {
        const band = cyl(0.29, 0.29, 0.05, 0x5a4a2a, 14)
        band.position.y = y
        group.add(band)
      }
      break
    }
    case 'prop.pallet': {
      height = 0.15
      // Top deck slats.
      for (let i = 0; i < 5; i++) {
        const slat = box(1.2, 0.03, 0.14, 0xa0803a)
        slat.position.set(0, 0.13, -0.5 + i * 0.25)
        group.add(slat)
      }
      // Bottom stringers.
      for (const sx of [-0.5, 0, 0.5]) {
        const stringer = box(0.12, 0.1, 1.2, 0x8a6a2a)
        stringer.position.set(sx, 0.05, 0)
        group.add(stringer)
      }
      break
    }
    case 'prop.tent': {
      height = 1.4
      // Ridge tent: 2 sloped sides forming an A.
      const sideL = box(1.4, 0.04, 1.6, 0x2a6a4a)
      sideL.position.set(-0.5, 0.65, 0)
      sideL.rotation.z = -0.9
      group.add(sideL)
      const sideR = box(1.4, 0.04, 1.6, 0x2a6a4a)
      sideR.position.set(0.5, 0.65, 0)
      sideR.rotation.z = 0.9
      group.add(sideR)
      // Back wall triangle-ish.
      const back = box(1.4, 1.2, 0.04, 0x226040)
      back.position.set(0, 0.55, 0.8)
      group.add(back)
      break
    }
    case 'prop.campfire': {
      height = 0.5
      // Ring of stones.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU
        const stone = sphere(0.08, 0x707078, 8)
        stone.position.set(Math.sin(a) * 0.28, 0.06, Math.cos(a) * 0.28)
        group.add(stone)
      }
      // Crossed logs.
      const log1 = cyl(0.05, 0.05, 0.5, 0x5a3a1a, 8)
      log1.rotation.z = Math.PI / 2
      log1.rotation.y = 0.4
      log1.position.y = 0.08
      group.add(log1)
      const log2 = cyl(0.05, 0.05, 0.5, 0x4a3418, 8)
      log2.rotation.z = Math.PI / 2
      log2.rotation.y = -0.5
      log2.position.y = 0.08
      group.add(log2)
      // Emissive flame cone.
      const flame = emissive(new THREE.ConeGeometry(0.14, 0.45, 10), 0xff7020, 0.9)
      flame.position.y = 0.35
      group.add(flame)
      const flameCore = emissive(new THREE.ConeGeometry(0.07, 0.3, 8), 0xffd040)
      flameCore.position.y = 0.32
      group.add(flameCore)
      break
    }
    case 'prop.poolWater': {
      height = 0.05
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.05, 2),
        new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
      )
      ;(slab.userData as TintUserData).origColor = 0x3080c0
      slab.castShadow = false
      slab.receiveShadow = true
      slab.position.y = 0.025
      group.add(slab)
      break
    }
    case 'prop.fountain': {
      height = 1.6
      // Basin.
      const basin = cyl(1.1, 1.1, 0.5, 0x9a9aa2, 16)
      basin.position.y = 0.25
      group.add(basin)
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.0, 0.1, 16),
        new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
      )
      ;(water.userData as TintUserData).origColor = 0x3080c0
      water.castShadow = false
      water.position.y = 0.48
      group.add(water)
      // Central pedestal + tiers.
      const pedestal = cyl(0.15, 0.2, 0.9, 0x8a8a92, 12)
      pedestal.position.y = 0.9
      group.add(pedestal)
      const tier = cyl(0.5, 0.5, 0.1, 0x9a9aa2, 14)
      tier.position.y = 1.1
      group.add(tier)
      const spout = emissive(new THREE.CylinderGeometry(0.03, 0.05, 0.5, 8), 0x90c0e0, 0.7)
      spout.position.y = 1.45
      group.add(spout)
      break
    }
    case 'prop.flagpole': {
      height = 6.0
      const base = cyl(0.2, 0.25, 0.15, 0x40404a, 12)
      base.position.y = 0.075
      group.add(base)
      const pole = cyl(0.05, 0.07, 6.0, 0xbcbcc4, 10)
      pole.position.y = 3.0
      group.add(pole)
      const finial = sphere(0.09, 0xc0a860, 10)
      finial.position.y = 6.0
      group.add(finial)
      // Flag near the top, extending -Z.
      const flag = box(0.02, 0.7, 1.1, 0xc03030)
      flag.position.set(0, 5.55, -0.55)
      group.add(flag)
      break
    }
    case 'prop.helicopter': {
      height = 3.5
      const flyH = 3.5
      const fuselage = capsule(0.7, 2.0, 0x556070)
      fuselage.rotation.x = Math.PI / 2
      fuselage.position.set(0, flyH, 0)
      group.add(fuselage)
      // Cockpit glass at front (-Z).
      const cockpit = sphere(0.55, 0x88aacc, 12)
      cockpit.scale.set(0.9, 0.8, 1.1)
      cockpit.position.set(0, flyH, -1.3)
      group.add(cockpit)
      // Tail boom (+Z).
      const boom = cyl(0.12, 0.18, 2.6, 0x556070, 8)
      boom.rotation.x = Math.PI / 2
      boom.position.set(0, flyH + 0.1, 2.2)
      group.add(boom)
      const tailFin = box(0.06, 0.7, 0.5, 0x4a5060)
      tailFin.position.set(0, flyH + 0.4, 3.4)
      group.add(tailFin)
      // Tail rotor.
      const tailRotor = box(0.05, 0.7, 0.06, 0x2a2a30)
      tailRotor.position.set(0.15, flyH + 0.4, 3.4)
      group.add(tailRotor)
      // Skids.
      for (const sx of [-0.5, 0.5]) {
        const skid = cyl(0.04, 0.04, 2.2, 0x40404a, 6)
        skid.rotation.x = Math.PI / 2
        skid.position.set(sx, flyH - 0.85, 0)
        group.add(skid)
        const strut1 = box(0.04, 0.4, 0.04, 0x40404a)
        strut1.position.set(sx, flyH - 0.6, -0.5)
        group.add(strut1)
        const strut2 = strut1.clone()
        strut2.position.z = 0.5
        group.add(strut2)
      }
      // Main rotor — named group, spins around Y.
      const rotor = grp(0, flyH + 0.85, 0)
      rotor.name = 'rotor'
      group.add(rotor)
      const mast = cyl(0.06, 0.06, 0.25, 0x40404a, 8)
      mast.position.y = -0.12
      rotor.add(mast)
      const blade1 = box(6.0, 0.05, 0.25, 0x2a2a30)
      rotor.add(blade1)
      const blade2 = box(0.25, 0.05, 6.0, 0x2a2a30)
      rotor.add(blade2)
      animate = (input: AnimInput) => {
        // Always spin slowly; faster when moving.
        const rate = input.speed > 0 ? 30 : 3
        rotor.rotation.y = input.time * rate
        tailRotor.rotation.x = input.time * rate * 2
      }
      break
    }
    case 'prop.hotTub': {
      height = 0.9
      // Raised octagon-ish tub (12-seg cylinder reads as rounded octagon).
      const tub = cyl(0.9, 0.95, 0.85, 0x6a5a4a, 8)
      tub.position.y = 0.425
      group.add(tub)
      const rim = cyl(0.98, 0.98, 0.1, 0x7a6a5a, 8)
      rim.position.y = 0.85
      group.add(rim)
      // Translucent water disc.
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.82, 0.82, 0.1, 8),
        new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
      )
      ;(water.userData as TintUserData).origColor = 0x3080c0
      water.castShadow = false
      water.position.y = 0.78
      group.add(water)
      // Seat ledge inside.
      const ledge = cyl(0.7, 0.7, 0.25, 0x5a4a3a, 8)
      ledge.position.y = 0.5
      group.add(ledge)
      break
    }
    case 'prop.bbqGrill': {
      height = 1.1
      // Cart body.
      const cart = box(0.7, 0.5, 0.5, 0x40404a)
      cart.position.y = 0.55
      group.add(cart)
      for (const [lx, lz] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]] as [number, number][]) {
        const leg = box(0.05, 0.3, 0.05, 0x2c2c32)
        leg.position.set(lx, 0.15, lz)
        group.add(leg)
      }
      // Domed lid.
      const lid = sphere(0.4, 0x2a2a30, 12)
      lid.scale.set(1, 0.6, 0.75)
      lid.position.y = 0.85
      group.add(lid)
      // Side shelf.
      const shelf = box(0.35, 0.03, 0.4, 0x6a6a72)
      shelf.position.set(0.5, 0.8, 0)
      group.add(shelf)
      break
    }
    case 'prop.firepit': {
      height = 0.6
      // Stone ring.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU
        const stone = sphere(0.11, 0x707078, 8)
        stone.position.set(Math.sin(a) * 0.4, 0.08, Math.cos(a) * 0.4)
        group.add(stone)
      }
      // Emissive flame.
      const flame = emissive(new THREE.ConeGeometry(0.2, 0.55, 10), 0xff7020, 0.9)
      flame.position.y = 0.4
      group.add(flame)
      const flameCore = emissive(new THREE.ConeGeometry(0.1, 0.35, 8), 0xffd040)
      flameCore.position.y = 0.36
      group.add(flameCore)
      break
    }
    case 'prop.poolLounger': {
      height = 0.6
      // Frame + reclined back (head at -Z).
      const seat = box(0.6, 0.08, 1.4, 0x8a8a92)
      seat.position.set(0, 0.35, 0.1)
      group.add(seat)
      const back = box(0.6, 0.08, 0.7, 0x8a8a92)
      back.position.set(0, 0.5, -0.6)
      back.rotation.x = 0.6
      group.add(back)
      for (const lz of [-0.4, 0.6]) {
        const leg = box(0.55, 0.3, 0.05, 0x70707a)
        leg.position.set(0, 0.15, lz)
        group.add(leg)
      }
      break
    }
    case 'prop.patioUmbrellaTable': {
      height = 2.4
      // Round table.
      const top = cyl(0.6, 0.6, 0.05, 0x9a9aa2, 14)
      top.position.y = 0.74
      group.add(top)
      const stem = cyl(0.05, 0.06, 0.72, 0x70707a, 8)
      stem.position.y = 0.36
      group.add(stem)
      // Pole through the table.
      const pole = cyl(0.04, 0.04, 2.4, 0x8a8a92, 8)
      pole.position.y = 1.2
      group.add(pole)
      // Canopy.
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.5, 12), mat(0xd04040))
      ;(canopy.userData as TintUserData).origColor = 0xd04040
      canopy.castShadow = true
      canopy.position.y = 2.25
      group.add(canopy)
      break
    }
    case 'prop.picnicTable': {
      height = 0.8
      const top = box(1.6, 0.06, 0.8, 0x9a8a72)
      top.position.y = 0.74
      group.add(top)
      // A-frame benches attached both sides.
      for (const side of [-1, 1]) {
        const bench = box(1.6, 0.05, 0.28, 0x8a7a62)
        bench.position.set(0, 0.45, side * 0.62)
        group.add(bench)
      }
      // A-frame legs.
      for (const lx of [-0.65, 0.65]) {
        const legL = box(0.06, 0.74, 0.06, 0x70707a)
        legL.position.set(lx, 0.37, -0.5)
        legL.rotation.x = -0.5
        group.add(legL)
        const legR = legL.clone()
        legR.position.z = 0.5
        legR.rotation.x = 0.5
        group.add(legR)
      }
      break
    }
    case 'prop.swingSet': {
      height = 2.4
      const W = 1.6
      const topY = 2.3
      // A-frame legs both ends.
      for (const side of [-1, 1]) {
        for (const lz of [-0.6, 0.6]) {
          const leg = box(0.08, topY, 0.08, 0x70707a)
          leg.position.set(side * W * 0.5, topY * 0.5, lz)
          leg.rotation.x = lz < 0 ? -0.25 : 0.25
          group.add(leg)
        }
      }
      // Top beam.
      const beam = box(W + 0.3, 0.1, 0.1, 0x8a8a92)
      beam.position.y = topY
      group.add(beam)
      // 2 swings on chains.
      for (const sx of [-0.4, 0.4]) {
        for (const cz of [-0.15, 0.15]) {
          const chain = box(0.02, 1.3, 0.02, 0x50505a)
          chain.position.set(sx, topY - 0.65, cz)
          group.add(chain)
        }
        const seat = box(0.4, 0.04, 0.18, 0x40404a)
        seat.position.set(sx, topY - 1.3, 0)
        group.add(seat)
      }
      break
    }
    case 'prop.slide': {
      height = 2.2
      // Ladder up (+Z end), platform, chute down toward -Z.
      const topY = 2.0
      for (const lx of [-0.35, 0.35]) {
        const rail = box(0.05, topY, 0.05, 0x8a8a92)
        rail.position.set(lx, topY * 0.5, 0.7)
        group.add(rail)
      }
      for (let i = 0; i < 5; i++) {
        const rung = box(0.7, 0.04, 0.04, 0x8a8a92)
        rung.position.set(0, 0.3 + i * 0.4, 0.7)
        group.add(rung)
      }
      const platform = box(0.7, 0.05, 0.7, 0x82828a)
      platform.position.set(0, topY, 0.4)
      group.add(platform)
      // Chute sloping down toward -Z.
      const chute = box(0.6, 0.05, 2.4, 0x40a0c0)
      chute.position.set(0, topY * 0.5, -0.8)
      chute.rotation.x = 0.7
      group.add(chute)
      break
    }
    case 'prop.seesaw': {
      height = 1.0
      // Central fulcrum.
      const fulcrum = box(0.2, 0.5, 0.4, 0x70707a)
      fulcrum.position.y = 0.25
      group.add(fulcrum)
      // Tilted plank along Z.
      const plank = box(0.3, 0.08, 3.2, 0xd07040)
      plank.position.y = 0.55
      plank.rotation.x = 0.12
      group.add(plank)
      // Handles + seats at each end.
      for (const side of [-1, 1]) {
        const handle = box(0.3, 0.35, 0.05, 0x40404a)
        handle.position.set(0, 0.75 + side * 0.19, side * 1.4)
        group.add(handle)
      }
      break
    }
    case 'prop.sandbox': {
      height = 0.3
      // Wooden frame walls.
      for (const [x, z, w, d] of [[0, -0.75, 1.6, 0.12], [0, 0.75, 1.6, 0.12], [-0.75, 0, 0.12, 1.6], [0.75, 0, 0.12, 1.6]] as [number, number, number, number][]) {
        const wall = box(w, 0.25, d, 0x8a7a62)
        wall.position.set(x, 0.125, z)
        group.add(wall)
      }
      // Sand fill.
      const sand = box(1.5, 0.1, 1.5, 0xd8c890)
      sand.position.y = 0.1
      sand.receiveShadow = true
      sand.castShadow = false
      group.add(sand)
      break
    }
    case 'prop.trampoline': {
      height = 2.4
      // Round frame + mat.
      const frame = cyl(1.5, 1.5, 0.1, 0x40404a, 16)
      frame.position.y = 0.65
      group.add(frame)
      const mat0 = cyl(1.35, 1.35, 0.05, 0x2a2a30, 16)
      mat0.position.y = 0.66
      group.add(mat0)
      // Legs.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + 0.4
        const leg = cyl(0.04, 0.04, 0.65, 0x8a8a92, 6)
        leg.position.set(Math.sin(a) * 1.3, 0.325, Math.cos(a) * 1.3)
        group.add(leg)
      }
      // Safety net posts.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU
        const post = cyl(0.03, 0.03, 1.8, 0x8a8a92, 6)
        post.position.set(Math.sin(a) * 1.45, 1.55, Math.cos(a) * 1.45)
        group.add(post)
      }
      break
    }
    case 'prop.kiddiePool': {
      height = 0.3
      const rim = cyl(0.9, 0.9, 0.28, 0x40a0c0, 14)
      rim.position.y = 0.14
      group.add(rim)
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(0.78, 0.78, 0.1, 14),
        new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
      )
      ;(water.userData as TintUserData).origColor = 0x3080c0
      water.castShadow = false
      water.position.y = 0.2
      group.add(water)
      break
    }
    case 'prop.basketballHoop': {
      height = 3.05
      const pole = cyl(0.09, 0.11, 3.05, 0x50505a, 10)
      pole.position.y = 1.525
      group.add(pole)
      // Backboard (faces -Z).
      const board = box(1.2, 0.7, 0.05, 0xe8e8ec)
      board.position.set(0, 2.9, -0.4)
      group.add(board)
      // Ring.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.03, 6, 14), mat(0xd06020))
      ;(ring.userData as TintUserData).origColor = 0xd06020
      ring.rotation.x = Math.PI / 2
      ring.castShadow = true
      ring.position.set(0, 2.6, -0.6)
      group.add(ring)
      break
    }
    case 'prop.soccerGoal': {
      height = 2.44
      const W = 3.66
      const H = 2.44
      // Posts + crossbar (opening faces -Z).
      for (const sx of [-W * 0.5, W * 0.5]) {
        const post = cyl(0.06, 0.06, H, 0xe8e8ec, 8)
        post.position.set(sx, H * 0.5, 0)
        group.add(post)
      }
      const bar = cyl(0.06, 0.06, W, 0xe8e8ec, 8)
      bar.rotation.z = Math.PI / 2
      bar.position.set(0, H, 0)
      group.add(bar)
      // Angled net panel (sloping back +Z toward the ground).
      const net = new THREE.Mesh(
        new THREE.PlaneGeometry(W, 2.4),
        new THREE.MeshLambertMaterial({ color: 0xcccccc, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
      )
      ;(net.userData as TintUserData).origColor = 0xcccccc
      net.rotation.x = -Math.PI / 3
      net.position.set(0, H * 0.5, 0.9)
      group.add(net)
      break
    }
    case 'prop.doghouse': {
      height = 0.9
      const body = box(0.7, 0.6, 0.8, 0x8a7a62)
      body.position.y = 0.3
      group.add(body)
      // Pitched roof (two slabs).
      for (const side of [-1, 1]) {
        const roof = box(0.5, 0.05, 0.85, 0x6a4a3a)
        roof.position.set(side * 0.18, 0.72, 0)
        roof.rotation.z = side * -0.7
        group.add(roof)
      }
      // Doorway.
      const door = box(0.3, 0.4, 0.05, 0x2a2a30)
      door.position.set(0, 0.2, -0.41)
      group.add(door)
      break
    }
    case 'prop.shed': {
      height = 2.3
      const body = box(2.0, 1.9, 1.5, 0x7a7a82)
      body.position.y = 0.95
      group.add(body)
      // Pitched roof.
      for (const side of [-1, 1]) {
        const roof = box(1.2, 0.06, 1.6, 0x5a4a3a)
        roof.position.set(side * 0.5, 2.1, 0)
        roof.rotation.z = side * -0.5
        group.add(roof)
      }
      // Double doors (front -Z).
      const door = box(0.9, 1.5, 0.05, 0x6a5a4a)
      door.position.set(0, 0.75, -0.76)
      group.add(door)
      break
    }
    case 'prop.gazebo': {
      height = 3.0
      // 4 posts + railing + pyramid roof.
      const R = 1.4
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4
        const post = box(0.1, 2.2, 0.1, 0x8a7a62)
        post.position.set(Math.sin(a) * R, 1.1, Math.cos(a) * R)
        group.add(post)
      }
      // Railing ring hint.
      const rail = cyl(R, R, 0.08, 0x8a7a62, 4)
      rail.rotation.y = Math.PI / 4
      rail.position.y = 0.8
      group.add(rail)
      // Floor.
      const floor = cyl(R + 0.1, R + 0.1, 0.1, 0x9a8a72, 4)
      floor.rotation.y = Math.PI / 4
      floor.position.y = 0.05
      group.add(floor)
      // Pyramid roof.
      const roof = new THREE.Mesh(new THREE.ConeGeometry(R + 0.4, 0.9, 4), mat(0x6a4a3a))
      ;(roof.userData as TintUserData).origColor = 0x6a4a3a
      roof.rotation.y = Math.PI / 4
      roof.castShadow = true
      roof.position.y = 2.65
      group.add(roof)
      break
    }
    case 'prop.hammock': {
      height = 1.2
      // Two posts.
      for (const sz of [-1.4, 1.4]) {
        const post = cyl(0.05, 0.06, 1.4, 0x8a7a62, 8)
        post.position.set(0, 0.7, sz)
        group.add(post)
      }
      // Sagging mat (curved via 3 boxes).
      const segs: [number, number][] = [[-1.0, 0.75], [0, 0.5], [1.0, 0.75]]
      for (const [z, y] of segs) {
        const seg = box(0.6, 0.04, 0.9, 0x40a0c0)
        seg.position.set(0, y, z)
        group.add(seg)
      }
      break
    }
    case 'prop.lawnmower': {
      height = 1.0
      // Deck.
      const deck = box(0.55, 0.2, 0.55, 0xd04040)
      deck.position.y = 0.2
      group.add(deck)
      // 4 wheels.
      for (const [wx, wz] of [[-0.25, -0.2], [0.25, -0.2], [-0.25, 0.2], [0.25, 0.2]] as [number, number][]) {
        const w = wheel(0.1, 0.06, 0x2c2c30)
        w.position.set(wx, 0.1, wz)
        group.add(w)
      }
      // Handle sloping up toward +Z.
      const handle = box(0.5, 0.04, 0.8, 0x50505a)
      handle.position.set(0, 0.6, 0.45)
      handle.rotation.x = -0.7
      group.add(handle)
      break
    }
    case 'prop.cashRegister': {
      height = 0.35
      const body = box(0.35, 0.22, 0.3, 0x40404a)
      body.position.y = 0.11
      group.add(body)
      // Angled display + emissive screen.
      const disp = box(0.28, 0.16, 0.03, 0x2a2a30)
      disp.position.set(0, 0.3, -0.1)
      disp.rotation.x = -0.4
      group.add(disp)
      const screen = emissive(new THREE.PlaneGeometry(0.22, 0.1), 0x60d0a0, 0.9)
      screen.position.set(0, 0.31, -0.09)
      screen.rotation.x = -0.4
      group.add(screen)
      // Drawer front.
      const drawer = box(0.34, 0.08, 0.02, 0x2a2a30)
      drawer.position.set(0, 0.06, -0.16)
      group.add(drawer)
      break
    }
    case 'prop.kiosk': {
      height = 2.6
      // Counter.
      const counter = box(1.6, 1.0, 0.7, 0x7a6a52)
      counter.position.y = 0.5
      group.add(counter)
      const top = box(1.7, 0.05, 0.8, 0x9a8a72)
      top.position.y = 1.02
      group.add(top)
      // Corner posts.
      for (const [px, pz] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]] as [number, number][]) {
        const post = box(0.08, 2.4, 0.08, 0x70707a)
        post.position.set(px, 1.2, pz)
        group.add(post)
      }
      // Roof.
      const roof = box(2.0, 0.15, 1.1, 0xc03030)
      roof.position.y = 2.5
      group.add(roof)
      break
    }
    case 'prop.gasPump': {
      height = 1.5
      const body = box(0.5, 1.4, 0.35, 0xd04040)
      body.position.y = 0.7
      group.add(body)
      // Emissive display.
      const disp = emissive(new THREE.PlaneGeometry(0.36, 0.25), 0x40d0d0, 0.9)
      disp.position.set(0, 1.05, -0.18)
      group.add(disp)
      // Nozzle holster.
      const nozzle = box(0.1, 0.25, 0.08, 0x2a2a30)
      nozzle.position.set(0.28, 0.9, 0)
      group.add(nozzle)
      // Base.
      const base = box(0.6, 0.15, 0.45, 0x50505a)
      base.position.y = 0.075
      group.add(base)
      break
    }
    case 'prop.parkingMeter': {
      height = 1.3
      const pole = cyl(0.03, 0.04, 1.1, 0x50505a, 8)
      pole.position.y = 0.55
      group.add(pole)
      const headM = box(0.14, 0.3, 0.1, 0x40404a)
      headM.position.y = 1.2
      group.add(headM)
      const face = emissive(new THREE.PlaneGeometry(0.1, 0.12), 0x60d0a0, 0.9)
      face.position.set(0, 1.22, -0.06)
      group.add(face)
      break
    }
    case 'prop.busShelter': {
      height = 2.4
      // Roof.
      const roof = box(3.0, 0.1, 1.4, 0x50505a)
      roof.position.y = 2.35
      group.add(roof)
      // Back + side glass panels.
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(3.0, 2.0, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
      )
      ;(back.userData as TintUserData).origColor = 0xbcc4cc
      back.position.set(0, 1.2, 0.68)
      group.add(back)
      for (const sx of [-1.5, 1.5]) {
        const side = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 2.0, 1.4),
          new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
        )
        ;(side.userData as TintUserData).origColor = 0xbcc4cc
        side.position.set(sx, 1.2, 0)
        group.add(side)
      }
      // Bench.
      const bench = box(2.4, 0.1, 0.4, 0x70707a)
      bench.position.set(0, 0.45, 0.4)
      group.add(bench)
      break
    }
    case 'prop.slotMachine': {
      height = 1.7
      const body = box(0.5, 1.1, 0.4, 0xc03030)
      body.position.y = 1.15
      group.add(body)
      const base = box(0.5, 0.6, 0.4, 0x8a2020)
      base.position.y = 0.3
      group.add(base)
      // Emissive reel face.
      const face = emissive(new THREE.PlaneGeometry(0.38, 0.35), 0xffd040, 0.95)
      face.position.set(0, 1.25, -0.21)
      group.add(face)
      // Emissive top marquee.
      const marquee = emissive(new THREE.PlaneGeometry(0.44, 0.2), 0xff40a0, 0.9)
      marquee.position.set(0, 1.6, -0.21)
      group.add(marquee)
      // Lever.
      const lever = cyl(0.02, 0.02, 0.35, 0x9a9aa2, 6)
      lever.position.set(0.28, 1.2, 0)
      lever.rotation.z = -0.3
      group.add(lever)
      const knob = sphere(0.05, 0xd04040, 8)
      knob.position.set(0.33, 1.37, 0)
      group.add(knob)
      break
    }
    case 'prop.cloud': {
      height = 2.5
      // Puffy cluster floating at ~4m (like helicopter built at height).
      const floatY = 4
      const puffs: [number, number, number, number][] = [
        [0, 0, 0, 1.2],
        [1.1, -0.2, 0.3, 0.9],
        [-1.0, -0.1, -0.2, 0.95],
        [0.5, 0.3, -0.6, 0.8],
        [-0.6, 0.2, 0.5, 0.75]
      ]
      for (const [px, py, pz, r] of puffs) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(r, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xf4f6fa, transparent: true, opacity: 0.85 })
        )
        puff.castShadow = false
        puff.receiveShadow = false
        puff.position.set(px, floatY + py, pz)
        group.add(puff)
      }
      break
    }
    case 'prop.squirtGun': {
      height = 0.35
      // Chunky toy pistol — bright orange body, barrel points -Z. Reads as a toy.
      const grip = box(0.07, 0.22, 0.1, 0xff7020)
      grip.position.set(0, 0.11, 0.09)
      grip.rotation.x = 0.25
      group.add(grip)
      // Fat barrel.
      const barrel = cyl(0.05, 0.06, 0.28, 0xff7020, 10)
      barrel.rotation.x = Math.PI / 2
      barrel.position.set(0, 0.28, -0.06)
      group.add(barrel)
      // Muzzle tip (bright yellow safety cap).
      const muzzle = cyl(0.03, 0.045, 0.05, 0xffd040, 10)
      muzzle.rotation.x = Math.PI / 2
      muzzle.position.set(0, 0.28, -0.22)
      group.add(muzzle)
      // Trigger loop.
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 6, 12), mat(0xff7020))
      ;(guard.userData as TintUserData).origColor = 0xff7020
      guard.castShadow = true
      guard.position.set(0, 0.16, 0.03)
      group.add(guard)
      // Blue water tank on top.
      const tank = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.05, 0.14, 4, 8),
        new THREE.MeshLambertMaterial({ color: 0x3080d0, transparent: true, opacity: 0.75 })
      )
      ;(tank.userData as TintUserData).origColor = 0x3080d0
      tank.castShadow = true
      tank.rotation.z = Math.PI / 2
      tank.position.set(0, 0.36, 0.02)
      group.add(tank)
      break
    }
    default: {
      const spec = assetSpec(assetId)
      height = spec.height
      const b = box(0.4, height, 0.4, 0x9a9aa2)
      b.position.y = height * 0.5
      group.add(b)
    }
  }

  const setTint = makeSetTint(group)
  return { group, height, animate, setTint }
}

// ---------------------------------------------------------------------------
// ENVIRONMENTS
// ---------------------------------------------------------------------------

function wallMesh(w: number, h: number, thickness: number, color = 0x9a9aa2): THREE.Mesh {
  return box(w, h, thickness, color)
}

interface EnvResult {
  group: THREE.Group
  height: number
  animate?: (input: AnimInput) => void
}

function buildEnv(assetId: string): BuiltAsset {
  const group = new THREE.Group()
  group.name = assetId
  const spec = assetSpec(assetId)
  let res: EnvResult = { group, height: spec.height }

  switch (assetId) {
    case 'env.houseInterior':
      res = envHouseInterior(group)
      break
    case 'env.houseExterior':
      res = envHouseExterior(group)
      break
    case 'env.cityStreet':
      res = envCityStreet(group)
      break
    case 'env.store':
      res = envStore(group)
      break
    case 'env.nightclub':
      res = envNightclub(group)
      break
    case 'env.office':
      res = envOffice(group)
      break
    case 'env.warehouse':
      res = envWarehouse(group)
      break
    case 'env.carInterior':
      res = envCarInterior(group)
      break
    case 'env.busInterior':
      res = envBusInterior(group)
      break
    case 'env.planeCabin':
      res = envPlaneCabin(group)
      break
    case 'env.field':
      res = envField(group)
      break
    case 'env.desert':
      res = envDesert(group)
      break
    case 'env.parkingLot':
      res = envParkingLot(group)
      break
    case 'env.alley':
      res = envAlley(group)
      break
    case 'env.rooftop':
      res = envRooftop(group)
      break
    case 'env.restaurant':
      res = envRestaurant(group)
      break
    case 'env.hospitalRoom':
      res = envHospitalRoom(group)
      break
    case 'env.classroom':
      res = envClassroom(group)
      break
    case 'env.gym':
      res = envGym(group)
      break
    case 'env.courtroom':
      res = envCourtroom(group)
      break
    case 'env.subwayPlatform':
      res = envSubwayPlatform(group)
      break
    case 'env.beach':
      res = envBeach(group)
      break
    case 'env.forest':
      res = envForest(group)
      break
    case 'env.bar':
      res = envBar(group)
      break
    case 'env.stage':
      res = envStage(group)
      break
    case 'env.trainInterior':
      res = envTrainInterior(group)
      break
    case 'env.boatInterior':
      res = envBoatInterior(group)
      break
    case 'env.postOffice':
      res = envPostOffice(group)
      break
    case 'env.supermarket':
      res = envSupermarket(group)
      break
    case 'env.movieTheater':
      res = envMovieTheater(group)
      break
    case 'env.indoorMall':
      res = envIndoorMall(group)
      break
    case 'env.hotelLobby':
      res = envHotelLobby(group)
      break
    case 'env.hotelRoom':
      res = envHotelRoom(group)
      break
    case 'env.diner':
      res = envDiner(group)
      break
    case 'env.coffeeShop':
      res = envCoffeeShop(group)
      break
    case 'env.policeStation':
      res = envPoliceStation(group)
      break
    case 'env.church':
      res = envChurch(group)
      break
    case 'env.schoolHallway':
      res = envSchoolHallway(group)
      break
    case 'env.airportTerminal':
      res = envAirportTerminal(group)
      break
    case 'env.casino':
      res = envCasino(group)
      break
    case 'env.parkingGarage':
      res = envParkingGarage(group)
      break
    case 'env.stripMall':
      res = envStripMall(group)
      break
    case 'env.outdoorMall':
      res = envOutdoorMall(group)
      break
    case 'env.residentialStreet':
      res = envResidentialStreet(group)
      break
    case 'env.downtown':
      res = envDowntown(group)
      break
    case 'env.trainStation':
      res = envTrainStation(group)
      break
    case 'env.gasStation':
      res = envGasStation(group)
      break
    case 'env.park':
      res = envPark(group)
      break
    case 'env.playgroundPark':
      res = envPlaygroundPark(group)
      break
    case 'env.backyard':
      res = envBackyard(group)
      break
    case 'env.constructionSite':
      res = envConstructionSite(group)
      break
    case 'env.cemetery':
      res = envCemetery(group)
      break
    case 'env.stadium':
      res = envStadium(group)
      break
    case 'env.sky':
      res = envSky(group)
      break
    case 'env.houseFull':
      res = envHouseFull(group)
      break
    default: {
      const b = box(2, spec.height, 2)
      b.position.y = spec.height * 0.5
      group.add(b)
    }
  }

  const setTint = makeSetTint(res.group)
  return { group: res.group, height: res.height, animate: res.animate, setTint }
}

function envHouseInterior(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 2.7
  const t = 0.15
  group.add(ground(S, S, 0x76767e))
  // Back wall (+Z) and two sides; front (-Z) open for camera.
  const back = wallMesh(S, wallH, t)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
  // 2 window openings on the back wall (frame + lighter inset).
  for (const x of [-4, 4]) {
    const frame = box(1.6, 1.4, 0.16, 0x84848c)
    frame.position.set(x, 1.5, S * 0.5 - 0.01)
    group.add(frame)
    const pane = box(1.3, 1.1, 0.05, 0xbcc4cc)
    pane.position.set(x, 1.5, S * 0.5 - 0.06)
    group.add(pane)
  }
  // Door opening on left wall.
  const door = box(0.1, 2.1, 1.0, 0x6a6a72)
  door.position.set(-S * 0.5 + 0.02, 1.05, -3)
  group.add(door)
  return { group, height: wallH }
}

function envHouseExterior(group: THREE.Group): EnvResult {
  const S = 20
  group.add(ground(S, S, 0x7a8a6e))
  // House block.
  const bodyH = 3.5
  const bw = 8
  const bd = 7
  const body = box(bw, bodyH, bd, 0x8a8a92)
  body.position.y = bodyH * 0.5
  group.add(body)
  // Pitched roof: 2 rotated boxes.
  const roofL = box(bw + 0.6, 0.25, 5, 0x6a5a52)
  roofL.position.set(0, bodyH + 1.2, -1.7)
  roofL.rotation.x = -0.6
  group.add(roofL)
  const roofR = box(bw + 0.6, 0.25, 5, 0x6a5a52)
  roofR.position.set(0, bodyH + 1.2, 1.7)
  roofR.rotation.x = 0.6
  group.add(roofR)
  // Door + windows on front (-Z).
  const door = box(1.0, 2.1, 0.1, 0x5a4a42)
  door.position.set(0, 1.05, -bd * 0.5 - 0.01)
  group.add(door)
  for (const x of [-2.5, 2.5]) {
    const win = box(1.2, 1.2, 0.1, 0xbcc4cc)
    win.position.set(x, 1.7, -bd * 0.5 - 0.01)
    group.add(win)
  }
  // Path.
  const path = box(1.5, 0.02, 6, 0x9a9a9a)
  path.position.set(0, 0.01, -bd * 0.5 - 3)
  path.receiveShadow = true
  path.castShadow = false
  group.add(path)
  return { group, height: 6 }
}

function envCityStreet(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0x6e6e74))
  // Asphalt strip down Z.
  const asphalt = box(8, 0.02, S, 0x53545c)
  asphalt.position.y = 0.011
  asphalt.receiveShadow = true
  asphalt.castShadow = false
  group.add(asphalt)
  // Dashed center line.
  for (let z = -S * 0.5 + 1; z < S * 0.5; z += 3) {
    const dash = box(0.2, 0.02, 1.2, 0xd0d060)
    dash.position.set(0, 0.02, z)
    dash.receiveShadow = true
    dash.castShadow = false
    group.add(dash)
  }
  // Raised sidewalks both sides.
  for (const x of [-6, 6]) {
    const sw = box(4, 0.2, S, 0x9a9aa2)
    sw.position.set(x, 0.1, 0)
    group.add(sw)
  }
  // 4–6 building blocks set back, varying heights.
  const heights = [12, 18, 9, 20, 14, 16]
  const zs = [-10, -3, 4, 11, -7, 8]
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const bh = heights[i] ?? 12
    const b = box(6, bh, 5, i % 2 === 0 ? 0x83838b : 0x8c8c94)
    b.position.set(side * 11, bh * 0.5, zs[i] ?? 0)
    group.add(b)
  }
  // 2 streetlight poles with arm.
  for (const [x, z] of [
    [-8.2, -5],
    [8.2, 5]
  ] as [number, number][]) {
    const pole = cyl(0.1, 0.12, 6, 0x55555f)
    pole.position.set(x, 3, z)
    group.add(pole)
    const arm = box(1.6, 0.1, 0.1, 0x55555f)
    arm.position.set(x + (x < 0 ? 0.8 : -0.8), 5.9, z)
    group.add(arm)
  }
  return { group, height: 12 }
}

function envStore(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3.5
  const t = 0.15
  group.add(ground(S, S, 0x9a9aa2))
  // 3 walls, front open.
  const back = wallMesh(S, wallH, t)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
  // 4 shelf-aisle rows.
  for (let i = 0; i < 4; i++) {
    const x = -6 + i * 4
    const shelf = box(1.0, 1.8, 12, 0x81818a)
    shelf.position.set(x, 0.9, -1)
    group.add(shelf)
  }
  // Checkout counter.
  const counter = box(3, 1.0, 0.8, 0x7a7a82)
  counter.position.set(0, 0.5, S * 0.5 - 3)
  group.add(counter)
  return { group, height: wallH }
}

function envNightclub(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 4
  const t = 0.15
  group.add(ground(S, S, 0x25252b))
  const back = wallMesh(S, wallH, t, 0x2c2c32)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S, 0x2c2c32)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
  // Bar along one side.
  const bar = box(0.7, 1.1, 14, 0x3a3a42)
  bar.position.set(-S * 0.5 + 1.5, 0.55, 0)
  group.add(bar)
  // DJ booth.
  const booth = box(3, 1.3, 1.5, 0x40404a)
  booth.position.set(0, 0.65, S * 0.5 - 3)
  group.add(booth)
  // 4 colored emissive cones from ceiling (MeshBasicMaterial, transparent).
  const coneGroup = grp(0, 0, 0)
  group.add(coneGroup)
  const colors = [0xff3040, 0x3060ff, 0x30ff60, 0xff30ff]
  const spots: [number, number][] = [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5]
  ]
  const cones: THREE.Mesh[] = []
  for (let i = 0; i < 4; i++) {
    const c = spots[i] ?? [0, 0]
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 4, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: colors[i] ?? 0xffffff,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide
      })
    )
    // Apex up at ceiling, opening down.
    cone.position.set(c[0], 2, c[1])
    cone.castShadow = false
    cone.receiveShadow = false
    coneGroup.add(cone)
    cones.push(cone)
  }
  const animate = (input: AnimInput) => {
    coneGroup.rotation.y = input.time * 0.4
  }
  return { group, height: wallH, animate }
}

function envOffice(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 2.8
  const t = 0.15
  group.add(ground(S, S, 0x84848c))
  const back = wallMesh(S, wallH, t)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
  // 4 desk+chair clusters.
  for (const [x, z] of [
    [-5, -4],
    [5, -4],
    [-5, 4],
    [5, 4]
  ] as [number, number][]) {
    const cluster = grp(x, 0, z)
    group.add(cluster)
    const top = box(1.4, 0.05, 0.7, 0x8d8d95)
    top.position.y = 0.72
    cluster.add(top)
    const legs = box(1.3, 0.68, 0.6, 0x70707a)
    legs.position.y = 0.35
    cluster.add(legs)
    const chair = grp(0, 0, -0.6)
    cluster.add(chair)
    buildSimpleChair(chair)
  }
  return { group, height: wallH }
}

function envWarehouse(group: THREE.Group): EnvResult {
  const S = 24
  const wallH = 6
  const t = 0.2
  group.add(ground(S, S, 0x7a7a80))
  const back = wallMesh(S, wallH, t)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
  // Stacked crate piles.
  const cratePos: [number, number][] = [
    [-6, -6],
    [-6, 6],
    [6, -6]
  ]
  for (const [cx, cz] of cratePos) {
    for (let i = 0; i < 3; i++) {
      const crate = box(1.2, 1.2, 1.2, i % 2 === 0 ? 0x8a7a5a : 0x92826a)
      crate.position.set(cx + (i === 2 ? 0.5 : 0), 0.6 + i * 1.2, cz)
      group.add(crate)
    }
  }
  // 2 shelving racks.
  for (const x of [-2, 4]) {
    const rack = grp(x, 0, 4)
    group.add(rack)
    const postH = 5
    for (const px of [-1.5, 1.5]) {
      const post = box(0.15, postH, 0.15, 0x55555f)
      post.position.set(px, postH * 0.5, 0)
      rack.add(post)
    }
    for (let s = 0; s < 3; s++) {
      const shelf = box(3.2, 0.1, 1.2, 0x6a6a72)
      shelf.position.set(0, 1 + s * 1.8, 0)
      rack.add(shelf)
    }
  }
  return { group, height: wallH }
}

function envCarInterior(group: THREE.Group): EnvResult {
  // No roof/walls. Floor + 2 seat rows + dashboard + steering wheel.
  const floor = box(1.8, 0.05, 3.2, 0x50505a)
  floor.position.y = 0.02
  floor.receiveShadow = true
  floor.castShadow = false
  group.add(floor)
  // Seats: front row (-Z), back row (+Z).
  const mkSeat = (x: number, z: number) => {
    const base = box(0.55, 0.15, 0.55, 0x3a3a42)
    base.position.set(x, 0.4, z)
    group.add(base)
    const backrest = box(0.55, 0.6, 0.12, 0x3a3a42)
    backrest.position.set(x, 0.75, z + 0.28)
    group.add(backrest)
  }
  mkSeat(-0.45, -0.6)
  mkSeat(0.45, -0.6)
  mkSeat(-0.45, 0.7)
  mkSeat(0.45, 0.7)
  // Dashboard block at front.
  const dash = box(1.7, 0.4, 0.35, 0x2c2c32)
  dash.position.set(0, 0.7, -1.4)
  group.add(dash)
  // Steering wheel torus (driver on left, forward -Z).
  const wheelT = new THREE.Mesh(
    new THREE.TorusGeometry(0.17, 0.03, 8, 16),
    mat(0x20202a)
  )
  ;(wheelT.userData as TintUserData).origColor = 0x20202a
  wheelT.castShadow = true
  wheelT.position.set(-0.45, 0.85, -1.15)
  wheelT.rotation.x = 1.2
  group.add(wheelT)
  return { group, height: 1.3 }
}

function envBusInterior(group: THREE.Group): EnvResult {
  // Floor + 6 seat rows (2 columns) + side window band. No roof.
  const floor = box(2.5, 0.05, 11, 0x50505a)
  floor.position.y = 0.02
  floor.receiveShadow = true
  floor.castShadow = false
  group.add(floor)
  for (let r = 0; r < 6; r++) {
    const z = -4.5 + r * 1.8
    for (const x of [-0.7, 0.7]) {
      const base = box(0.55, 0.12, 0.5, 0x3a3a42)
      base.position.set(x, 0.45, z)
      group.add(base)
      const backrest = box(0.55, 0.55, 0.1, 0x40404a)
      backrest.position.set(x, 0.72, z + 0.25)
      group.add(backrest)
    }
  }
  // Side window bands (thin light boxes).
  for (const x of [-1.24, 1.24]) {
    const band = box(0.04, 0.6, 10, 0xbcc4cc)
    band.position.set(x, 1.3, 0)
    group.add(band)
  }
  return { group, height: 2.2 }
}

function envPlaneCabin(group: THREE.Group): EnvResult {
  // Floor + 6 rows × (2+2) seats with aisle + curved side hints + overhead bins. No roof.
  const floor = box(3.2, 0.05, 12, 0x60606a)
  floor.position.y = 0.02
  floor.receiveShadow = true
  floor.castShadow = false
  group.add(floor)
  const seatX = [-1.1, -0.6, 0.6, 1.1] // aisle gap in middle
  for (let r = 0; r < 6; r++) {
    const z = -5 + r * 1.8
    for (const x of seatX) {
      const base = box(0.42, 0.12, 0.5, 0x3a3a42)
      base.position.set(x, 0.45, z)
      group.add(base)
      const backrest = box(0.42, 0.5, 0.1, 0x40404a)
      backrest.position.set(x, 0.7, z + 0.25)
      group.add(backrest)
    }
  }
  // Curved-ish side hints (angled boxes).
  for (const side of [-1, 1]) {
    const sideWall = box(0.1, 1.6, 12, 0x9a9aa2)
    sideWall.position.set(side * 1.55, 1.2, 0)
    sideWall.rotation.z = side * 0.25
    group.add(sideWall)
    // Overhead bins.
    const bin = box(0.6, 0.4, 11, 0x8a8a92)
    bin.position.set(side * 1.3, 2.0, 0)
    group.add(bin)
  }
  return { group, height: 2.2 }
}

function envField(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0x6f8060))
  // A few low bush mounds (squashed spheres).
  const bushes: [number, number][] = [
    [-8, -6],
    [5, -9],
    [10, 4],
    [-6, 8],
    [2, 2]
  ]
  for (const [x, z] of bushes) {
    const bush = sphere(1.0, 0x5c7050, 10)
    bush.scale.y = 0.4
    bush.position.set(x, 0.35, z)
    group.add(bush)
  }
  return { group, height: 0.1 }
}

function envDesert(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0xc4b088))
  // 2 dune mounds.
  for (const [x, z, r] of [
    [-8, -4, 4],
    [7, 6, 5]
  ] as [number, number, number][]) {
    const dune = sphere(r, 0xbca878, 12)
    dune.scale.y = 0.25
    dune.position.set(x, 0.2, z)
    group.add(dune)
  }
  // 1 cactus (cylinder + 2 arms).
  const trunk = cyl(0.25, 0.3, 3, 0x5c7050)
  trunk.position.set(0, 1.5, 0)
  group.add(trunk)
  const armL = cyl(0.15, 0.15, 1.2, 0x5c7050)
  armL.position.set(-0.5, 1.8, 0)
  armL.rotation.z = 0.6
  group.add(armL)
  const armLup = cyl(0.15, 0.15, 0.8, 0x5c7050)
  armLup.position.set(-0.85, 2.3, 0)
  group.add(armLup)
  const armR = cyl(0.15, 0.15, 1.0, 0x5c7050)
  armR.position.set(0.5, 2.1, 0)
  armR.rotation.z = -0.6
  group.add(armR)
  return { group, height: 0.1 }
}

function envParkingLot(group: THREE.Group): EnvResult {
  const S = 20
  group.add(ground(S, S, 0x3a3a40))
  // Painted line boxes forming ~8 stalls (2 rows of 4).
  const stallW = 2.6
  const stallD = 5
  for (let row = 0; row < 2; row++) {
    const z0 = row === 0 ? -stallD : 0
    for (let i = 0; i <= 4; i++) {
      const x = -2 * stallW + i * stallW
      const line = box(0.1, 0.02, stallD, 0xd0d0d0)
      line.position.set(x, 0.02, z0 + stallD * 0.5)
      line.receiveShadow = true
      line.castShadow = false
      group.add(line)
    }
    // Head line.
    const head = box(4 * stallW, 0.02, 0.1, 0xd0d0d0)
    head.position.set(0, 0.02, z0 + (row === 0 ? 0 : stallD))
    head.receiveShadow = true
    head.castShadow = false
    group.add(head)
  }
  return { group, height: 0.1 }
}

function envAlley(group: THREE.Group): EnvResult {
  // Narrow ground strip + 2 tall walls close together.
  const stripW = 5
  const L = 20
  group.add(ground(stripW, L, 0x4a4a50))
  const wallH = 8
  for (const side of [-1, 1]) {
    const wall = box(0.3, wallH, L, 0x707078)
    wall.position.set(side * stripW * 0.5, wallH * 0.5, 0)
    group.add(wall)
    // Fire-escape hint (thin boxes) on one wall.
    if (side === -1) {
      for (let f = 0; f < 3; f++) {
        const platform = box(0.1, 0.1, 1.5, 0x40404a)
        platform.position.set(-stripW * 0.5 + 0.8, 2.5 + f * 1.8, -3)
        group.add(platform)
        const rail = box(0.05, 0.6, 1.5, 0x40404a)
        rail.position.set(-stripW * 0.5 + 1.5, 2.8 + f * 1.8, -3)
        group.add(rail)
      }
    }
  }
  // Dumpster.
  const dumpster = box(1.6, 1.2, 1.0, 0x4a5a4a)
  dumpster.position.set(-1, 0.6, 5)
  group.add(dumpster)
  return { group, height: 8 }
}

function envRooftop(group: THREE.Group): EnvResult {
  const S = 12
  // 12×12 slab raised 0.02.
  const slab = box(S, 0.04, S, 0x6a6a72)
  slab.position.y = 0.02
  slab.receiveShadow = true
  slab.castShadow = false
  group.add(slab)
  // Parapet walls 1m.
  const pH = 1
  const t = 0.2
  for (const [x, z, w, d] of [
    [0, S * 0.5, S, t],
    [0, -S * 0.5, S, t],
    [S * 0.5, 0, t, S],
    [-S * 0.5, 0, t, S]
  ] as [number, number, number, number][]) {
    const wall = box(w, pH, d, 0x7a7a82)
    wall.position.set(x, pH * 0.5, z)
    group.add(wall)
  }
  // AC unit boxes.
  for (const [x, z] of [
    [-3, -2],
    [2, 3]
  ] as [number, number][]) {
    const ac = box(1.5, 0.9, 1.2, 0x8a8a92)
    ac.position.set(x, 0.45, z)
    group.add(ac)
  }
  // Door bulkhead.
  const bulkhead = box(2, 2.4, 1.8, 0x82828a)
  bulkhead.position.set(3.5, 1.2, -3.5)
  group.add(bulkhead)
  const door = box(0.9, 2, 0.1, 0x5a4a42)
  door.position.set(3.5, 1.0, -3.5 - 0.9 - 0.01)
  group.add(door)
  return { group, height: 1.2 }
}

/** Standard 3-wall shell (back +Z, left/right), front open for camera. */
function shell(group: THREE.Group, S: number, wallH: number, floor: number, wall = 0x9a9aa2): void {
  const t = 0.15
  group.add(ground(S, S, floor))
  const back = wallMesh(S, wallH, t, wall)
  back.position.set(0, wallH * 0.5, S * 0.5)
  group.add(back)
  const left = wallMesh(t, wallH, S, wall)
  left.position.set(-S * 0.5, wallH * 0.5, 0)
  group.add(left)
  const right = left.clone()
  right.position.x = S * 0.5
  group.add(right)
}

function envRestaurant(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3
  shell(group, S, wallH, 0x6a5a4a)
  // 3×2 grid of dining tables with 4 chairs each.
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 2; iz++) {
      const x = -5 + ix * 5
      const z = -3 + iz * 5
      const top = cyl(0.55, 0.55, 0.05, 0x9a8a72, 14)
      top.position.set(x, 0.75, z)
      group.add(top)
      const stem = cyl(0.06, 0.08, 0.72, 0x70707a, 8)
      stem.position.set(x, 0.36, z)
      group.add(stem)
      for (let c = 0; c < 4; c++) {
        const a = (c / 4) * TAU
        const chair = grp(x + Math.sin(a) * 0.8, 0, z + Math.cos(a) * 0.8)
        chair.rotation.y = a + Math.PI
        group.add(chair)
        buildSimpleChair(chair)
      }
    }
  }
  // Bar along the left wall.
  const bar = box(0.7, 1.1, 8, 0x5a4a3a)
  bar.position.set(-S * 0.5 + 1.2, 0.55, 5)
  group.add(bar)
  // Kitchen pass (back-right): counter + opening.
  const pass = box(5, 1.1, 0.7, 0x82828a)
  pass.position.set(5, 0.55, S * 0.5 - 1.5)
  group.add(pass)
  const passTop = box(5, 0.05, 0.75, 0x9a9aa2)
  passTop.position.set(5, 1.12, S * 0.5 - 1.5)
  group.add(passTop)
  return { group, height: wallH }
}

function envHospitalRoom(group: THREE.Group): EnvResult {
  const S = 16
  const wallH = 2.8
  shell(group, S, wallH, 0xc4cad0, 0xdde4ea)
  // Bed.
  const bed = grp(-2, 0, 0)
  group.add(bed)
  const bframe = box(0.9, 0.4, 2.0, 0x9a9aa2)
  bframe.position.y = 0.5
  bed.add(bframe)
  const mattress = box(0.85, 0.15, 1.9, 0xe8e8ec)
  mattress.position.y = 0.72
  bed.add(mattress)
  const headSec = box(0.85, 0.15, 0.6, 0xe8e8ec)
  headSec.position.set(0, 0.82, -0.75)
  headSec.rotation.x = -0.4
  bed.add(headSec)
  // IV pole hint.
  const ivBase = cyl(0.15, 0.15, 0.04, 0x9a9aa2, 8)
  ivBase.position.set(-3.2, 0.02, -0.8)
  group.add(ivBase)
  const ivPole = cyl(0.02, 0.02, 2.0, 0xc0c0c8, 8)
  ivPole.position.set(-3.2, 1.0, -0.8)
  group.add(ivPole)
  const ivBag = box(0.12, 0.25, 0.05, 0xd0e0d0)
  ivBag.position.set(-3.2, 1.85, -0.7)
  group.add(ivBag)
  // Cabinet.
  const cabinet = box(0.6, 1.2, 0.5, 0x8a8a92)
  cabinet.position.set(3, 0.6, S * 0.5 - 0.5)
  group.add(cabinet)
  // Window on back wall.
  const win = box(2.0, 1.2, 0.05, 0xbcc4cc)
  win.position.set(0, 1.6, S * 0.5 - 0.09)
  group.add(win)
  return { group, height: wallH }
}

function envClassroom(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 2.8
  shell(group, S, wallH, 0x9a9080)
  // Rows of student desks (3 cols × 3 rows).
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = -4 + c * 4
      const z = 2 + r * 3
      const top = box(1.0, 0.05, 0.5, 0x9a8a72)
      top.position.set(x, 0.72, z)
      group.add(top)
      const legs = box(0.9, 0.68, 0.4, 0x70707a)
      legs.position.set(x, 0.35, z)
      group.add(legs)
      const chair = grp(x, 0, z - 0.6)
      group.add(chair)
      buildSimpleChair(chair)
    }
  }
  // Whiteboard on back wall.
  const board = box(4, 1.2, 0.05, 0xe8e8ec)
  board.position.set(0, 1.6, S * 0.5 - 0.1)
  group.add(board)
  // Teacher desk at front.
  const tdesk = box(1.6, 0.75, 0.8, 0x7a6a52)
  tdesk.position.set(0, 0.375, -6)
  group.add(tdesk)
  return { group, height: wallH }
}

function envGym(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3.5
  shell(group, S, wallH, 0x5a5a62)
  // Mirror band along back wall.
  const mirror = box(S - 1, 2.0, 0.05, 0xd0dce4)
  mirror.position.set(0, 1.3, S * 0.5 - 0.1)
  group.add(mirror)
  // Weight benches.
  for (const [x, z] of [
    [-6, 0],
    [-3, 0],
    [0, 0]
  ] as [number, number][]) {
    const bench = box(0.4, 0.15, 1.2, 0x2a2a30)
    bench.position.set(x, 0.5, z)
    group.add(bench)
    for (const sx of [-0.15, 0.15]) {
      const leg = box(0.06, 0.45, 0.06, 0x40404a)
      leg.position.set(x + sx, 0.22, z)
      group.add(leg)
    }
  }
  // Squat racks.
  for (const x of [4, 7]) {
    for (const sx of [-0.6, 0.6]) {
      const post = box(0.1, 2.2, 0.1, 0x30303a)
      post.position.set(x + sx, 1.1, 2)
      group.add(post)
    }
    const bar = cyl(0.03, 0.03, 1.6, 0x9a9aa2, 8)
    bar.rotation.z = Math.PI / 2
    bar.position.set(x, 1.6, 2)
    group.add(bar)
  }
  return { group, height: wallH }
}

function envCourtroom(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 4
  shell(group, S, wallH, 0x6a5a42, 0x8a7a5a)
  // Judge bench (raised) at back.
  const bench = box(4, 1.4, 1.2, 0x5a4a32)
  bench.position.set(0, 0.7, S * 0.5 - 2)
  group.add(bench)
  const platform = box(4.5, 0.4, 1.6, 0x4a3a22)
  platform.position.set(0, 0.2, S * 0.5 - 2)
  group.add(platform)
  // Witness stand (side of bench).
  const witness = box(1.2, 1.1, 1.0, 0x5a4a32)
  witness.position.set(-3.5, 0.55, S * 0.5 - 3.5)
  group.add(witness)
  // Bar rail across the room.
  const rail = box(10, 1.0, 0.1, 0x6a5a42)
  rail.position.set(0, 0.5, -1)
  group.add(rail)
  // Gallery rows (benches).
  for (let r = 0; r < 3; r++) {
    const gb = box(8, 0.5, 0.5, 0x5a4a32)
    gb.position.set(0, 0.4, 1 + r * 2)
    group.add(gb)
    const gback = box(8, 0.6, 0.1, 0x5a4a32)
    gback.position.set(0, 0.7, 1.25 + r * 2)
    group.add(gback)
  }
  return { group, height: wallH }
}

function envSubwayPlatform(group: THREE.Group): EnvResult {
  const S = 30
  const wallH = 4
  // Platform slab (raised), tracks trench beside it.
  group.add(ground(20, S, 0x3a3a40))
  const platform = box(8, 1.2, S, 0x8a8a92)
  platform.position.set(3, 0.6, 0)
  group.add(platform)
  // Yellow edge strip.
  const edge = box(0.3, 0.02, S, 0xd0c040)
  edge.position.set(-1.0, 1.21, 0)
  group.add(edge)
  // Track trench (lower) with 2 rails.
  for (const rx of [-5.5, -3.5]) {
    const trackrail = box(0.1, 0.15, S, 0x9a9aa2)
    trackrail.position.set(rx, 0.08, 0)
    group.add(trackrail)
  }
  // Pillars down the platform.
  for (let z = -S * 0.5 + 3; z < S * 0.5; z += 5) {
    const pillar = box(0.6, wallH, 0.6, 0x707078)
    pillar.position.set(3, wallH * 0.5 + 1.2, z)
    group.add(pillar)
  }
  // Signs.
  for (const z of [-6, 6]) {
    const sign = box(1.6, 0.5, 0.08, 0x304860)
    sign.position.set(3, 3.2, z)
    group.add(sign)
  }
  // Back wall behind tracks.
  const wall = box(0.3, wallH, S, 0x55555f)
  wall.position.set(-7, wallH * 0.5, 0)
  group.add(wall)
  return { group, height: wallH }
}

function envBeach(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0xd8c890))
  // Water slab band along +Z.
  const water = new THREE.Mesh(
    new THREE.BoxGeometry(S, 0.05, 10),
    new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
  )
  ;(water.userData as TintUserData).origColor = 0x3080c0
  water.castShadow = false
  water.receiveShadow = true
  water.position.set(0, 0.03, S * 0.5 - 5)
  group.add(water)
  // 2 beach umbrellas (open canopy).
  for (const [x, z] of [
    [-6, -2],
    [5, 2]
  ] as [number, number][]) {
    const pole = cyl(0.04, 0.04, 2.2, 0x9a9aa2, 8)
    pole.position.set(x, 1.1, z)
    group.add(pole)
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.6, 12), mat(0xd04040))
    ;(canopy.userData as TintUserData).origColor = 0xd04040
    canopy.castShadow = true
    canopy.position.set(x, 2.3, z)
    group.add(canopy)
  }
  // Towels (flat mats).
  for (const [x, z, col] of [
    [-6, -3.5, 0x40a0c0],
    [5, 0.5, 0xd0a040]
  ] as [number, number, number][]) {
    const towel = box(1.0, 0.02, 2.0, col)
    towel.position.set(x, 0.02, z)
    towel.receiveShadow = true
    towel.castShadow = false
    group.add(towel)
  }
  return { group, height: 0.1 }
}

function envForest(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0x4a5a38))
  // 12 trees at fixed positions with varied scale.
  const treePos: [number, number, number][] = [
    [-10, -8, 1.0],
    [-4, -10, 1.2],
    [3, -9, 0.85],
    [9, -7, 1.1],
    [-12, -2, 0.95],
    [11, 0, 1.15],
    [-8, 4, 1.05],
    [-2, 6, 0.9],
    [5, 5, 1.2],
    [10, 8, 1.0],
    [-11, 10, 1.1],
    [1, 11, 0.95]
  ]
  for (const [x, z, sc] of treePos) {
    const t = grp(x, 0, z)
    t.scale.setScalar(sc)
    group.add(t)
    const trunk = cyl(0.18, 0.25, 1.6, 0x5a4030, 8)
    trunk.position.y = 0.8
    t.add(trunk)
    const c1 = sphere(1.1, 0x3a5a2a, 10)
    c1.position.y = 2.2
    t.add(c1)
    const c2 = sphere(0.85, 0x44662f, 10)
    c2.position.set(0.4, 2.9, -0.2)
    t.add(c2)
  }
  // A few rocks.
  for (const [x, z] of [
    [-6, 0],
    [4, -3],
    [8, 4]
  ] as [number, number][]) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x7a7a80))
    ;(rock.userData as TintUserData).origColor = 0x7a7a80
    rock.castShadow = true
    rock.receiveShadow = true
    rock.scale.set(1.4, 0.8, 1.1)
    rock.position.set(x, 0.3, z)
    group.add(rock)
  }
  return { group, height: 5 }
}

function envBar(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3
  shell(group, S, wallH, 0x3a3038, 0x4a3a42)
  // Long bar counter.
  const bar = box(8, 1.1, 0.7, 0x4a3a2a)
  bar.position.set(-2, 0.55, S * 0.5 - 3)
  group.add(bar)
  const barTop = box(8.2, 0.06, 0.8, 0x6a4a3a)
  barTop.position.set(-2, 1.12, S * 0.5 - 3)
  group.add(barTop)
  // Back-wall shelves with bottles.
  for (let s = 0; s < 3; s++) {
    const shelf = box(8, 0.05, 0.3, 0x5a4a3a)
    shelf.position.set(-2, 1.6 + s * 0.5, S * 0.5 - 0.4)
    group.add(shelf)
    for (let b = 0; b < 10; b++) {
      const bottle = cyl(0.04, 0.04, 0.22, b % 2 === 0 ? 0x3a6a4a : 0x6a4a3a, 6)
      bottle.position.set(-5.5 + b * 0.78, 1.75 + s * 0.5, S * 0.5 - 0.4)
      group.add(bottle)
    }
  }
  // Stools along the bar.
  for (let i = 0; i < 5; i++) {
    const x = -5.5 + i * 1.7
    const seat = cyl(0.18, 0.18, 0.06, 0x2a2a30, 12)
    seat.position.set(x, 0.9, S * 0.5 - 4)
    group.add(seat)
    const post = cyl(0.04, 0.05, 0.85, 0x40404a, 8)
    post.position.set(x, 0.45, S * 0.5 - 4)
    group.add(post)
  }
  // Booths along -X wall.
  for (let i = 0; i < 2; i++) {
    const z = -4 + i * 4
    const seatB = box(0.6, 0.45, 1.6, 0x5a3a3a)
    seatB.position.set(-S * 0.5 + 1, 0.45, z)
    group.add(seatB)
    const backB = box(0.3, 1.1, 1.6, 0x5a3a3a)
    backB.position.set(-S * 0.5 + 0.6, 0.7, z)
    group.add(backB)
    const tableB = box(0.9, 0.05, 0.9, 0x7a6a52)
    tableB.position.set(-S * 0.5 + 1.9, 0.72, z)
    group.add(tableB)
  }
  return { group, height: wallH }
}

function envStage(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 5
  group.add(ground(S, S, 0x2a2a30))
  // Raised stage platform.
  const platform = box(12, 1.0, 8, 0x5a4a3a)
  platform.position.set(0, 0.5, 3)
  group.add(platform)
  const deck = box(12, 0.06, 8, 0x6a5a4a)
  deck.position.set(0, 1.03, 3)
  group.add(deck)
  // Backdrop wall.
  const backdrop = box(12, wallH, 0.3, 0x30303a)
  backdrop.position.set(0, wallH * 0.5, S * 0.5 - 3)
  group.add(backdrop)
  // 2 light trusses overhead.
  for (const z of [0, 4] ) {
    const truss = box(12, 0.2, 0.2, 0x40404a)
    truss.position.set(0, wallH - 0.5, z)
    group.add(truss)
    for (let i = 0; i < 5; i++) {
      const x = -5 + i * 2.5
      const lamp = box(0.25, 0.25, 0.25, 0x2a2a30)
      lamp.position.set(x, wallH - 0.75, z)
      group.add(lamp)
      const glow = emissive(new THREE.CylinderGeometry(0.08, 0.12, 0.05, 10), 0xfff0c0, 0.85)
      glow.position.set(x, wallH - 0.9, z)
      group.add(glow)
    }
  }
  return { group, height: wallH }
}

// ---------------------------------------------------------------------------
// ENVIRONMENTS — round 5
// ---------------------------------------------------------------------------

/** A simple seat cluster (base + backrest) used across kits; y raises it. */
function seatBox(group: THREE.Group, x: number, z: number, col = 0x40404a, y = 0): void {
  const base = box(0.45, 0.12, 0.45, col)
  base.position.set(x, 0.42 + y, z)
  group.add(base)
  const backrest = box(0.45, 0.5, 0.1, col)
  backrest.position.set(x, 0.67 + y, z + 0.22)
  group.add(backrest)
}

function envTrainInterior(group: THREE.Group): EnvResult {
  const L = 16
  const W = 3
  const wallH = 2.4
  const t = 0.12
  group.add(ground(W, L, 0x55555f))
  // Side walls with window strips.
  for (const side of [-1, 1]) {
    const wall = box(t, wallH, L, 0x8a8a92)
    wall.position.set(side * W * 0.5, wallH * 0.5, 0)
    group.add(wall)
    const windows = box(t + 0.02, 0.7, L * 0.85, 0xbcc4cc)
    windows.position.set(side * W * 0.5, wallH * 0.62, 0)
    group.add(windows)
    // Overhead luggage rack.
    const rack = box(0.5, 0.1, L * 0.9, 0x70707a)
    rack.position.set(side * (W * 0.5 - 0.35), wallH - 0.35, 0)
    group.add(rack)
  }
  // Doors at both ends.
  for (const z of [-L * 0.5, L * 0.5]) {
    const door = box(W - 0.4, wallH, 0.08, 0x6a6a72)
    door.position.set(0, wallH * 0.5, z)
    group.add(door)
  }
  // Paired seat rows both sides, center aisle.
  for (let i = 0; i < 6; i++) {
    const z = -L * 0.5 + 1.6 + i * 2.3
    for (const side of [-1, 1]) {
      seatBox(group, side * 0.95, z, 0x3a4a6a)
    }
  }
  return { group, height: wallH }
}

function envBoatInterior(group: THREE.Group): EnvResult {
  const L = 10
  const W = 4
  const wallH = 2.2
  group.add(ground(W, L, 0x6a5a4a))
  // Hull-curved walls (angled boxes).
  for (const side of [-1, 1]) {
    const hull = box(0.15, wallH, L, 0x8a8a92)
    hull.position.set(side * W * 0.5, wallH * 0.5, 0)
    hull.rotation.z = side * 0.2
    group.add(hull)
    // Portholes.
    for (const z of [-2.5, 0, 2.5]) {
      const port = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), mat(0xbcc4cc))
      ;(port.userData as TintUserData).origColor = 0xbcc4cc
      port.rotation.y = side * Math.PI / 2
      port.position.set(side * (W * 0.5 - 0.15), 1.4, z)
      group.add(port)
    }
  }
  // Back wall.
  const back = box(W, wallH, 0.15, 0x8a8a92)
  back.position.set(0, wallH * 0.5, L * 0.5)
  group.add(back)
  // Helm console + wheel at front (-Z).
  const console0 = box(1.0, 1.0, 0.5, 0x40404a)
  console0.position.set(0, 0.5, -L * 0.5 + 1)
  group.add(console0)
  const wheelT = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 8, 16), mat(0x5a4a3a))
  ;(wheelT.userData as TintUserData).origColor = 0x5a4a3a
  wheelT.castShadow = true
  wheelT.position.set(0, 1.2, -L * 0.5 + 1.3)
  group.add(wheelT)
  // Bench seating.
  for (const side of [-1, 1]) {
    const bench = box(0.5, 0.4, 3, 0x5a4a3a)
    bench.position.set(side * 1.4, 0.4, 2)
    group.add(bench)
  }
  // Small table.
  const table = cyl(0.5, 0.5, 0.05, 0x9a8a72, 12)
  table.position.set(0, 0.6, 2)
  group.add(table)
  const stem = cyl(0.06, 0.06, 0.58, 0x70707a, 8)
  stem.position.set(0, 0.29, 2)
  group.add(stem)
  return { group, height: wallH }
}

function envPostOffice(group: THREE.Group): EnvResult {
  const S = 16
  const wallH = 3
  shell(group, S, wallH, 0x8a8a80)
  // Service counter with divider windows.
  const counter = box(8, 1.1, 0.8, 0x7a6a52)
  counter.position.set(0, 0.55, 3)
  group.add(counter)
  const top = box(8.2, 0.05, 0.9, 0x9a8a72)
  top.position.set(0, 1.12, 3)
  group.add(top)
  // Divider glass above counter with gaps.
  for (let i = 0; i < 3; i++) {
    const x = -3 + i * 3
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.2, 0.04),
      new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
    )
    ;(glass.userData as TintUserData).origColor = 0xbcc4cc
    glass.position.set(x, 1.8, 3)
    group.add(glass)
  }
  // Wall of PO boxes (grid) on back wall.
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 10; c++) {
      const bx = -3 + c * 0.65
      const boxM = box(0.55, 0.35, 0.1, r % 2 === c % 2 ? 0x9a9aa2 : 0x8a8a92)
      boxM.position.set(bx, 0.6 + r * 0.4, S * 0.5 - 0.1)
      group.add(boxM)
    }
  }
  // Queue stanchions with ropes.
  for (let i = 0; i < 3; i++) {
    const x = -2 + i * 2
    const post = cyl(0.05, 0.06, 1.0, 0x9a9aa2, 8)
    post.position.set(x, 0.5, -2)
    group.add(post)
    if (i < 2) {
      const rope = box(2, 0.03, 0.03, 0x8a2020)
      rope.position.set(x + 1, 0.9, -2)
      group.add(rope)
    }
  }
  // Package shelves on left wall.
  for (let s = 0; s < 3; s++) {
    const shelf = box(0.5, 0.05, 5, 0x6a6a72)
    shelf.position.set(-S * 0.5 + 0.4, 0.6 + s * 0.7, -3)
    group.add(shelf)
  }
  return { group, height: wallH }
}

function envSupermarket(group: THREE.Group): EnvResult {
  const S = 24
  const wallH = 4
  shell(group, S, wallH, 0xc4c4cc)
  // 4 gondola aisles.
  for (let i = 0; i < 4; i++) {
    const x = -7.5 + i * 4
    const gondola = box(1.4, 1.8, 12, 0x81818a)
    gondola.position.set(x, 0.9, -1)
    group.add(gondola)
  }
  // Checkout lanes with belts.
  for (let i = 0; i < 3; i++) {
    const x = -5 + i * 3.5
    const lane = box(0.8, 1.0, 2.5, 0x7a7a82)
    lane.position.set(x, 0.5, S * 0.5 - 3)
    group.add(lane)
    const belt = box(0.6, 0.05, 2.0, 0x2a2a30)
    belt.position.set(x, 1.02, S * 0.5 - 3)
    group.add(belt)
  }
  // Produce bins (front-left).
  for (const [px, pz] of [[-9, 6], [-9, 8]] as [number, number][]) {
    const bin = box(1.6, 0.7, 1.2, 0x5a4a3a)
    bin.position.set(px, 0.35, pz)
    group.add(bin)
  }
  // Freezer wall on left.
  const freezer = box(0.6, 2.2, 10, 0xbcc4cc)
  freezer.position.set(-S * 0.5 + 0.5, 1.1, -3)
  group.add(freezer)
  // A couple of shopping carts.
  for (const [cx, cz] of [[6, 7], [4, 8.5]] as [number, number][]) {
    const cart = grp(cx, 0, cz)
    group.add(cart)
    const basket = box(0.5, 0.35, 0.7, 0x9a9aa2)
    basket.position.y = 0.7
    cart.add(basket)
    for (const [wx, wz] of [[-0.2, -0.3], [0.2, -0.3], [-0.2, 0.3], [0.2, 0.3]] as [number, number][]) {
      const w = wheel(0.08, 0.04, 0x2c2c30)
      w.position.set(wx, 0.08, wz)
      cart.add(w)
    }
  }
  return { group, height: wallH }
}

function envMovieTheater(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 5
  group.add(ground(S, S, 0x2a2028))
  // Big glowing screen at front (-Z).
  const screen = emissive(new THREE.PlaneGeometry(14, 6), 0xf0f4ff, 0.9)
  screen.position.set(0, 3.5, -S * 0.5 + 0.5)
  group.add(screen)
  const frame = box(15, 7, 0.2, 0x111116)
  frame.position.set(0, 3.5, -S * 0.5 + 0.3)
  group.add(frame)
  // Side curtains.
  for (const side of [-1, 1]) {
    const curtain = box(0.4, wallH, S, 0x6a1a24)
    curtain.position.set(side * S * 0.5, wallH * 0.5, 0)
    group.add(curtain)
  }
  // Raked rows of seats (step up toward +Z).
  for (let r = 0; r < 6; r++) {
    const z = -4 + r * 2.2
    const y = r * 0.35
    // Aisle step.
    const step = box(S, 0.35, 2.0, 0x30303a)
    step.position.set(0, y * 0.5, z)
    group.add(step)
    for (let c = 0; c < 8; c++) {
      const x = -7 + c * 2
      seatBox(group, x, z, 0x40404a, y)
    }
  }
  return { group, height: wallH }
}

function envIndoorMall(group: THREE.Group): EnvResult {
  const S = 28
  const wallH = 6
  group.add(ground(S, S, 0xc4c4cc))
  // Storefront facades both sides (along Z).
  for (const side of [-1, 1]) {
    const facade = box(0.4, wallH, S, 0x9a9aa2)
    facade.position.set(side * S * 0.5, wallH * 0.5, 0)
    group.add(facade)
    // Signboards.
    for (let i = 0; i < 4; i++) {
      const z = -S * 0.5 + 4 + i * 6
      const sign = emissive(new THREE.PlaneGeometry(3, 0.8), i % 2 === 0 ? 0x40a0d0 : 0xd06040, 0.9)
      sign.rotation.y = side * -Math.PI / 2
      sign.position.set(side * (S * 0.5 - 0.25), 3.5, z)
      group.add(sign)
      // Storefront opening frame.
      const opening = box(0.3, 3.5, 4, 0x50505a)
      opening.position.set(side * (S * 0.5 - 0.2), 1.75, z)
      group.add(opening)
    }
  }
  // Central kiosks.
  for (const z of [-6, 6]) {
    const kiosk = box(2.5, 1.2, 2.5, 0x7a6a52)
    kiosk.position.set(0, 0.6, z)
    group.add(kiosk)
    const roof = box(3, 0.2, 3, 0xc03030)
    roof.position.set(0, 2.2, z)
    group.add(roof)
  }
  // Planters.
  for (const [px, pz] of [[-3, 0], [3, 0]] as [number, number][]) {
    const planter = cyl(0.6, 0.6, 0.6, 0x8a7a62, 10)
    planter.position.set(px, 0.3, pz)
    group.add(planter)
    const foliage = sphere(0.7, 0x3a5a2a, 10)
    foliage.position.set(px, 1.0, pz)
    group.add(foliage)
  }
  // Skylight beams overhead.
  for (let i = 0; i < 5; i++) {
    const z = -S * 0.5 + 3 + i * 5.5
    const beam = box(S * 0.5, 0.2, 0.3, 0xbcc4cc)
    beam.position.set(0, wallH - 0.2, z)
    group.add(beam)
  }
  return { group, height: wallH }
}

function envHotelLobby(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 4
  shell(group, S, wallH, 0x8a7a6a, 0xb4a494)
  // Front desk.
  const desk = box(5, 1.1, 1.0, 0x5a4a3a)
  desk.position.set(0, 0.55, S * 0.5 - 2)
  group.add(desk)
  const deskTop = box(5.2, 0.06, 1.1, 0x8a7a62)
  deskTop.position.set(0, 1.12, S * 0.5 - 2)
  group.add(deskTop)
  // Columns.
  for (const [cx, cz] of [[-5, -3], [5, -3], [-5, 3], [5, 3]] as [number, number][]) {
    const col = cyl(0.4, 0.4, wallH, 0xc4b4a4, 12)
    col.position.set(cx, wallH * 0.5, cz)
    group.add(col)
  }
  // Seating cluster (2 sofas + coffee table).
  for (const side of [-1, 1]) {
    const sofa = box(2.4, 0.7, 0.9, 0x5a5a66)
    sofa.position.set(0, 0.35, side * 1.5)
    group.add(sofa)
  }
  const coffee = box(1.2, 0.4, 0.7, 0x6a5a4a)
  coffee.position.set(0, 0.2, 0)
  group.add(coffee)
  // Luggage cart.
  const cart = grp(-6, 0, 4)
  group.add(cart)
  const cartBase = box(0.8, 0.1, 1.2, 0xc0a860)
  cartBase.position.y = 0.3
  cart.add(cartBase)
  for (const px of [-0.35, 0.35]) {
    const pole = cyl(0.03, 0.03, 1.5, 0xc0a860, 8)
    pole.position.set(px, 0.75, -0.5)
    cart.add(pole)
  }
  const bag = box(0.6, 0.5, 0.8, 0x6a5a4a)
  bag.position.set(0, 0.6, 0)
  cart.add(bag)
  return { group, height: wallH }
}

function envHotelRoom(group: THREE.Group): EnvResult {
  const S = 16
  const wallH = 2.7
  shell(group, S, wallH, 0x8a7a6a, 0xc4b4a4)
  // Queen bed against headboard wall (back +Z).
  const bedFrame = box(2.2, 0.4, 2.2, 0x6a5a4a)
  bedFrame.position.set(-2, 0.2, S * 0.5 - 1.6)
  group.add(bedFrame)
  const mattress = box(2.1, 0.25, 2.1, 0xd4d4dc)
  mattress.position.set(-2, 0.5, S * 0.5 - 1.6)
  group.add(mattress)
  const headboard = box(2.3, 1.0, 0.15, 0x5a4a3a)
  headboard.position.set(-2, 0.7, S * 0.5 - 0.6)
  group.add(headboard)
  // TV dresser.
  const dresser = box(2.0, 0.7, 0.5, 0x6a5a4a)
  dresser.position.set(-2, 0.35, -S * 0.5 + 0.8)
  group.add(dresser)
  const tv = box(1.2, 0.7, 0.06, 0x2a2a30)
  tv.position.set(-2, 1.3, -S * 0.5 + 0.6)
  group.add(tv)
  // Desk + chair.
  const desk = box(1.2, 0.75, 0.6, 0x7a6a52)
  desk.position.set(3, 0.375, -S * 0.5 + 1)
  group.add(desk)
  const chair = grp(3, 0, -S * 0.5 + 1.9)
  group.add(chair)
  buildSimpleChair(chair)
  // Curtained window wall (right side -X open, use +X wall region).
  const curtain = box(0.1, 2.2, 3, 0x8a5a6a)
  curtain.position.set(S * 0.5 - 0.2, 1.3, 4)
  group.add(curtain)
  // Bathroom nook (corner partition + toilet block).
  const partition = box(0.15, wallH, 3, 0xc4b4a4)
  partition.position.set(4, wallH * 0.5, S * 0.5 - 1.5)
  group.add(partition)
  const toilet = box(0.4, 0.5, 0.5, 0xe8e8ec)
  toilet.position.set(5.5, 0.25, S * 0.5 - 1)
  group.add(toilet)
  return { group, height: wallH }
}

function envDiner(group: THREE.Group): EnvResult {
  const S = 16
  const wallH = 3
  shell(group, S, wallH, 0x8a8a92)
  // Checkerboard-ish floor tint patch.
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if ((r + c) % 2 === 0) continue
      const tile = box(2, 0.02, 2, 0x30303a)
      tile.position.set(-3 + c * 2, 0.02, -3 + r * 2)
      tile.receiveShadow = true
      tile.castShadow = false
      group.add(tile)
    }
  }
  // Window booths along one wall (right +X region, use back-left instead: left wall).
  for (let i = 0; i < 3; i++) {
    const z = -4 + i * 4
    const seatB = box(0.5, 0.45, 1.6, 0xc03040)
    seatB.position.set(-S * 0.5 + 1, 0.45, z)
    group.add(seatB)
    const backB = box(0.25, 1.1, 1.6, 0xc03040)
    backB.position.set(-S * 0.5 + 0.6, 0.7, z)
    group.add(backB)
    const table = box(0.9, 0.05, 0.9, 0x9a9aa2)
    table.position.set(-S * 0.5 + 1.9, 0.72, z)
    group.add(table)
  }
  // Counter with stools.
  const counter = box(0.7, 1.0, 8, 0x8a8a92)
  counter.position.set(4, 0.5, 0)
  group.add(counter)
  const counterTop = box(1.0, 0.06, 8, 0xc4c4cc)
  counterTop.position.set(4, 1.02, 0)
  group.add(counterTop)
  for (let i = 0; i < 5; i++) {
    const z = -3.2 + i * 1.6
    const seat = cyl(0.2, 0.2, 0.06, 0xc03040, 12)
    seat.position.set(2.9, 0.75, z)
    group.add(seat)
    const post = cyl(0.04, 0.05, 0.72, 0x9a9aa2, 8)
    post.position.set(2.9, 0.36, z)
    group.add(post)
  }
  // Kitchen pass window (back wall).
  const pass = box(4, 0.9, 0.3, 0x6a6a72)
  pass.position.set(4, 1.6, S * 0.5 - 0.3)
  group.add(pass)
  return { group, height: wallH }
}

function envCoffeeShop(group: THREE.Group): EnvResult {
  const S = 16
  const wallH = 3
  shell(group, S, wallH, 0x8a7a6a, 0x9a8a72)
  // Order counter.
  const counter = box(4, 1.1, 0.8, 0x5a4a3a)
  counter.position.set(-2, 0.55, S * 0.5 - 2)
  group.add(counter)
  const counterTop = box(4.2, 0.06, 0.9, 0x6a5a4a)
  counterTop.position.set(-2, 1.12, S * 0.5 - 2)
  group.add(counterTop)
  // Espresso machine block.
  const machine = box(0.8, 0.5, 0.5, 0x9a9aa2)
  machine.position.set(-3, 1.4, S * 0.5 - 2)
  group.add(machine)
  // Pastry case (glass).
  const pcase = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.5, 0.7),
    new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
  )
  ;(pcase.userData as TintUserData).origColor = 0xbcc4cc
  pcase.position.set(-0.5, 1.4, S * 0.5 - 2)
  group.add(pcase)
  // Menu board (emissive).
  const menu = emissive(new THREE.PlaneGeometry(3, 1), 0x2a3a30, 1)
  menu.position.set(-2, 2.4, S * 0.5 - 0.1)
  group.add(menu)
  // Small round tables + chairs.
  for (const [tx, tz] of [[-4, -2], [0, -2], [4, -1]] as [number, number][]) {
    const top = cyl(0.4, 0.4, 0.05, 0x8a7a62, 12)
    top.position.set(tx, 0.72, tz)
    group.add(top)
    const stem = cyl(0.05, 0.06, 0.7, 0x70707a, 8)
    stem.position.set(tx, 0.35, tz)
    group.add(stem)
    for (let c = 0; c < 2; c++) {
      const chair = grp(tx + (c === 0 ? -0.7 : 0.7), 0, tz)
      chair.rotation.y = c === 0 ? Math.PI / 2 : -Math.PI / 2
      group.add(chair)
      buildSimpleChair(chair)
    }
  }
  // Two armchairs.
  for (const ax of [-5, 5]) {
    const arm = box(0.9, 0.7, 0.9, 0x5a5a66)
    arm.position.set(ax, 0.35, 4)
    group.add(arm)
    const backr = box(0.9, 0.5, 0.2, 0x5a5a66)
    backr.position.set(ax, 0.7, 4.35)
    group.add(backr)
  }
  return { group, height: wallH }
}

function envPoliceStation(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3
  shell(group, S, wallH, 0x7a7a82)
  // Reception counter at front.
  const desk = box(4, 1.1, 1.0, 0x5a5a62)
  desk.position.set(-4, 0.55, -S * 0.5 + 2)
  group.add(desk)
  // Bullpen of paired desks.
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      const x = -3 + c * 6
      const z = 0 + r * 3
      const d1 = box(1.4, 0.05, 0.7, 0x8d8d95)
      d1.position.set(x, 0.72, z)
      group.add(d1)
      const legs = box(1.3, 0.68, 0.6, 0x70707a)
      legs.position.set(x, 0.35, z)
      group.add(legs)
      const chair = grp(x, 0, z - 0.7)
      group.add(chair)
      buildSimpleChair(chair)
    }
  }
  // Holding cell (bar grid) in a corner.
  const cellX = S * 0.5 - 3
  const cellZ = S * 0.5 - 3
  for (let i = 0; i <= 6; i++) {
    const bar = cyl(0.05, 0.05, wallH, 0x2c2c32, 6)
    bar.position.set(cellX - 3 + i * 0.5, wallH * 0.5, cellZ)
    group.add(bar)
  }
  for (let i = 0; i <= 6; i++) {
    const bar = cyl(0.05, 0.05, wallH, 0x2c2c32, 6)
    bar.position.set(cellX, wallH * 0.5, cellZ - 3 + i * 0.5)
    group.add(bar)
  }
  return { group, height: wallH }
}

function envChurch(group: THREE.Group): EnvResult {
  const S = 22
  const wallH = 6
  shell(group, S, wallH, 0x8a7a6a, 0xb4a494)
  // Pew rows split by center aisle.
  for (let r = 0; r < 6; r++) {
    const z = -6 + r * 1.8
    for (const side of [-1, 1]) {
      const pew = box(4, 0.45, 0.5, 0x6a5a4a)
      pew.position.set(side * 3.5, 0.35, z)
      group.add(pew)
      const backr = box(4, 0.6, 0.12, 0x6a5a4a)
      backr.position.set(side * 3.5, 0.7, z + 0.2)
      group.add(backr)
    }
  }
  // Raised altar platform with pulpit.
  const platform = box(8, 0.5, 3, 0x9a8a72)
  platform.position.set(0, 0.25, S * 0.5 - 2.5)
  group.add(platform)
  const pulpit = box(0.8, 1.1, 0.6, 0x5a4a3a)
  pulpit.position.set(-2, 1.05, S * 0.5 - 2.5)
  group.add(pulpit)
  // Tall colored window panels (emissive tints).
  const tints = [0xd04060, 0x4060d0, 0x40c060]
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -4 + i * 4
      const win = emissive(new THREE.PlaneGeometry(1.2, 3.5), tints[i] ?? 0xd0a040, 0.85)
      win.rotation.y = side * -Math.PI / 2
      win.position.set(side * (S * 0.5 - 0.1), 3.5, z)
      group.add(win)
    }
  }
  return { group, height: wallH }
}

function envSchoolHallway(group: THREE.Group): EnvResult {
  const L = 20
  const W = 5
  const wallH = 3
  group.add(ground(W, L, 0x9a9080))
  // Two walls with locker banks.
  for (const side of [-1, 1]) {
    const wall = box(0.15, wallH, L, 0x9a9aa2)
    wall.position.set(side * W * 0.5, wallH * 0.5, 0)
    group.add(wall)
    // Locker banks.
    for (let i = 0; i < 12; i++) {
      const z = -L * 0.5 + 1 + i * 1.6
      const locker = box(0.25, 1.8, 1.4, i % 2 === 0 ? 0x3a5a8a : 0x40608a)
      locker.position.set(side * (W * 0.5 - 0.2), 1.0, z)
      group.add(locker)
    }
    // Classroom doors.
    for (const z of [-6, 0, 6]) {
      const door = box(0.1, 2.1, 1.0, 0x6a5a4a)
      door.position.set(side * (W * 0.5 - 0.05), 1.05, z)
      group.add(door)
    }
  }
  // A bench.
  const bench = box(2, 0.45, 0.5, 0x6a5a4a)
  bench.position.set(-1.5, 0.35, 3)
  group.add(bench)
  return { group, height: wallH }
}

function envAirportTerminal(group: THREE.Group): EnvResult {
  const S = 30
  const wallH = 5
  group.add(ground(S, S, 0xc4c4cc))
  // Floor-to-ceiling window wall (back +Z).
  const winWall = new THREE.Mesh(
    new THREE.BoxGeometry(S, wallH, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
  )
  ;(winWall.userData as TintUserData).origColor = 0xbcc4cc
  winWall.position.set(0, wallH * 0.5, S * 0.5)
  group.add(winWall)
  // Mullions.
  for (let i = -6; i <= 6; i++) {
    const mullion = box(0.15, wallH, 0.15, 0x70707a)
    mullion.position.set(i * 2.3, wallH * 0.5, S * 0.5)
    group.add(mullion)
  }
  // Gate seating rows back-to-back.
  for (let r = 0; r < 2; r++) {
    const z = -2 + r * 1.2
    for (let c = 0; c < 8; c++) {
      const x = -7 + c * 2
      seatBox(group, x, z, r === 0 ? 0x3a4a6a : 0x4a5a7a)
    }
  }
  // Check-in desk row (front).
  for (let i = 0; i < 4; i++) {
    const x = -6 + i * 4
    const desk = box(3, 1.1, 1.0, 0x5a5a66)
    desk.position.set(x, 0.55, -S * 0.5 + 3)
    group.add(desk)
  }
  // Departures board (emissive).
  const board = emissive(new THREE.PlaneGeometry(6, 1.5), 0x203040, 1)
  board.position.set(0, 4, -S * 0.5 + 1)
  board.rotation.y = Math.PI
  group.add(board)
  return { group, height: wallH }
}

function envCasino(group: THREE.Group): EnvResult {
  const S = 20
  const wallH = 3.5
  shell(group, S, wallH, 0x5a2030, 0x3a2028)
  // Patterned floor tint.
  for (let i = 0; i < 5; i++) {
    const ring = cyl(3 + i * 0.4, 3 + i * 0.4, 0.02, i % 2 === 0 ? 0xc0a040 : 0x8a2030, 20)
    ring.position.y = 0.02 + i * 0.001
    ring.receiveShadow = true
    ring.castShadow = false
    group.add(ring)
  }
  // Slot-machine rows (small glowing boxes).
  for (let r = 0; r < 2; r++) {
    const z = -6 + r * 2
    for (let c = 0; c < 8; c++) {
      const x = -7 + c * 2
      const machine = box(0.6, 1.5, 0.5, 0x40404a)
      machine.position.set(x, 0.75, z)
      group.add(machine)
      const glow = emissive(new THREE.PlaneGeometry(0.45, 0.4), c % 2 === 0 ? 0xffd040 : 0xff40a0, 0.9)
      glow.position.set(x, 1.1, z - 0.26)
      group.add(glow)
    }
  }
  // Two card tables with stool rings.
  for (const tx of [-4, 4]) {
    const table = cyl(1.2, 1.2, 0.4, 0x2a5a3a, 14)
    table.position.set(tx, 0.7, 5)
    group.add(table)
    const stem = cyl(0.15, 0.2, 0.7, 0x40404a, 8)
    stem.position.set(tx, 0.35, 5)
    group.add(stem)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI - Math.PI * 0.5
      const stool = cyl(0.2, 0.2, 0.06, 0x8a2030, 12)
      stool.position.set(tx + Math.sin(a) * 1.6, 0.65, 5 + Math.cos(a) * 1.6)
      group.add(stool)
    }
  }
  // Low ceiling glow.
  const ceilGlow = emissive(new THREE.PlaneGeometry(S - 2, S - 2), 0x402028, 0.5)
  ceilGlow.rotation.x = Math.PI / 2
  ceilGlow.position.y = wallH - 0.1
  group.add(ceilGlow)
  return { group, height: wallH }
}

function envParkingGarage(group: THREE.Group): EnvResult {
  const S = 28
  const ceilH = 2.6
  group.add(ground(S, S, 0x55555c))
  // Low ceiling slab.
  const ceiling = box(S, 0.3, S, 0x6a6a72)
  ceiling.position.y = ceilH
  ceiling.receiveShadow = true
  ceiling.castShadow = false
  group.add(ceiling)
  // Square columns.
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const col = box(0.6, ceilH, 0.6, 0x82828a)
      col.position.set(cx * 8, ceilH * 0.5, cz * 8)
      group.add(col)
    }
  }
  // Painted stall stripes.
  for (let i = 0; i <= 8; i++) {
    const x = -10 + i * 2.5
    const line = box(0.1, 0.02, 5, 0xd0d0d0)
    line.position.set(x, 0.02, -9)
    line.receiveShadow = true
    line.castShadow = false
    group.add(line)
  }
  // Ramp.
  const ramp = box(4, 0.15, 8, 0x4a4a52)
  ramp.position.set(S * 0.5 - 3, 0.6, 5)
  ramp.rotation.x = 0.15
  group.add(ramp)
  // Concrete barriers.
  for (const [bx, bz] of [[-6, 6], [0, 8]] as [number, number][]) {
    const barrier = box(1.6, 0.5, 0.4, 0xb4b4b4)
    barrier.position.set(bx, 0.25, bz)
    group.add(barrier)
  }
  return { group, height: ceilH }
}

function envStripMall(group: THREE.Group): EnvResult {
  const S = 40
  group.add(ground(S, S, 0x55555c))
  // One long row of storefronts (back +Z) with sign band.
  const facade = box(S * 0.8, 5, 1, 0x9a9aa2)
  facade.position.set(0, 2.5, S * 0.25)
  group.add(facade)
  const signBand = box(S * 0.8, 1.2, 0.2, 0x40404a)
  signBand.position.set(0, 4.4, S * 0.25 - 0.5)
  group.add(signBand)
  // Storefront windows/openings.
  for (let i = 0; i < 6; i++) {
    const x = -13 + i * 5.2
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3, 0.1),
      new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
    )
    ;(glass.userData as TintUserData).origColor = 0xbcc4cc
    glass.position.set(x, 1.6, S * 0.25 - 0.5)
    group.add(glass)
    const sign = emissive(new THREE.PlaneGeometry(3.5, 0.8), i % 2 === 0 ? 0x40a0d0 : 0xd06040, 0.9)
    sign.position.set(x, 4.4, S * 0.25 - 0.6)
    sign.rotation.y = Math.PI
    group.add(sign)
  }
  // Sidewalk.
  const sidewalk = box(S * 0.85, 0.15, 4, 0x9a9aa2)
  sidewalk.position.set(0, 0.075, S * 0.25 - 3)
  group.add(sidewalk)
  // Parking stalls (empty for user cars).
  for (let i = 0; i <= 10; i++) {
    const x = -13 + i * 2.6
    const line = box(0.1, 0.02, 5, 0xd0d0d0)
    line.position.set(x, 0.02, -5)
    line.receiveShadow = true
    line.castShadow = false
    group.add(line)
  }
  // Light poles.
  for (const px of [-12, 0, 12]) {
    const pole = cyl(0.1, 0.12, 6, 0x55555f)
    pole.position.set(px, 3, -8)
    group.add(pole)
    const headL = box(0.6, 0.2, 0.3, 0x40404a)
    headL.position.set(px, 6, -8)
    group.add(headL)
  }
  return { group, height: 5 }
}

function envOutdoorMall(group: THREE.Group): EnvResult {
  const S = 36
  group.add(ground(S, S, 0xb4a494))
  // Promenade strip.
  const promenade = box(8, 0.05, S, 0xc4c4cc)
  promenade.position.y = 0.03
  promenade.receiveShadow = true
  promenade.castShadow = false
  group.add(promenade)
  // Storefront facades both sides.
  for (const side of [-1, 1]) {
    const facade = box(1, 5, S, 0x9a9aa2)
    facade.position.set(side * 6, 2.5, 0)
    group.add(facade)
    for (let i = 0; i < 5; i++) {
      const z = -S * 0.5 + 4 + i * 7
      const sign = emissive(new THREE.PlaneGeometry(3, 0.8), i % 2 === 0 ? 0x40a0d0 : 0xd06040, 0.9)
      sign.rotation.y = side * -Math.PI / 2
      sign.position.set(side * 5.4, 3.5, z)
      group.add(sign)
    }
  }
  // Central fountain.
  const basin = cyl(1.6, 1.6, 0.5, 0x9a9aa2, 16)
  basin.position.y = 0.25
  group.add(basin)
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.1, 16),
    new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
  )
  ;(water.userData as TintUserData).origColor = 0x3080c0
  water.castShadow = false
  water.position.y = 0.48
  group.add(water)
  const spout = emissive(new THREE.CylinderGeometry(0.05, 0.08, 0.8, 8), 0x90c0e0, 0.7)
  spout.position.y = 0.9
  group.add(spout)
  // Planters + benches + string-light posts.
  for (const z of [-10, 10]) {
    const planter = cyl(0.7, 0.7, 0.6, 0x8a7a62, 10)
    planter.position.set(-2.5, 0.3, z)
    group.add(planter)
    const foliage = sphere(0.8, 0x3a5a2a, 10)
    foliage.position.set(-2.5, 1.1, z)
    group.add(foliage)
    const bench = box(1.6, 0.45, 0.5, 0x6a5a4a)
    bench.position.set(2.5, 0.35, z)
    group.add(bench)
  }
  for (const [px, pz] of [[-3.5, -6], [3.5, 6]] as [number, number][]) {
    const post = cyl(0.06, 0.08, 4, 0x40404a, 8)
    post.position.set(px, 2, pz)
    group.add(post)
    const light = emissive(new THREE.SphereGeometry(0.12, 8, 8), 0xffe0a0, 0.9)
    light.position.set(px, 4, pz)
    group.add(light)
  }
  return { group, height: 5 }
}

function envResidentialStreet(group: THREE.Group): EnvResult {
  const S = 36
  group.add(ground(S, S, 0x5a6a48))
  // Asphalt street down Z.
  const asphalt = box(7, 0.02, S, 0x53545c)
  asphalt.position.y = 0.011
  asphalt.receiveShadow = true
  asphalt.castShadow = false
  group.add(asphalt)
  for (let z = -S * 0.5 + 1; z < S * 0.5; z += 3) {
    const dash = box(0.2, 0.02, 1.2, 0xd0d060)
    dash.position.set(0, 0.02, z)
    group.add(dash)
  }
  // Sidewalks both sides.
  for (const x of [-4.5, 4.5]) {
    const sw = box(2, 0.15, S, 0x9a9aa2)
    sw.position.set(x, 0.075, 0)
    group.add(sw)
  }
  // 3 house fronts per side.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const z = -10 + i * 10
      const hx = side * 9
      const houseBody = box(6, 3, 5, side * i % 2 === 0 ? 0xb4a494 : 0xa49484)
      houseBody.position.set(hx, 1.5, z)
      group.add(houseBody)
      // Gable roof.
      for (const rside of [-1, 1]) {
        const roof = box(3.4, 0.1, 5.4, 0x6a4a3a)
        roof.position.set(hx + rside * 1.5, 3.7, z)
        roof.rotation.z = rside * -0.6
        group.add(roof)
      }
      // Porch.
      const porch = box(6, 0.15, 1.5, 0x8a7a62)
      porch.position.set(hx - side * 3, 0.15, z)
      group.add(porch)
      // Lawn.
      const lawn = box(6, 0.02, 4, 0x4a6a38)
      lawn.position.set(hx - side * 3.5, 0.02, z)
      lawn.receiveShadow = true
      lawn.castShadow = false
      group.add(lawn)
      // Driveway.
      const drive = box(2.5, 0.03, 4, 0x8a8a92)
      drive.position.set(hx - side * 4, 0.03, z + 3)
      group.add(drive)
    }
    // Street trees + streetlights.
    for (const z of [-5, 8]) {
      const tx = side * 5.5
      const trunk = cyl(0.2, 0.28, 1.6, 0x5a4030, 8)
      trunk.position.set(tx, 0.8, z)
      group.add(trunk)
      const canopy = sphere(1.2, 0x3a5a2a, 10)
      canopy.position.set(tx, 2.5, z)
      group.add(canopy)
    }
    const pole = cyl(0.1, 0.12, 5, 0x55555f)
    pole.position.set(side * 4.2, 2.5, side * 6)
    group.add(pole)
  }
  return { group, height: 5 }
}

function envDowntown(group: THREE.Group): EnvResult {
  const S = 36
  group.add(ground(S, S, 0x6e6e74))
  // Street.
  const asphalt = box(9, 0.02, S, 0x53545c)
  asphalt.position.y = 0.011
  asphalt.receiveShadow = true
  asphalt.castShadow = false
  group.add(asphalt)
  // Crosswalk stripes.
  for (let i = 0; i < 6; i++) {
    const stripe = box(1.0, 0.02, 4, 0xe0e0e0)
    stripe.position.set(-4 + i * 1.5, 0.02, -8)
    stripe.receiveShadow = true
    stripe.castShadow = false
    group.add(stripe)
  }
  // Sidewalks.
  for (const x of [-6.5, 6.5]) {
    const sw = box(4, 0.2, S, 0x9a9aa2)
    sw.position.set(x, 0.1, 0)
    group.add(sw)
  }
  // Tall building facades both sides.
  const heights = [10, 14, 11, 13]
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const bh = heights[i] ?? 12
      const b = box(7, bh, 8, i % 2 === 0 ? 0x83838b : 0x8c8c94)
      b.position.set(side * 11, bh * 0.5, -12 + i * 9)
      group.add(b)
      // Storefront base.
      const store = box(7.2, 3, 8.2, 0x50505a)
      store.position.set(side * 11, 1.5, -12 + i * 9)
      group.add(store)
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(6, 2.5, 0.1),
        new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
      )
      ;(glass.userData as TintUserData).origColor = 0xbcc4cc
      glass.position.set(side * (11 - side * 4), 1.5, -12 + i * 9)
      group.add(glass)
    }
  }
  // Traffic lights.
  for (const [tx, tz] of [[-4.5, -6], [4.5, 6]] as [number, number][]) {
    const pole = cyl(0.12, 0.14, 5, 0x40404a)
    pole.position.set(tx, 2.5, tz)
    group.add(pole)
    const box0 = box(0.3, 0.9, 0.3, 0x2a2a30)
    box0.position.set(tx, 5.2, tz)
    group.add(box0)
    const red = emissive(new THREE.SphereGeometry(0.1, 8, 8), 0xff3030, 0.95)
    red.position.set(tx, 5.5, tz - 0.16)
    group.add(red)
  }
  // Bus-stop shelter.
  const shelterRoof = box(3, 0.1, 1.4, 0x50505a)
  shelterRoof.position.set(-7, 2.4, 4)
  group.add(shelterRoof)
  const shelterBench = box(2.4, 0.1, 0.4, 0x70707a)
  shelterBench.position.set(-7, 0.5, 4.3)
  group.add(shelterBench)
  return { group, height: 14 }
}

function envTrainStation(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(20, S, 0x6a6a72))
  // Outdoor platform slab.
  const platform = box(8, 0.6, S, 0x9a9aa2)
  platform.position.set(2, 0.3, 0)
  group.add(platform)
  // Yellow edge strip.
  const edge = box(0.3, 0.02, S, 0xd0c040)
  edge.position.set(-2, 0.61, 0)
  group.add(edge)
  // Canopy on posts.
  for (let i = 0; i < 4; i++) {
    const z = -S * 0.5 + 4 + i * 7
    for (const px of [0, 4]) {
      const post = cyl(0.12, 0.14, 3.5, 0x55555f, 8)
      post.position.set(px, 1.75 + 0.6, z)
      group.add(post)
    }
  }
  const canopy = box(6, 0.2, S * 0.9, 0x70707a)
  canopy.position.set(2, 4.5, 0)
  group.add(canopy)
  // Track bed with rails alongside (-X of platform).
  const bed = box(6, 0.1, S, 0x3a3a40)
  bed.position.set(-5, 0.05, 0)
  group.add(bed)
  for (const rx of [-6.5, -3.5]) {
    const rail = box(0.1, 0.15, S, 0xb4b4bc)
    rail.position.set(rx, 0.15, 0)
    group.add(rail)
  }
  // Benches.
  for (const z of [-6, 6]) {
    const bench = box(2, 0.45, 0.5, 0x5a4a3a)
    bench.position.set(3.5, 0.95, z)
    group.add(bench)
  }
  // Departure sign (emissive).
  const sign = emissive(new THREE.PlaneGeometry(3, 0.8), 0x203040, 1)
  sign.position.set(2, 3.8, -6)
  group.add(sign)
  return { group, height: 4 }
}

function envGasStation(group: THREE.Group): EnvResult {
  const S = 24
  group.add(ground(S, S, 0x55555c))
  // Flat canopy on posts.
  const canopy = box(12, 0.4, 8, 0xe8e8ec)
  canopy.position.set(-2, 4.5, 0)
  group.add(canopy)
  for (const [px, pz] of [[-6, -3], [2, -3], [-6, 3], [2, 3]] as [number, number][]) {
    const post = box(0.4, 4.3, 0.4, 0x9a9aa2)
    post.position.set(px, 2.15, pz)
    group.add(post)
  }
  // Two pump islands.
  for (const iz of [-2, 2]) {
    const island = box(3, 0.2, 1, 0x6a6a72)
    island.position.set(-2, 0.1, iz)
    group.add(island)
    const pump = box(0.5, 1.4, 0.35, 0xd04040)
    pump.position.set(-2, 0.9, iz)
    group.add(pump)
    const disp = emissive(new THREE.PlaneGeometry(0.36, 0.25), 0x40d0d0, 0.9)
    disp.position.set(-2, 1.1, iz + 0.18)
    group.add(disp)
  }
  // Convenience-store front with door + windows.
  const store = box(8, 4, 5, 0x9a9aa2)
  store.position.set(8, 2, 0)
  group.add(store)
  const door = box(0.1, 2.2, 1.2, 0x5a4a3a)
  door.position.set(8 - 4 - 0.05, 1.1, 0)
  group.add(door)
  for (const dz of [-1.6, 1.6]) {
    const win = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 2, 1.4),
      new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
    )
    ;(win.userData as TintUserData).origColor = 0xbcc4cc
    win.position.set(8 - 4 - 0.05, 1.5, dz)
    group.add(win)
  }
  return { group, height: 5 }
}

function envPark(group: THREE.Group): EnvResult {
  const S = 32
  group.add(ground(S, S, 0x4a6a38))
  // Winding path (flat strips).
  const pathSegs: [number, number, number][] = [
    [-8, -8, 0], [-4, -3, 0.6], [0, 2, 0.3], [5, 7, -0.4], [9, 11, 0]
  ]
  for (const [x, z, rot] of pathSegs) {
    const seg = box(2, 0.03, 5, 0xc4b494)
    seg.position.set(x, 0.02, z)
    seg.rotation.y = rot
    seg.receiveShadow = true
    seg.castShadow = false
    group.add(seg)
  }
  // Pond (translucent water disc).
  const pond = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 0.1, 20),
    new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
  )
  ;(pond.userData as TintUserData).origColor = 0x3080c0
  pond.castShadow = false
  pond.receiveShadow = true
  pond.position.set(-7, 0.05, 7)
  group.add(pond)
  // Trees.
  for (const [x, z, sc] of [[-10, -2, 1.1], [6, -6, 0.9], [10, 4, 1.2], [2, 9, 1.0], [-4, 6, 0.85]] as [number, number, number][]) {
    const t = grp(x, 0, z)
    t.scale.setScalar(sc)
    group.add(t)
    const trunk = cyl(0.2, 0.28, 1.6, 0x5a4030, 8)
    trunk.position.y = 0.8
    t.add(trunk)
    const canopy = sphere(1.3, 0x3a5a2a, 10)
    canopy.position.y = 2.4
    t.add(canopy)
  }
  // Benches.
  for (const [bx, bz] of [[-2, -4], [4, 3]] as [number, number][]) {
    const bench = box(1.8, 0.45, 0.5, 0x6a5a4a)
    bench.position.set(bx, 0.35, bz)
    group.add(bench)
  }
  // Picnic table.
  const ptable = box(1.6, 0.06, 0.8, 0x9a8a72)
  ptable.position.set(8, 0.74, -2)
  group.add(ptable)
  const plegs = box(1.5, 0.72, 0.7, 0x70707a)
  plegs.position.set(8, 0.36, -2)
  group.add(plegs)
  return { group, height: 4 }
}

function envPlaygroundPark(group: THREE.Group): EnvResult {
  const S = 22
  group.add(ground(S, S, 0x4a6a38))
  // Safety-surface patch.
  const surface = box(14, 0.05, 14, 0x9a5a3a)
  surface.position.y = 0.03
  surface.receiveShadow = true
  surface.castShadow = false
  group.add(surface)
  // Swing set.
  const swing = grp(-5, 0, -3)
  group.add(swing)
  for (const side of [-1, 1]) {
    for (const lz of [-0.6, 0.6]) {
      const leg = box(0.1, 2.3, 0.1, 0x70707a)
      leg.position.set(side * 0.8, 1.15, lz)
      leg.rotation.x = lz < 0 ? -0.25 : 0.25
      swing.add(leg)
    }
  }
  const beam = box(2.0, 0.1, 0.1, 0x8a8a92)
  beam.position.y = 2.3
  swing.add(beam)
  for (const sx of [-0.4, 0.4]) {
    const chain = box(0.02, 1.3, 0.02, 0x50505a)
    chain.position.set(sx, 1.65, 0)
    swing.add(chain)
    const seat = box(0.4, 0.04, 0.18, 0x40404a)
    seat.position.set(sx, 1.0, 0)
    swing.add(seat)
  }
  // Slide.
  const slide = grp(5, 0, -2)
  group.add(slide)
  const platform = box(0.8, 0.05, 0.8, 0x82828a)
  platform.position.set(0, 1.6, 0.4)
  slide.add(platform)
  for (const lx of [-0.35, 0.35]) {
    const post0 = box(0.08, 1.6, 0.08, 0x8a8a92)
    post0.position.set(lx, 0.8, 0.4)
    slide.add(post0)
  }
  const chute = box(0.6, 0.05, 2.4, 0x40a0c0)
  chute.position.set(0, 0.8, -0.9)
  chute.rotation.x = 0.7
  slide.add(chute)
  // Climbing frame.
  const climb = grp(-2, 0, 4)
  group.add(climb)
  for (const cx of [-1, 1]) {
    for (const cz of [-1, 1]) {
      const post0 = box(0.08, 1.8, 0.08, 0xd04040)
      post0.position.set(cx, 0.9, cz)
      climb.add(post0)
    }
  }
  for (let i = 0; i < 4; i++) {
    const rung = box(2, 0.05, 0.05, 0xffd040)
    rung.position.set(0, 0.5 + i * 0.4, -1)
    climb.add(rung)
  }
  // Sandbox.
  for (const [x, z, w, d] of [[3, 5, 2.4, 0.15], [3, 6.5, 2.4, 0.15], [1.9, 5.75, 0.15, 1.5], [4.1, 5.75, 0.15, 1.5]] as [number, number, number, number][]) {
    const wall = box(w, 0.25, d, 0x8a7a62)
    wall.position.set(x, 0.125, z)
    group.add(wall)
  }
  const sand = box(2.2, 0.1, 1.5, 0xd8c890)
  sand.position.set(3, 0.1, 5.75)
  group.add(sand)
  // Spring riders.
  for (const [rx, rz] of [[-6, 3], [-4, 5]] as [number, number][]) {
    const spring = cyl(0.1, 0.1, 0.4, 0x40404a, 8)
    spring.position.set(rx, 0.2, rz)
    group.add(spring)
    const seat = box(0.4, 0.2, 0.8, 0xffd040)
    seat.position.set(rx, 0.55, rz)
    group.add(seat)
  }
  // Bench for parents.
  const bench = box(1.8, 0.45, 0.5, 0x6a5a4a)
  bench.position.set(6, 0.35, 5)
  group.add(bench)
  return { group, height: 3 }
}

function envBackyard(group: THREE.Group): EnvResult {
  const S = 24
  group.add(ground(S, S, 0x4a6a38))
  // House rear wall with sliding door (back +Z).
  const rear = box(S * 0.7, 3.5, 0.3, 0xb4a494)
  rear.position.set(0, 1.75, S * 0.5 - 1)
  group.add(rear)
  const slider = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.4, 0.1),
    new THREE.MeshLambertMaterial({ color: 0xbcc4cc, transparent: true, opacity: 0.4 })
  )
  ;(slider.userData as TintUserData).origColor = 0xbcc4cc
  slider.position.set(0, 1.2, S * 0.5 - 1.15)
  group.add(slider)
  // Wood fence around the lawn (3 open sides less; fence at edges).
  for (const side of [-1, 1]) {
    const fence = box(0.15, 1.6, S - 2, 0x8a7a62)
    fence.position.set(side * (S * 0.5 - 1), 0.8, 0)
    group.add(fence)
  }
  const fenceBack = box(S - 2, 1.6, 0.15, 0x8a7a62)
  fenceBack.position.set(0, 0.8, -S * 0.5 + 1)
  group.add(fenceBack)
  // In-ground pool with deck edge.
  const deck = box(6, 0.1, 4, 0x9a9aa2)
  deck.position.set(-4, 0.05, -2)
  group.add(deck)
  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(5, 0.15, 3),
    new THREE.MeshLambertMaterial({ color: 0x3080c0, transparent: true, opacity: 0.6 })
  )
  ;(pool.userData as TintUserData).origColor = 0x3080c0
  pool.castShadow = false
  pool.receiveShadow = true
  pool.position.set(-4, 0.05, -2)
  group.add(pool)
  // Patio with table + chairs.
  const patio = box(6, 0.06, 5, 0xb4b4bc)
  patio.position.set(5, 0.03, 3)
  patio.receiveShadow = true
  patio.castShadow = false
  group.add(patio)
  const table = cyl(0.6, 0.6, 0.05, 0x9a9aa2, 12)
  table.position.set(5, 0.74, 3)
  group.add(table)
  const stem = cyl(0.06, 0.06, 0.72, 0x70707a, 8)
  stem.position.set(5, 0.36, 3)
  group.add(stem)
  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * TAU
    const chair = grp(5 + Math.sin(a) * 1.0, 0, 3 + Math.cos(a) * 1.0)
    chair.rotation.y = a + Math.PI
    group.add(chair)
    buildSimpleChair(chair)
  }
  // BBQ grill.
  const grill = box(0.7, 0.5, 0.5, 0x40404a)
  grill.position.set(8, 0.55, 6)
  group.add(grill)
  const lid = sphere(0.4, 0x2a2a30, 12)
  lid.scale.set(1, 0.6, 0.75)
  lid.position.set(8, 0.85, 6)
  group.add(lid)
  return { group, height: 3 }
}

function envConstructionSite(group: THREE.Group): EnvResult {
  const S = 26
  group.add(ground(S, S, 0x8a7a5a))
  // Steel beam frame (columns + crossbeams).
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) {
      const col = box(0.3, 6, 0.3, 0xc06020)
      col.position.set(cx * 5, 3, cz * 5)
      group.add(col)
    }
  }
  for (const y of [2, 4, 6]) {
    for (const cz of [-5, 0, 5]) {
      const beam = box(10.3, 0.3, 0.3, 0xc06020)
      beam.position.set(0, y, cz)
      group.add(beam)
    }
    for (const cx of [-5, 0, 5]) {
      const beam = box(0.3, 0.3, 10.3, 0xc06020)
      beam.position.set(cx, y, 0)
      group.add(beam)
    }
  }
  // Dirt piles (squashed spheres).
  for (const [x, z, r] of [[-9, -8, 1.5], [8, 7, 2.0]] as [number, number, number][]) {
    const pile = sphere(r, 0x6a5a3a, 10)
    pile.scale.y = 0.4
    pile.position.set(x, r * 0.2, z)
    group.add(pile)
  }
  // Barriers.
  for (const [bx, bz] of [[-8, 8], [8, -8]] as [number, number][]) {
    const barrier = box(2, 1.1, 0.3, 0xff6020)
    barrier.position.set(bx, 0.55, bz)
    group.add(barrier)
  }
  // Portable site office.
  const office = box(3, 2.4, 6, 0xd0d0d0)
  office.position.set(-9, 1.2, 2)
  group.add(office)
  // Material stacks.
  for (let i = 0; i < 3; i++) {
    const stack = box(1.0, 0.3, 3, 0x9a9aa2)
    stack.position.set(9, 0.15 + i * 0.32, -2)
    group.add(stack)
  }
  return { group, height: 6 }
}

function envCemetery(group: THREE.Group): EnvResult {
  const S = 26
  group.add(ground(S, S, 0x4a5a38))
  // Gravel path.
  const path = box(3, 0.03, S, 0xb4b4a4)
  path.position.y = 0.02
  path.receiveShadow = true
  path.castShadow = false
  group.add(path)
  // Rows of varied headstones.
  const shapes = [0, 1, 2] // flat, rounded, cross-ish
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      const x = c < 3 ? -9 + c * 2.5 : -1 + (c - 3) * 2.5 + 4
      const z = -8 + r * 4
      const kind = shapes[(r + c) % 3] ?? 0
      if (kind === 0) {
        const hs = box(0.6, 0.8, 0.15, 0x9a9aa2)
        hs.position.set(x, 0.4, z)
        group.add(hs)
      } else if (kind === 1) {
        const hs = box(0.6, 0.7, 0.15, 0x8a8a92)
        hs.position.set(x, 0.35, z)
        group.add(hs)
        const topR = cyl(0.3, 0.3, 0.15, 0x8a8a92, 10)
        topR.rotation.x = Math.PI / 2
        topR.position.set(x, 0.7, z)
        group.add(topR)
      } else {
        const vert = box(0.2, 1.0, 0.15, 0x9a9aa2)
        vert.position.set(x, 0.5, z)
        group.add(vert)
        const horiz = box(0.6, 0.2, 0.15, 0x9a9aa2)
        horiz.position.set(x, 0.75, z)
        group.add(horiz)
      }
    }
  }
  // Iron-ish fence.
  for (const side of [-1, 1]) {
    const rail = box(0.1, 1.2, S, 0x2c2c32)
    rail.position.set(side * S * 0.5, 0.6, 0)
    group.add(rail)
  }
  // One big tree.
  const trunk = cyl(0.4, 0.55, 3, 0x5a4030, 8)
  trunk.position.set(9, 1.5, -8)
  group.add(trunk)
  const canopy = sphere(2.5, 0x3a5a2a, 12)
  canopy.position.set(9, 4.5, -8)
  group.add(canopy)
  // Mausoleum.
  const maus = box(3, 2.8, 3, 0xb4b4bc)
  maus.position.set(-9, 1.4, 8)
  group.add(maus)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1, 4), mat(0x9a9aa2))
  ;(roof.userData as TintUserData).origColor = 0x9a9aa2
  roof.castShadow = true
  roof.rotation.y = Math.PI / 4
  roof.position.set(-9, 3.3, 8)
  group.add(roof)
  return { group, height: 4 }
}

function envStadium(group: THREE.Group): EnvResult {
  const S = 30
  group.add(ground(S, S, 0x3a6a2a))
  // Field patch with line stripes.
  const field = box(20, 0.03, 14, 0x357028)
  field.position.set(0, 0.02, -3)
  field.receiveShadow = true
  field.castShadow = false
  group.add(field)
  for (let i = 0; i <= 4; i++) {
    const line = box(0.15, 0.02, 14, 0xe0e0e0)
    line.position.set(-8 + i * 4, 0.03, -3)
    line.receiveShadow = true
    line.castShadow = false
    group.add(line)
  }
  // Curved/tiered stand section (stepped rows) along +Z.
  for (let r = 0; r < 8; r++) {
    const z = 6 + r * 1.4
    const y = 0.4 + r * 0.8
    const tier = box(22, 0.8, 1.4, r % 2 === 0 ? 0x7a7a82 : 0x82828a)
    tier.position.set(0, y, z)
    group.add(tier)
    // Seat hints.
    for (let c = 0; c < 10; c++) {
      const seat = box(0.5, 0.4, 0.4, 0x3a5a8a)
      seat.position.set(-9 + c * 2, y + 0.6, z)
      group.add(seat)
    }
  }
  // Floodlight towers (emissive heads).
  for (const [fx, fz] of [[-11, 8], [11, 8]] as [number, number][]) {
    const tower = cyl(0.2, 0.3, 12, 0x55555f, 8)
    tower.position.set(fx, 6, fz)
    group.add(tower)
    const rig = box(2.5, 1.2, 0.4, 0x40404a)
    rig.position.set(fx, 12, fz)
    group.add(rig)
    for (let i = 0; i < 4; i++) {
      const light = emissive(new THREE.CircleGeometry(0.3, 10), 0xfff4d0, 0.95)
      light.position.set(fx - 0.9 + i * 0.6, 12, fz - 0.22)
      group.add(light)
    }
  }
  return { group, height: 8 }
}

function envSky(group: THREE.Group): EnvResult {
  // Flying scenes: no walls, keep origin clear. Faint far-below ground.
  const farGround = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({ color: 0x5a6a58, transparent: true, opacity: 0.4 })
  )
  ;(farGround.userData as TintUserData).origColor = 0x5a6a58
  farGround.rotation.x = -Math.PI / 2
  farGround.position.y = -30
  farGround.receiveShadow = false
  farGround.castShadow = false
  group.add(farGround)
  // 8 puffy cloud clusters at varied x/z and heights 6–25m, origin kept clear.
  const clouds: [number, number, number, number][] = [
    [-18, 8, -14, 1.0],
    [15, 12, 10, 1.3],
    [-12, 18, 16, 0.9],
    [20, 22, -8, 1.1],
    [8, 7, -20, 0.85],
    [-22, 15, 4, 1.2],
    [4, 25, 22, 1.0],
    [-6, 20, -22, 0.95]
  ]
  for (const [cx, cy, cz, sc] of clouds) {
    const cloud = grp(cx, cy, cz)
    cloud.scale.setScalar(sc)
    group.add(cloud)
    const puffs: [number, number, number, number][] = [
      [0, 0, 0, 1.4],
      [1.4, -0.2, 0.4, 1.0],
      [-1.3, -0.1, -0.3, 1.05],
      [0.6, 0.35, -0.8, 0.85],
      [-0.7, 0.25, 0.6, 0.8]
    ]
    for (const [px, py, pz, r] of puffs) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf4f6fa, transparent: true, opacity: 0.8 })
      )
      puff.castShadow = false
      puff.receiveShadow = false
      puff.position.set(px, py, pz)
      cloud.add(puff)
    }
  }
  return { group, height: 0.1 }
}

function envHouseFull(group: THREE.Group): EnvResult {
  const W = 16
  const D = 12
  const wallH = 2.4
  const t = 0.12
  group.add(ground(W, D, 0x8a7a6a))
  // Perimeter: back + two sides (front -Z open for camera).
  const back = box(W, wallH, t, 0xb4a494)
  back.position.set(0, wallH * 0.5, D * 0.5)
  group.add(back)
  for (const side of [-1, 1]) {
    const sw = box(t, wallH, D, 0xb4a494)
    sw.position.set(side * W * 0.5, wallH * 0.5, 0)
    group.add(sw)
  }
  // Room floor-tint patches (top-down legibility). x from -8..8, z from -6..6.
  const roomTile = (x: number, z: number, w: number, d: number, col: number): void => {
    const tile = box(w, 0.02, d, col)
    tile.position.set(x, 0.02, z)
    tile.receiveShadow = true
    tile.castShadow = false
    group.add(tile)
  }
  // KITCHEN (back-left).
  roomTile(-5.5, 3.5, 5, 5, 0xc4c4a4)
  // LIVING ROOM (front-left).
  roomTile(-5.5, -3, 5, 6, 0x9aa4b4)
  // DINING ROOM (back-center).
  roomTile(0.5, 3.5, 5, 5, 0xb4a48a)
  // BEDROOM (back-right).
  roomTile(6, 3, 3.5, 6, 0xa494b4)
  // BATHROOM (front-right).
  roomTile(6, -3.5, 3.5, 5, 0x94b4b4)
  // HALLWAY strip through center.
  roomTile(0.5, -2, 5, 3, 0x9a9080)

  // Interior partition walls with door gaps.
  const partition = (x: number, z: number, w: number, d: number): void => {
    const wall = box(w, wallH, d, 0xc4b4a4)
    wall.position.set(x, wallH * 0.5, z)
    group.add(wall)
  }
  // Kitchen | Dining divider (with gap in middle).
  partition(-3, 4.5, t, 3)
  partition(-3, 1.2, t, 1.4)
  // Kitchen/Dining vs Living/Hall (horizontal wall at z=1, with gaps).
  partition(-6, 1, 3.5, t)
  partition(-1, 1, 3, t)
  // Dining | Bedroom divider.
  partition(3, 4, t, 4)
  // Bedroom vs Bathroom (horizontal).
  partition(6, 0, 3.5, t)
  // Living vs Hallway divider.
  partition(-2.5, -3, t, 5)
  // Bathroom | Hallway divider.
  partition(4.2, -3, t, 5)

  // KITCHEN dressing: counter L, fridge, stove, small table.
  const counter = box(4, 0.9, 0.6, 0x9a9aa2)
  counter.position.set(-5.5, 0.45, D * 0.5 - 0.5)
  group.add(counter)
  const fridge = box(0.7, 1.8, 0.7, 0x9a9aa2)
  fridge.position.set(-7.5, 0.9, D * 0.5 - 0.5)
  group.add(fridge)
  const stove = box(0.7, 0.85, 0.6, 0x82828a)
  stove.position.set(-4, 0.425, D * 0.5 - 0.5)
  group.add(stove)
  const kTable = box(1.0, 0.75, 1.0, 0x9a8a72)
  kTable.position.set(-5.5, 0.375, 2.5)
  group.add(kTable)

  // LIVING ROOM: couch + armchair + coffee table + TV wall.
  const couch = box(2.4, 0.7, 0.9, 0x5a5a66)
  couch.position.set(-6, 0.35, -1)
  group.add(couch)
  const armchair = box(0.9, 0.7, 0.9, 0x5a5a66)
  armchair.position.set(-4, 0.35, -3.5)
  group.add(armchair)
  const coffee = box(1.2, 0.35, 0.6, 0x6a5a4a)
  coffee.position.set(-6, 0.175, -3)
  group.add(coffee)
  const tv = box(1.2, 0.7, 0.06, 0x2a2a30)
  tv.position.set(-7.7, 1.0, -3)
  tv.rotation.y = Math.PI / 2
  group.add(tv)

  // DINING ROOM: table + chairs.
  const dTable = box(1.6, 0.75, 0.9, 0x7a6a52)
  dTable.position.set(0.5, 0.375, 3.5)
  group.add(dTable)
  for (const [cx, cz] of [[-0.6, 3.5], [1.6, 3.5], [0.5, 2.6], [0.5, 4.4]] as [number, number][]) {
    const chair = grp(cx, 0, cz)
    group.add(chair)
    buildSimpleChair(chair)
  }

  // BEDROOM: bed + dresser.
  const bedFrame = box(1.6, 0.4, 2.0, 0x6a5a4a)
  bedFrame.position.set(6, 0.2, 3.5)
  group.add(bedFrame)
  const mattress = box(1.5, 0.25, 1.9, 0xd4d4dc)
  mattress.position.set(6, 0.5, 3.5)
  group.add(mattress)
  const dresser = box(1.2, 0.8, 0.5, 0x6a5a4a)
  dresser.position.set(7, 0.4, 0.5)
  group.add(dresser)

  // BATHROOM: toilet + sink + tub.
  const toilet = box(0.4, 0.5, 0.5, 0xe8e8ec)
  toilet.position.set(5, 0.25, -2)
  group.add(toilet)
  const sink = box(0.6, 0.85, 0.4, 0xe8e8ec)
  sink.position.set(7, 0.425, -2)
  group.add(sink)
  const tub = box(1.6, 0.5, 0.8, 0xe8e8ec)
  tub.position.set(6, 0.25, -5)
  group.add(tub)

  return { group, height: wallH }
}

// ---------------------------------------------------------------------------
// PRIMITIVES
// ---------------------------------------------------------------------------

function buildPrimitive(assetId: string): BuiltAsset {
  const group = new THREE.Group()
  group.name = assetId
  let height = 1

  switch (assetId) {
    case 'prim.cube': {
      const b = box(1, 1, 1)
      b.position.y = 0.5
      group.add(b)
      break
    }
    case 'prim.cylinder': {
      const c = cyl(0.5, 0.5, 1)
      c.position.y = 0.5
      group.add(c)
      break
    }
    case 'prim.ramp': {
      height = 1
      group.add(buildWedge(1, 1, 1))
      break
    }
    case 'prim.wall': {
      height = 2.7
      const w = box(3, 2.7, 0.15)
      w.position.y = 1.35
      group.add(w)
      break
    }
    case 'prim.stairs': {
      height = 2
      const steps = 5
      const rise = height / steps
      const run = 0.4
      const width = 1.2
      for (let i = 0; i < steps; i++) {
        const stepH = rise * (i + 1)
        const step = box(width, stepH, run, 0x86868e)
        step.position.set(0, stepH * 0.5, run * 0.5 - i * run)
        group.add(step)
      }
      break
    }
    default: {
      const b = box(1, 1, 1)
      b.position.y = 0.5
      group.add(b)
    }
  }

  return finalizeStatic(group, height)
}

/**
 * A right-triangular wedge (ramp): rises along +Y from the -Z (low) edge to
 * the +Z (high) edge... but forward is -Z, so incline faces -Z: high at -Z.
 * Built from BufferGeometry with correct outward normals.
 */
function buildWedge(w: number, h: number, d: number): THREE.Mesh {
  const hw = w * 0.5
  // 6 vertices: bottom rectangle + a slanted top edge.
  // Low edge at +Z (z = d/2, y=0), high edge at -Z (z=-d/2, y=h).
  // Cross-section is a right triangle in the Y-Z plane.
  const zLow = d * 0.5
  const zHigh = -d * 0.5
  // Vertices (index):
  // 0: (-hw, 0, zLow)   1: (hw, 0, zLow)
  // 2: (-hw, 0, zHigh)  3: (hw, 0, zHigh)
  // 4: (-hw, h, zHigh)  5: (hw, h, zHigh)
  const positions: number[] = []
  const normals: number[] = []

  const push = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ) => {
    // Compute face normal from the triangle (CCW → outward).
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    for (let i = 0; i < 3; i++) normals.push(nx, ny, nz)
  }

  // Named corners.
  const A0: [number, number, number] = [-hw, 0, zLow]
  const B0: [number, number, number] = [hw, 0, zLow]
  const C0: [number, number, number] = [-hw, 0, zHigh]
  const D0: [number, number, number] = [hw, 0, zHigh]
  const C1: [number, number, number] = [-hw, h, zHigh]
  const D1: [number, number, number] = [hw, h, zHigh]

  // Bottom (facing -Y): A0,C0,D0 / A0,D0,B0 (CCW when viewed from below)
  push(...A0, ...D0, ...C0)
  push(...A0, ...B0, ...D0)
  // Vertical back face (facing -Z): C0,D0,D1 / C0,D1,C1
  push(...C0, ...D0, ...D1)
  push(...C0, ...D1, ...C1)
  // Slanted top (facing up/+Z-ish): A0,C1,D1 / A0,D1,B0
  push(...A0, ...C1, ...D1)
  push(...A0, ...D1, ...B0)
  // Left triangle side (facing -X): A0,C1,C0
  push(...A0, ...C1, ...C0)
  // Right triangle side (facing +X): B0,D0,D1
  push(...B0, ...D0, ...D1)

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  const m = new THREE.Mesh(geo, mat(BASE_GREY))
  m.castShadow = true
  m.receiveShadow = true
  ;(m.userData as TintUserData).origColor = BASE_GREY
  return m
}

// ---------------------------------------------------------------------------
// FALLBACK
// ---------------------------------------------------------------------------

function buildFallback(assetId: string): BuiltAsset {
  const group = new THREE.Group()
  group.name = assetId
  const spec = assetSpec(assetId)
  const h = spec.height
  const b = box(0.5, h, 0.5, 0x9a9aa2)
  b.position.y = h * 0.5
  group.add(b)
  return finalizeStatic(group, h)
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function buildAsset(assetId: string, params?: Record<string, number | string>): BuiltAsset {
  if (assetId.startsWith('person.')) return buildPerson(assetId, params)
  if (assetId === 'animal.bird') return buildBird(assetId)
  if (assetId.startsWith('animal.')) return buildQuadruped(assetId)
  if (assetId.startsWith('vehicle.')) {
    switch (assetId) {
      case 'vehicle.sedan':
        return buildSedan()
      case 'vehicle.suv':
        return buildSUV()
      case 'vehicle.pickup':
        return buildPickup()
      case 'vehicle.van':
        return buildVan()
      case 'vehicle.bus':
        return buildBus()
      case 'vehicle.truck':
        return buildTruck()
      case 'vehicle.tank':
        return buildTank()
      case 'vehicle.train':
        return buildTrain()
      case 'vehicle.motorcycle':
        return buildMotorcycle()
      case 'vehicle.bicycle':
        return buildBicycle()
      case 'vehicle.plane':
        return buildPlane()
      case 'vehicle.boat':
        return buildBoat()
      default:
        return buildFallback(assetId)
    }
  }
  if (assetId.startsWith('furniture.')) return buildFurniture(assetId)
  if (assetId.startsWith('prop.')) return buildProp(assetId)
  if (assetId.startsWith('env.')) return buildEnv(assetId)
  if (assetId.startsWith('prim.')) return buildPrimitive(assetId)
  return buildFallback(assetId)
}

// ---------------------------------------------------------------------------
// Marks & labels
// ---------------------------------------------------------------------------

/**
 * Classic floor spike-tape "T" mark: two crossing flat boxes in the given
 * color + a small floating number label sprite. Deterministic.
 */
export function markMesh(color: string, index: number): THREE.Group {
  const group = new THREE.Group()
  group.name = 'mark'
  const tapeMat = new THREE.MeshBasicMaterial({ color })
  // Crossing bars forming a "T".
  const barGeo = new THREE.BoxGeometry(0.4, 0.02, 0.08)
  const across = new THREE.Mesh(barGeo, tapeMat)
  across.position.set(0, 0.011, -0.14)
  across.rotation.y = 0
  group.add(across)
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.4), tapeMat)
  stem.position.set(0, 0.011, 0.06)
  group.add(stem)

  // Number label sprite floating 0.3m above.
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128)
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${index}`, 64, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
  sprite.scale.set(0.35, 0.35, 0.35)
  sprite.position.set(0, 0.3, 0)
  group.add(sprite)

  return group
}

/**
 * Billboard label: rounded dark pill background with a colored left bar and
 * white bold text. Sized to read at ~2–8m. Deterministic.
 */
export function labelSprite(text: string, color: string): THREE.Sprite {
  const pad = 24
  const fontSize = 44
  const barW = 3
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  // Measure text to size the canvas.
  const measureFont = `bold ${fontSize}px sans-serif`
  let textW = 120
  if (ctx) {
    ctx.font = measureFont
    textW = ctx.measureText(text).width
  }
  const cw = Math.ceil(textW + pad * 2 + barW + 12)
  const ch = Math.ceil(fontSize + pad * 2)
  canvas.width = cw
  canvas.height = ch

  if (ctx) {
    ctx.clearRect(0, 0, cw, ch)
    // Rounded pill background.
    const r = ch * 0.28
    ctx.fillStyle = 'rgba(17,17,19,0.85)'
    roundRect(ctx, 0, 0, cw, ch, r)
    ctx.fill()
    // Colored left bar.
    ctx.fillStyle = color
    roundRect(ctx, 6, ch * 0.2, barW, ch * 0.6, barW * 0.5)
    ctx.fill()
    // White text.
    ctx.fillStyle = '#ffffff'
    ctx.font = measureFont
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, barW + 18, ch * 0.52)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }))
  // Height ≈ 0.28m; width proportional to aspect.
  const h = 0.28
  const w = h * (cw / ch)
  sprite.scale.set(w, h, 1)
  return sprite
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
