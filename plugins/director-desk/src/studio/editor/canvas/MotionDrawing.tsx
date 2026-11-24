import { OrthographicCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef, type PointerEvent } from "react";
import { Euler, Matrix4, Quaternion, Vector3, type Vector3Tuple } from "three";
import type { DirectorObject } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import { useMotionClock, type DrawingPlane } from "../store/motionPlayback";

const views = {
  top: { label: "俯视", right: new Vector3(1, 0, 0), up: new Vector3(0, 0, -1) },
  front: { label: "正视", right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
  side: { label: "侧视", right: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
};
type DrawingProps = { object: DirectorObject; span: number; plane: DrawingPlane };

export function drawingSpan(object: DirectorObject, objects: DirectorObject[]) {
  const origin = new Vector3(...object.transform.position);
  let radius = 4;
  for (const item of objects) {
    if (item.visible) radius = Math.max(radius, origin.distanceTo(new Vector3(...item.transform.position)));
  }
  for (const offset of object.motionPath?.offsets ?? []) radius = Math.max(radius, new Vector3(...offset).length());
  return radius * 2.4;
}

export function MotionDrawingCamera({ object, span, plane }: DrawingProps) {
  const scene = useDirectorStore(state => state.project.scene);
  const size = useThree(state => state.size);
  const { right, up } = views[plane];
  const normal = new Vector3().crossVectors(right, up);
  const rotation = new Quaternion().setFromEuler(new Euler(...scene.rotation));
  const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal)).premultiply(rotation);
  const position = new Vector3(...object.transform.position).addScaledVector(normal, span)
    .multiplyScalar(scene.scale).applyQuaternion(rotation).add(new Vector3(...scene.position));
  return <OrthographicCamera makeDefault position={position} quaternion={orientation} far={2 * span * scene.scale}
    zoom={Math.min(size.width, size.height) / (span * scene.scale)} />;
}

export function MotionDrawingSurface({ object, span, plane }: DrawingProps) {
  const svg = useRef<SVGSVGElement>(null);
  const line = useRef<SVGPolylineElement>(null);
  const stroke = useRef<{ id: number; start: number; x: number; y: number; moved: boolean; offsets: Vector3Tuple[] } | null>(null);
  const setPath = useDirectorStore(state => state.setMotionPath);

  useEffect(() => {
    const opener = document.activeElement;
    svg.current?.focus({ preventScroll: true });
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  function append(event: PointerEvent<SVGSVGElement>) {
    const pen = stroke.current;
    if (!pen || event.pointerId !== pen.id) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse());
    const { right, up } = views[plane];
    const offset = right.clone().multiplyScalar(point.x).addScaledVector(up, -point.y);
    const last = pen.offsets[pen.offsets.length - 1];
    if (offset.x === last[0] && offset.y === last[1] && offset.z === last[2]) return;
    pen.offsets.push([offset.x, offset.y, offset.z]);
    const vertex = svg.current!.createSVGPoint();
    vertex.x = point.x; vertex.y = point.y;
    line.current!.points.appendItem(vertex);
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    const pen = stroke.current;
    if (!pen || event.pointerId !== pen.id) return;
    append(event);
    const elapsed = (event.timeStamp - pen.start) / 1000;
    if ((pen.moved || pen.x !== event.clientX || pen.y !== event.clientY) && pen.offsets.length > 1 && elapsed > 0) {
      const duration = object.motionPath?.duration ?? Number(elapsed.toPrecision(3));
      setPath(object.id, { offsets: pen.offsets, duration });
      useMotionClock.setState({ drawingId: null });
    }
    stroke.current = null;
    line.current?.setAttribute("points", "0,0");
  }

  return <div className="motion-drawing">
    <svg ref={svg} className="motion-surface" tabIndex={-1} role="img" aria-label={object.name + "的轨迹画板"} viewBox={`${-span / 2} ${-span / 2} ${span} ${span}`}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || stroke.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        stroke.current = { id: event.pointerId, start: event.timeStamp, x: event.clientX, y: event.clientY, moved: false, offsets: [[0, 0, 0]] };
        line.current!.setAttribute("points", "0,0");
        append(event);
      }}
      onPointerMove={event => {
        const pen = stroke.current;
        if (pen && event.pointerId === pen.id) {
          if (pen.x !== event.clientX || pen.y !== event.clientY) pen.moved = true;
          append(event);
        }
      }}
      onPointerUp={finish}
      onLostPointerCapture={event => {
        if (stroke.current?.id === event.pointerId) {
          stroke.current = null;
          line.current!.setAttribute("points", "0,0");
        }
      }}
      onPointerCancel={event => { if (stroke.current?.id === event.pointerId) useMotionClock.setState({ drawingId: null }); }}>
      <polyline ref={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
    <span className="motion-origin" aria-hidden="true" />
    <div className="motion-view-tools" role="group" aria-label="绘制视角">
      {(Object.keys(views) as DrawingPlane[]).map(key => <button type="button" key={key} aria-pressed={plane === key}
        onClick={() => useMotionClock.setState({ plane: key })}>{views[key].label}</button>)}
      <button type="button" onClick={() => useMotionClock.setState({ drawingId: null })}>取消</button>
    </div>
    <p className="motion-hint">从{object.name}的起点拖画，松开保存</p>
  </div>;
}
