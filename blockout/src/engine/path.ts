/**
 * Paths between marks: centripetal Catmull-Rom through
 * [previous mark, ...via points, next mark], arc-length parameterized so
 * easing maps to real distance, not parameter space.
 */

import type { V3 } from './types'

export function v3(x = 0, y = 0, z = 0): V3 {
  return { x, y, z }
}

export function dist(a: V3, b: V3): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

/**
 * Heading (yaw) of a horizontal direction. Convention: heading 0 faces -Z
 * and an object built facing -Z faces the heading when rotation.y = heading
 * (matches three.js Y-rotation: forward(θ) = (-sinθ, 0, -cosθ)).
 */
export function headingOf(dir: V3): number {
  return Math.atan2(-dir.x, -dir.z)
}

interface Segment {
  p0: V3
  p1: V3
  p2: V3
  p3: V3
}

function catmullRom(seg: Segment, t: number): V3 {
  // Centripetal parameterization (alpha = 0.5) avoids cusps/self-loops.
  const alpha = 0.5
  const { p0, p1, p2, p3 } = seg
  const d01 = Math.pow(Math.max(dist(p0, p1), 1e-6), alpha)
  const d12 = Math.pow(Math.max(dist(p1, p2), 1e-6), alpha)
  const d23 = Math.pow(Math.max(dist(p2, p3), 1e-6), alpha)

  const t0 = 0
  const t1 = t0 + d01
  const t2 = t1 + d12
  const t3 = t2 + d23
  const tt = t1 + (t2 - t1) * t

  const lerpV = (a: V3, b: V3, ta: number, tb: number, tv: number): V3 => {
    if (Math.abs(tb - ta) < 1e-9) return a
    const u = (tv - ta) / (tb - ta)
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u
    }
  }

  const a1 = lerpV(p0, p1, t0, t1, tt)
  const a2 = lerpV(p1, p2, t1, t2, tt)
  const a3 = lerpV(p2, p3, t2, t3, tt)
  const b1 = lerpV(a1, a2, t0, t2, tt)
  const b2 = lerpV(a2, a3, t1, t3, tt)
  return lerpV(b1, b2, t1, t2, tt)
}

export class Path {
  private points: V3[]
  private samples: V3[] = []
  private cumulative: number[] = []
  readonly length: number

  /**
   * @param points ordered control points the path passes through
   *               (departure mark, via…, arrival mark)
   */
  constructor(points: V3[], samplesPerSegment = 32) {
    this.points = points.length >= 2 ? points : [points[0] ?? v3(), points[0] ?? v3()]
    const pts = this.points
    const segs: Segment[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!
      const p2 = pts[i + 1]!
      const p0 = pts[i - 1] ?? { x: p1.x + (p1.x - p2.x), y: p1.y + (p1.y - p2.y), z: p1.z + (p1.z - p2.z) }
      const p3 = pts[i + 2] ?? { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y), z: p2.z + (p2.z - p1.z) }
      segs.push({ p0, p1, p2, p3 })
    }

    // Dense sampling → arc-length table.
    let acc = 0
    let prev: V3 | null = null
    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s]!
      const from = s === 0 ? 0 : 1 // avoid duplicating shared endpoints
      for (let k = from; k <= samplesPerSegment; k++) {
        const p = catmullRom(seg, k / samplesPerSegment)
        if (prev) acc += dist(prev, p)
        this.samples.push(p)
        this.cumulative.push(acc)
        prev = p
      }
    }
    this.length = acc
  }

  /** Point at a given distance along the path. */
  pointAt(distance: number): V3 {
    const d = Math.min(this.length, Math.max(0, distance))
    const cum = this.cumulative
    // binary search
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid]! < d) lo = mid + 1
      else hi = mid
    }
    const i = Math.max(1, lo)
    const d0 = cum[i - 1]!
    const d1 = cum[i]!
    const p0 = this.samples[i - 1]!
    const p1 = this.samples[i]!
    const u = d1 - d0 < 1e-9 ? 0 : (d - d0) / (d1 - d0)
    return {
      x: p0.x + (p1.x - p0.x) * u,
      y: p0.y + (p1.y - p0.y) * u,
      z: p0.z + (p1.z - p0.z) * u
    }
  }

  /** Travel heading at a distance (yaw of the tangent). */
  headingAt(distance: number): number {
    const eps = Math.max(this.length * 0.001, 0.01)
    const a = this.pointAt(Math.max(0, distance - eps))
    const b = this.pointAt(Math.min(this.length, distance + eps))
    const d = sub(b, a)
    if (Math.abs(d.x) < 1e-9 && Math.abs(d.z) < 1e-9) return 0
    return headingOf(d)
  }

  /** Dense polyline for rendering the path in the viewport / diagrams. */
  polyline(): V3[] {
    return this.samples
  }
}
