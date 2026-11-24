import { useEffect } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { DirectorObject } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import { useMotionClock } from "../store/motionPlayback";
import { useRecordingState } from "../io/recording";

export function MotionPanel({ object }: { object: DirectorObject }) {
  const path = object.motionPath;
  const setPath = useDirectorStore(state => state.setMotionPath);
  const busy = useMotionClock(state => state.time !== null || state.drawingId !== null);
  const recording = useRecordingState();
  useEffect(() => () => {
    if (useMotionClock.getState().drawingId === object.id) useMotionClock.setState({ drawingId: null });
  }, [object.id, object.locked]);

  return <fieldset className="motion-editor" disabled={object.locked || busy || recording !== "idle"}>
    {object.locked && <p>先解锁对象，再绘制轨迹。</p>}
    <button type="button" className="motion-add" onClick={() => useMotionClock.setState({ drawingId: object.id, plane: "top" })}>
      <Pencil size={15} />{path ? "重画轨迹" : "绘制轨迹"}
    </button>
    {path && <>
      <label className="inspector-field">
        <span className="inspector-field-label">移动用时（秒）</span>
        <input key={path.duration} type="number" step="any" min="0" aria-label="移动用时（秒）" className="inspector-text-input" defaultValue={path.duration}
          onBlur={event => {
            const duration = event.currentTarget.valueAsNumber;
            if (Number.isFinite(duration) && duration > 0) setPath(object.id, { ...path, duration });
            else event.currentTarget.value = String(path.duration);
          }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </label>
      <button type="button" className="motion-remove" onClick={() => setPath(object.id)}><Trash2 size={14} />清除轨迹</button>
    </>}
  </fieldset>;
}
