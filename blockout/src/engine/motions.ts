/**
 * Mixamo-style motion-preset library for Blockout.
 *
 * Each preset is a sequence of full-pose keyframes describing per-joint offsets
 * (radians) applied ADDITIVELY on top of a gait pose by the renderer (see
 * `animatePerson` / `AnimInput.overrides` in
 * `src/renderer/viewport/builders.ts`). The app interpolates LINEARLY between
 * keyframes, and any joint key missing from a keyframe reads as 0 — which would
 * pop the limb toward neutral mid-motion. To avoid that, every joint a motion
 * touches ANYWHERE appears in EVERY keyframe of that motion, with an explicit
 * value (including 0 for a deliberately-neutral pose).
 *
 * Sign conventions (from the renderer's override application):
 *   shoulderLX / shoulderRX : arm swing around X; NEGATIVE raises forward/up
 *                             (−2.3 ≈ straight up-forward, −1.5 ≈ punch height).
 *   shoulderLZ / shoulderRZ : arm out to the side; POSITIVE = outward (both
 *                             sides — the renderer mirrors the right arm).
 *   elbowL / elbowR         : bend; POSITIVE bends the forearm toward the
 *                             upper arm (1.9 ≈ chambered/guard, ~0.15 ≈ extended).
 *   hipLX / hipRX           : leg swing; POSITIVE ≈ leg back, NEGATIVE raises
 *                             the leg forward (−1.6 ≈ high front kick).
 *   hipLZ / hipRZ           : leg abduction out to the side; POSITIVE = leg
 *                             swings OUTWARD away from the body midline (both
 *                             legs — the renderer mirrors the right leg).
 *                             (0.5 ≈ a wide jumping-jack stance, 1.0 ≈ a high
 *                             side kick.)
 *   kneeL / kneeR           : POSITIVE bends the shin backward.
 *   torsoX                  : POSITIVE leans the torso forward.
 *   torsoY                  : twist (positive = counterclockwise from above).
 *   torsoZ                  : lateral lean; POSITIVE = lean to the RIGHT
 *                             (small ±0.35 counter-leans read well).
 *   headX                   : nod (small ±0.4). headY : turn.
 *   headZ                   : head tilt; POSITIVE = tilt to the RIGHT (±0.3).
 *
 * Guard-pose reference (fight moves): elbows ~1.8, shoulders X ≈ −0.9, slight
 * torsoX 0.15.
 *
 * Pure data — no engine-purity concerns (no DOM/three/Electron imports).
 */

export interface MotionKeyframe {
  /** Seconds from the start of the motion. */
  t: number
  joints: Record<string, number>
  /**
   * Optional root motion: offsets from the motion's base position, applied
   * by the app when laying down marks. `forward` is meters along the
   * character's heading, `up` is altitude. Lets a motion JUMP (up), CRAWL
   * (forward), or climb stairs (both) instead of staying rooted.
   */
  move?: { forward?: number; up?: number }
}

export interface MotionPreset {
  id: string
  name: string
  category: 'fight' | 'dance' | 'gesture' | 'stunt' | 'sport' | 'everyday'
  /** Total length in seconds (last keyframe t should equal this). */
  duration: number
  /** True if the motion reads best repeated (dance loops). */
  loop: boolean
  keyframes: MotionKeyframe[]
}

export const MOTION_PRESETS: MotionPreset[] = [
  // -------------------------------------------------------------------------
  // FIGHT
  // -------------------------------------------------------------------------
  {
    id: 'jab-cross',
    name: 'Jab / Cross',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0,
        },
      },
      // Right straight punch out (rear-hand cross fires first here).
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, elbowL: 1.9, elbowR: 0.15,
          torsoX: 0.15, torsoY: 0.5,
        },
      },
      // Retract right, reset guard.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0,
        },
      },
      // Left cross out (twist the other way).
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.9,
          torsoX: 0.15, torsoY: -0.5,
        },
      },
      // Back to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0,
        },
      },
    ],
  },
  {
    id: 'uppercut',
    name: 'Uppercut',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Guard, slight dip to load.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0,
        },
      },
      // Drop and coil — right hand low, torso wound.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: 0.2, elbowL: 1.8, elbowR: 1.9,
          torsoX: 0.4, torsoY: 0.35,
        },
      },
      // Drive up — right arm rips upward, torso opens and rises.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -2.1, elbowL: 1.8, elbowR: 1.2,
          torsoX: -0.1, torsoY: -0.4,
        },
      },
      // Recover to guard.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0,
        },
      },
    ],
  },
  {
    id: 'high-kick',
    name: 'High Kick',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard, feet set.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          hipRX: 0, kneeR: 0, torsoX: 0.15,
        },
      },
      // Chamber — knee up, shin folded.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          hipRX: -1.0, kneeR: 1.6, torsoX: 0.1,
        },
      },
      // Front kick R — leg snaps out high, torso leans back to counter.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.5, elbowR: 1.5,
          hipRX: -1.7, kneeR: 0.1, torsoX: -0.25,
        },
      },
      // Re-chamber.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          hipRX: -1.0, kneeR: 1.6, torsoX: 0.1,
        },
      },
      // Recover to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          hipRX: 0, kneeR: 0, torsoX: 0.15,
        },
      },
    ],
  },
  {
    id: 'block-and-dodge',
    name: 'Block & Dodge',
    category: 'fight',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0, hipLX: 0, hipRX: 0, kneeL: 0, kneeR: 0,
        },
      },
      // Arms up high guard, forearms crossed in front of face.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.15, headX: 0.2, hipLX: 0, hipRX: 0, kneeL: 0, kneeR: 0,
        },
      },
      // Lean back and duck — weight drops, torso pulls back, knees bend.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.9, elbowR: 1.9,
          torsoX: -0.4, headX: 0.35, hipLX: 0.5, hipRX: 0.5,
          kneeL: 0.9, kneeR: 0.9,
        },
      },
      // Rise back into high guard.
      {
        t: 1.05,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.15, headX: 0.2, hipLX: 0, hipRX: 0, kneeL: 0, kneeR: 0,
        },
      },
      // Settle to guard.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0, hipLX: 0, hipRX: 0, kneeL: 0, kneeR: 0,
        },
      },
    ],
  },
  {
    id: 'haymaker',
    name: 'Haymaker',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0,
        },
      },
      // Wind up — right arm cocks way back and out, torso twists hard right.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: 0.1, shoulderRZ: 1.1,
          elbowL: 1.8, elbowR: 1.3, torsoX: 0.1, torsoY: 0.8,
        },
      },
      // Big swing across — arm sweeps around, torso unwinds counterclockwise.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.4, shoulderRZ: 0.8,
          elbowL: 1.8, elbowR: 0.3, torsoX: 0.2, torsoY: -0.6,
        },
      },
      // Follow-through past center.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.0, shoulderRZ: 0.2,
          elbowL: 1.8, elbowR: 0.6, torsoX: 0.25, torsoY: -0.8,
        },
      },
      // Recover to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0,
        },
      },
    ],
  },
  {
    id: 'knocked-down',
    name: 'Knocked Down',
    category: 'fight',
    duration: 1.5,
    loop: false,
    keyframes: [
      // Standing, arms neutral-ish.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0, shoulderRZ: 0,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0, torsoY: 0, headX: 0, headY: 0,
        },
      },
      // Hit reaction — head snaps, torso recoils back, arms fly up.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.5, elbowR: 0.5, torsoX: -0.5, torsoY: 0.4,
          headX: -0.3, headY: 0.5,
        },
      },
      // Stagger — torso whips forward, arms flail wide the other way.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -2.0, shoulderLZ: 0.9, shoulderRZ: 0.4,
          elbowL: 0.2, elbowR: 0.7, torsoX: 0.6, torsoY: -0.5,
          headX: 0.35, headY: -0.4,
        },
      },
      // Flail — arms thrown out, losing balance.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.6, shoulderRX: -0.6, shoulderLZ: 1.0, shoulderRZ: 0.9,
          elbowL: 0.6, elbowR: 0.3, torsoX: 0.5, torsoY: 0.3,
          headX: 0.3, headY: 0.3,
        },
      },
      // Going down — torso pitching forward, arms starting to drop.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.9, torsoY: 0,
          headX: 0.4, headY: 0,
        },
      },
      // Crumpled — the app holds this final pose: torso forward, arms hang down.
      {
        t: 1.5,
        joints: {
          shoulderLX: 0.2, shoulderRX: 0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.5, elbowR: 0.5, torsoX: 1.1, torsoY: 0,
          headX: 0.4, headY: 0,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // DANCE
  // -------------------------------------------------------------------------
  {
    id: 'groove-loop',
    name: 'Groove Loop',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Right arm pumped up, sway right, left knee bent (bounce).
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -2.0, elbowL: 0.9, elbowR: 1.4,
          torsoY: 0.3, torsoX: 0.05, kneeL: 0.4, kneeR: 0.0,
        },
      },
      // Cross — pass through center.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.2, elbowR: 1.2,
          torsoY: 0.0, torsoX: 0.05, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Left arm pumped up, sway left, right knee bent.
      {
        t: 0.8,
        joints: {
          shoulderLX: -2.0, shoulderRX: -0.4, elbowL: 1.4, elbowR: 0.9,
          torsoY: -0.3, torsoX: 0.05, kneeL: 0.0, kneeR: 0.4,
        },
      },
      // Cross back.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.2, elbowR: 1.2,
          torsoY: 0.0, torsoX: 0.05, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Return to start pose to seamlessly loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -2.0, elbowL: 0.9, elbowR: 1.4,
          torsoY: 0.3, torsoX: 0.05, kneeL: 0.4, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'arms-up-party',
    name: 'Arms Up Party',
    category: 'dance',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Both arms straight up, sway right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.25, kneeL: 0.3, kneeR: 0.0,
        },
      },
      // Sway left, hands waving over.
      {
        t: 0.4,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.3, elbowR: 0.3, torsoY: -0.25, kneeL: 0.0, kneeR: 0.3,
        },
      },
      // Sway right again.
      {
        t: 0.8,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.25, kneeL: 0.3, kneeR: 0.0,
        },
      },
      // Loop back to start.
      {
        t: 1.2,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.25, kneeL: 0.3, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'disco-point',
    name: 'Disco Point',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Right arm points high diagonal, left arm low, torso twists right.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.3, shoulderRX: -2.2, shoulderLZ: 0.2, shoulderRZ: 0.5,
          elbowL: 0.2, elbowR: 0.1, torsoY: -0.4, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Switch — pass through center.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Left arm points high diagonal, right arm low, torso twists left.
      {
        t: 0.8,
        joints: {
          shoulderLX: -2.2, shoulderRX: 0.3, shoulderLZ: 0.5, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 0.2, torsoY: 0.4, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Switch back through center.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Loop to start.
      {
        t: 1.6,
        joints: {
          shoulderLX: 0.3, shoulderRX: -2.2, shoulderLZ: 0.2, shoulderRZ: 0.5,
          elbowL: 0.2, elbowR: 0.1, torsoY: -0.4, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'robot',
    name: 'Robot',
    category: 'dance',
    duration: 2.0,
    loop: true,
    // Stepped motion: keyframe pairs 0.05s apart hold a pose then snap to the
    // next, faking stiff robotic transitions between rigid 90° positions.
    keyframes: [
      // Pose A — right forearm up (90° elbow), left arm forward level.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 1.6, torsoY: 0.0,
        },
      },
      // Hold A.
      {
        t: 0.45,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 1.6, torsoY: 0.0,
        },
      },
      // Snap to B.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 0.1, torsoY: -0.2,
        },
      },
      // Hold B.
      {
        t: 0.95,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 0.1, torsoY: -0.2,
        },
      },
      // Snap to C — both forearms up, torso twisted the other way.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 1.6, torsoY: 0.2,
        },
      },
      // Hold C.
      {
        t: 1.45,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 1.6, torsoY: 0.2,
        },
      },
      // Snap back toward A.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 1.6, torsoY: 0.0,
        },
      },
      // Hold, then loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 1.6, torsoY: 0.0,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // GESTURE
  // -------------------------------------------------------------------------
  {
    id: 'wave',
    name: 'Wave',
    category: 'gesture',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Arm at side, neutral.
      {
        t: 0.0,
        joints: { shoulderRX: 0, shoulderRZ: 0, elbowR: 0 },
      },
      // Arm raised up-forward (waving position).
      {
        t: 0.3,
        joints: { shoulderRX: -2.3, shoulderRZ: 0.4, elbowR: 0.6 },
      },
      // Forearm wags out.
      {
        t: 0.55,
        joints: { shoulderRX: -2.3, shoulderRZ: 0.7, elbowR: 0.4 },
      },
      // Forearm wags in.
      {
        t: 0.8,
        joints: { shoulderRX: -2.3, shoulderRZ: 0.4, elbowR: 0.8 },
      },
      // Wags out again.
      {
        t: 1.0,
        joints: { shoulderRX: -2.3, shoulderRZ: 0.7, elbowR: 0.4 },
      },
      // Arm back down to side.
      {
        t: 1.2,
        joints: { shoulderRX: 0, shoulderRZ: 0, elbowR: 0 },
      },
    ],
  },
  {
    id: 'clap',
    name: 'Clap',
    category: 'gesture',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Arms forward, hands apart (shoulders swung out to the sides).
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.9, elbowR: 0.9,
        },
      },
      // Palms meet — arms swing inward.
      {
        t: 0.25,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.1, elbowR: 1.1,
        },
      },
      // Apart again.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.9, elbowR: 0.9,
        },
      },
      // Palms meet (second clap).
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.1, elbowR: 1.1,
        },
      },
      // Apart — loops to start.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.9, elbowR: 0.9,
        },
      },
    ],
  },
  {
    id: 'point-ahead',
    name: 'Point Ahead',
    category: 'gesture',
    duration: 0.8,
    loop: false,
    keyframes: [
      // Arm at side.
      {
        t: 0.0,
        joints: { shoulderRX: 0, shoulderRZ: 0, elbowR: 0 },
      },
      // Rising, elbow still a little bent.
      {
        t: 0.4,
        joints: { shoulderRX: -1.2, shoulderRZ: 0.1, elbowR: 0.5 },
      },
      // Straight horizontal point ahead, hold.
      {
        t: 0.8,
        joints: { shoulderRX: -1.55, shoulderRZ: 0.0, elbowR: 0.0 },
      },
    ],
  },
  {
    id: 'bow',
    name: 'Bow',
    category: 'gesture',
    duration: 1.5,
    loop: false,
    keyframes: [
      // Upright, arms at side.
      {
        t: 0.0,
        joints: {
          torsoX: 0, headX: 0, shoulderLX: 0, shoulderRX: 0,
          elbowL: 0, elbowR: 0,
        },
      },
      // Fold forward into the bow — arms trail slightly back, head follows.
      {
        t: 0.5,
        joints: {
          torsoX: 0.9, headX: 0.4, shoulderLX: 0.4, shoulderRX: 0.4,
          elbowL: 0.1, elbowR: 0.1,
        },
      },
      // Hold the bow.
      {
        t: 0.9,
        joints: {
          torsoX: 0.9, headX: 0.4, shoulderLX: 0.4, shoulderRX: 0.4,
          elbowL: 0.1, elbowR: 0.1,
        },
      },
      // Return upright.
      {
        t: 1.5,
        joints: {
          torsoX: 0, headX: 0, shoulderLX: 0, shoulderRX: 0,
          elbowL: 0, elbowR: 0,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // STUNT
  // -------------------------------------------------------------------------
  {
    id: 'dive-dodge',
    name: 'Dive Dodge',
    category: 'stunt',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Standing ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.1, hipLX: 0, hipRX: 0, kneeL: 0, kneeR: 0,
        },
      },
      // Crouch wind-up — drop low, coil, arms pull back.
      {
        t: 0.4,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.5, hipLX: 0.6, hipRX: 0.6, kneeL: 1.3, kneeR: 1.3,
        },
      },
      // Explode into the dive — arms thrown forward, torso lunges, legs extend back.
      {
        t: 0.7,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, elbowL: 0.1, elbowR: 0.1,
          torsoX: 0.8, hipLX: 0.5, hipRX: 0.5, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Full extension — stretched out through the dodge.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, elbowL: 0.0, elbowR: 0.0,
          torsoX: 1.0, hipLX: 0.7, hipRX: 0.7, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },

  // =========================================================================
  // ROUND 5 ADDITIONS
  // =========================================================================

  // -------------------------------------------------------------------------
  // DANCE — distinct silhouettes for one-click crowd dance numbers
  // -------------------------------------------------------------------------
  {
    id: 'hip-hop-bounce',
    name: 'Hip-Hop Bounce',
    category: 'dance',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Low bounce down, right arm swagger out, left tucked.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.1, shoulderLZ: 0.2, shoulderRZ: 0.5,
          elbowL: 1.5, elbowR: 1.0, torsoX: 0.15, torsoY: 0.2,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Rise through center, arms cross the swagger.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.35, shoulderRZ: 0.35,
          elbowL: 1.2, elbowR: 1.2, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Low bounce again, left arm swagger out, right tucked.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.1, shoulderRX: -0.6, shoulderLZ: 0.5, shoulderRZ: 0.2,
          elbowL: 1.0, elbowR: 1.5, torsoX: 0.15, torsoY: -0.2,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Rise through center again.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.35, shoulderRZ: 0.35,
          elbowL: 1.2, elbowR: 1.2, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Loop back to start.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.1, shoulderLZ: 0.2, shoulderRZ: 0.5,
          elbowL: 1.5, elbowR: 1.0, torsoX: 0.15, torsoY: 0.2,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
      },
    ],
  },
  {
    id: 'salsa-step',
    name: 'Salsa Step',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Weight right, hip sways right, left arm open out, right arm closed in.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -0.9, shoulderLZ: 0.7, shoulderRZ: 0.1,
          elbowL: 0.9, elbowR: 1.4, torsoY: -0.25, torsoX: 0.05,
          hipLX: -0.2, hipRX: 0.2, kneeL: 0.15, kneeR: 0.3,
        },
      },
      // Cross center — arms swap toward neutral.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.15, elbowR: 1.15, torsoY: 0.0, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Weight left, hip sways left, right arm open out, left arm closed in.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.0, shoulderLZ: 0.1, shoulderRZ: 0.7,
          elbowL: 1.4, elbowR: 0.9, torsoY: 0.25, torsoX: 0.05,
          hipLX: 0.2, hipRX: -0.2, kneeL: 0.3, kneeR: 0.15,
        },
      },
      // Cross back through center.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.15, elbowR: 1.15, torsoY: 0.0, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop to start.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.0, shoulderRX: -0.9, shoulderLZ: 0.7, shoulderRZ: 0.1,
          elbowL: 0.9, elbowR: 1.4, torsoY: -0.25, torsoX: 0.05,
          hipLX: -0.2, hipRX: 0.2, kneeL: 0.15, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'moonwalk-lean',
    name: 'Moonwalk Lean',
    category: 'dance',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Backward lean, arms loose low, right leg slides back extended.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.3,
          hipLX: 0.0, hipRX: 0.5, kneeL: 0.1, kneeR: 0.05,
        },
      },
      // Right foot plants, left leg slides back, weight shifts.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.25, shoulderRX: -0.15, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.3,
          hipLX: 0.5, hipRX: 0.0, kneeL: 0.05, kneeR: 0.1,
        },
      },
      // Left foot plants, right leg slides back again.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.3,
          hipLX: 0.0, hipRX: 0.5, kneeL: 0.1, kneeR: 0.05,
        },
      },
      // Right plants, left slides back.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.25, shoulderRX: -0.15, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.3,
          hipLX: 0.5, hipRX: 0.0, kneeL: 0.05, kneeR: 0.1,
        },
      },
      // Loop back to start.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.3,
          hipLX: 0.0, hipRX: 0.5, kneeL: 0.1, kneeR: 0.05,
        },
      },
    ],
  },
  {
    id: 'breakdance-freeze',
    name: 'Breakdance Freeze',
    category: 'dance',
    duration: 2.2,
    loop: false,
    keyframes: [
      // Standing ready, arms loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Squat and reach one hand down to the floor.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.2, shoulderRX: 0.6, shoulderLZ: 0.4, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 0.2, torsoX: 0.7, torsoY: 0.3,
          hipLX: 0.7, hipRX: 0.7, kneeL: 1.4, kneeR: 1.4,
        },
      },
      // Drop to the hand, torso pitches hard over, legs kick up and out.
      {
        t: 1.1,
        joints: {
          shoulderLX: 0.2, shoulderRX: 1.0, shoulderLZ: 0.9, shoulderRZ: 0.2,
          elbowL: 0.3, elbowR: 0.05, torsoX: 1.2, torsoY: 0.6,
          hipLX: -1.4, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
      },
      // Hold the freeze — one-hand support, legs splayed in the air.
      {
        t: 1.7,
        joints: {
          shoulderLX: 0.2, shoulderRX: 1.0, shoulderLZ: 0.9, shoulderRZ: 0.2,
          elbowL: 0.3, elbowR: 0.05, torsoX: 1.2, torsoY: 0.6,
          hipLX: -1.4, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
      },
      // Recover to standing.
      {
        t: 2.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'macarena',
    name: 'Macarena',
    category: 'dance',
    duration: 3.2,
    loop: true,
    keyframes: [
      // Both arms straight out forward, palms down.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.55, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Arms out, palms flip up (open the elbows slightly).
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.55, shoulderLZ: 0.25, shoulderRZ: 0.25,
          elbowL: 0.3, elbowR: 0.3, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Hands cross up to opposite shoulders.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 2.4, elbowR: 2.4, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Hands up to the back of the head.
      {
        t: 1.6,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 2.2, elbowR: 2.2, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Hands drop to the hips, hip sway right.
      {
        t: 2.2,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.6, elbowR: 1.6, torsoY: -0.25, hipLX: -0.15, hipRX: 0.15,
        },
      },
      // Hip sway left (the little wiggle before the jump).
      {
        t: 2.7,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.6, elbowR: 1.6, torsoY: 0.25, hipLX: 0.15, hipRX: -0.15,
        },
      },
      // Reset arms straight out forward to loop.
      {
        t: 3.2,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.55, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
    ],
  },
  {
    id: 'mosh-jump',
    name: 'Mosh Jump',
    category: 'dance',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Compressed crouch — knees and hips loaded, arms cocked down.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.3, shoulderRX: 0.3, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.8, elbowR: 0.8, torsoX: 0.3,
          hipLX: 0.6, hipRX: 0.6, kneeL: 1.2, kneeR: 1.2,
        },
      },
      // Explode up — legs extend, both arms thrown straight up.
      {
        t: 0.35,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 0.1, torsoX: -0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Peak — fully extended, arms up, airborne.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.7, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.05, elbowR: 0.05, torsoX: -0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Land back into the compressed crouch to loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: 0.3, shoulderRX: 0.3, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.8, elbowR: 0.8, torsoX: 0.3,
          hipLX: 0.6, hipRX: 0.6, kneeL: 1.2, kneeR: 1.2,
        },
      },
    ],
  },
  {
    id: 'slow-sway',
    name: 'Slow Sway',
    category: 'dance',
    duration: 3.0,
    loop: true,
    keyframes: [
      // Gentle sway right, arms held mid at partner height.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.2, elbowR: 1.2, torsoY: 0.15, torsoX: 0.05,
          hipLX: -0.1, hipRX: 0.1,
        },
      },
      // Ease through center.
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.2, elbowR: 1.2, torsoY: 0.0, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Sway left.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.2, elbowR: 1.2, torsoY: -0.15, torsoX: 0.05,
          hipLX: 0.1, hipRX: -0.1,
        },
      },
      // Ease back through center.
      {
        t: 2.25,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.2, elbowR: 1.2, torsoY: 0.0, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Loop back to the right sway.
      {
        t: 3.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.2, elbowR: 1.2, torsoY: 0.15, torsoX: 0.05,
          hipLX: -0.1, hipRX: 0.1,
        },
      },
    ],
  },
  {
    id: 'twist',
    name: 'The Twist',
    category: 'dance',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Torso twisted right, arms pump opposite (elbows bent, swinging).
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.3, elbowR: 1.3, torsoY: 0.4, torsoX: 0.1,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Through center — knees dip.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.3, elbowR: 1.3, torsoY: 0.0, torsoX: 0.1,
          kneeL: 0.45, kneeR: 0.45,
        },
      },
      // Torso twisted left, arms pump the other way.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.3, elbowR: 1.3, torsoY: -0.4, torsoX: 0.1,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Back through center.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.3, elbowR: 1.3, torsoY: 0.0, torsoX: 0.1,
          kneeL: 0.45, kneeR: 0.45,
        },
      },
      // Loop to start.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.3, elbowR: 1.3, torsoY: 0.4, torsoX: 0.1,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'vogue-pose-chain',
    name: 'Vogue Pose Chain',
    category: 'dance',
    duration: 3.6,
    loop: false,
    keyframes: [
      // Neutral start.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, torsoY: 0.0, headY: 0.0,
        },
      },
      // Pose 1 — right arm framed high over the head, head turned.
      {
        t: 0.4,
        joints: {
          shoulderLX: -2.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.6,
          elbowL: 1.8, elbowR: 0.2, torsoY: -0.2, headY: 0.4,
        },
      },
      // Hold pose 1.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.6,
          elbowL: 1.8, elbowR: 0.2, torsoY: -0.2, headY: 0.4,
        },
      },
      // Pose 2 — left arm frames the face, right arm out to the side.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.5, shoulderLZ: 0.6, shoulderRZ: 0.9,
          elbowL: 0.2, elbowR: 2.0, torsoY: 0.2, headY: -0.4,
        },
      },
      // Hold pose 2.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.5, shoulderLZ: 0.6, shoulderRZ: 0.9,
          elbowL: 0.2, elbowR: 2.0, torsoY: 0.2, headY: -0.4,
        },
      },
      // Pose 3 — both arms boxed up beside the head, sharp.
      {
        t: 2.4,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 2.0, elbowR: 2.0, torsoY: 0.0, headY: 0.0,
        },
      },
      // Hold pose 3.
      {
        t: 3.0,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 2.0, elbowR: 2.0, torsoY: 0.0, headY: 0.0,
        },
      },
      // Pose 4 — arms sweep down and out, final flourish held.
      {
        t: 3.6,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.1, elbowR: 0.1, torsoY: 0.0, headY: 0.0,
        },
      },
    ],
  },
  {
    id: 'charleston',
    name: 'Charleston',
    category: 'dance',
    duration: 1.4,
    loop: true,
    keyframes: [
      // Right knee up, arms swing back (opposition), torso light.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: 0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.15, torsoX: 0.1,
          hipLX: 0.1, hipRX: -0.8, kneeL: 0.2, kneeR: 1.2,
        },
      },
      // Feet together, arms swing forward through center.
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.0, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Left knee up, arms swing back the other way.
      {
        t: 0.7,
        joints: {
          shoulderLX: 0.4, shoulderRX: -1.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoY: -0.15, torsoX: 0.1,
          hipLX: -0.8, hipRX: 0.1, kneeL: 1.2, kneeR: 0.2,
        },
      },
      // Feet together, arms forward again.
      {
        t: 1.05,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.0, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Loop back to the first kick.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: 0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoY: 0.15, torsoX: 0.1,
          hipLX: 0.1, hipRX: -0.8, kneeL: 0.2, kneeR: 1.2,
        },
      },
    ],
  },
  {
    id: 'headbang',
    name: 'Headbang',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Head up, slight crouch, arms cocked in a rock stance.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.3, torsoX: 0.0, headX: -0.35,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Snap the head and torso down hard.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.3, torsoX: 0.5, headX: 0.4,
          kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Whip back up.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.3, torsoX: 0.0, headX: -0.35,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Second bang down.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.3, torsoX: 0.5, headX: 0.4,
          kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Back up to loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.3, torsoX: 0.0, headX: -0.35,
          kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // FIGHT
  // -------------------------------------------------------------------------
  {
    id: 'roundhouse-kick',
    name: 'Roundhouse Kick',
    category: 'fight',
    duration: 1.3,
    loop: false,
    keyframes: [
      // Guard, feet set.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0, kneeR: 0,
        },
      },
      // Pivot and chamber — knee whips up and across, torso winds.
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.7, shoulderRX: -1.2, elbowL: 1.6, elbowR: 1.9,
          torsoX: 0.1, torsoY: 0.6, hipRX: -1.1, kneeR: 1.5,
        },
      },
      // Whip the shin out — leg extends across, torso rotates fully through.
      {
        t: 0.65,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.4, elbowL: 1.5, elbowR: 1.8,
          torsoX: 0.1, torsoY: -0.8, hipRX: -1.5, kneeR: 0.2,
        },
      },
      // Re-chamber after impact.
      {
        t: 0.95,
        joints: {
          shoulderLX: -0.7, shoulderRX: -1.2, elbowL: 1.6, elbowR: 1.9,
          torsoX: 0.1, torsoY: 0.2, hipRX: -1.1, kneeR: 1.5,
        },
      },
      // Recover to guard.
      {
        t: 1.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0, kneeR: 0,
        },
      },
    ],
  },
  {
    id: 'front-kick-combo',
    name: 'Front Kick / Jab',
    category: 'fight',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0, kneeR: 0,
        },
      },
      // Chamber front kick — right knee up.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.1, torsoY: 0.0, hipRX: -1.0, kneeR: 1.6,
        },
      },
      // Front kick snaps straight out.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.7, elbowR: 1.7,
          torsoX: -0.2, torsoY: 0.0, hipRX: -1.5, kneeR: 0.15,
        },
      },
      // Foot lands back into guard, load the jab.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.8,
          torsoX: 0.15, torsoY: -0.1, hipRX: 0, kneeR: 0,
        },
      },
      // Left jab fires straight.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.9,
          torsoX: 0.15, torsoY: -0.4, hipRX: 0, kneeR: 0,
        },
      },
      // Retract to guard.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0, kneeR: 0,
        },
      },
    ],
  },
  {
    id: 'spinning-backfist',
    name: 'Spinning Backfist',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Wind the torso hard clockwise to start the spin.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.2, elbowL: 1.8, elbowR: 1.6,
          torsoX: 0.1, torsoY: 0.9,
        },
      },
      // Backfist whips out as the torso unwinds through the spin.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, shoulderRZ: 0.9, elbowL: 1.8, elbowR: 0.4,
          torsoX: 0.15, torsoY: -0.9,
        },
      },
      // Follow-through past center.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderRZ: 0.4, elbowL: 1.8, elbowR: 1.0,
          torsoX: 0.15, torsoY: -1.1,
        },
      },
      // Recover to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'double-jab-body-shot',
    name: 'Double Jab / Body Shot',
    category: 'fight',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0,
        },
      },
      // First jab out (left).
      {
        t: 0.25,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.8,
          torsoX: 0.15, torsoY: -0.35,
        },
      },
      // Half-retract.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.1, shoulderRX: -0.9, elbowL: 1.0, elbowR: 1.8,
          torsoX: 0.15, torsoY: -0.1,
        },
      },
      // Second jab out (left again).
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.8,
          torsoX: 0.15, torsoY: -0.35,
        },
      },
      // Drop level and rip the right hand to the body — torso leans in low.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.0, elbowL: 1.8, elbowR: 0.6,
          torsoX: 0.5, torsoY: 0.4,
        },
      },
      // Recover to guard.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'guard-up-advance',
    name: 'Guard-Up Advance',
    category: 'fight',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Tight high guard, weight on the back foot.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.2, hipLX: -0.15, hipRX: 0.2, kneeL: 0.4, kneeR: 0.3,
        },
      },
      // Lead foot creeps forward, guard stays tight.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.25, shoulderRX: -1.25, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.2, hipLX: -0.3, hipRX: 0.15, kneeL: 0.3, kneeR: 0.35,
        },
      },
      // Rear foot catches up, settle back into stance.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.2, hipLX: -0.15, hipRX: 0.2, kneeL: 0.4, kneeR: 0.3,
        },
      },
      // Another creeping lead step.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.25, shoulderRX: -1.25, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.2, hipLX: -0.3, hipRX: 0.15, kneeL: 0.3, kneeR: 0.35,
        },
      },
      // Settle — loops to start.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.2, hipLX: -0.15, hipRX: 0.2, kneeL: 0.4, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'dodge-weave',
    name: 'Dodge & Weave',
    category: 'fight',
    duration: 1.8,
    loop: true,
    keyframes: [
      // Centered guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Bob down and weave to the left.
      {
        t: 0.45,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, torsoY: 0.4, hipLX: 0.5, hipRX: 0.3, kneeL: 0.9, kneeR: 0.6,
        },
      },
      // Rise back to center.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Bob down and weave to the right.
      {
        t: 1.35,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, torsoY: -0.4, hipLX: 0.3, hipRX: 0.5, kneeL: 0.6, kneeR: 0.9,
        },
      },
      // Rise to center — loops.
      {
        t: 1.8,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'grapple-shove',
    name: 'Grapple Shove',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard, weight balanced.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Reach in and grab — arms extend forward, drop into the hips.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.4, hipLX: 0.4, hipRX: 0.4, kneeL: 0.7, kneeR: 0.7,
        },
      },
      // Drive and shove — legs extend, arms thrust out, torso rises through.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.55, elbowL: 0.1, elbowR: 0.1,
          torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Recover to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'takedown-lunge',
    name: 'Takedown Lunge',
    category: 'fight',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Level change — drop the hips low, hands reach for the legs.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.7, hipLX: 0.7, hipRX: 0.7, kneeL: 1.3, kneeR: 1.3,
        },
      },
      // Explosive lunge — lead knee drives forward, arms clamp, torso spears in.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.4, elbowR: 1.4,
          torsoX: 1.0, hipLX: -0.9, hipRX: 0.6, kneeL: 1.0, kneeR: 0.4,
        },
      },
      // Drive through the finish, held low.
      {
        t: 1.05,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.6, elbowR: 1.6,
          torsoX: 1.1, hipLX: -0.6, hipRX: 0.8, kneeL: 1.2, kneeR: 0.6,
        },
      },
      // Recover to guard.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // REACTIONS & STUNTS — fight "defender" moves and falls
  // -------------------------------------------------------------------------
  {
    id: 'hit-reaction-head',
    name: 'Hit Reaction — Head',
    category: 'stunt',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Standing, loose guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.1, torsoY: 0.0, headX: 0.0, headY: 0.0,
          hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Impact — head snaps back and to the side, torso recoils.
      {
        t: 0.2,
        joints: {
          shoulderLX: -1.0, shoulderRX: -0.4, elbowL: 1.0, elbowR: 1.0,
          torsoX: -0.4, torsoY: 0.4, headX: -0.4, headY: 0.5,
          hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Stagger a step, off balance to the side.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.9, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, torsoY: -0.3, headX: 0.2, headY: -0.3,
          hipLX: -0.3, hipRX: 0.3,
        },
      },
      // Regain composure.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.1, torsoY: 0.0, headX: 0.0, headY: 0.0,
          hipLX: 0.0, hipRX: 0.0,
        },
      },
    ],
  },
  {
    id: 'hit-reaction-body',
    name: 'Hit Reaction — Body',
    category: 'stunt',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Standing, loose guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.1, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Gut shot lands — double over hard, arms clamp to the middle.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.9, elbowR: 1.9,
          torsoX: 1.0, headX: 0.4, hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
      },
      // Hold, hunched, absorbing it.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.9, headX: 0.4, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
      },
      // Slowly straighten back up.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.1, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'stumble-back-fall',
    name: 'Stumble Back & Fall',
    category: 'stunt',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.0, headX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Knocked back — arms fly up, torso recoils, one leg lifts.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.5, headX: -0.3,
          hipLX: -0.6, hipRX: 0.3, kneeL: 0.5, kneeR: 0.1,
        },
      },
      // Losing it — arms windmill, torso pitching, knees buckling.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.2, shoulderRX: -0.4, shoulderLZ: 0.9, shoulderRZ: 0.5,
          elbowL: 0.3, elbowR: 0.5, torsoX: -0.2, headX: 0.2,
          hipLX: 0.4, hipRX: 0.6, kneeL: 1.2, kneeR: 1.3,
        },
      },
      // Hitting the ground — collapsing onto the back.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.6, elbowR: 0.6, torsoX: -0.9, headX: 0.3,
          hipLX: -1.2, hipRX: -1.2, kneeL: 0.8, kneeR: 0.8,
        },
      },
      // Prone on the ground — the app holds this final pose (legs up, torso back).
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.3, elbowR: 0.3, torsoX: -1.3, headX: 0.4,
          hipLX: -1.5, hipRX: -1.5, kneeL: 1.0, kneeR: 1.0,
        },
      },
    ],
  },
  {
    id: 'shield-block',
    name: 'Shield Block',
    category: 'stunt',
    duration: 1.4,
    loop: true,
    keyframes: [
      // Braced behind a raised shield — forearms up, weight low and set.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.25, headX: 0.15, hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Absorb an impact — driven back slightly, dig in harder.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 2.1, elbowR: 2.1,
          torsoX: 0.35, headX: 0.25, hipLX: 0.3, hipRX: 0.4, kneeL: 0.6, kneeR: 0.6,
        },
      },
      // Push back to the braced hold.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.25, headX: 0.15, hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Loop back to the braced hold.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.25, headX: 0.15, hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
      },
    ],
  },
  {
    id: 'roll-dodge',
    name: 'Roll Dodge',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Standing ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Duck low and dive — tuck the chin, hips fold, arms reach down-forward.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 1.0, hipLX: 0.9, hipRX: 0.9, kneeL: 1.5, kneeR: 1.5,
        },
      },
      // Over the shoulder — fully tucked ball through the roll.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 2.2, elbowR: 2.2,
          torsoX: 1.3, hipLX: 1.0, hipRX: 1.0, kneeL: 2.0, kneeR: 2.0,
        },
      },
      // Coming up out of the roll to one knee.
      {
        t: 1.05,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.6, hipLX: -0.4, hipRX: 0.8, kneeL: 0.9, kneeR: 1.3,
        },
      },
      // Back to standing ready.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'dazed-wobble',
    name: 'Dazed Wobble',
    category: 'stunt',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Woozy — head lolls right, torso tips, arms hang heavy.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, torsoY: 0.2, headX: 0.2, headY: 0.3,
          hipLX: -0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Sway forward, nearly pitching over.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.4, torsoY: 0.0, headX: 0.35, headY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Lurch the other way — head lolls left, torso tips back.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: -0.1, torsoY: -0.2, headX: -0.1, headY: -0.3,
          hipLX: 0.1, hipRX: -0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Sway forward again.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.4, torsoY: 0.0, headX: 0.35, headY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Loop back to the woozy start.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, torsoY: 0.2, headX: 0.2, headY: 0.3,
          hipLX: -0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // GESTURE
  // -------------------------------------------------------------------------
  {
    id: 'cheer-jump',
    name: 'Cheer Jump',
    category: 'gesture',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Crouch to load the jump, arms cocked down.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.2, shoulderRX: 0.2, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.3,
          hipLX: 0.5, hipRX: 0.5, kneeL: 1.1, kneeR: 1.1,
        },
      },
      // Launch — legs extend, arms fly straight up in a V.
      {
        t: 0.35,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.1, elbowR: 0.1, torsoX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Peak — arms up, celebrating.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.7, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.05, elbowR: 0.05, torsoX: -0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Land, arms coming down, absorb.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.2,
          hipLX: 0.4, hipRX: 0.4, kneeL: 0.7, kneeR: 0.7,
        },
      },
      // Settle to standing.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'argue-point',
    name: 'Argue & Point',
    category: 'gesture',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Lean in, right hand jabbing a point forward, left hand on hip-ish.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.4, shoulderLZ: 0.5, shoulderRZ: 0.1,
          elbowL: 1.6, elbowR: 0.3, torsoX: 0.3, torsoY: -0.2, headX: 0.15,
        },
      },
      // Pull the point back, gesture builds.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 1.2, torsoX: 0.15, torsoY: 0.1, headX: 0.0,
        },
      },
      // Jab the point forward again, harder.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.5, shoulderLZ: 0.5, shoulderRZ: 0.1,
          elbowL: 1.6, elbowR: 0.2, torsoX: 0.35, torsoY: -0.25, headX: 0.2,
        },
      },
      // Ease back, hands open in exasperation.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.9, elbowR: 0.9, torsoX: 0.05, torsoY: 0.0, headX: -0.1,
        },
      },
      // Loop back to the leaning-in jab.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.4, shoulderLZ: 0.5, shoulderRZ: 0.1,
          elbowL: 1.6, elbowR: 0.3, torsoX: 0.3, torsoY: -0.2, headX: 0.15,
        },
      },
    ],
  },
  {
    id: 'salute',
    name: 'Salute',
    category: 'gesture',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Attention — arms at sides, standing tall.
      {
        t: 0.0,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0, headX: 0.0,
        },
      },
      // Snap the right hand up to the brow.
      {
        t: 0.35,
        joints: {
          shoulderRX: -1.3, shoulderRZ: 0.35, elbowR: 2.3, headX: 0.05,
        },
      },
      // Hold the salute crisply.
      {
        t: 1.0,
        joints: {
          shoulderRX: -1.3, shoulderRZ: 0.35, elbowR: 2.3, headX: 0.05,
        },
      },
      // Cut the hand back down to the side.
      {
        t: 1.6,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0, headX: 0.0,
        },
      },
    ],
  },
  {
    id: 'look-around-paranoid',
    name: 'Look Around (Paranoid)',
    category: 'gesture',
    duration: 2.8,
    loop: true,
    keyframes: [
      // Neutral, slightly hunched, glancing right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.15, torsoY: -0.2, headX: 0.0, headY: -0.5,
        },
      },
      // Whip the head and torso to look sharply left.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.15, torsoY: 0.3, headX: 0.0, headY: 0.6,
        },
      },
      // Hold, scanning left.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.35, shoulderRX: -0.35, elbowL: 0.65, elbowR: 0.65,
          torsoX: 0.15, torsoY: 0.3, headX: 0.0, headY: 0.65,
        },
      },
      // Glance back over the right shoulder.
      {
        t: 1.7,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.2, torsoY: -0.35, headX: 0.0, headY: -0.65,
        },
      },
      // Ease back toward center-right.
      {
        t: 2.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.15, torsoY: -0.1, headX: 0.0, headY: -0.3,
        },
      },
      // Loop back to the first glance.
      {
        t: 2.8,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.15, torsoY: -0.2, headX: 0.0, headY: -0.5,
        },
      },
    ],
  },

  // =========================================================================
  // ROUND 6 ADDITIONS — user-requested named motions
  // =========================================================================

  // -------------------------------------------------------------------------
  // GESTURE
  // -------------------------------------------------------------------------
  {
    id: 'playing-cards',
    name: 'Playing Cards',
    category: 'gesture',
    duration: 3.0,
    loop: true,
    keyframes: [
      // Seated-friendly: forearms up holding a fan of cards, both hands.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.7, elbowR: 1.7, torsoX: 0.1, headX: 0.15,
        },
      },
      // Right hand reaches forward to play a card.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderLZ: 0.2, shoulderRZ: 0.1,
          elbowL: 1.7, elbowR: 0.5, torsoX: 0.15, headX: 0.25,
        },
      },
      // Right hand back to the fan.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.7, elbowR: 1.7, torsoX: 0.1, headX: 0.15,
        },
      },
      // Left hand reaches forward to play a card.
      {
        t: 1.8,
        joints: {
          shoulderLX: -1.1, shoulderRX: -0.9, shoulderLZ: 0.1, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 1.7, torsoX: 0.15, headX: 0.25,
        },
      },
      // Both back to the fan, look down at hand.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.7, elbowR: 1.7, torsoX: 0.1, headX: 0.35,
        },
      },
      // Loop back to the neutral fan.
      {
        t: 3.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.7, elbowR: 1.7, torsoX: 0.1, headX: 0.15,
        },
      },
    ],
  },
  {
    id: 'shoot-squirt-gun',
    name: 'Shoot Squirt Gun',
    category: 'gesture',
    duration: 2.2,
    loop: false,
    keyframes: [
      // Arm at side, neutral.
      {
        t: 0.0,
        joints: { shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0 },
      },
      // Right arm extends level to aim.
      {
        t: 0.5,
        joints: { shoulderRX: -1.55, shoulderRZ: 0.0, elbowR: 0.1 },
      },
      // Trigger pulse 1 — tiny elbow/shoulder recoil.
      {
        t: 0.8,
        joints: { shoulderRX: -1.7, shoulderRZ: 0.0, elbowR: 0.35 },
      },
      // Return to aim.
      {
        t: 1.0,
        joints: { shoulderRX: -1.55, shoulderRZ: 0.0, elbowR: 0.1 },
      },
      // Trigger pulse 2.
      {
        t: 1.25,
        joints: { shoulderRX: -1.7, shoulderRZ: 0.0, elbowR: 0.35 },
      },
      // Return to aim.
      {
        t: 1.45,
        joints: { shoulderRX: -1.55, shoulderRZ: 0.0, elbowR: 0.1 },
      },
      // Trigger pulse 3.
      {
        t: 1.7,
        joints: { shoulderRX: -1.7, shoulderRZ: 0.0, elbowR: 0.35 },
      },
      // Lower the arm back to the side.
      {
        t: 2.2,
        joints: { shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0 },
      },
    ],
  },
  {
    id: 'open-door',
    name: 'Open Door',
    category: 'gesture',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Standing, arms neutral.
      {
        t: 0.0,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0,
          torsoX: 0.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Reach forward to handle height, small lean in.
      {
        t: 0.5,
        joints: {
          shoulderRX: -1.4, shoulderRZ: 0.05, elbowR: 0.3,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Grip the handle.
      {
        t: 0.8,
        joints: {
          shoulderRX: -1.35, shoulderRZ: 0.05, elbowR: 0.5,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Pull back and aside with a small step-back lean.
      {
        t: 1.3,
        joints: {
          shoulderRX: -0.9, shoulderRZ: 0.4, elbowR: 1.3,
          torsoX: -0.15, torsoY: -0.35, hipLX: 0.2, hipRX: -0.1,
        },
      },
      // Settle, arm back down.
      {
        t: 1.8,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0,
          torsoX: 0.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
    ],
  },
  {
    id: 'close-door',
    name: 'Close Door',
    category: 'gesture',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Standing, arms neutral, slightly turned to the door.
      {
        t: 0.0,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0,
          torsoX: 0.0, torsoY: -0.2, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Reach out and grip the edge.
      {
        t: 0.5,
        joints: {
          shoulderRX: -1.0, shoulderRZ: 0.4, elbowR: 1.2,
          torsoX: -0.1, torsoY: -0.3, hipLX: 0.15, hipRX: -0.1,
        },
      },
      // Push away firmly — arm extends forward, lean into it.
      {
        t: 1.1,
        joints: {
          shoulderRX: -1.45, shoulderRZ: 0.05, elbowR: 0.15,
          torsoX: 0.25, torsoY: 0.05, hipLX: 0.0, hipRX: 0.1,
        },
      },
      // Settle back, arm down.
      {
        t: 1.8,
        joints: {
          shoulderRX: 0.0, shoulderRZ: 0.0, elbowR: 0.0,
          torsoX: 0.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
    ],
  },
  {
    id: 'lie-down-sleep',
    name: 'Lie Down & Sleep',
    category: 'gesture',
    duration: 3.0,
    loop: false,
    keyframes: [
      // Standing, arms loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
      // Turn-ish settle and begin to sit — knees and hips bend.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.1, shoulderRX: -0.1, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.3, headX: 0.1, hipLX: 0.8, hipRX: 0.8, kneeL: 1.4, kneeR: 1.4,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Recline toward flat — torso leans back, legs extending.
      {
        t: 1.7,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.6, elbowR: 0.6,
          torsoX: -0.6, headX: 0.15, hipLX: -0.6, hipRX: -0.6, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0, up: -0.7 },
      },
      // Flat on the back, legs extended, one arm folds in.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.9, elbowL: 0.3, elbowR: 1.4,
          torsoX: -1.35, headX: 0.2, hipLX: -1.4, hipRX: -1.4, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0, up: -0.75 },
      },
      // Still — hold the final sleeping pose.
      {
        t: 3.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.9, elbowL: 0.3, elbowR: 1.4,
          torsoX: -1.35, headX: 0.2, hipLX: -1.4, hipRX: -1.4, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0, up: -0.75 },
      },
    ],
  },
  {
    id: 'sit-down',
    name: 'Sit Down',
    category: 'gesture',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Standing tall.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
      // Lean slightly forward as the hips lower.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.35, hipLX: 0.6, hipRX: 0.6, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: 0, up: -0.25 },
      },
      // Settle back onto the seat.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Final seated pose, held.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
    ],
  },
  {
    id: 'stand-up',
    name: 'Stand Up',
    category: 'gesture',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Seated pose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Lean forward over the feet to load.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.4, hipLX: 0.7, hipRX: 0.7, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 0, up: -0.25 },
      },
      // Push up through the legs.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.35, elbowR: 0.35,
          torsoX: 0.2, hipLX: 0.3, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 0, up: -0.1 },
      },
      // Standing tall.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
    ],
  },
  {
    id: 'drink-seated',
    name: 'Drink (Seated)',
    category: 'gesture',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Seated, right hand resting, cup at side.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, headX: 0.0, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Raise the right hand to the mouth.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.6, elbowL: 0.4, elbowR: 2.0,
          torsoX: 0.05, headX: -0.05, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Tip the head back to drink.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.7, elbowL: 0.4, elbowR: 2.2,
          torsoX: 0.05, headX: -0.3, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Lower the cup, head levels.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.4, elbowL: 0.4, elbowR: 1.0,
          torsoX: 0.05, headX: 0.0, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
      // Back to rest — loops.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, headX: 0.0, hipLX: 1.4, hipRX: 1.4, kneeL: 1.5, kneeR: 1.5,
        },
        move: { forward: 0, up: -0.45 },
      },
    ],
  },
  {
    id: 'drink-standing',
    name: 'Drink (Standing)',
    category: 'gesture',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Standing, right hand at side.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, headX: 0.0,
        },
      },
      // Raise the right hand to the mouth.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.6, elbowL: 0.3, elbowR: 2.0,
          torsoX: 0.0, headX: -0.05,
        },
      },
      // Tip the head back to drink.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.7, elbowL: 0.3, elbowR: 2.2,
          torsoX: 0.0, headX: -0.3,
        },
      },
      // Lower the cup, head levels.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.4, elbowL: 0.3, elbowR: 1.0,
          torsoX: 0.0, headX: 0.0,
        },
      },
      // Back to rest — loops.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, headX: 0.0,
        },
      },
    ],
  },
  {
    id: 'basketball-dribble',
    name: 'Basketball Dribble',
    category: 'gesture',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Athletic crouch, right hand at waist height.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.2,
          elbowL: 0.9, elbowR: 1.0, torsoX: 0.3,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0, up: 0 },
      },
      // Dribble pulse down (right hand pushes the ball).
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.35, shoulderLZ: 0.3, shoulderRZ: 0.2,
          elbowL: 0.9, elbowR: 0.6, torsoX: 0.35,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 0, up: 0 },
      },
      // Crossover to the left hand.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.35, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 0.9, torsoX: 0.35,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 0, up: 0 },
      },
      // Gather and load for the jump shot.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 1.6, torsoX: 0.25,
          hipLX: 0.6, hipRX: 0.6, kneeL: 1.1, kneeR: 1.1,
        },
        move: { forward: 0, up: 0 },
      },
      // Jump-shot arc — arms up, airborne.
      {
        t: 1.6,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.2, torsoX: -0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.05, kneeR: 0.05,
        },
        move: { forward: 0, up: 0.35 },
      },
      // Land back into the athletic crouch — loops.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.2,
          elbowL: 0.9, elbowR: 1.0, torsoX: 0.3,
          hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0, up: 0 },
      },
    ],
  },
  {
    id: 'soccer-kicks',
    name: 'Soccer Kicks',
    category: 'gesture',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Balanced ready, arms out slightly for balance.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Plant left, swing the right leg back to load the instep kick.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.3, shoulderLZ: 0.6, shoulderRZ: 0.3,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.05,
          hipLX: 0.1, hipRX: 0.7, kneeL: 0.2, kneeR: 0.9,
        },
      },
      // Right instep kick snaps through.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.5, shoulderLZ: 0.4, shoulderRZ: 0.6,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.05,
          hipLX: 0.1, hipRX: -1.0, kneeL: 0.15, kneeR: 0.2,
        },
      },
      // Trap/settle — right foot comes down, weight centers.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.2,
        },
      },
      // Left instep kick snaps through.
      {
        t: 1.9,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.3, shoulderLZ: 0.6, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.05,
          hipLX: -1.0, hipRX: 0.1, kneeL: 0.2, kneeR: 0.15,
        },
      },
      // Settle back to ready — loops.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'tennis-swings',
    name: 'Tennis Swings',
    category: 'gesture',
    duration: 2.8,
    loop: true,
    keyframes: [
      // Split-step ready, both hands on the racquet in front.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 1.2, torsoX: 0.15, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Forehand load — turn and take the racquet back to the right.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.9,
          elbowL: 1.0, elbowR: 1.3, torsoX: 0.1, torsoY: 0.7,
          hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.5,
        },
      },
      // Forehand swing across the body.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.0, elbowR: 0.5, torsoX: 0.1, torsoY: -0.7,
          hipLX: 0.2, hipRX: 0.1, kneeL: 0.4, kneeR: 0.3,
        },
      },
      // Recover to split-step ready.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 1.2, torsoX: 0.15, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Backhand load — turn to the left, racquet crosses over.
      {
        t: 1.9,
        joints: {
          shoulderLX: -0.4, shoulderRX: -1.3, shoulderLZ: 0.6, shoulderRZ: 0.2,
          elbowL: 1.4, elbowR: 1.6, torsoX: 0.1, torsoY: -0.6,
          hipLX: 0.2, hipRX: 0.1, kneeL: 0.5, kneeR: 0.4,
        },
      },
      // Backhand swing out.
      {
        t: 2.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.0, shoulderLZ: 0.7, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 1.0, torsoX: 0.1, torsoY: 0.6,
          hipLX: 0.1, hipRX: 0.2, kneeL: 0.3, kneeR: 0.4,
        },
      },
      // Recover to ready — loops.
      {
        t: 2.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 1.2, torsoX: 0.15, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
    ],
  },
  {
    id: 'kiss-lean',
    name: 'Kiss Lean',
    category: 'gesture',
    duration: 2.4,
    loop: false,
    keyframes: [
      // Standing, arms loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0.0, headX: 0.0, headY: 0.0,
        },
        move: { forward: 0, up: 0 },
      },
      // Lean in — slight head tilt, rise on the toes, arms come forward.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.1, elbowR: 1.1, torsoX: 0.25, headX: -0.1, headY: 0.2,
        },
        move: { forward: 0, up: 0.06 },
      },
      // Hold the embrace-lean a beat.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.1, elbowR: 1.1, torsoX: 0.28, headX: -0.1, headY: 0.2,
        },
        move: { forward: 0, up: 0.06 },
      },
      // Ease back to standing.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0.0, headX: 0.0, headY: 0.0,
        },
        move: { forward: 0, up: 0 },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // DANCE
  // -------------------------------------------------------------------------
  {
    id: 'c-walk',
    name: 'C-Walk',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Right heel out, light bounce, arms loose swagger.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.25,
          elbowL: 0.9, elbowR: 1.0, torsoX: 0.1, torsoY: 0.15,
          hipLX: 0.1, hipRX: -0.4, kneeL: 0.4, kneeR: 0.6,
        },
      },
      // Toe pivot in, knees pop through center.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.0, elbowR: 1.0, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.7, kneeR: 0.7,
        },
      },
      // Left heel out, swagger the other way.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.4, shoulderLZ: 0.25, shoulderRZ: 0.3,
          elbowL: 1.0, elbowR: 0.9, torsoX: 0.1, torsoY: -0.15,
          hipLX: -0.4, hipRX: 0.1, kneeL: 0.6, kneeR: 0.4,
        },
      },
      // Toe pivot through center again.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.0, elbowR: 1.0, torsoX: 0.1, torsoY: 0.0,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.7, kneeR: 0.7,
        },
      },
      // Loop back to the first heel-toe.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.25,
          elbowL: 0.9, elbowR: 1.0, torsoX: 0.1, torsoY: 0.15,
          hipLX: 0.1, hipRX: -0.4, kneeL: 0.4, kneeR: 0.6,
        },
      },
    ],
  },
  {
    id: 'freestyle-dance',
    name: 'Freestyle Dance',
    category: 'dance',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Bounce down, right arm thrown up and out, torso twist right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -2.3, shoulderLZ: 0.4, shoulderRZ: 0.6,
          elbowL: 1.1, elbowR: 0.4, torsoX: 0.1, torsoY: 0.4,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.5, kneeR: 0.3,
        },
      },
      // Rise through center, both arms sweep across.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.8, elbowR: 0.8, torsoX: 0.0, torsoY: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Bounce down, left arm thrown up and out, torso twist left.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.3, shoulderRX: -0.5, shoulderLZ: 0.6, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 1.1, torsoX: 0.1, torsoY: -0.4,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.3, kneeR: 0.5,
        },
      },
      // Big cross-body throw the other way.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.8, shoulderLZ: 0.7, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 0.6, torsoX: 0.15, torsoY: 0.3,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.2,
        },
      },
      // Loop back to the first throw.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -2.3, shoulderLZ: 0.4, shoulderRZ: 0.6,
          elbowL: 1.1, elbowR: 0.4, torsoX: 0.1, torsoY: 0.4,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.5, kneeR: 0.3,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // FIGHT
  // -------------------------------------------------------------------------
  {
    id: 'boxing-combo',
    name: 'Boxing Combo',
    category: 'fight',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Guard bounce, weight up.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Jab (left) fires.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.9,
          torsoX: 0.15, torsoY: -0.35, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Second jab (left) fires again.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.15, elbowR: 1.9,
          torsoX: 0.15, torsoY: -0.35, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Cross (right) drives across.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, elbowL: 1.9, elbowR: 0.15,
          torsoX: 0.15, torsoY: 0.5, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Slip to the outside — bob and roll under.
      {
        t: 1.3,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.5, torsoY: -0.4, hipLX: 0.4, hipRX: 0.4, kneeL: 0.8, kneeR: 0.8,
        },
      },
      // Rise back to guard bounce.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop back to the guard bounce.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.25, kneeR: 0.25,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // STUNT
  // -------------------------------------------------------------------------
  {
    id: 'fall-backwards',
    name: 'Fall Backwards',
    category: 'stunt',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Standing, arms loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.0, headX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
      // Arms windmill up as balance goes, torso starts arching back.
      {
        t: 0.4,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.0, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.3, elbowR: 0.4, torsoX: -0.5, headX: -0.3,
          hipLX: -0.4, hipRX: -0.2, kneeL: 0.3, kneeR: 0.2,
        },
        move: { forward: 0, up: 0 },
      },
      // Pitching over backwards, legs lifting.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.4, elbowR: 0.4, torsoX: -1.0, headX: 0.1,
          hipLX: -1.2, hipRX: -1.2, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0, up: -0.4 },
      },
      // Hitting the ground on the back, legs extending out.
      {
        t: 1.3,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.2, elbowR: 0.2, torsoX: -1.4, headX: 0.2,
          hipLX: -0.9, hipRX: -0.9, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0, up: -0.85 },
      },
      // Flat on the back, legs extended — the app holds this final pose.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.8, shoulderRZ: 0.8,
          elbowL: 0.2, elbowR: 0.2, torsoX: -1.5, headX: 0.2,
          hipLX: -0.6, hipRX: -0.6, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: -0.9 },
      },
    ],
  },
  {
    id: 'freefall-flail',
    name: 'Freefall Flail',
    category: 'stunt',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Arms and legs wide, one arm high, torso arched — mid-air spread.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.2, shoulderRX: -0.6, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.5, elbowR: 0.8, torsoX: -0.3, torsoY: 0.2,
          hipLX: -0.6, hipRX: -0.9, kneeL: 0.5, kneeR: 0.2,
        },
      },
      // Flail cycle — arms swap, legs cross-bicycle.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.8, shoulderRX: -1.8, shoulderLZ: 1.0, shoulderRZ: 0.8,
          elbowL: 0.9, elbowR: 0.4, torsoX: -0.2, torsoY: -0.2,
          hipLX: -0.9, hipRX: -0.5, kneeL: 0.2, kneeR: 0.6,
        },
      },
      // Spread the other way.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.9, shoulderRX: -0.9, shoulderLZ: 0.8, shoulderRZ: 1.0,
          elbowL: 0.4, elbowR: 0.9, torsoX: -0.35, torsoY: 0.25,
          hipLX: -0.5, hipRX: -0.8, kneeL: 0.6, kneeR: 0.3,
        },
      },
      // Flail cycle again.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.7, shoulderRX: -2.0, shoulderLZ: 1.0, shoulderRZ: 0.85,
          elbowL: 0.8, elbowR: 0.5, torsoX: -0.2, torsoY: -0.25,
          hipLX: -0.8, hipRX: -0.5, kneeL: 0.25, kneeR: 0.55,
        },
      },
      // Loop back to the first spread.
      {
        t: 1.2,
        joints: {
          shoulderLX: -2.2, shoulderRX: -0.6, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.5, elbowR: 0.8, torsoX: -0.3, torsoY: 0.2,
          hipLX: -0.6, hipRX: -0.9, kneeL: 0.5, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'crawl',
    name: 'Crawl',
    category: 'stunt',
    duration: 4.0,
    loop: false,
    keyframes: [
      // Prone, right arm reaching forward, left leg pushing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.6, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 1.2, elbowR: 0.4, torsoX: 1.4, headX: -0.2,
          hipLX: -0.9, hipRX: 0.3, kneeL: 1.3, kneeR: 0.3,
        },
        move: { forward: 0, up: -0.85 },
      },
      // Pull through — right arm drives back, torso slides forward.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.6, shoulderRX: -0.6, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 1.2, torsoX: 1.4, headX: -0.15,
          hipLX: 0.3, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
        move: { forward: 0.6, up: -0.85 },
      },
      // Left arm reaches forward, right leg pushes.
      {
        t: 2.0,
        joints: {
          shoulderLX: -1.6, shoulderRX: -0.6, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 1.2, torsoX: 1.4, headX: -0.2,
          hipLX: 0.3, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
        move: { forward: 1.1, up: -0.85 },
      },
      // Pull through the other side.
      {
        t: 3.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.6, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 1.2, elbowR: 0.4, torsoX: 1.4, headX: -0.15,
          hipLX: -0.9, hipRX: 0.3, kneeL: 1.3, kneeR: 0.3,
        },
        move: { forward: 1.7, up: -0.85 },
      },
      // Final reach — arrived, still prone.
      {
        t: 4.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.6, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 1.2, elbowR: 0.4, torsoX: 1.4, headX: -0.2,
          hipLX: -0.9, hipRX: 0.3, kneeL: 1.3, kneeR: 0.3,
        },
        move: { forward: 2.2, up: -0.85 },
      },
    ],
  },
  {
    id: 'jump',
    name: 'Jump',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Standing ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
      // Crouch — knees bend, arms swing back to load.
      {
        t: 0.35,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.35,
          hipLX: 0.6, hipRX: 0.6, kneeL: 1.2, kneeR: 1.2,
        },
        move: { forward: 0, up: -0.1 },
      },
      // Explode up — legs extend, arms swing up, airborne peak.
      {
        t: 0.75,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 0.1, torsoX: -0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
        move: { forward: 0, up: 0.7 },
      },
      // Land into a crouch to absorb.
      {
        t: 1.05,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.3,
          hipLX: 0.5, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 0, up: -0.1 },
      },
      // Recover to standing.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0, up: 0 },
      },
    ],
  },

  // =========================================================================
  // PHASE B1 ADDITIONS — expanded motion library
  // =========================================================================

  // -------------------------------------------------------------------------
  // FIGHT — strikes, kicks, defense
  // -------------------------------------------------------------------------
  {
    id: 'boxing-guard-bounce',
    name: 'Boxing Guard Bounce',
    category: 'fight',
    duration: 1.0,
    loop: true,
    keyframes: [
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.18, hipLX: 0.05, hipRX: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Bounce down on the balls of the feet.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.22, hipLX: 0.15, hipRX: 0.15, kneeL: 0.45, kneeR: 0.45,
        },
      },
      // Up.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.18, hipLX: 0.05, hipRX: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Bounce again, weight shifts.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.22, hipLX: 0.15, hipRX: 0.15, kneeL: 0.45, kneeR: 0.45,
        },
      },
      // Loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.18, hipLX: 0.05, hipRX: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
    ],
  },
  {
    id: 'hook-punch',
    name: 'Hook Punch',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Short wind — load the lead side, twist in.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.9, shoulderLZ: 0.3,
          elbowL: 1.6, elbowR: 1.8, torsoX: 0.15, torsoY: 0.3,
        },
      },
      // Snap the hook across — arm horizontal, elbow at 90°, torso whips over.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.4, shoulderRX: -0.9, shoulderLZ: 0.95,
          elbowL: 1.4, elbowR: 1.8, torsoX: 0.2, torsoY: -0.6,
        },
      },
      // Follow-through past center.
      {
        t: 0.55,
        joints: {
          shoulderLX: -1.2, shoulderRX: -0.9, shoulderLZ: 0.7,
          elbowL: 1.5, elbowR: 1.8, torsoX: 0.2, torsoY: -0.75,
        },
      },
      // Recover to guard.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'elbow-strike',
    name: 'Elbow Strike',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.0, shoulderRZ: 0.0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Load — right elbow cocks up and back, torso winds.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderLZ: 0.0, shoulderRZ: 0.6,
          elbowL: 1.8, elbowR: 2.3, torsoX: 0.15, torsoY: 0.5,
        },
      },
      // Snap the elbow horizontally across the centerline.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.3, shoulderLZ: 0.0, shoulderRZ: 0.85,
          elbowL: 1.8, elbowR: 2.2, torsoX: 0.2, torsoY: -0.5,
        },
      },
      // Follow-through.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.2, shoulderLZ: 0.0, shoulderRZ: 0.6,
          elbowL: 1.8, elbowR: 2.2, torsoX: 0.2, torsoY: -0.7,
        },
      },
      // Recover to guard.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.0, shoulderRZ: 0.0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'knee-strike',
    name: 'Knee Strike',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Guard, feet set.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Clinch pull — hands rip down as the right knee chambers up.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.35, hipLX: 0.1, hipRX: -1.4, kneeL: 0.1, kneeR: 1.7,
        },
      },
      // Drive the knee up — peak, torso curls over it.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.45, hipLX: 0.15, hipRX: -1.75, kneeL: 0.15, kneeR: 1.9,
        },
      },
      // Foot comes back down.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.7, elbowR: 1.7,
          torsoX: 0.2, hipLX: 0.05, hipRX: -0.5, kneeL: 0.1, kneeR: 0.6,
        },
      },
      // Recover to guard.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'front-kick',
    name: 'Front Kick',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Guard, planted.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Chamber — right knee lifts, hands open for balance.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.0, torsoZ: -0.1, hipLX: 0.05, hipRX: -1.0, kneeL: 0.1, kneeR: 1.6,
        },
      },
      // Snap out — shin extends level, torso leans back to counter.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.5, elbowR: 1.5,
          torsoX: -0.25, torsoZ: -0.15, hipLX: 0.1, hipRX: -1.5, kneeL: 0.15, kneeR: 0.15,
        },
      },
      // Re-chamber.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.0, torsoZ: -0.1, hipLX: 0.05, hipRX: -1.0, kneeL: 0.1, kneeR: 1.6,
        },
      },
      // Recover to guard.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'side-kick',
    name: 'Side Kick',
    category: 'fight',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Guard, planted on the left leg.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoZ: 0.0,
          hipLX: 0.0, hipRX: 0.0, hipRZ: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Chamber — knee tucks up and across the body.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.5, elbowR: 1.5, torsoX: 0.05, torsoZ: -0.2,
          hipLX: 0.05, hipRX: -0.9, hipRZ: 0.5, kneeL: 0.15, kneeR: 1.7,
        },
      },
      // Thrust the leg out sideways — torso leans away to counterbalance.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.8, shoulderLZ: 0.7, shoulderRZ: 0.2,
          elbowL: 1.4, elbowR: 1.6, torsoX: 0.1, torsoZ: -0.35,
          hipLX: 0.1, hipRX: -0.6, hipRZ: 1.05, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Re-chamber.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.5, elbowR: 1.5, torsoX: 0.05, torsoZ: -0.2,
          hipLX: 0.05, hipRX: -0.9, hipRZ: 0.5, kneeL: 0.15, kneeR: 1.7,
        },
      },
      // Recover to guard.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoZ: 0.0,
          hipLX: 0.0, hipRX: 0.0, hipRZ: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'spinning-back-kick',
    name: 'Spinning Back Kick',
    category: 'fight',
    duration: 1.3,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0.0, kneeR: 0.0, hipLX: 0.0, kneeL: 0.0,
        },
      },
      // Wind — torso spins hard, look over the shoulder.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.1, torsoY: 1.0, hipRX: 0.2, kneeR: 0.3, hipLX: -0.1, kneeL: 0.2,
        },
      },
      // Chamber the back leg as the spin comes around.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.7, elbowR: 1.7,
          torsoX: 0.1, torsoY: 0.2, hipRX: -0.9, kneeR: 1.6, hipLX: 0.05, kneeL: 0.15,
        },
      },
      // Drive the heel straight back — leg extends, torso pitches forward.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.5, elbowR: 1.5,
          torsoX: 0.5, torsoY: -0.3, hipRX: -1.5, kneeR: 0.15, hipLX: 0.1, kneeL: 0.2,
        },
      },
      // Recover to guard.
      {
        t: 1.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0.0, kneeR: 0.0, hipLX: 0.0, kneeL: 0.0,
        },
      },
    ],
  },
  {
    id: 'low-sweep',
    name: 'Low Sweep',
    category: 'fight',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0.0, hipRZ: 0.0, kneeR: 0.0, hipLX: 0.0, kneeL: 0.0,
        },
      },
      // Drop level — crouch low, hands down for balance.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.5, torsoY: 0.3, hipRX: 0.3, hipRZ: 0.0, kneeR: 1.3, hipLX: 0.6, kneeL: 1.4,
        },
      },
      // Sweep the leg low across the ground — torso rotates through.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.55, torsoY: -0.6, hipRX: -0.5, hipRZ: 0.9, kneeR: 0.2, hipLX: 0.6, kneeL: 1.4,
        },
      },
      // Bring it back under, rising.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.35, torsoY: -0.1, hipRX: 0.1, hipRZ: 0.2, kneeR: 0.6, hipLX: 0.3, kneeL: 0.7,
        },
      },
      // Recover to guard.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, torsoY: 0.0, hipRX: 0.0, hipRZ: 0.0, kneeR: 0.0, hipLX: 0.0, kneeL: 0.0,
        },
      },
    ],
  },
  {
    id: 'spinning-back-fist',
    name: 'Spinning Back Fist',
    category: 'fight',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Wind the torso up clockwise for the spin.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.2,
          elbowL: 1.8, elbowR: 1.6, torsoX: 0.1, torsoY: 1.0,
        },
      },
      // Fling the back fist out as the torso unwinds.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, shoulderRZ: 0.95,
          elbowL: 1.8, elbowR: 0.4, torsoX: 0.15, torsoY: -0.9,
        },
      },
      // Follow-through.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderRZ: 0.4,
          elbowL: 1.8, elbowR: 1.0, torsoX: 0.15, torsoY: -1.2,
        },
      },
      // Recover to guard.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.0,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'block-high',
    name: 'Block High',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0.0,
        },
      },
      // Forearms snap up to shield the head.
      {
        t: 0.2,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 2.1, elbowR: 2.1,
          torsoX: 0.1, headX: 0.2,
        },
      },
      // Hold the block, absorbing.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 2.1, elbowR: 2.1,
          torsoX: 0.1, headX: 0.2,
        },
      },
      // Lower back to guard.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0.0,
        },
      },
    ],
  },
  {
    id: 'block-low',
    name: 'Block Low',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Drop the forearms down and dip the knees to cover low.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.35, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
      },
      // Hold the low block.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.35, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
      },
      // Rise back to guard.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'parry-deflect',
    name: 'Parry / Deflect',
    category: 'fight',
    duration: 0.8,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Flick the rear hand across to slap the strike aside.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.2, shoulderRZ: 0.6,
          elbowL: 1.8, elbowR: 1.2, torsoX: 0.15, torsoY: -0.3,
        },
      },
      // Deflection carries across center.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderRZ: 0.2,
          elbowL: 1.8, elbowR: 1.4, torsoX: 0.15, torsoY: -0.4,
        },
      },
      // Snap back to guard.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderRZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'dodge-left',
    name: 'Dodge Left',
    category: 'fight',
    duration: 0.7,
    loop: false,
    keyframes: [
      // Centered guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Slip hard to the left — lean and drop weight over the left leg.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.2, torsoZ: -0.4, hipLX: -0.3, hipRX: 0.2, kneeL: 0.5, kneeR: 0.3,
        },
      },
      // Return to guard.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'dodge-right',
    name: 'Dodge Right',
    category: 'fight',
    duration: 0.7,
    loop: false,
    keyframes: [
      // Centered guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Slip hard to the right.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.2, torsoZ: 0.4, hipLX: 0.2, hipRX: -0.3, kneeL: 0.3, kneeR: 0.5,
        },
      },
      // Return to guard.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'duck-under',
    name: 'Duck Under',
    category: 'fight',
    duration: 0.8,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Drop straight down under the swing.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, headX: 0.3, hipLX: 0.6, hipRX: 0.6, kneeL: 1.1, kneeR: 1.1,
        },
      },
      // Hold low.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, headX: 0.3, hipLX: 0.6, hipRX: 0.6, kneeL: 1.1, kneeR: 1.1,
        },
      },
      // Rise back to guard.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
    ],
  },
  {
    id: 'weave-bob',
    name: 'Weave & Bob',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Centered guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Bob down and weave left.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, torsoY: 0.4, hipLX: 0.5, hipRX: 0.3, kneeL: 0.9, kneeR: 0.6,
        },
      },
      // Roll across the bottom of the U and weave right.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.5, torsoY: -0.4, hipLX: 0.3, hipRX: 0.5, kneeL: 0.6, kneeR: 0.9,
        },
      },
      // Rise back to center guard.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.9, elbowR: 1.9,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'stagger-back',
    name: 'Stagger Back',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Standing, loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.0, headX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0.0 },
      },
      // Struck — recoil back, arms fly up, one foot lifts.
      {
        t: 0.25,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.5, elbowR: 0.5, torsoX: -0.4, headX: -0.3,
          hipLX: -0.4, hipRX: 0.2, kneeL: 0.4, kneeR: 0.1,
        },
        move: { forward: -0.3 },
      },
      // Stumble a step backward, off balance.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.6, elbowR: 0.6, torsoX: -0.15, headX: 0.1,
          hipLX: 0.3, hipRX: 0.5, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: -0.6 },
      },
      // Catch balance, settle.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.05, headX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: -0.6 },
      },
    ],
  },
  {
    id: 'knockdown-fall',
    name: 'Knockdown Fall',
    category: 'fight',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.0, headX: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Struck — head snaps, torso recoils, arms fly up.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.5, headX: -0.3,
          hipLX: -0.4, hipRX: 0.2, kneeL: 0.4, kneeR: 0.2,
        },
        move: { forward: -0.2, up: 0.0 },
      },
      // Legs buckle, dropping toward the ground.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.6, elbowR: 0.6, torsoX: -0.6, headX: 0.2,
          hipLX: 0.5, hipRX: 0.5, kneeL: 1.3, kneeR: 1.3,
        },
        move: { forward: -0.3, up: -0.3 },
      },
      // Land on the back, legs up.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.3, elbowR: 0.3, torsoX: -1.2, headX: 0.3,
          hipLX: -1.4, hipRX: -1.4, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: -0.4, up: -0.5 },
      },
      // Down and still — the app holds this final pose.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.3, elbowR: 0.3, torsoX: -1.3, headX: 0.4,
          hipLX: -1.5, hipRX: -1.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: -0.4, up: -0.55 },
      },
    ],
  },
  {
    id: 'ko-collapse',
    name: 'KO Collapse',
    category: 'fight',
    duration: 1.5,
    loop: false,
    keyframes: [
      // Standing, loose.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.0, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
      // Lights out — head lolls, arms go completely limp.
      {
        t: 0.25,
        joints: {
          shoulderLX: 0.1, shoulderRX: 0.1, elbowL: 0.3, elbowR: 0.3,
          torsoX: -0.2, headX: -0.4, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
        move: { up: 0.0 },
      },
      // Knees buckle straight down, folding.
      {
        t: 0.55,
        joints: {
          shoulderLX: 0.3, shoulderRX: 0.3, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.6, headX: 0.4, hipLX: 0.6, hipRX: 0.6, kneeL: 1.5, kneeR: 1.5,
        },
        move: { up: -0.35 },
      },
      // Crumple onto the ground.
      {
        t: 0.9,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 1.1, headX: 0.4, hipLX: 0.9, hipRX: 0.9, kneeL: 2.0, kneeR: 2.0,
        },
        move: { up: -0.5 },
      },
      // Limp heap — held.
      {
        t: 1.5,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 1.2, headX: 0.4, hipLX: 0.9, hipRX: 0.9, kneeL: 2.0, kneeR: 2.0,
        },
        move: { up: -0.55 },
      },
    ],
  },
  {
    id: 'get-up-from-ground',
    name: 'Get Up From Ground',
    category: 'fight',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Face down on the ground.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 1.2, headX: 0.3, hipLX: 0.9, hipRX: 0.9, kneeL: 1.8, kneeR: 1.8,
        },
        move: { up: -0.55 },
      },
      // Push up onto hands and knees.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.9, elbowR: 0.9,
          torsoX: 1.1, headX: 0.1, hipLX: 0.9, hipRX: 0.9, kneeL: 1.9, kneeR: 1.9,
        },
        move: { up: -0.45 },
      },
      // Post a foot forward into a low crouch.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.7, headX: 0.0, hipLX: -0.3, hipRX: 0.7, kneeL: 0.9, kneeR: 1.3,
        },
        move: { up: -0.25 },
      },
      // Rise, a hand pushing off the knee.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.4, headX: 0.0, hipLX: 0.2, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { up: -0.1 },
      },
      // Back on the feet.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.05, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'tackle-lunge',
    name: 'Tackle Lunge',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Ready stance.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.2, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0.0 },
      },
      // Drop level, load the legs.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.6, hipLX: 0.6, hipRX: 0.6, kneeL: 1.1, kneeR: 1.1,
        },
        move: { forward: 0.0 },
      },
      // Explode forward, arms sweep to wrap.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.9, hipLX: -0.7, hipRX: 0.5, kneeL: 0.6, kneeR: 0.9,
        },
        move: { forward: 0.9 },
      },
      // Drive through the wrap.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.5, elbowR: 1.5,
          torsoX: 1.0, hipLX: -0.5, hipRX: 0.7, kneeL: 0.9, kneeR: 0.6,
        },
        move: { forward: 1.4 },
      },
      // Low finish — held.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.8, hipLX: 0.3, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 1.6 },
      },
    ],
  },
  {
    id: 'shove-two-hands',
    name: 'Two-Hand Shove',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Chamber — hands draw in, load the hips.
      {
        t: 0.2,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.3, hipLX: 0.3, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Thrust — arms punch out flat, legs extend, torso drives.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.55, elbowL: 0.1, elbowR: 0.1,
          torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Hold the extension.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.15, elbowR: 0.15,
          torsoX: 0.05, hipLX: 0.0, hipRX: 0.0, kneeL: 0.05, kneeR: 0.05,
        },
      },
      // Recover to guard.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // FIGHT / weapons
  // -------------------------------------------------------------------------
  {
    id: 'sword-slash-combo',
    name: 'Sword Slash Combo',
    category: 'fight',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Ready — blade cocked over the right shoulder (two-handed grip).
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 1.6, elbowR: 1.4, torsoX: 0.15, torsoY: 0.5,
        },
      },
      // First slash — diagonally down to the left, torso unwinds.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.6, shoulderLZ: 0.6, shoulderRZ: 0.2,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.4, torsoY: -0.6,
        },
      },
      // Recover — blade up over the left shoulder.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.3, shoulderLZ: 0.5, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.6, torsoX: 0.15, torsoY: -0.5,
        },
      },
      // Second slash — diagonally down to the right.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.6,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.4, torsoY: 0.6,
        },
      },
      // Return to the ready guard.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 1.6, elbowR: 1.4, torsoX: 0.15, torsoY: 0.5,
        },
      },
    ],
  },
  {
    id: 'sword-thrust',
    name: 'Sword Thrust',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // En garde.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.2, elbowL: 1.4, elbowR: 1.2,
          torsoX: 0.15, hipLX: -0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.3,
        },
        move: { forward: 0.0 },
      },
      // Coil back onto the rear leg.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.1, shoulderRX: -1.4, elbowL: 1.6, elbowR: 1.5,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.4, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 0.0 },
      },
      // Lunge — front knee drives, blade spears forward.
      {
        t: 0.55,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.2, elbowR: 0.2,
          torsoX: 0.35, hipLX: -0.8, hipRX: 0.6, kneeL: 0.9, kneeR: 0.2,
        },
        move: { forward: 0.7 },
      },
      // Hold the extension.
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.45, shoulderRX: -1.45, elbowL: 0.15, elbowR: 0.15,
          torsoX: 0.35, hipLX: -0.8, hipRX: 0.6, kneeL: 0.9, kneeR: 0.2,
        },
        move: { forward: 0.8 },
      },
      // Recover to en garde.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.2, elbowL: 1.4, elbowR: 1.2,
          torsoX: 0.15, hipLX: -0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.3,
        },
        move: { forward: 0.3 },
      },
    ],
  },
  {
    id: 'sword-parry',
    name: 'Sword Parry',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // En garde.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.2, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.2, torsoX: 0.15, torsoY: 0.1,
        },
      },
      // Raise the blade to catch a high strike.
      {
        t: 0.2,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.6, shoulderLZ: 0.5, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, torsoX: 0.1, torsoY: 0.3,
        },
      },
      // Turn the parry across and off-line.
      {
        t: 0.45,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.5, shoulderLZ: 0.2, shoulderRZ: 0.6,
          elbowL: 1.1, elbowR: 1.1, torsoX: 0.15, torsoY: -0.3,
        },
      },
      // Return to en garde.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.2, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.2, torsoX: 0.15, torsoY: 0.1,
        },
      },
    ],
  },
  {
    id: 'knife-lunge',
    name: 'Knife Lunge',
    category: 'fight',
    duration: 0.9,
    loop: false,
    keyframes: [
      // Low knife-fighter stance, off hand up.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.9, elbowL: 1.0, elbowR: 1.6,
          torsoX: 0.3, hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
        move: { forward: 0.0 },
      },
      // Coil the knife hand back.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.7, elbowL: 1.0, elbowR: 1.9,
          torsoX: 0.35, hipLX: 0.1, hipRX: 0.3, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 0.0 },
      },
      // Stab forward low, stepping in.
      {
        t: 0.45,
        joints: {
          shoulderLX: -0.6, shoulderRX: -1.2, elbowL: 1.0, elbowR: 0.4,
          torsoX: 0.5, hipLX: -0.5, hipRX: 0.4, kneeL: 0.8, kneeR: 0.3,
        },
        move: { forward: 0.5 },
      },
      // Retract the blade.
      {
        t: 0.65,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.8, elbowL: 1.0, elbowR: 1.4,
          torsoX: 0.35, hipLX: -0.2, hipRX: 0.3, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: 0.5 },
      },
      // Reset the stance.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.9, elbowL: 1.0, elbowR: 1.6,
          torsoX: 0.3, hipLX: 0.1, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
        move: { forward: 0.5 },
      },
    ],
  },
  {
    id: 'pistol-aim-fire',
    name: 'Pistol Aim & Fire',
    category: 'fight',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Low ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.1, torsoY: 0.0, headX: 0.0,
        },
      },
      // Punch out to a two-handed aim.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.55, elbowL: 0.2, elbowR: 0.15,
          torsoX: 0.1, torsoY: 0.05, headX: 0.05,
        },
      },
      // Fire — recoil kicks the muzzle up.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.7, shoulderRX: -1.75, elbowL: 0.35, elbowR: 0.3,
          torsoX: 0.0, torsoY: 0.05, headX: -0.05,
        },
      },
      // Settle back on target.
      {
        t: 0.85,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.55, elbowL: 0.2, elbowR: 0.15,
          torsoX: 0.1, torsoY: 0.05, headX: 0.05,
        },
      },
      // Hold the aim.
      {
        t: 1.1,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.55, elbowL: 0.2, elbowR: 0.15,
          torsoX: 0.1, torsoY: 0.05, headX: 0.05,
        },
      },
      // Lower to low ready.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.1, torsoY: 0.0, headX: 0.0,
        },
      },
    ],
  },
  {
    id: 'rifle-aim-sweep',
    name: 'Rifle Aim & Sweep',
    category: 'fight',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Low ready, rifle held across the body.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 1.4, torsoX: 0.15, torsoY: 0.0, headX: 0.0, headY: 0.0,
        },
      },
      // Shoulder it and aim center.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.1, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 1.6, elbowR: 1.9, torsoX: 0.1, torsoY: 0.0, headX: 0.05, headY: 0.0,
        },
      },
      // Sweep the aim to the left, scanning.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.1, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 1.6, elbowR: 1.9, torsoX: 0.1, torsoY: 0.3, headX: 0.05, headY: 0.4,
        },
      },
      // Sweep across to the right.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.1, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 1.6, elbowR: 1.9, torsoX: 0.1, torsoY: -0.3, headX: 0.05, headY: -0.4,
        },
      },
      // Lower to low ready.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 1.2, elbowR: 1.4, torsoX: 0.15, torsoY: 0.0, headX: 0.0, headY: 0.0,
        },
      },
    ],
  },
  {
    id: 'bow-draw-loose',
    name: 'Bow Draw & Loose',
    category: 'fight',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Relaxed, bow held low.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, torsoY: 0.0, headY: 0.0,
        },
      },
      // Raise the bow arm straight out at the target.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.55, shoulderRX: -0.6, shoulderLZ: 0.6, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 1.2, torsoX: 0.1, torsoY: 0.1, headY: -0.3,
        },
      },
      // Draw the string — rear elbow pulls back and high.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.3, shoulderLZ: 0.6, shoulderRZ: 0.9,
          elbowL: 0.05, elbowR: 2.0, torsoX: 0.1, torsoY: 0.2, headY: -0.3,
        },
      },
      // Loose — release, rear hand flies back.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.5, shoulderLZ: 0.6, shoulderRZ: 1.0,
          elbowL: 0.05, elbowR: 1.0, torsoX: 0.1, torsoY: 0.1, headY: -0.3,
        },
      },
      // Lower the bow.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, torsoY: 0.0, headY: 0.0,
        },
      },
    ],
  },
  {
    id: 'shield-brace',
    name: 'Shield Brace & Bash',
    category: 'fight',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Set behind a raised shield, weight low.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, hipLX: 0.1, hipRX: 0.2, kneeL: 0.5, kneeR: 0.4,
        },
      },
      // Dig in hard against an impact.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.1, elbowR: 2.1,
          torsoX: 0.45, hipLX: 0.3, hipRX: 0.4, kneeL: 0.7, kneeR: 0.6,
        },
      },
      // Shield bash — drive the shield out and forward.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.05, hipLX: -0.1, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Reset behind the shield.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, hipLX: 0.1, hipRX: 0.2, kneeL: 0.5, kneeR: 0.4,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // DANCE — grooves, moves, freezes
  // -------------------------------------------------------------------------
  {
    id: 'running-man',
    name: 'Running Man',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Right knee driving up, left leg sliding back; arms pump opposite.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.2, shoulderRX: 0.3, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, hipLX: 0.4, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
      },
      // Through center on a small hop.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, hipLX: 0.0, hipRX: 0.0, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Left knee up, right leg back; arms swap.
      {
        t: 0.4,
        joints: {
          shoulderLX: 0.3, shoulderRX: -1.2, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, hipLX: -0.9, hipRX: 0.4, kneeL: 1.3, kneeR: 0.3,
        },
      },
      // Through center again.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, hipLX: 0.0, hipRX: 0.0, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.2, shoulderRX: 0.3, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.2, hipLX: 0.4, hipRX: -0.9, kneeL: 0.3, kneeR: 1.3,
        },
      },
    ],
  },
  {
    id: 'robot-wave',
    name: 'Robot Wave',
    category: 'dance',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Arms out level, a wave rising on the left.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.4, shoulderLZ: 0.9, shoulderRZ: 0.7,
          elbowL: 0.2, elbowR: 0.4,
        },
      },
      // Wave crosses to center, elbows bend through.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.6, elbowR: 0.5,
        },
      },
      // Wave lifts the right side.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.55, shoulderLZ: 0.7, shoulderRZ: 0.9,
          elbowL: 0.4, elbowR: 0.2,
        },
      },
      // Back through center.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.5, elbowR: 0.6,
        },
      },
      // Loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -1.55, shoulderRX: -1.4, shoulderLZ: 0.9, shoulderRZ: 0.7,
          elbowL: 0.2, elbowR: 0.4,
        },
      },
    ],
  },
  {
    id: 'body-roll',
    name: 'Body Roll',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Chest pushed out, head back.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: -0.2, headX: -0.2, hipLX: -0.1, hipRX: -0.1, kneeL: 0.15, kneeR: 0.15,
        },
      },
      // The roll starts folding from the top.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.15, headX: 0.1, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Full fold forward through the middle.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.45, headX: 0.35, hipLX: 0.3, hipRX: 0.3, kneeL: 0.45, kneeR: 0.45,
        },
      },
      // Hips push through, torso arches back.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.0, headX: -0.1, hipLX: -0.15, hipRX: -0.15, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: -0.2, headX: -0.2, hipLX: -0.1, hipRX: -0.1, kneeL: 0.15, kneeR: 0.15,
        },
      },
    ],
  },
  {
    id: 'chest-pop',
    name: 'Chest Pop',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Chest snaps out.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, torsoX: -0.25, headX: -0.1,
        },
      },
      // Retract.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoX: 0.2, headX: 0.15,
        },
      },
      // Pop again.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, torsoX: -0.25, headX: -0.1,
        },
      },
      // Retract.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoX: 0.2, headX: 0.15,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, torsoX: -0.25, headX: -0.1,
        },
      },
    ],
  },
  {
    id: 'arm-wave',
    name: 'Arm Wave',
    category: 'dance',
    duration: 1.4,
    loop: true,
    keyframes: [
      // Left fingertips up, ripple begins.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 1.0, shoulderRZ: 0.5,
          elbowL: 0.1, elbowR: 0.6,
        },
      },
      // Ripple through the shoulders.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.4,
        },
      },
      // Right fingertips up.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.5, shoulderRZ: 1.0,
          elbowL: 0.6, elbowR: 0.1,
        },
      },
      // Ripple back.
      {
        t: 1.05,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.4,
        },
      },
      // Loop.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 1.0, shoulderRZ: 0.5,
          elbowL: 0.1, elbowR: 0.6,
        },
      },
    ],
  },
  {
    id: 'shoulder-bounce',
    name: 'Shoulder Bounce',
    category: 'dance',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Left shoulder up, lean right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.3, shoulderLZ: 0.5, shoulderRZ: 0.2,
          elbowL: 1.2, elbowR: 1.0, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.3,
        },
      },
      // Center.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoZ: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Right shoulder up, lean left.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.7, shoulderLZ: 0.2, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.2, torsoZ: -0.15, kneeL: 0.3, kneeR: 0.2,
        },
      },
      // Center.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoZ: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.3, shoulderLZ: 0.5, shoulderRZ: 0.2,
          elbowL: 1.2, elbowR: 1.0, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'hip-sway-groove',
    name: 'Hip Sway Groove',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Sway right, hands resting on the hips.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 1.6, elbowR: 1.6,
          torsoZ: 0.2, hipLZ: 0.1, hipRZ: 0.15, kneeL: 0.15, kneeR: 0.3,
        },
      },
      // Center.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 1.6, elbowR: 1.6,
          torsoZ: 0.0, hipLZ: 0.05, hipRZ: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Sway left.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 1.6, elbowR: 1.6,
          torsoZ: -0.2, hipLZ: 0.15, hipRZ: 0.1, kneeL: 0.3, kneeR: 0.15,
        },
      },
      // Center.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 1.6, elbowR: 1.6,
          torsoZ: 0.0, hipLZ: 0.05, hipRZ: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 1.6, elbowR: 1.6,
          torsoZ: 0.2, hipLZ: 0.1, hipRZ: 0.15, kneeL: 0.15, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'floss-dance',
    name: 'Floss Dance',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Arms swung to the left, hips to the right — left arm behind, right front.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.3, shoulderRX: -0.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.2, elbowR: 0.2, torsoZ: 0.15, torsoY: -0.1, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Center pass.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.2, elbowR: 0.2, torsoZ: 0.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Arms swung to the right, hips to the left.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: 0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.2, elbowR: 0.2, torsoZ: -0.15, torsoY: 0.1, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Center pass.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.2, elbowR: 0.2, torsoZ: 0.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: 0.3, shoulderRX: -0.5, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.2, elbowR: 0.2, torsoZ: 0.15, torsoY: -0.1, hipLX: 0.0, hipRX: 0.0,
        },
      },
    ],
  },
  {
    id: 'dab',
    name: 'Dab',
    category: 'dance',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Neutral.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, headX: 0.0, torsoY: 0.0,
        },
      },
      // Dab — right arm shoots up on a diagonal, head drops into the left elbow.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.4, shoulderRX: -2.0, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 2.0, elbowR: 0.2, headX: 0.35, torsoY: 0.15,
        },
      },
      // Hold the dab.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.4, shoulderRX: -2.0, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 2.0, elbowR: 0.2, headX: 0.35, torsoY: 0.15,
        },
      },
      // Back to neutral.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, headX: 0.0, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'vogue-frames',
    name: 'Vogue Frames',
    category: 'dance',
    duration: 2.4,
    loop: true,
    keyframes: [
      // Right hand frames over the head, head turned.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -2.2, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 0.3, elbowR: 1.6, headY: 0.3,
        },
      },
      // Switch through center, arms boxed.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, headY: 0.0,
        },
      },
      // Left hand frames over the head.
      {
        t: 1.2,
        joints: {
          shoulderLX: -2.2, shoulderRX: -0.5, shoulderLZ: 0.5, shoulderRZ: 0.3,
          elbowL: 1.6, elbowR: 0.3, headY: -0.3,
        },
      },
      // Switch through center.
      {
        t: 1.8,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.0, elbowR: 1.0, headY: 0.0,
        },
      },
      // Loop.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -2.2, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 0.3, elbowR: 1.6, headY: 0.3,
        },
      },
    ],
  },
  {
    id: 'grapevine',
    name: 'Grapevine',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Feet together.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoZ: 0.0, hipLZ: 0.0, hipRZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Step out to the right, left foot follows across.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.3, elbowL: 0.7, elbowR: 0.5,
          torsoZ: 0.15, hipLZ: 0.0, hipRZ: 0.5, hipLX: -0.2, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Feet together, weight shifted.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoZ: 0.0, hipLZ: 0.0, hipRZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Step out to the left, right foot follows.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.6, elbowL: 0.5, elbowR: 0.7,
          torsoZ: -0.15, hipLZ: 0.5, hipRZ: 0.0, hipLX: 0.1, hipRX: -0.2, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoZ: 0.0, hipLZ: 0.0, hipRZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'two-step',
    name: 'Two-Step',
    category: 'dance',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Step right, lean right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.3, elbowL: 0.7, elbowR: 0.5,
          torsoZ: 0.15, hipLX: 0.0, hipRX: 0.1, kneeL: 0.2, kneeR: 0.35,
        },
      },
      // Feet together.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Step left, lean left.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.5, elbowL: 0.5, elbowR: 0.7,
          torsoZ: -0.15, hipLX: 0.1, hipRX: 0.0, kneeL: 0.35, kneeR: 0.2,
        },
      },
      // Feet together.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoZ: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.3, elbowL: 0.7, elbowR: 0.5,
          torsoZ: 0.15, hipLX: 0.0, hipRX: 0.1, kneeL: 0.2, kneeR: 0.35,
        },
      },
    ],
  },
  {
    id: 'shuffle-step',
    name: 'Shuffle Step',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Right foot kicks forward, left slides back.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, hipLX: 0.3, hipRX: -0.5, kneeL: 0.4, kneeR: 0.7,
        },
      },
      // Snap together.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Left foot kicks forward, right slides back.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, hipLX: -0.5, hipRX: 0.3, kneeL: 0.7, kneeR: 0.4,
        },
      },
      // Snap together.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, hipLX: 0.3, hipRX: -0.5, kneeL: 0.4, kneeR: 0.7,
        },
      },
    ],
  },
  {
    id: 'top-rock',
    name: 'Top Rock',
    category: 'dance',
    duration: 1.4,
    loop: true,
    keyframes: [
      // Right foot crosses, arms swing left with a twist.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.3, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 1.3, elbowR: 0.9, torsoY: 0.3, hipLX: 0.0, hipRX: -0.4, kneeL: 0.3, kneeR: 0.6,
        },
      },
      // Center bounce.
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Left foot crosses, arms swing right.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.9, shoulderLZ: 0.5, shoulderRZ: 0.3,
          elbowL: 0.9, elbowR: 1.3, torsoY: -0.3, hipLX: -0.4, hipRX: 0.0, kneeL: 0.6, kneeR: 0.3,
        },
      },
      // Center bounce.
      {
        t: 1.05,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.1, elbowR: 1.1, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Loop.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.3, shoulderLZ: 0.3, shoulderRZ: 0.5,
          elbowL: 1.3, elbowR: 0.9, torsoY: 0.3, hipLX: 0.0, hipRX: -0.4, kneeL: 0.3, kneeR: 0.6,
        },
      },
    ],
  },
  {
    id: 'spin-freeze',
    name: 'Spin Freeze',
    category: 'dance',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Wind up for the spin.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 0.6, torsoY: -0.5, torsoZ: 0.0,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Spin around, arms tuck in tight.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 1.6, elbowR: 1.6, torsoY: 0.9, torsoZ: 0.0,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.5, kneeR: 0.5,
        },
      },
      // Continue the spin, arms fly out.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.4, torsoY: -0.9, torsoZ: 0.1,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Freeze — one arm up, sharp lean.
      {
        t: 1.1,
        joints: {
          shoulderLX: -2.2, shoulderRX: -0.3, shoulderLZ: 0.5, shoulderRZ: 0.3,
          elbowL: 0.3, elbowR: 1.4, torsoY: 0.0, torsoZ: 0.3,
          hipLX: -0.3, hipRX: 0.2, kneeL: 0.6, kneeR: 0.4,
        },
      },
      // Hold the freeze.
      {
        t: 1.6,
        joints: {
          shoulderLX: -2.2, shoulderRX: -0.3, shoulderLZ: 0.5, shoulderRZ: 0.3,
          elbowL: 0.3, elbowR: 1.4, torsoY: 0.0, torsoZ: 0.3,
          hipLX: -0.3, hipRX: 0.2, kneeL: 0.6, kneeR: 0.4,
        },
      },
    ],
  },
  {
    id: 'sprinkler',
    name: 'Sprinkler',
    category: 'dance',
    duration: 1.0,
    loop: true,
    keyframes: [
      // One arm straight out, the other cocked behind the head, aimed right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.55, shoulderLZ: 0.5, shoulderRZ: 0.9,
          elbowL: 2.2, elbowR: 0.15, torsoY: 0.5, headY: 0.1,
        },
      },
      // Slow sweep across to the left.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.55, shoulderLZ: 0.5, shoulderRZ: 0.9,
          elbowL: 2.2, elbowR: 0.15, torsoY: -0.5, headY: 0.1,
        },
      },
      // Pause at the end of the sweep.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.55, shoulderLZ: 0.5, shoulderRZ: 0.9,
          elbowL: 2.2, elbowR: 0.15, torsoY: -0.5, headY: 0.1,
        },
      },
      // Ratchet snap back to the start.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.55, shoulderLZ: 0.5, shoulderRZ: 0.9,
          elbowL: 2.2, elbowR: 0.15, torsoY: 0.5, headY: 0.1,
        },
      },
    ],
  },
  {
    id: 'swim-dance',
    name: 'Swim Dance',
    category: 'dance',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Left arm strokes overhead, right recovers.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.4, shoulderRX: -0.4, shoulderLZ: 0.3, shoulderRZ: 0.4,
          elbowL: 0.3, elbowR: 1.0, torsoY: 0.2,
        },
      },
      // Pass through.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.35, shoulderRZ: 0.35,
          elbowL: 0.7, elbowR: 0.7, torsoY: 0.0,
        },
      },
      // Right arm strokes overhead, left recovers.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -2.4, shoulderLZ: 0.4, shoulderRZ: 0.3,
          elbowL: 1.0, elbowR: 0.3, torsoY: -0.2,
        },
      },
      // Pass through.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.35, shoulderRZ: 0.35,
          elbowL: 0.7, elbowR: 0.7, torsoY: 0.0,
        },
      },
      // Loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -2.4, shoulderRX: -0.4, shoulderLZ: 0.3, shoulderRZ: 0.4,
          elbowL: 0.3, elbowR: 1.0, torsoY: 0.2,
        },
      },
    ],
  },
  {
    id: 'shopping-cart',
    name: 'Shopping Cart',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Hands on the handle, reach up with the right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.9, shoulderLZ: 0.2, shoulderRZ: 0.4,
          elbowL: 0.6, elbowR: 0.3, torsoY: -0.1, kneeL: 0.2, kneeR: 0.3,
        },
      },
      // Pull the right hand in — grab an item.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -0.8, shoulderLZ: 0.2, shoulderRZ: 0.3,
          elbowL: 0.6, elbowR: 1.4, torsoY: 0.1, kneeL: 0.3, kneeR: 0.2,
        },
      },
      // Reach up with the left.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.9, shoulderRX: -1.4, shoulderLZ: 0.4, shoulderRZ: 0.2,
          elbowL: 0.3, elbowR: 0.6, torsoY: 0.1, kneeL: 0.3, kneeR: 0.2,
        },
      },
      // Pull the left hand in.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.8, shoulderRX: -1.4, shoulderLZ: 0.3, shoulderRZ: 0.2,
          elbowL: 1.4, elbowR: 0.6, torsoY: -0.1, kneeL: 0.2, kneeR: 0.3,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.9, shoulderLZ: 0.2, shoulderRZ: 0.4,
          elbowL: 0.6, elbowR: 0.3, torsoY: -0.1, kneeL: 0.2, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'raise-the-roof',
    name: 'Raise the Roof',
    category: 'dance',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Palms push up, lean right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.8, elbowR: 1.8, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.35,
        },
      },
      // Hands recock down, center.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 2.2, elbowR: 2.2, torsoZ: 0.0, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Push up again, lean left.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.8, elbowR: 1.8, torsoZ: -0.15, kneeL: 0.35, kneeR: 0.2,
        },
      },
      // Recock down, center.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 2.2, elbowR: 2.2, torsoZ: 0.0, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Loop.
      {
        t: 1.2,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.8, elbowR: 1.8, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.35,
        },
      },
    ],
  },
  {
    id: 'clap-groove',
    name: 'Clap Groove',
    category: 'dance',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Hands apart, lean right, knees bounce.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.35,
        },
      },
      // Clap, center.
      {
        t: 0.25,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.2, elbowR: 1.2, torsoZ: 0.0, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Apart, lean left.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoZ: -0.15, kneeL: 0.35, kneeR: 0.2,
        },
      },
      // Clap, center.
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.2, elbowR: 1.2, torsoZ: 0.0, kneeL: 0.35, kneeR: 0.35,
        },
      },
      // Loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoZ: 0.15, kneeL: 0.2, kneeR: 0.35,
        },
      },
    ],
  },
  {
    id: 'slow-sway-partner',
    name: 'Slow Sway (Partner Hold)',
    category: 'dance',
    duration: 3.0,
    loop: true,
    keyframes: [
      // Held in a frame, sway right, head tilts right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.1, shoulderRX: -0.9, shoulderLZ: 0.7, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.1, torsoZ: 0.15, headZ: 0.15, hipLX: -0.1, hipRX: 0.1,
        },
      },
      // Ease through center.
      {
        t: 0.75,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.55, shoulderRZ: 0.55,
          elbowL: 1.2, elbowR: 1.2, torsoZ: 0.0, headZ: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Sway left, head tilts left.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.1, shoulderLZ: 0.4, shoulderRZ: 0.7,
          elbowL: 1.1, elbowR: 1.3, torsoZ: -0.15, headZ: -0.15, hipLX: 0.1, hipRX: -0.1,
        },
      },
      // Ease through center.
      {
        t: 2.25,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.55, shoulderRZ: 0.55,
          elbowL: 1.2, elbowR: 1.2, torsoZ: 0.0, headZ: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
      },
      // Loop.
      {
        t: 3.0,
        joints: {
          shoulderLX: -1.1, shoulderRX: -0.9, shoulderLZ: 0.7, shoulderRZ: 0.4,
          elbowL: 1.3, elbowR: 1.1, torsoZ: 0.15, headZ: 0.15, hipLX: -0.1, hipRX: 0.1,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // GESTURE — communication and expression
  // -------------------------------------------------------------------------
  {
    id: 'big-wave',
    name: 'Big Wave',
    category: 'gesture',
    duration: 1.4,
    loop: true,
    keyframes: [
      // Arm high overhead, swung to the right.
      {
        t: 0.0,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.7, elbowR: 0.3 },
      },
      // Sweep across to the left.
      {
        t: 0.35,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.2, elbowR: 0.5 },
      },
      // Sweep back to the right.
      {
        t: 0.7,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.8, elbowR: 0.3 },
      },
      // Across to the left.
      {
        t: 1.05,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.2, elbowR: 0.5 },
      },
      // Loop.
      {
        t: 1.4,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.7, elbowR: 0.3 },
      },
    ],
  },
  {
    id: 'slow-clap',
    name: 'Slow Clap',
    category: 'gesture',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Hands wide apart.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.8, elbowR: 0.8,
        },
      },
      // Meet deliberately.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.2, elbowR: 1.2,
        },
      },
      // Apart again.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.8, elbowR: 0.8,
        },
      },
      // Meet.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 1.2, elbowR: 1.2,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.8, elbowR: 0.8,
        },
      },
    ],
  },
  {
    id: 'applause',
    name: 'Applause',
    category: 'gesture',
    duration: 0.6,
    loop: true,
    keyframes: [
      // Hands apart, up high and enthusiastic.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.4,
        },
      },
      // Clap.
      {
        t: 0.15,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 1.6, elbowR: 1.6,
        },
      },
      // Apart.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.4,
        },
      },
      // Clap.
      {
        t: 0.45,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 1.6, elbowR: 1.6,
        },
      },
      // Loop.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.4, elbowR: 1.4,
        },
      },
    ],
  },
  {
    id: 'fist-pump',
    name: 'Fist Pump',
    category: 'gesture',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Fist punched up high.
      {
        t: 0.0,
        joints: { shoulderRX: -2.2, elbowR: 1.8, torsoX: 0.1 },
      },
      // Yank down to the side.
      {
        t: 0.2,
        joints: { shoulderRX: -0.8, elbowR: 2.4, torsoX: 0.2 },
      },
      // Up again.
      {
        t: 0.4,
        joints: { shoulderRX: -2.2, elbowR: 1.8, torsoX: 0.1 },
      },
      // Down.
      {
        t: 0.6,
        joints: { shoulderRX: -0.8, elbowR: 2.4, torsoX: 0.2 },
      },
      // Loop.
      {
        t: 0.8,
        joints: { shoulderRX: -2.2, elbowR: 1.8, torsoX: 0.1 },
      },
    ],
  },
  {
    id: 'beckon-come',
    name: 'Beckon (Come Here)',
    category: 'gesture',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Arm forward, hand extended.
      {
        t: 0.0,
        joints: { shoulderRX: -1.5, elbowR: 0.4 },
      },
      // Curl the hand in, beckoning.
      {
        t: 0.25,
        joints: { shoulderRX: -1.4, elbowR: 1.5 },
      },
      // Extend.
      {
        t: 0.5,
        joints: { shoulderRX: -1.5, elbowR: 0.4 },
      },
      // Curl in.
      {
        t: 0.75,
        joints: { shoulderRX: -1.4, elbowR: 1.5 },
      },
      // Loop.
      {
        t: 1.0,
        joints: { shoulderRX: -1.5, elbowR: 0.4 },
      },
    ],
  },
  {
    id: 'bow-formal',
    name: 'Formal Bow',
    category: 'gesture',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Standing tall.
      {
        t: 0.0,
        joints: {
          torsoX: 0.0, headX: 0.0, shoulderLX: 0.0, shoulderRX: 0.0,
          elbowL: 0.0, elbowR: 0.0,
        },
      },
      // Fold deep — one hand to the waist, one arm sweeps behind.
      {
        t: 0.5,
        joints: {
          torsoX: 1.0, headX: 0.4, shoulderLX: 0.6, shoulderRX: -0.3,
          elbowL: 1.6, elbowR: 0.3,
        },
      },
      // Hold the bow.
      {
        t: 1.2,
        joints: {
          torsoX: 1.0, headX: 0.4, shoulderLX: 0.6, shoulderRX: -0.3,
          elbowL: 1.6, elbowR: 0.3,
        },
      },
      // Rise back to standing.
      {
        t: 2.0,
        joints: {
          torsoX: 0.0, headX: 0.0, shoulderLX: 0.0, shoulderRX: 0.0,
          elbowL: 0.0, elbowR: 0.0,
        },
      },
    ],
  },
  {
    id: 'shrug',
    name: 'Shrug',
    category: 'gesture',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Neutral.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, headZ: 0.0,
        },
      },
      // Shrug — shoulders and hands turn out, head tilts.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 1.4, elbowR: 1.4, headZ: 0.15,
        },
      },
      // Hold.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 1.4, elbowR: 1.4, headZ: 0.15,
        },
      },
      // Back to neutral.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.15, shoulderRZ: 0.15,
          elbowL: 0.4, elbowR: 0.4, headZ: 0.0,
        },
      },
    ],
  },
  {
    id: 'facepalm',
    name: 'Facepalm',
    category: 'gesture',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Neutral.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headX: 0.0, torsoX: 0.05,
        },
      },
      // Hand rises to the face.
      {
        t: 0.4,
        joints: {
          shoulderRX: -1.3, shoulderRZ: 0.3, elbowR: 2.3, headX: 0.3, torsoX: 0.15,
        },
      },
      // Head sinks into the hand.
      {
        t: 1.1,
        joints: {
          shoulderRX: -1.3, shoulderRZ: 0.3, elbowR: 2.4, headX: 0.4, torsoX: 0.2,
        },
      },
      // Lower the hand.
      {
        t: 1.6,
        joints: {
          shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headX: 0.0, torsoX: 0.05,
        },
      },
    ],
  },
  {
    id: 'arms-crossed-settle',
    name: 'Arms Crossed (Settle)',
    category: 'gesture',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Arms at the sides.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3,
        },
      },
      // Bring the arms up and fold them across the chest.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 2.4, elbowR: 2.4,
        },
      },
      // Settle into the crossed-arms hold.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.45, shoulderRX: -0.45, shoulderLZ: 0.05, shoulderRZ: 0.05,
          elbowL: 2.5, elbowR: 2.5,
        },
      },
    ],
  },
  {
    id: 'hands-on-hips',
    name: 'Hands on Hips',
    category: 'gesture',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Arms at the sides.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.3, elbowR: 0.3,
        },
      },
      // Hands travel up onto the hips, elbows out.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 1.7, elbowR: 1.7,
        },
      },
      // Hold the confident stance.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 1.7, elbowR: 1.7,
        },
      },
    ],
  },
  {
    id: 'thinking-chin',
    name: 'Thinking (Hand on Chin)',
    category: 'gesture',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Neutral.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headX: 0.0, headZ: 0.0,
        },
      },
      // Bring the hand up to the chin.
      {
        t: 0.5,
        joints: {
          shoulderRX: -0.6, shoulderRZ: 0.2, elbowR: 2.5, headX: 0.15, headZ: 0.15,
        },
      },
      // Ponder, head tilting.
      {
        t: 1.5,
        joints: {
          shoulderRX: -0.6, shoulderRZ: 0.2, elbowR: 2.5, headX: 0.1, headZ: 0.2,
        },
      },
      // Lower the hand.
      {
        t: 2.0,
        joints: {
          shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headX: 0.0, headZ: 0.0,
        },
      },
    ],
  },
  {
    id: 'nod-yes',
    name: 'Nod (Yes)',
    category: 'gesture',
    duration: 1.0,
    loop: true,
    keyframes: [
      { t: 0.0, joints: { headX: 0.0 } },
      { t: 0.25, joints: { headX: 0.35 } },
      { t: 0.5, joints: { headX: 0.0 } },
      { t: 0.75, joints: { headX: 0.35 } },
      { t: 1.0, joints: { headX: 0.0 } },
    ],
  },
  {
    id: 'shake-no',
    name: 'Shake (No)',
    category: 'gesture',
    duration: 1.0,
    loop: true,
    keyframes: [
      { t: 0.0, joints: { headY: 0.0 } },
      { t: 0.25, joints: { headY: 0.4 } },
      { t: 0.5, joints: { headY: -0.4 } },
      { t: 0.75, joints: { headY: 0.4 } },
      { t: 1.0, joints: { headY: 0.0 } },
    ],
  },
  {
    id: 'laugh-double-over',
    name: 'Laugh (Double Over)',
    category: 'gesture',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Upright.
      {
        t: 0.0,
        joints: {
          torsoX: 0.05, headX: 0.0, shoulderLX: -0.3, shoulderRX: -0.3,
          elbowL: 0.5, elbowR: 0.5,
        },
      },
      // Head back laughing, hands come to the belly.
      {
        t: 0.4,
        joints: {
          torsoX: -0.15, headX: -0.35, shoulderLX: -0.4, shoulderRX: -0.4,
          elbowL: 1.6, elbowR: 1.6,
        },
      },
      // Double over with laughter.
      {
        t: 0.9,
        joints: {
          torsoX: 0.7, headX: 0.4, shoulderLX: -0.2, shoulderRX: -0.2,
          elbowL: 1.9, elbowR: 1.9,
        },
      },
      // Settle upright.
      {
        t: 1.6,
        joints: {
          torsoX: 0.05, headX: 0.0, shoulderLX: -0.3, shoulderRX: -0.3,
          elbowL: 0.5, elbowR: 0.5,
        },
      },
    ],
  },
  {
    id: 'sob-cry',
    name: 'Sob / Cry',
    category: 'gesture',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Neutral.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.05, headX: 0.0,
        },
      },
      // Hands come up to cover the face, curling in.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.4, headX: 0.35,
        },
      },
      // Shoulders heave with a sob.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 2.4, elbowR: 2.4,
          torsoX: 0.5, headX: 0.4,
        },
      },
      // Sink again.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.45, headX: 0.4,
        },
      },
      // Held, face buried.
      {
        t: 2.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.4, headX: 0.35,
        },
      },
    ],
  },
  {
    id: 'look-around-wary',
    name: 'Look Around (Wary)',
    category: 'gesture',
    duration: 3.0,
    loop: true,
    keyframes: [
      // Hunched, glancing right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.2, torsoY: -0.2, headY: -0.5, headX: 0.1,
        },
      },
      // Scan through center.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.2, torsoY: 0.0, headY: 0.0, headX: 0.05,
        },
      },
      // Turn and scan left.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.2, torsoY: 0.25, headY: 0.5, headX: 0.1,
        },
      },
      // Back through center.
      {
        t: 2.25,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.2, torsoY: 0.0, headY: 0.0, headX: 0.05,
        },
      },
      // Loop.
      {
        t: 3.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.2, torsoY: -0.2, headY: -0.5, headX: 0.1,
        },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // EVERYDAY — daily actions
  // -------------------------------------------------------------------------
  {
    id: 'shiver-cold',
    name: 'Shiver (Cold)',
    category: 'everyday',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Hugging self, trembling left.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.25, headZ: 0.1,
        },
      },
      // Tremble right.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, elbowL: 2.35, elbowR: 2.35,
          torsoX: 0.28, headZ: -0.1,
        },
      },
      // Left.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.25, headZ: 0.1,
        },
      },
      // Right.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.95, shoulderRX: -0.95, elbowL: 2.35, elbowR: 2.35,
          torsoX: 0.28, headZ: -0.1,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 2.3, elbowR: 2.3,
          torsoX: 0.25, headZ: 0.1,
        },
      },
    ],
  },
  {
    id: 'check-watch',
    name: 'Check Watch',
    category: 'everyday',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Arm down.
      {
        t: 0.0,
        joints: { shoulderLX: -0.2, elbowL: 0.3, headX: 0.0 },
      },
      // Raise the wrist to look.
      {
        t: 0.4,
        joints: { shoulderLX: -0.7, elbowL: 2.2, headX: 0.25 },
      },
      // Hold, reading the time.
      {
        t: 0.9,
        joints: { shoulderLX: -0.7, elbowL: 2.2, headX: 0.3 },
      },
      // Lower.
      {
        t: 1.4,
        joints: { shoulderLX: -0.2, elbowL: 0.3, headX: 0.0 },
      },
    ],
  },
  {
    id: 'phone-call',
    name: 'Phone Call',
    category: 'everyday',
    duration: 2.2,
    loop: false,
    keyframes: [
      // Arm down.
      {
        t: 0.0,
        joints: { shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headZ: 0.0 },
      },
      // Bring the phone to the ear.
      {
        t: 0.4,
        joints: { shoulderRX: -0.9, shoulderRZ: 0.4, elbowR: 2.4, headZ: 0.2 },
      },
      // Talking.
      {
        t: 1.0,
        joints: { shoulderRX: -0.9, shoulderRZ: 0.4, elbowR: 2.5, headZ: 0.15 },
      },
      // Still talking.
      {
        t: 1.6,
        joints: { shoulderRX: -0.9, shoulderRZ: 0.4, elbowR: 2.4, headZ: 0.2 },
      },
      // Lower.
      {
        t: 2.2,
        joints: { shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, headZ: 0.0 },
      },
    ],
  },
  {
    id: 'texting',
    name: 'Texting',
    category: 'everyday',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Holding the phone, head down, left thumb taps.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.85, headX: 0.3,
        },
      },
      // Right thumb taps.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.85, elbowR: 1.9, headX: 0.3,
        },
      },
      // Left taps.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.85, headX: 0.3,
        },
      },
      // Right taps.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.85, elbowR: 1.9, headX: 0.3,
        },
      },
      // Loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.85, headX: 0.3,
        },
      },
    ],
  },
  {
    id: 'typing-seated',
    name: 'Typing',
    category: 'everyday',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Hands over the keyboard, left presses.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.7, elbowR: 1.6,
          torsoX: 0.2, headX: 0.2,
        },
      },
      // Right presses.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.7,
          torsoX: 0.2, headX: 0.2,
        },
      },
      // Left.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.7, elbowR: 1.6,
          torsoX: 0.2, headX: 0.2,
        },
      },
      // Right.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.7,
          torsoX: 0.2, headX: 0.2,
        },
      },
      // Loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.7, elbowR: 1.6,
          torsoX: 0.2, headX: 0.2,
        },
      },
    ],
  },
  {
    id: 'eat-seated',
    name: 'Eat',
    category: 'everyday',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Hand down at the plate.
      {
        t: 0.0,
        joints: { shoulderRX: -0.3, elbowR: 1.0, headX: 0.15, torsoX: 0.2 },
      },
      // Raise the food to the mouth.
      {
        t: 0.6,
        joints: { shoulderRX: -0.7, elbowR: 2.4, headX: 0.1, torsoX: 0.15 },
      },
      // Chew.
      {
        t: 1.0,
        joints: { shoulderRX: -0.7, elbowR: 2.45, headX: 0.05, torsoX: 0.1 },
      },
      // Back down to the plate.
      {
        t: 1.4,
        joints: { shoulderRX: -0.3, elbowR: 1.0, headX: 0.15, torsoX: 0.2 },
      },
      // Loop.
      {
        t: 2.0,
        joints: { shoulderRX: -0.3, elbowR: 1.0, headX: 0.15, torsoX: 0.2 },
      },
    ],
  },
  {
    id: 'toast-raise-glass',
    name: 'Toast (Raise Glass)',
    category: 'everyday',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Glass held at the chest.
      {
        t: 0.0,
        joints: { shoulderRX: -0.5, shoulderRZ: 0.2, elbowR: 1.6, headX: 0.0 },
      },
      // Raise it up in a toast.
      {
        t: 0.4,
        joints: { shoulderRX: -1.3, shoulderRZ: 0.4, elbowR: 1.0, headX: -0.1 },
      },
      // Hold the toast.
      {
        t: 0.8,
        joints: { shoulderRX: -1.3, shoulderRZ: 0.4, elbowR: 1.0, headX: -0.1 },
      },
      // Sip.
      {
        t: 1.2,
        joints: { shoulderRX: -0.7, shoulderRZ: 0.3, elbowR: 2.4, headX: 0.1 },
      },
      // Lower to the chest.
      {
        t: 1.6,
        joints: { shoulderRX: -0.5, shoulderRZ: 0.2, elbowR: 1.6, headX: 0.0 },
      },
    ],
  },
  {
    id: 'photo-snap',
    name: 'Take a Photo',
    category: 'everyday',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Camera down.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4, headX: 0.0,
        },
      },
      // Raise to the eye and frame the shot.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 1.8, elbowR: 1.8, headX: 0.1,
        },
      },
      // Hold and snap.
      {
        t: 0.9,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 1.85, elbowR: 1.85, headX: 0.1,
        },
      },
      // Lower.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4, headX: 0.0,
        },
      },
    ],
  },
  {
    id: 'push-heavy-object',
    name: 'Push Heavy Object',
    category: 'everyday',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Set against the object, leaning in.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.5, hipLX: 0.2, hipRX: 0.4, kneeL: 0.5, kneeR: 0.6,
        },
      },
      // Drive — legs push, arms straighten.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.6, hipLX: 0.5, hipRX: 0.2, kneeL: 0.6, kneeR: 0.5,
        },
      },
      // Reset the stride.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.55, hipLX: 0.3, hipRX: 0.4, kneeL: 0.55, kneeR: 0.55,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.5, hipLX: 0.2, hipRX: 0.4, kneeL: 0.5, kneeR: 0.6,
        },
      },
    ],
  },
  {
    id: 'pull-heavy-object',
    name: 'Pull Heavy Object',
    category: 'everyday',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Reach out, leaning back to haul.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.3, elbowL: 0.4, elbowR: 1.6,
          torsoX: -0.25, hipLX: 0.3, hipRX: 0.4, kneeL: 0.5, kneeR: 0.6,
        },
      },
      // Haul with the left, right reaches out.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.0, elbowL: 1.6, elbowR: 0.4,
          torsoX: -0.3, hipLX: 0.4, hipRX: 0.3, kneeL: 0.6, kneeR: 0.5,
        },
      },
      // Haul with the right.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.3, elbowL: 0.4, elbowR: 1.6,
          torsoX: -0.25, hipLX: 0.3, hipRX: 0.4, kneeL: 0.5, kneeR: 0.6,
        },
      },
      // Haul with the left.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.0, elbowL: 1.6, elbowR: 0.4,
          torsoX: -0.3, hipLX: 0.4, hipRX: 0.3, kneeL: 0.6, kneeR: 0.5,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.3, elbowL: 0.4, elbowR: 1.6,
          torsoX: -0.25, hipLX: 0.3, hipRX: 0.4, kneeL: 0.5, kneeR: 0.6,
        },
      },
    ],
  },
  {
    id: 'lift-and-carry',
    name: 'Lift and Carry',
    category: 'everyday',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Standing over the object.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.05, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Squat down and reach for it.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.6, hipLX: 0.7, hipRX: 0.7, kneeL: 1.4, kneeR: 1.4,
        },
      },
      // Grip and begin the lift.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.5, hipLX: 0.5, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
      },
      // Stand up, holding it at the waist.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.15, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Settled, carrying.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.1, hipLX: 0.05, hipRX: 0.05, kneeL: 0.15, kneeR: 0.15,
        },
      },
    ],
  },
  {
    id: 'throw-overhand',
    name: 'Overhand Throw',
    category: 'everyday',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
        move: { forward: 0.0 },
      },
      // Wind up — right arm cocks back, torso coils.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.0, shoulderRX: 0.4, elbowL: 1.0, elbowR: 2.0,
          torsoX: 0.1, torsoY: 0.7, hipLX: 0.1, hipRX: 0.3,
        },
        move: { forward: 0.0 },
      },
      // Release — arm whips forward overhead, torso unwinds, step in.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.6, shoulderRX: -2.4, elbowL: 0.6, elbowR: 0.3,
          torsoX: 0.3, torsoY: -0.5, hipLX: -0.5, hipRX: 0.4,
        },
        move: { forward: 0.4 },
      },
      // Follow-through.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.4, elbowL: 0.5, elbowR: 1.0,
          torsoX: 0.4, torsoY: -0.7, hipLX: -0.3, hipRX: 0.4,
        },
        move: { forward: 0.5 },
      },
      // Recover.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
        move: { forward: 0.5 },
      },
    ],
  },
  {
    id: 'catch-object',
    name: 'Catch',
    category: 'everyday',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Ready, hands up.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Reach out to meet it.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
      },
      // Impact — absorb, pull in and dip.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.3, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
      },
      // Settle, holding it.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.5, elbowR: 1.5,
          torsoX: 0.15, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'open-door-step',
    name: 'Open Door & Step Through',
    category: 'everyday',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Reach for the handle.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.9, elbowR: 0.9, torsoX: 0.15,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 0.0 },
      },
      // Grip and pull the door open.
      {
        t: 0.4,
        joints: {
          shoulderRX: -0.7, elbowR: 1.6, torsoX: 0.1,
          hipLX: 0.2, hipRX: -0.2, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: 0.1 },
      },
      // Step through the doorway.
      {
        t: 0.9,
        joints: {
          shoulderRX: -0.4, elbowR: 0.8, torsoX: 0.2,
          hipLX: -0.5, hipRX: 0.4, kneeL: 0.5, kneeR: 0.3,
        },
        move: { forward: 0.7 },
      },
      // Settle on the far side.
      {
        t: 1.6,
        joints: {
          shoulderRX: -0.2, elbowR: 0.3, torsoX: 0.05,
          hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 1.0 },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // STUNT — rolls, falls, big stunts
  // -------------------------------------------------------------------------
  {
    id: 'dive-roll',
    name: 'Dive Roll',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Run-up crouch.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.3, hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Dive — arms forward, body stretches out, airborne.
      {
        t: 0.3,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, elbowL: 0.2, elbowR: 0.2,
          torsoX: 0.7, hipLX: 0.3, hipRX: 0.3, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: 0.6, up: 0.3 },
      },
      // Tuck and roll over the shoulder.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 2.2, elbowR: 2.2,
          torsoX: 1.3, hipLX: 1.0, hipRX: 1.0, kneeL: 2.0, kneeR: 2.0,
        },
        move: { forward: 1.2, up: -0.1 },
      },
      // Come up to a crouch.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.6, hipLX: 0.5, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 1.7, up: 0.0 },
      },
      // Stand.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 1.9, up: 0.0 },
      },
    ],
  },
  {
    id: 'combat-roll',
    name: 'Combat Roll',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Crouched ready.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.4, hipLX: 0.5, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Dive low and forward.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 1.2, elbowR: 1.2,
          torsoX: 0.9, hipLX: 0.7, hipRX: 0.7, kneeL: 1.4, kneeR: 1.4,
        },
        move: { forward: 0.6, up: -0.1 },
      },
      // Tucked roll.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 2.2, elbowR: 2.2,
          torsoX: 1.3, hipLX: 1.0, hipRX: 1.0, kneeL: 2.0, kneeR: 2.0,
        },
        move: { forward: 1.1, up: -0.15 },
      },
      // Up onto a knee, ready.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.4, elbowR: 1.4,
          torsoX: 0.5, hipLX: -0.4, hipRX: 0.8, kneeL: 0.9, kneeR: 1.3,
        },
        move: { forward: 1.4, up: -0.05 },
      },
      // Crouched ready.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.7, elbowR: 0.7,
          torsoX: 0.4, hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 1.5, up: 0.0 },
      },
    ],
  },
  {
    id: 'stumble-trip',
    name: 'Stumble Trip',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Walking.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, headX: 0.0, hipLX: 0.2, hipRX: -0.2, kneeL: 0.2, kneeR: 0.3,
        },
        move: { forward: 0.0 },
      },
      // Catch a toe — pitch forward, arms fly out.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.8, headX: 0.3, hipLX: -0.6, hipRX: 0.4, kneeL: 0.4, kneeR: 0.9,
        },
        move: { forward: 0.4 },
      },
      // Windmill to recover.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -2.0, elbowL: 0.4, elbowR: 0.3,
          torsoX: 0.5, headX: 0.1, hipLX: 0.4, hipRX: 0.5, kneeL: 0.7, kneeR: 0.6,
        },
        move: { forward: 0.7 },
      },
      // Regain balance.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.15, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0.9 },
      },
    ],
  },
  {
    id: 'trip-and-fall-flat',
    name: 'Trip and Fall Flat',
    category: 'stunt',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Walking.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, headX: 0.0, hipLX: 0.2, hipRX: -0.2, kneeL: 0.2, kneeR: 0.3,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Trip, pitching forward.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.9, headX: 0.3, hipLX: -0.5, hipRX: 0.3, kneeL: 0.4, kneeR: 0.7,
        },
        move: { forward: 0.4, up: 0.0 },
      },
      // Going down, arms out to break the fall.
      {
        t: 0.7,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: 1.3, headX: 0.2, hipLX: 0.4, hipRX: 0.4, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0.7, up: -0.35 },
      },
      // Flat on the ground.
      {
        t: 1.1,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, elbowL: 0.3, elbowR: 0.3,
          torsoX: 1.5, headX: 0.1, hipLX: 0.5, hipRX: 0.5, kneeL: 0.4, kneeR: 0.4,
        },
        move: { forward: 0.8, up: -0.55 },
      },
      // Held, sprawled flat.
      {
        t: 1.6,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, elbowL: 0.3, elbowR: 0.3,
          torsoX: 1.5, headX: 0.1, hipLX: 0.5, hipRX: 0.5, kneeL: 0.4, kneeR: 0.4,
        },
        move: { forward: 0.8, up: -0.55 },
      },
    ],
  },
  {
    id: 'thrown-backward',
    name: 'Thrown Backward',
    category: 'stunt',
    duration: 1.5,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.0, headX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Impact — flung back, arms fly up, feet leave the ground.
      {
        t: 0.25,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, elbowL: 0.4, elbowR: 0.4,
          torsoX: -0.7, headX: -0.3, hipLX: -0.9, hipRX: -0.9, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: -0.5, up: 0.3 },
      },
      // Airborne arc.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 0.5, elbowR: 0.5,
          torsoX: -1.0, headX: -0.2, hipLX: -1.2, hipRX: -1.2, kneeL: 0.8, kneeR: 0.8,
        },
        move: { forward: -1.0, up: 0.4 },
      },
      // Slam onto the back.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 0.4, elbowR: 0.4,
          torsoX: -1.3, headX: 0.3, hipLX: -1.5, hipRX: -1.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: -1.4, up: -0.4 },
      },
      // Sprawled, held.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.3, elbowR: 0.3,
          torsoX: -1.3, headX: 0.4, hipLX: -1.4, hipRX: -1.4, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: -1.5, up: -0.55 },
      },
    ],
  },
  {
    id: 'blown-back-explosion',
    name: 'Blown Back (Explosion)',
    category: 'stunt',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Blast — limbs splay, hurled off the feet.
      {
        t: 0.2,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 1.0, shoulderRZ: 1.0,
          elbowL: 0.2, elbowR: 0.2, torsoX: -0.8, hipLX: -1.0, hipRX: -1.0, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: -0.6, up: 0.4 },
      },
      // Tumbling through the air.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -2.0, shoulderLZ: 0.9, shoulderRZ: 0.6,
          elbowL: 0.4, elbowR: 0.3, torsoX: -1.1, hipLX: -1.3, hipRX: -0.9, kneeL: 0.9, kneeR: 0.5,
        },
        move: { forward: -1.2, up: 0.5 },
      },
      // Crash down.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.4, torsoX: -1.3, hipLX: -1.5, hipRX: -1.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: -1.7, up: -0.4 },
      },
      // Sprawled, held.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, shoulderLZ: 0.8, shoulderRZ: 0.8,
          elbowL: 0.3, elbowR: 0.3, torsoX: -1.3, hipLX: -1.4, hipRX: -1.4, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: -1.9, up: -0.55 },
      },
    ],
  },
  {
    id: 'dragged-by-feet',
    name: 'Dragged by the Feet',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Prone on the back, arms trailing overhead.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.4, elbowR: 0.4, torsoX: -1.3, headX: 0.3,
          hipLX: -1.2, hipRX: -1.2, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 0.0, up: -0.5 },
      },
      // Slide forward, body jostling.
      {
        t: 0.5,
        joints: {
          shoulderLX: -2.3, shoulderRX: -2.1, shoulderLZ: 0.7, shoulderRZ: 0.5,
          elbowL: 0.5, elbowR: 0.4, torsoX: -1.3, headX: 0.4,
          hipLX: -1.3, hipRX: -1.1, kneeL: 0.6, kneeR: 0.4,
        },
        move: { forward: 0.5, up: -0.5 },
      },
      // Slide, jostle the other way.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.1, shoulderRX: -2.3, shoulderLZ: 0.5, shoulderRZ: 0.7,
          elbowL: 0.4, elbowR: 0.5, torsoX: -1.3, headX: 0.2,
          hipLX: -1.1, hipRX: -1.3, kneeL: 0.4, kneeR: 0.6,
        },
        move: { forward: 1.0, up: -0.5 },
      },
      // Still being dragged.
      {
        t: 1.4,
        joints: {
          shoulderLX: -2.2, shoulderRX: -2.2, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.4, elbowR: 0.4, torsoX: -1.3, headX: 0.3,
          hipLX: -1.2, hipRX: -1.2, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 1.4, up: -0.5 },
      },
    ],
  },
  {
    id: 'hang-from-ledge',
    name: 'Hang from Ledge',
    category: 'stunt',
    duration: 2.2,
    loop: true,
    keyframes: [
      // Hanging by both hands, sway right.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, torsoZ: 0.1,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.2,
        },
        move: { up: 0.4 },
      },
      // Sway left.
      {
        t: 1.1,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, torsoZ: -0.1,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.3,
        },
        move: { up: 0.4 },
      },
      // Loop.
      {
        t: 2.2,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, torsoZ: 0.1,
          hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.2,
        },
        move: { up: 0.4 },
      },
    ],
  },
  {
    id: 'climb-up-ledge',
    name: 'Climb Up Ledge',
    category: 'stunt',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Hanging.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
        move: { up: 0.4, forward: 0.0 },
      },
      // Pull up — elbows bend hard, chin over the ledge.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, hipLX: 0.2, hipRX: 0.2, kneeL: 0.6, kneeR: 0.6,
        },
        move: { up: 0.8, forward: 0.1 },
      },
      // Knee up onto the ledge, press.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.6, hipLX: -0.9, hipRX: 0.3, kneeL: 1.3, kneeR: 0.9,
        },
        move: { up: 1.0, forward: 0.3 },
      },
      // Rise up onto the ledge.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.3, hipLX: 0.2, hipRX: 0.2, kneeL: 0.5, kneeR: 0.5,
        },
        move: { up: 1.1, forward: 0.5 },
      },
      // Stand.
      {
        t: 2.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 1.1, forward: 0.6 },
      },
    ],
  },
  {
    id: 'vault-obstacle',
    name: 'Vault Obstacle',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Approach crouch.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.4, hipLX: 0.3, hipRX: 0.3, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Hands plant, hips rise, legs tuck to the side.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.8, hipLX: 0.8, hipRX: 0.8, kneeL: 1.6, kneeR: 1.6,
        },
        move: { forward: 0.4, up: 0.5 },
      },
      // Over the top, body swept across.
      {
        t: 0.65,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.6, hipLX: -0.4, hipRX: -0.4, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 0.9, up: 0.6 },
      },
      // Land the far side, absorb.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.4, hipLX: 0.5, hipRX: 0.5, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: 1.3, up: 0.1 },
      },
      // Stand.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 1.5, up: 0.0 },
      },
    ],
  },
  {
    id: 'slide-feet-first',
    name: 'Slide (Feet First)',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Running.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.2, hipLX: 0.4, hipRX: -0.4, kneeL: 0.4, kneeR: 0.5,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Drop into the slide — lead leg extends, torso leans back.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 0.4, elbowR: 0.4,
          torsoX: -0.4, hipLX: -1.2, hipRX: -0.3, kneeL: 0.2, kneeR: 1.3,
        },
        move: { forward: 0.6, up: -0.35 },
      },
      // Sliding low.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.4, elbowR: 0.4,
          torsoX: -0.6, hipLX: -1.4, hipRX: -0.2, kneeL: 0.1, kneeR: 1.4,
        },
        move: { forward: 1.2, up: -0.5 },
      },
      // Slide slows.
      {
        t: 1.1,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 0.5, elbowR: 0.5,
          torsoX: -0.5, hipLX: -1.2, hipRX: -0.1, kneeL: 0.2, kneeR: 1.3,
        },
        move: { forward: 1.5, up: -0.5 },
      },
      // Held low.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 0.5, elbowR: 0.5,
          torsoX: -0.5, hipLX: -1.2, hipRX: -0.1, kneeL: 0.2, kneeR: 1.3,
        },
        move: { forward: 1.6, up: -0.5 },
      },
    ],
  },
  {
    id: 'slide-under',
    name: 'Slide Under',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Running crouch.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.3, hipLX: 0.3, hipRX: -0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Drop onto the back, sliding under.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 0.4, elbowR: 0.4,
          torsoX: -0.9, hipLX: -1.0, hipRX: -1.0, kneeL: 0.7, kneeR: 0.7,
        },
        move: { forward: 0.6, up: -0.5 },
      },
      // Flat, sliding under the gap.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 0.3, elbowR: 0.3,
          torsoX: -1.2, hipLX: -1.2, hipRX: -1.2, kneeL: 0.5, kneeR: 0.5,
        },
        move: { forward: 1.2, up: -0.55 },
      },
      // Come up out the far side.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 0.9, elbowR: 0.9,
          torsoX: 0.4, hipLX: -0.3, hipRX: 0.6, kneeL: 0.9, kneeR: 1.2,
        },
        move: { forward: 1.6, up: -0.1 },
      },
      // Stand.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 1.8, up: 0.0 },
      },
    ],
  },
  {
    id: 'leap-gap',
    name: 'Leap the Gap',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Running.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.25, hipLX: 0.5, hipRX: -0.5, kneeL: 0.4, kneeR: 0.6,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Takeoff — drive the knee up, arms reach forward.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.4, hipLX: -0.9, hipRX: 0.4, kneeL: 1.4, kneeR: 0.4,
        },
        move: { forward: 0.5, up: 0.5 },
      },
      // Peak — stretched across the gap.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.5, hipLX: -0.6, hipRX: 0.5, kneeL: 0.8, kneeR: 0.6,
        },
        move: { forward: 1.3, up: 0.7 },
      },
      // Landing — legs down to absorb.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.4, hipLX: 0.5, hipRX: 0.5, kneeL: 1.0, kneeR: 1.0,
        },
        move: { forward: 2.0, up: 0.1 },
      },
      // Stand.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 2.2, up: 0.0 },
      },
    ],
  },
  {
    id: 'hard-landing-crouch',
    name: 'Hard Landing (Crouch)',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Airborne, legs coming down, arms out.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.3, hipLX: -0.2, hipRX: -0.2, kneeL: 0.5, kneeR: 0.5,
        },
        move: { up: 0.8 },
      },
      // Impact — deep three-point crouch, one hand to the ground.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.4, shoulderRX: 0.6, elbowL: 0.6, elbowR: 0.3,
          torsoX: 0.7, hipLX: 0.8, hipRX: 0.8, kneeL: 1.6, kneeR: 1.6,
        },
        move: { up: 0.0 },
      },
      // Hold the landing.
      {
        t: 0.5,
        joints: {
          shoulderLX: -0.4, shoulderRX: 0.6, elbowL: 0.6, elbowR: 0.2,
          torsoX: 0.7, hipLX: 0.8, hipRX: 0.8, kneeL: 1.6, kneeR: 1.6,
        },
        move: { up: 0.0 },
      },
      // Rise.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.3, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { up: 0.0 },
      },
      // Stand tall.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'stagger-explosion-shield',
    name: 'Shielded Blast Stagger',
    category: 'stunt',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Shield up, braced.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, headX: 0.1, hipLX: 0.1, hipRX: 0.2, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: 0.0 },
      },
      // Blast — driven back, dig in behind the shield.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 2.1, elbowR: 2.1,
          torsoX: 0.5, headX: 0.25, hipLX: 0.5, hipRX: 0.6, kneeL: 0.9, kneeR: 0.8,
        },
        move: { forward: -0.4 },
      },
      // Skid back a step, shield still up.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.4, headX: 0.15, hipLX: 0.3, hipRX: 0.5, kneeL: 0.7, kneeR: 0.6,
        },
        move: { forward: -0.8 },
      },
      // Recover, weight forward.
      {
        t: 1.1,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, headX: 0.1, hipLX: 0.1, hipRX: 0.2, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: -0.7 },
      },
      // Braced again.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.3, headX: 0.1, hipLX: 0.1, hipRX: 0.2, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: -0.7 },
      },
    ],
  },
  {
    id: 'crawl-fast-military',
    name: 'Fast Military Crawl',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Low — left arm reaches, right knee drives up.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.0, shoulderRX: -0.6, elbowL: 0.8, elbowR: 1.6,
          torsoX: 1.3, headX: 0.1, hipLX: 0.2, hipRX: 0.9, kneeL: 0.3, kneeR: 1.6,
        },
        move: { forward: 0.0, up: -0.4 },
      },
      // Pull through center.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, elbowL: 1.2, elbowR: 1.2,
          torsoX: 1.3, headX: 0.15, hipLX: 0.5, hipRX: 0.5, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: 0.3, up: -0.4 },
      },
      // Right arm reaches, left knee drives up.
      {
        t: 0.7,
        joints: {
          shoulderLX: -0.6, shoulderRX: -2.0, elbowL: 1.6, elbowR: 0.8,
          torsoX: 1.3, headX: 0.1, hipLX: 0.9, hipRX: 0.2, kneeL: 1.6, kneeR: 0.3,
        },
        move: { forward: 0.6, up: -0.4 },
      },
      // Pull through center.
      {
        t: 1.05,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.3, elbowL: 1.2, elbowR: 1.2,
          torsoX: 1.3, headX: 0.15, hipLX: 0.5, hipRX: 0.5, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: 0.9, up: -0.4 },
      },
      // Left arm reaches again.
      {
        t: 1.4,
        joints: {
          shoulderLX: -2.0, shoulderRX: -0.6, elbowL: 0.8, elbowR: 1.6,
          torsoX: 1.3, headX: 0.1, hipLX: 0.2, hipRX: 0.9, kneeL: 0.3, kneeR: 1.6,
        },
        move: { forward: 1.2, up: -0.4 },
      },
    ],
  },
  {
    id: 'wall-press-peek',
    name: 'Wall Press & Peek',
    category: 'stunt',
    duration: 3.0,
    loop: true,
    keyframes: [
      // Pressed flat to the wall, arms tucked.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 1.4, elbowR: 1.4,
          torsoY: 0.0, headY: 0.0, torsoZ: 0.0,
        },
      },
      // Lean out to peek around the corner.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.3, elbowR: 1.3,
          torsoY: -0.3, headY: -0.4, torsoZ: 0.25,
        },
      },
      // Hold the peek.
      {
        t: 1.5,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 1.3, elbowR: 1.3,
          torsoY: -0.3, headY: -0.4, torsoZ: 0.25,
        },
      },
      // Pull back against the wall.
      {
        t: 2.2,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 1.4, elbowR: 1.4,
          torsoY: 0.0, headY: 0.0, torsoZ: 0.0,
        },
      },
      // Loop.
      {
        t: 3.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 1.4, elbowR: 1.4,
          torsoY: 0.0, headY: 0.0, torsoZ: 0.0,
        },
      },
    ],
  },
  {
    id: 'sprint-skid-stop',
    name: 'Sprint Skid Stop',
    category: 'stunt',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Sprinting.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.3, hipLX: 0.7, hipRX: -0.7, kneeL: 0.5, kneeR: 0.8,
        },
        move: { forward: 0.0 },
      },
      // Next stride.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.3, hipLX: -0.7, hipRX: 0.7, kneeL: 0.8, kneeR: 0.5,
        },
        move: { forward: 0.7 },
      },
      // Plant and skid — lean back, arms fly forward.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, elbowL: 0.5, elbowR: 0.5,
          torsoX: -0.3, hipLX: -0.9, hipRX: 0.4, kneeL: 0.4, kneeR: 0.9,
        },
        move: { forward: 1.2 },
      },
      // Skidding to a stop.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 0.6, elbowR: 0.6,
          torsoX: -0.1, hipLX: -0.4, hipRX: 0.3, kneeL: 0.5, kneeR: 0.6,
        },
        move: { forward: 1.5 },
      },
      // Settle.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 1.6 },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // SPORT — athletic actions and exercise
  // -------------------------------------------------------------------------
  {
    id: 'basketball-shoot',
    name: 'Basketball Jump Shot',
    category: 'sport',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Set, ball at the chest.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.2, hipLX: 0.3, hipRX: 0.3, kneeL: 0.6, kneeR: 0.6,
        },
        move: { up: 0.0 },
      },
      // Rise, ball to the set point.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, elbowL: 2.0, elbowR: 2.0,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
        move: { up: 0.15 },
      },
      // Release — arms extend up and flick.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.0, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
        move: { up: 0.3 },
      },
      // Follow-through, landing.
      {
        t: 0.85,
        joints: {
          shoulderLX: -2.5, shoulderRX: -2.5, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.2, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
        move: { up: 0.05 },
      },
      // Settle.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'basketball-layup',
    name: 'Basketball Layup',
    category: 'sport',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Driving step.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.0, elbowR: 1.4,
          torsoX: 0.3, hipLX: 0.5, hipRX: -0.5, kneeL: 0.5, kneeR: 0.7,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Gather and plant, knee drives up.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.0, elbowL: 1.4, elbowR: 1.6,
          torsoX: 0.2, hipLX: -1.0, hipRX: 0.4, kneeL: 1.4, kneeR: 0.4,
        },
        move: { forward: 0.4, up: 0.3 },
      },
      // Extend up to lay it in.
      {
        t: 0.65,
        joints: {
          shoulderLX: -1.6, shoulderRX: -2.7, elbowL: 1.4, elbowR: 0.3,
          torsoX: 0.1, hipLX: -0.6, hipRX: 0.3, kneeL: 1.0, kneeR: 0.4,
        },
        move: { forward: 0.6, up: 0.6 },
      },
      // Land, absorb.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.3, hipLX: 0.4, hipRX: 0.4, kneeL: 0.9, kneeR: 0.9,
        },
        move: { forward: 0.9, up: 0.1 },
      },
      // Settle.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { forward: 1.0, up: 0.0 },
      },
    ],
  },
  {
    id: 'soccer-kick',
    name: 'Soccer Kick',
    category: 'sport',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Approach.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, hipLX: 0.2, hipRX: -0.3, kneeL: 0.2, kneeR: 0.4,
        },
        move: { forward: 0.0 },
      },
      // Plant, wind the kicking leg back, arms out for balance.
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.15, hipLX: 0.1, hipRX: 0.6, kneeL: 0.4, kneeR: 1.0,
        },
        move: { forward: 0.2 },
      },
      // Swing through — leg whips forward, torso leans back.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.5, shoulderLZ: 0.6, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: -0.1, hipLX: 0.2, hipRX: -1.3, kneeL: 0.3, kneeR: 0.15,
        },
        move: { forward: 0.3 },
      },
      // Follow-through.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.5, shoulderLZ: 0.5, shoulderRZ: 0.4,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.0, hipLX: 0.2, hipRX: -1.5, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: 0.4 },
      },
      // Recover.
      {
        t: 1.1,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.5, elbowR: 0.5, torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0.5 },
      },
    ],
  },
  {
    id: 'goal-celebration',
    name: 'Goal Celebration',
    category: 'sport',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Arms thrown out wide, running off.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.2, shoulderLZ: 1.0, shoulderRZ: 1.0,
          elbowL: 0.2, elbowR: 0.2, torsoX: -0.1, headX: -0.2,
          hipLX: 0.4, hipRX: -0.4, kneeL: 0.4, kneeR: 0.5,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Arms up, elated.
      {
        t: 0.5,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 0.7, shoulderRZ: 0.7,
          elbowL: 0.2, elbowR: 0.2, torsoX: -0.15, headX: -0.3,
          hipLX: -0.4, hipRX: 0.4, kneeL: 0.5, kneeR: 0.4,
        },
        move: { forward: 0.6, up: 0.0 },
      },
      // Drop into a knee slide, arms wide.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.3, elbowR: 0.3, torsoX: -0.2, headX: -0.35,
          hipLX: -0.9, hipRX: 0.2, kneeL: 1.6, kneeR: 1.0,
        },
        move: { forward: 1.2, up: -0.3 },
      },
      // Held celebration slide.
      {
        t: 1.6,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 0.2, elbowR: 0.2, torsoX: -0.2, headX: -0.3,
          hipLX: -1.0, hipRX: 0.2, kneeL: 1.7, kneeR: 1.1,
        },
        move: { forward: 1.5, up: -0.3 },
      },
    ],
  },
  {
    id: 'golf-swing',
    name: 'Golf Swing',
    category: 'sport',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Address — hands low in front, torso tilted over the ball.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.8, shoulderRX: -1.0, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.9, elbowR: 0.7, torsoX: 0.4, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1,
        },
      },
      // Backswing — arms up to the right, big coil.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.2, shoulderRX: -2.0, shoulderLZ: 0.5, shoulderRZ: 0.6,
          elbowL: 1.6, elbowR: 0.9, torsoX: 0.3, torsoY: 0.9, hipLX: 0.0, hipRX: 0.2,
        },
      },
      // Impact — whip down through the ball, torso unwinds.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -0.9, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.7, elbowR: 0.9, torsoX: 0.35, torsoY: -0.6, hipLX: 0.2, hipRX: 0.0,
        },
      },
      // Follow-through — arms up to the left, fully rotated.
      {
        t: 1.4,
        joints: {
          shoulderLX: -2.2, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.5,
          elbowL: 1.4, elbowR: 1.8, torsoX: 0.15, torsoY: -1.1, hipLX: 0.2, hipRX: -0.1,
        },
      },
      // Hold the finish.
      {
        t: 1.8,
        joints: {
          shoulderLX: -2.2, shoulderRX: -1.4, shoulderLZ: 0.6, shoulderRZ: 0.5,
          elbowL: 1.5, elbowR: 1.9, torsoX: 0.1, torsoY: -1.1, hipLX: 0.2, hipRX: -0.1,
        },
      },
    ],
  },
  {
    id: 'tennis-serve',
    name: 'Tennis Serve',
    category: 'sport',
    duration: 1.8,
    loop: false,
    keyframes: [
      // Ready, hands together to toss.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.9, elbowR: 0.9, torsoX: 0.1, torsoY: 0.0, headX: 0.0,
        },
        move: { up: 0.0 },
      },
      // Toss — left arm up high, racquet drops behind (trophy pose).
      {
        t: 0.5,
        joints: {
          shoulderLX: -2.6, shoulderRX: -0.3, shoulderLZ: 0.4, shoulderRZ: 0.7,
          elbowL: 0.2, elbowR: 2.2, torsoX: -0.1, torsoY: 0.2, headX: -0.15,
        },
        move: { up: 0.0 },
      },
      // Explode up to contact, rising onto the toes.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.4, shoulderRX: -2.7, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 1.4, elbowR: 0.2, torsoX: -0.2, torsoY: -0.3, headX: -0.1,
        },
        move: { up: 0.15 },
      },
      // Follow-through — racquet sweeps down across the body.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.9, elbowR: 1.2, torsoX: 0.3, torsoY: -0.6, headX: 0.1,
        },
        move: { up: 0.0 },
      },
      // Recover.
      {
        t: 1.8,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.6, elbowR: 0.6, torsoX: 0.15, torsoY: 0.0, headX: 0.0,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'tennis-forehand',
    name: 'Tennis Forehand',
    category: 'sport',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Ready split.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderRZ: 0.2, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1,
        },
      },
      // Turn and take the racquet back.
      {
        t: 0.35,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.6, shoulderRZ: 0.5, elbowL: 1.0, elbowR: 1.3,
          torsoX: 0.15, torsoY: 0.7, hipLX: 0.0, hipRX: 0.2,
        },
      },
      // Swing through — low to high, torso unwinds.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.4, shoulderRZ: 0.6, elbowL: 1.0, elbowR: 0.5,
          torsoX: 0.1, torsoY: -0.5, hipLX: 0.2, hipRX: 0.0,
        },
      },
      // Follow-through over the shoulder.
      {
        t: 0.85,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.8, shoulderRZ: 0.4, elbowL: 1.0, elbowR: 1.4,
          torsoX: 0.1, torsoY: -0.8, hipLX: 0.2, hipRX: -0.1,
        },
      },
      // Recover.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, shoulderRZ: 0.2, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.15, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1,
        },
      },
    ],
  },
  {
    id: 'baseball-swing',
    name: 'Baseball Swing',
    category: 'sport',
    duration: 1.1,
    loop: false,
    keyframes: [
      // Stance, bat cocked over the back shoulder.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.5, elbowL: 1.4, elbowR: 1.2,
          torsoX: 0.15, torsoY: 0.5, hipLX: 0.1, hipRX: 0.2,
        },
      },
      // Load — small coil back.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.6, elbowL: 1.5, elbowR: 1.3,
          torsoX: 0.15, torsoY: 0.7, hipLX: 0.0, hipRX: 0.3,
        },
      },
      // Swing — level rip through the zone, hips fire.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.7, elbowL: 0.7, elbowR: 0.6,
          torsoX: 0.2, torsoY: -0.7, hipLX: 0.3, hipRX: -0.2,
        },
      },
      // Follow-through — bat wraps around.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.4, shoulderRX: -0.6, elbowL: 1.6, elbowR: 1.0,
          torsoX: 0.15, torsoY: -1.1, hipLX: 0.2, hipRX: -0.2,
        },
      },
      // Recover.
      {
        t: 1.1,
        joints: {
          shoulderLX: -1.3, shoulderRX: -1.5, elbowL: 1.4, elbowR: 1.2,
          torsoX: 0.15, torsoY: 0.5, hipLX: 0.1, hipRX: 0.2,
        },
      },
    ],
  },
  {
    id: 'baseball-pitch',
    name: 'Baseball Pitch',
    category: 'sport',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Set.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 1.0, elbowR: 1.0,
          torsoX: 0.1, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: 0.0 },
      },
      // Leg-lift windup — knee high, hands together, coil.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.1, torsoY: 0.3, hipLX: -1.2, hipRX: 0.2, kneeL: 1.5, kneeR: 0.4,
        },
        move: { forward: 0.0 },
      },
      // Stride and cock — throwing arm back, torso opens.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.4, shoulderRX: 0.4, elbowL: 1.2, elbowR: 2.0,
          torsoX: 0.15, torsoY: 0.7, hipLX: -0.6, hipRX: 0.4, kneeL: 0.4, kneeR: 0.5,
        },
        move: { forward: 0.3 },
      },
      // Release — arm whips over the top, torso drives forward.
      {
        t: 0.95,
        joints: {
          shoulderLX: -0.6, shoulderRX: -2.5, elbowL: 0.6, elbowR: 0.3,
          torsoX: 0.5, torsoY: -0.5, hipLX: 0.4, hipRX: -0.4, kneeL: 0.7, kneeR: 0.5,
        },
        move: { forward: 0.6 },
      },
      // Follow-through.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.2, elbowL: 0.6, elbowR: 1.0,
          torsoX: 0.6, torsoY: -0.7, hipLX: 0.5, hipRX: 0.3, kneeL: 0.9, kneeR: 0.5,
        },
        move: { forward: 0.7 },
      },
    ],
  },
  {
    id: 'bowling-throw',
    name: 'Bowling Throw',
    category: 'sport',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Ready, ball up in front.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.8, elbowR: 1.6, torsoX: 0.2,
          hipLX: 0.2, hipRX: 0.2, kneeL: 0.4, kneeR: 0.4,
        },
        move: { forward: 0.0 },
      },
      // Push away, arm swings back.
      {
        t: 0.4,
        joints: {
          shoulderRX: 0.6, elbowR: 0.6, torsoX: 0.3,
          hipLX: 0.3, hipRX: -0.3, kneeL: 0.5, kneeR: 0.6,
        },
        move: { forward: 0.2 },
      },
      // Backswing peak — arm high behind.
      {
        t: 0.8,
        joints: {
          shoulderRX: 1.0, elbowR: 0.3, torsoX: 0.4,
          hipLX: -0.5, hipRX: 0.5, kneeL: 0.4, kneeR: 1.0,
        },
        move: { forward: 0.4 },
      },
      // Downswing and release low, sliding into it.
      {
        t: 1.1,
        joints: {
          shoulderRX: -1.4, elbowR: 0.3, torsoX: 0.5,
          hipLX: -0.9, hipRX: 0.4, kneeL: 1.2, kneeR: 0.5,
        },
        move: { forward: 0.9 },
      },
      // Follow-through up.
      {
        t: 1.6,
        joints: {
          shoulderRX: -2.0, elbowR: 0.4, torsoX: 0.3,
          hipLX: -0.6, hipRX: 0.3, kneeL: 0.9, kneeR: 0.5,
        },
        move: { forward: 1.1 },
      },
    ],
  },
  {
    id: 'jumping-jacks',
    name: 'Jumping Jacks',
    category: 'sport',
    duration: 1.0,
    loop: true,
    keyframes: [
      // Out — arms overhead, legs wide.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.7, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.1, elbowR: 0.1, hipLZ: 0.4, hipRZ: 0.4, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.05 },
      },
      // In — arms at sides, feet together.
      {
        t: 0.25,
        joints: {
          shoulderLX: -0.1, shoulderRX: -0.1, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.1, elbowR: 0.1, hipLZ: 0.0, hipRZ: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { up: 0.0 },
      },
      // Out.
      {
        t: 0.5,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.7, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.1, elbowR: 0.1, hipLZ: 0.4, hipRZ: 0.4, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.05 },
      },
      // In.
      {
        t: 0.75,
        joints: {
          shoulderLX: -0.1, shoulderRX: -0.1, shoulderLZ: 0.1, shoulderRZ: 0.1,
          elbowL: 0.1, elbowR: 0.1, hipLZ: 0.0, hipRZ: 0.0, kneeL: 0.15, kneeR: 0.15,
        },
        move: { up: 0.0 },
      },
      // Loop.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.7, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.1, elbowR: 0.1, hipLZ: 0.4, hipRZ: 0.4, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.05 },
      },
    ],
  },
  {
    id: 'push-ups',
    name: 'Push-Ups',
    category: 'sport',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Top of the push-up, arms straight, body in a plank.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoX: 1.4, hipLX: 0.1, hipRX: 0.1, kneeL: 0.05, kneeR: 0.05,
        },
        move: { up: 0.3 },
      },
      // Lower — elbows bend, chest toward the floor.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.4, elbowR: 1.4, torsoX: 1.4, hipLX: 0.1, hipRX: 0.1, kneeL: 0.05, kneeR: 0.05,
        },
        move: { up: 0.15 },
      },
      // Push up.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoX: 1.4, hipLX: 0.1, hipRX: 0.1, kneeL: 0.05, kneeR: 0.05,
        },
        move: { up: 0.3 },
      },
      // Lower.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.4, shoulderRX: -1.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.4, elbowR: 1.4, torsoX: 1.4, hipLX: 0.1, hipRX: 0.1, kneeL: 0.05, kneeR: 0.05,
        },
        move: { up: 0.15 },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 0.1, elbowR: 0.1, torsoX: 1.4, hipLX: 0.1, hipRX: 0.1, kneeL: 0.05, kneeR: 0.05,
        },
        move: { up: 0.3 },
      },
    ],
  },
  {
    id: 'sit-ups',
    name: 'Sit-Ups',
    category: 'sport',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Reclined, knees up, hands behind the head.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, elbowL: 2.2, elbowR: 2.2,
          torsoX: -1.1, headX: 0.2, hipLX: -1.0, hipRX: -1.0, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.45 },
      },
      // Curl up.
      {
        t: 0.7,
        joints: {
          shoulderLX: -1.8, shoulderRX: -1.8, elbowL: 2.2, elbowR: 2.2,
          torsoX: 0.2, headX: 0.35, hipLX: -1.0, hipRX: -1.0, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.35 },
      },
      // Back down.
      {
        t: 1.4,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, elbowL: 2.2, elbowR: 2.2,
          torsoX: -1.1, headX: 0.2, hipLX: -1.0, hipRX: -1.0, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.45 },
      },
      // Loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -2.0, shoulderRX: -2.0, elbowL: 2.2, elbowR: 2.2,
          torsoX: -1.1, headX: 0.2, hipLX: -1.0, hipRX: -1.0, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.45 },
      },
    ],
  },
  {
    id: 'squat-exercise',
    name: 'Bodyweight Squat',
    category: 'sport',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Standing, arms forward for balance.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
      // Squat down.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.5, hipLX: 0.8, hipRX: 0.8, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.35 },
      },
      // Stand.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
      // Squat.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.5, hipLX: 0.8, hipRX: 0.8, kneeL: 1.4, kneeR: 1.4,
        },
        move: { up: -0.35 },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'boxing-bounce-drill',
    name: 'Boxing Bounce Drill',
    category: 'sport',
    duration: 1.2,
    loop: true,
    keyframes: [
      // Guard, bounce down.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Quick left jab.
      {
        t: 0.3,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, elbowL: 0.2, elbowR: 1.8,
          torsoX: 0.15, torsoY: -0.3, hipLX: 0.05, hipRX: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Back to guard bounce.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
      // Quick right cross.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, elbowL: 1.8, elbowR: 0.2,
          torsoX: 0.15, torsoY: 0.3, hipLX: 0.05, hipRX: 0.05, kneeL: 0.25, kneeR: 0.25,
        },
      },
      // Loop.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.2, torsoY: 0.0, hipLX: 0.1, hipRX: 0.1, kneeL: 0.4, kneeR: 0.4,
        },
      },
    ],
  },
  {
    id: 'weightlift-overhead-press',
    name: 'Overhead Press',
    category: 'sport',
    duration: 2.0,
    loop: true,
    keyframes: [
      // Bar racked at the shoulders.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.9, torsoX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Press up — arms extend overhead.
      {
        t: 0.6,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.15, elbowR: 0.15, torsoX: 0.05, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Hold locked out.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.65, shoulderRX: -2.65, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.1, elbowR: 0.1, torsoX: 0.05, kneeL: 0.1, kneeR: 0.1,
        },
      },
      // Lower to the shoulders.
      {
        t: 1.4,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.9, torsoX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
      // Loop.
      {
        t: 2.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.3, shoulderRZ: 0.3,
          elbowL: 1.9, elbowR: 1.9, torsoX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
      },
    ],
  },
  {
    id: 'frisbee-throw',
    name: 'Frisbee Throw',
    category: 'sport',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Ready, disc drawn across to the off hip.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.5, shoulderRZ: 0.0, elbowR: 1.8, torsoY: 0.4, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 0.0 },
      },
      // Wind further across, coil.
      {
        t: 0.3,
        joints: {
          shoulderRX: -0.4, shoulderRZ: 0.0, elbowR: 2.2, torsoY: 0.6, hipLX: 0.0, hipRX: 0.2,
        },
        move: { forward: 0.0 },
      },
      // Flick out — arm extends across, torso opens.
      {
        t: 0.55,
        joints: {
          shoulderRX: -1.2, shoulderRZ: 0.7, elbowR: 0.3, torsoY: -0.5, hipLX: 0.3, hipRX: -0.1,
        },
        move: { forward: 0.3 },
      },
      // Follow-through.
      {
        t: 0.75,
        joints: {
          shoulderRX: -1.3, shoulderRZ: 0.9, elbowR: 0.5, torsoY: -0.7, hipLX: 0.3, hipRX: -0.1,
        },
        move: { forward: 0.4 },
      },
      // Recover.
      {
        t: 1.0,
        joints: {
          shoulderRX: -0.5, shoulderRZ: 0.0, elbowR: 0.6, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
        move: { forward: 0.5 },
      },
    ],
  },
  {
    id: 'swim-freestyle',
    name: 'Swim (Freestyle)',
    category: 'sport',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Prone and horizontal — left arm pulls overhead, right recovers, flutter kick.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.6, shoulderRX: -0.6, elbowL: 0.4, elbowR: 1.2,
          torsoX: 1.4, headX: 0.1, hipLX: -0.2, hipRX: 0.2, kneeL: 0.3, kneeR: 0.2,
        },
        move: { forward: 0.0, up: -0.3 },
      },
      // Glide, arms passing.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.6, elbowR: 0.6,
          torsoX: 1.4, headX: 0.15, hipLX: 0.2, hipRX: -0.2, kneeL: 0.2, kneeR: 0.3,
        },
        move: { forward: 0.4, up: -0.3 },
      },
      // Right arm pulls, left recovers.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.6, shoulderRX: -2.6, elbowL: 1.2, elbowR: 0.4,
          torsoX: 1.4, headX: 0.1, hipLX: 0.2, hipRX: -0.2, kneeL: 0.3, kneeR: 0.2,
        },
        move: { forward: 0.8, up: -0.3 },
      },
      // Glide.
      {
        t: 1.5,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, elbowL: 0.6, elbowR: 0.6,
          torsoX: 1.4, headX: 0.15, hipLX: -0.2, hipRX: 0.2, kneeL: 0.2, kneeR: 0.3,
        },
        move: { forward: 1.2, up: -0.3 },
      },
      // Left arm pulls again.
      {
        t: 2.0,
        joints: {
          shoulderLX: -2.6, shoulderRX: -0.6, elbowL: 0.4, elbowR: 1.2,
          torsoX: 1.4, headX: 0.1, hipLX: -0.2, hipRX: 0.2, kneeL: 0.3, kneeR: 0.2,
        },
        move: { forward: 1.6, up: -0.3 },
      },
    ],
  },

  // -------------------------------------------------------------------------
  // EXTRA VARIANTS — additional combos and moves across categories
  // -------------------------------------------------------------------------
  {
    id: 'jab-hook-cross',
    name: 'Jab / Hook / Cross',
    category: 'fight',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
      // Jab (left straight).
      {
        t: 0.25,
        joints: {
          shoulderLX: -1.5, shoulderRX: -0.9, shoulderLZ: 0.1,
          elbowL: 0.15, elbowR: 1.8, torsoX: 0.15, torsoY: -0.3,
        },
      },
      // Left hook.
      {
        t: 0.5,
        joints: {
          shoulderLX: -1.4, shoulderRX: -0.9, shoulderLZ: 0.9,
          elbowL: 1.4, elbowR: 1.8, torsoX: 0.2, torsoY: -0.6,
        },
      },
      // Right cross.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.9, shoulderRX: -1.5, shoulderLZ: 0.1,
          elbowL: 1.8, elbowR: 0.15, torsoX: 0.15, torsoY: 0.5,
        },
      },
      // Recover to guard.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, shoulderLZ: 0.1,
          elbowL: 1.8, elbowR: 1.8, torsoX: 0.15, torsoY: 0.0,
        },
      },
    ],
  },
  {
    id: 'teep-push-kick',
    name: 'Teep (Push Kick)',
    category: 'fight',
    duration: 1.0,
    loop: false,
    keyframes: [
      // Guard.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
      // Chamber the knee.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.0, hipLX: 0.05, hipRX: -1.1, kneeL: 0.1, kneeR: 1.5,
        },
      },
      // Thrust the foot straight out, torso leans back.
      {
        t: 0.55,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 1.5, elbowR: 1.5,
          torsoX: -0.3, hipLX: 0.1, hipRX: -1.4, kneeL: 0.15, kneeR: 0.3,
        },
      },
      // Re-chamber.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.7, shoulderRX: -0.7, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.0, hipLX: 0.05, hipRX: -1.1, kneeL: 0.1, kneeR: 1.5,
        },
      },
      // Recover to guard.
      {
        t: 1.0,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.15, hipLX: 0.0, hipRX: 0.0, kneeL: 0.0, kneeR: 0.0,
        },
      },
    ],
  },
  {
    id: 'kick-ball-change',
    name: 'Kick Ball Change',
    category: 'dance',
    duration: 0.8,
    loop: true,
    keyframes: [
      // Right foot kicks forward low.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.1, hipRX: -0.6, kneeL: 0.2, kneeR: 0.3,
        },
      },
      // Ball step back on the right toe.
      {
        t: 0.2,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.4, kneeL: 0.3, kneeR: 0.5,
        },
      },
      // Change weight onto the left.
      {
        t: 0.4,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.3, hipRX: 0.0, kneeL: 0.4, kneeR: 0.3,
        },
      },
      // Recenter.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Loop.
      {
        t: 0.8,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.8, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.1, hipRX: -0.6, kneeL: 0.2, kneeR: 0.3,
        },
      },
    ],
  },
  {
    id: 'jazz-square',
    name: 'Jazz Square',
    category: 'dance',
    duration: 1.6,
    loop: true,
    keyframes: [
      // Cross the right foot over.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoY: 0.2, hipLX: 0.0, hipRX: -0.3, kneeL: 0.3, kneeR: 0.4,
        },
      },
      // Step back on the left.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoY: -0.1, hipLX: 0.4, hipRX: 0.0, kneeL: 0.5, kneeR: 0.3,
        },
      },
      // Step the right foot out to the side.
      {
        t: 0.8,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoY: 0.0, hipLX: 0.0, hipRX: 0.2, kneeL: 0.3, kneeR: 0.3,
        },
      },
      // Step forward on the left to close the box.
      {
        t: 1.2,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoY: 0.1, hipLX: -0.3, hipRX: 0.0, kneeL: 0.4, kneeR: 0.3,
        },
      },
      // Loop.
      {
        t: 1.6,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.0, elbowR: 1.0, torsoY: 0.2, hipLX: 0.0, hipRX: -0.3, kneeL: 0.3, kneeR: 0.4,
        },
      },
    ],
  },
  {
    id: 'volleyball-spike',
    name: 'Volleyball Spike',
    category: 'sport',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Approach crouch, arms drawn back.
      {
        t: 0.0,
        joints: {
          shoulderLX: 0.4, shoulderRX: 0.4, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.3, hipLX: 0.5, hipRX: 0.5, kneeL: 0.9, kneeR: 0.9,
        },
        move: { up: 0.0 },
      },
      // Jump — arms swing up, reaching high.
      {
        t: 0.35,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, elbowL: 0.3, elbowR: 0.3,
          torsoX: -0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.4 },
      },
      // Spike — right arm whips down, torso snaps forward.
      {
        t: 0.6,
        joints: {
          shoulderLX: -1.4, shoulderRX: -0.2, elbowL: 1.0, elbowR: 0.2,
          torsoX: 0.5, hipLX: 0.1, hipRX: 0.1, kneeL: 0.2, kneeR: 0.2,
        },
        move: { up: 0.35 },
      },
      // Land.
      {
        t: 0.9,
        joints: {
          shoulderLX: -0.6, shoulderRX: -0.6, elbowL: 0.5, elbowR: 0.5,
          torsoX: 0.3, hipLX: 0.4, hipRX: 0.4, kneeL: 0.8, kneeR: 0.8,
        },
        move: { up: 0.05 },
      },
      // Stand.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, elbowL: 0.4, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'jump-rope',
    name: 'Jump Rope',
    category: 'sport',
    duration: 0.6,
    loop: true,
    keyframes: [
      // Landing, wrists mid-turn.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.4, elbowR: 1.4, kneeL: 0.4, kneeR: 0.4,
        },
        move: { up: 0.0 },
      },
      // Hop up, wrists turning the rope.
      {
        t: 0.3,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.5, elbowR: 1.5, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.12 },
      },
      // Loop.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 1.4, elbowR: 1.4, kneeL: 0.4, kneeR: 0.4,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'football-throw',
    name: 'Football Throw',
    category: 'sport',
    duration: 1.2,
    loop: false,
    keyframes: [
      // Ready, ball at the chest.
      {
        t: 0.0,
        joints: {
          shoulderLX: -1.0, shoulderRX: -1.0, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.1, torsoY: 0.0, hipLX: 0.1, hipRX: 0.2,
        },
        move: { forward: 0.0 },
      },
      // Cock back — ball up behind the ear.
      {
        t: 0.35,
        joints: {
          shoulderLX: -1.2, shoulderRX: -1.4, elbowL: 1.4, elbowR: 2.0,
          torsoX: 0.1, torsoY: 0.6, hipLX: 0.0, hipRX: 0.3,
        },
        move: { forward: 0.0 },
      },
      // Release — arm snaps forward overhead, step in.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.6, shoulderRX: -2.4, elbowL: 0.8, elbowR: 0.4,
          torsoX: 0.3, torsoY: -0.5, hipLX: -0.5, hipRX: 0.4,
        },
        move: { forward: 0.4 },
      },
      // Follow-through.
      {
        t: 0.85,
        joints: {
          shoulderLX: -0.5, shoulderRX: -1.3, elbowL: 0.6, elbowR: 0.9,
          torsoX: 0.4, torsoY: -0.7, hipLX: -0.3, hipRX: 0.4,
        },
        move: { forward: 0.5 },
      },
      // Recover.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.4, shoulderRX: -0.4, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.1, torsoY: 0.0, hipLX: 0.0, hipRX: 0.0,
        },
        move: { forward: 0.5 },
      },
    ],
  },
  {
    id: 'victory-flex',
    name: 'Victory Flex',
    category: 'sport',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Arms down.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.05,
        },
      },
      // Arms up into a double-biceps flex.
      {
        t: 0.4,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.9, shoulderRZ: 0.9,
          elbowL: 2.4, elbowR: 2.4, torsoX: 0.05,
        },
      },
      // Hold the flex.
      {
        t: 1.0,
        joints: {
          shoulderLX: -1.5, shoulderRX: -1.5, shoulderLZ: 0.95, shoulderRZ: 0.95,
          elbowL: 2.5, elbowR: 2.5, torsoX: 0.05,
        },
      },
      // Relax down.
      {
        t: 1.4,
        joints: {
          shoulderLX: -0.3, shoulderRX: -0.3, shoulderLZ: 0.2, shoulderRZ: 0.2,
          elbowL: 0.4, elbowR: 0.4, torsoX: 0.05,
        },
      },
    ],
  },
  {
    id: 'hail-taxi',
    name: 'Hail a Taxi',
    category: 'everyday',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: { shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, torsoX: 0.05 },
        move: { forward: 0.0 },
      },
      // Arm shoots up high, leaning out.
      {
        t: 0.4,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.3, elbowR: 0.2, torsoX: 0.1 },
        move: { forward: 0.2 },
      },
      // Hold, hailing.
      {
        t: 0.9,
        joints: { shoulderRX: -2.5, shoulderRZ: 0.35, elbowR: 0.15, torsoX: 0.1 },
        move: { forward: 0.2 },
      },
      // Lower.
      {
        t: 1.4,
        joints: { shoulderRX: -0.2, shoulderRZ: 0.1, elbowR: 0.3, torsoX: 0.05 },
        move: { forward: 0.2 },
      },
    ],
  },
  {
    id: 'reach-high-shelf',
    name: 'Reach High Shelf',
    category: 'everyday',
    duration: 1.6,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderRX: -0.3, shoulderRZ: 0.1, elbowR: 0.4, torsoX: 0.05, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
      // Reach up high, onto the toes.
      {
        t: 0.5,
        joints: {
          shoulderRX: -2.7, shoulderRZ: 0.3, elbowR: 0.1, torsoX: -0.05, kneeL: 0.0, kneeR: 0.0,
        },
        move: { up: 0.08 },
      },
      // Grasp, hold.
      {
        t: 0.9,
        joints: {
          shoulderRX: -2.6, shoulderRZ: 0.3, elbowR: 0.3, torsoX: -0.05, kneeL: 0.0, kneeR: 0.0,
        },
        move: { up: 0.08 },
      },
      // Bring it down.
      {
        t: 1.6,
        joints: {
          shoulderRX: -0.5, shoulderRZ: 0.2, elbowR: 1.6, torsoX: 0.1, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'kneel-tie-shoe',
    name: 'Kneel & Tie Shoe',
    category: 'everyday',
    duration: 2.4,
    loop: false,
    keyframes: [
      // Standing.
      {
        t: 0.0,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.05, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
      // Kneel down onto one knee.
      {
        t: 0.6,
        joints: {
          shoulderLX: -0.5, shoulderRX: -0.5, elbowL: 0.6, elbowR: 0.6,
          torsoX: 0.6, hipLX: -0.9, hipRX: 0.9, kneeL: 1.3, kneeR: 1.6,
        },
        move: { up: -0.35 },
      },
      // Work at the laces.
      {
        t: 1.2,
        joints: {
          shoulderLX: -0.9, shoulderRX: -0.9, elbowL: 1.8, elbowR: 1.8,
          torsoX: 0.8, hipLX: -0.8, hipRX: 0.9, kneeL: 1.3, kneeR: 1.6,
        },
        move: { up: -0.4 },
      },
      // Finish tying.
      {
        t: 1.6,
        joints: {
          shoulderLX: -0.8, shoulderRX: -0.8, elbowL: 1.6, elbowR: 1.6,
          torsoX: 0.8, hipLX: -0.8, hipRX: 0.9, kneeL: 1.3, kneeR: 1.6,
        },
        move: { up: -0.4 },
      },
      // Stand back up.
      {
        t: 2.4,
        joints: {
          shoulderLX: -0.2, shoulderRX: -0.2, elbowL: 0.3, elbowR: 0.3,
          torsoX: 0.05, hipLX: 0.0, hipRX: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { up: 0.0 },
      },
    ],
  },
  {
    id: 'cartwheel',
    name: 'Cartwheel',
    category: 'stunt',
    duration: 1.4,
    loop: false,
    keyframes: [
      // Stand, arms reaching up.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.2, elbowR: 0.2, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, hipLZ: 0.0, hipRZ: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 0.0, up: 0.0 },
      },
      // Reach down to the hands, legs begin to split up.
      {
        t: 0.35,
        joints: {
          shoulderLX: -2.6, shoulderRX: -2.6, shoulderLZ: 0.5, shoulderRZ: 0.5,
          elbowL: 0.2, elbowR: 0.2, torsoX: 1.2,
          hipLX: -0.6, hipRX: -0.9, hipLZ: 0.6, hipRZ: 0.6, kneeL: 0.3, kneeR: 0.3,
        },
        move: { forward: 0.4, up: 0.3 },
      },
      // Inverted, legs splayed overhead.
      {
        t: 0.7,
        joints: {
          shoulderLX: -2.8, shoulderRX: -2.8, shoulderLZ: 0.4, shoulderRZ: 0.4,
          elbowL: 0.1, elbowR: 0.1, torsoX: 1.5,
          hipLX: -1.2, hipRX: -1.2, hipLZ: 0.8, hipRZ: 0.8, kneeL: 0.2, kneeR: 0.2,
        },
        move: { forward: 0.8, up: 0.5 },
      },
      // Legs come down the far side.
      {
        t: 1.05,
        joints: {
          shoulderLX: -1.6, shoulderRX: -1.6, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.2, elbowR: 0.2, torsoX: 0.6,
          hipLX: -0.3, hipRX: 0.6, hipLZ: 0.4, hipRZ: 0.4, kneeL: 0.6, kneeR: 0.9,
        },
        move: { forward: 1.2, up: 0.1 },
      },
      // Stand back up.
      {
        t: 1.4,
        joints: {
          shoulderLX: -2.4, shoulderRX: -2.4, shoulderLZ: 0.6, shoulderRZ: 0.6,
          elbowL: 0.2, elbowR: 0.2, torsoX: 0.1,
          hipLX: 0.0, hipRX: 0.0, hipLZ: 0.0, hipRZ: 0.0, kneeL: 0.1, kneeR: 0.1,
        },
        move: { forward: 1.5, up: 0.0 },
      },
    ],
  },
  {
    id: 'ledge-shimmy',
    name: 'Ledge Shimmy',
    category: 'stunt',
    duration: 2.0,
    loop: false,
    keyframes: [
      // Hanging by both hands.
      {
        t: 0.0,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.7, elbowL: 0.5, elbowR: 0.8,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 0.0, up: 0.4 },
      },
      // Reach the lead hand out along the ledge.
      {
        t: 0.5,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, elbowL: 0.6, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 0.3, up: 0.4 },
      },
      // Bring the trailing hand across.
      {
        t: 1.0,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.9, elbowL: 0.8, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 0.6, up: 0.4 },
      },
      // Reach the lead hand again.
      {
        t: 1.5,
        joints: {
          shoulderLX: -2.9, shoulderRX: -2.9, elbowL: 0.6, elbowR: 0.4,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 0.9, up: 0.4 },
      },
      // Trailing hand across.
      {
        t: 2.0,
        joints: {
          shoulderLX: -2.7, shoulderRX: -2.9, elbowL: 0.8, elbowR: 0.5,
          torsoX: 0.1, hipLX: 0.1, hipRX: 0.1,
        },
        move: { forward: 1.2, up: 0.4 },
      },
    ],
  },
]
