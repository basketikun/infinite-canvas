import { Euler, LinearInterpolant, MathUtils, Quaternion, Vector3, type Vector3Tuple } from "three";
import { getBodyPreset, legDimensions } from "./bodyTypes";
import type { DirectorObject } from "../../schema/directorProject";

function solveLeg(target: Vector3, hipHeight: number, thigh: number, shin: number, footYaw: number) {
  const down = hipHeight - target.y;
  const vertical = Math.hypot(target.x, down);
  const reach = Math.hypot(vertical, target.z);
  const acos = (cos: number) => Math.acos(MathUtils.clamp(cos, -1, 1));
  const pitch = -Math.atan2(target.z, vertical) - acos((thigh ** 2 + reach ** 2 - shin ** 2) / (2 * thigh * reach));
  const bend = Math.PI - acos((thigh ** 2 + shin ** 2 - reach ** 2) / (2 * thigh * shin));
  const hip = new Euler(pitch, 0, Math.atan2(target.x, down), "ZXY").reorder("XYZ");
  const knee = new Euler(bend, 0, 0);
  // 抵消髋、膝的旋转，让支撑脚的鞋底保持水平。
  const ankle = new Quaternion().setFromEuler(hip).multiply(new Quaternion().setFromEuler(knee)).invert()
    .multiply(new Quaternion().setFromEuler(new Euler(0, footYaw, 0)));
  return { hip, knee, ankle };
}

export function sampleWalk(role: DirectorObject, ground: LinearInterpolant, total: number, distance: number, offset: Vector3Tuple) {
  const preset = getBodyPreset(role.bodyType);
  const p = preset.proportions;
  const { thigh, shin } = legDimensions(p);
  const length = thigh + shin;
  const [sx, sy, sz] = role.transform.scale.map((value, i) => value * preset.defaultScale[i]);
  if (!total || !sx || !sy || !sz) return;
  const steps = Math.max(2, Math.round(total / (length * Math.abs(sz) * 0.48)));
  const stride = total / steps;
  const step = Math.min(steps - 1, Math.floor(distance / stride));
  const phase = MathUtils.clamp(distance / stride - step, 0, 1);

  function heading(at: number) {
    const window = stride * 0.24;
    const [ax, , az] = ground.evaluate(at - window);
    const [bx, , bz] = ground.evaluate(at + window);
    if (ax !== bx || az !== bz) return Math.atan2(bx - ax, bz - az);
    const [x, , z] = ground.evaluate(at);
    return Math.atan2(bx - x, bz - z);
  }
  const yaw = heading(distance);
  const elevation = ground.evaluate(distance)[1];
  // 两脚从起点并拢出发。每次落脚后固定在路线上的同一点，直到轮到它再迈步。
  function contact(landing: number, side: number) {
    const at = landing < 0 ? 0 : landing >= steps - 2 ? total : (landing + 1.5) * stride;
    const angle = heading(at);
    const foot = new Vector3().fromArray(ground.evaluate(at));
    foot.x += side * p.legSpread * sx * Math.cos(angle);
    foot.z -= side * p.legSpread * sx * Math.sin(angle);
    return { foot, angle };
  }
  function footTarget(side: number, swing: boolean) {
    let { foot, angle } = contact(step - (swing ? 2 : 1), side);
    if (swing) {
      const next = contact(step, side);
      const t = MathUtils.smoothstep(phase, 0, 1);
      foot.lerp(next.foot, t);
      angle += Math.atan2(Math.sin(next.angle - angle), Math.cos(next.angle - angle)) * t;
      foot.y += Math.min(stride * 0.32, length * Math.abs(sy) * 0.16) * Math.sin(Math.PI * phase) ** 2;
    }
    const dx = foot.x - offset[0], dz = foot.z - offset[2];
    foot.set((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / sx - side * p.legSpread,
      (foot.y - elevation) / sy, (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / sz);
    return { foot, yaw: angle - yaw };
  }
  const left = footTarget(-1, step % 2 === 0);
  const right = footTarget(1, step % 2 === 1);
  const reachableHeight = (foot: Vector3) => foot.y + Math.sqrt(Math.max(0, length ** 2 - foot.x ** 2 - foot.z ** 2));
  const hipHeight = Math.min(length, reachableHeight(left.foot), reachableHeight(right.foot));
  return {
    yaw, drop: hipHeight - length, armSwing: (left.foot.z - right.foot.z) / length * 0.55,
    left: solveLeg(left.foot, hipHeight, thigh, shin, left.yaw), right: solveLeg(right.foot, hipHeight, thigh, shin, right.yaw),
  };
}

export type WalkPose = NonNullable<ReturnType<typeof sampleWalk>>;
