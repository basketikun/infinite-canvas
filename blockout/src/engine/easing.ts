/**
 * Travel easing. A move between two marks is reparameterized so the entity
 * accelerates out of the departure mark and decelerates into the arrival
 * mark, with the eased portions controlled per-mark (0..1 of the leg).
 */

/**
 * Piecewise ease: accelerate over [0, a], cruise, decelerate over [1-b, 1].
 * Input u = normalized time 0..1, output = normalized distance 0..1.
 * a and b are clamped so they never overlap.
 */
export function easedProgress(u: number, easeOut: number, easeIn: number): number {
  const total = easeOut + easeIn
  let a = easeOut
  let b = easeIn
  if (total > 0.98) {
    a = (easeOut / total) * 0.98
    b = (easeIn / total) * 0.98
  }
  u = Math.min(1, Math.max(0, u))

  // Peak (cruise) velocity chosen so distance integrates to 1:
  // area = a*v/2 + (1-a-b)*v + b*v/2 = v * (1 - a/2 - b/2) = 1
  const v = 1 / (1 - a / 2 - b / 2)

  if (u < a) {
    // quadratic ramp up
    return (v * u * u) / (2 * a)
  }
  if (u > 1 - b) {
    const w = 1 - u // time remaining
    return 1 - (v * w * w) / (2 * b)
  }
  return (v * a) / 2 + v * (u - a)
}

/** Smoothstep for orientation/lens blends between marks. */
export function smoothstep(u: number): number {
  u = Math.min(1, Math.max(0, u))
  return u * u * (3 - 2 * u)
}

/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a: number, b: number, u: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * u
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}
