import { create } from "zustand";

export type DrawingPlane = "top" | "front" | "side";
export const useMotionClock = create<{ time: number | null; drawingId: string | null; plane: DrawingPlane }>(() => ({
  time: null, drawingId: null, plane: "top",
}));
let animation = 0;

export function stopMotion() {
  cancelAnimationFrame(animation);
  useMotionClock.setState({ time: null });
}

export function playMotion(duration: number, holdLastFrame = false) {
  stopMotion();
  if (duration === 0) return;
  const start = performance.now();
  useMotionClock.setState({ time: 0 });
  function tick(now: number) {
    const time = Math.min((now - start) / 1000, duration);
    useMotionClock.setState({ time });
    if (time < duration) animation = requestAnimationFrame(tick);
    else if (!holdLastFrame) animation = requestAnimationFrame(stopMotion);
  }
  animation = requestAnimationFrame(tick);
}
