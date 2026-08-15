// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Shoot-mode bottom timeline: transport, a scrubbable second-ruler, and one
 * lane per moving entity (camera first) with draggable mark pills. Reads and
 * writes the doc exclusively through the store; drags update local state for
 * live feedback and commit a single undoable mutate on pointer-up.
 */

import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useStore } from '../store'
import { ShotEvaluator } from '@engine/evaluate'
import { GAITS } from '@engine/gaits'
import type { ActorMark, CameraMark, MarkBase, Scene, Shot } from '@engine/types'

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** Human-readable label for a speed-warning suggestion. */
function suggestionLabel(suggestion: string): string {
  if (suggestion === 'addTime') return 'more time'
  const g = GAITS[suggestion as keyof typeof GAITS]
  return g ? g.name.toLowerCase() : suggestion
}

interface TimelineLane {
  key: string
  entityId: string | 'camera'
  label: JSX.Element
  marks: MarkBase[]
}

/** Live drag state: which mark, which handle, and its provisional values. */
interface DragState {
  entityId: string | 'camera'
  markId: string
  mode: 'move' | 'stretch'
  time: number
  hold: number
}

export function Timeline(): JSX.Element {
  const scene = useStore((s) => s.scene())
  const shot = useStore((s) => s.shot())
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const selection = useStore((s) => s.selection)
  const setTime = useStore((s) => s.setTime)
  const setPlaying = useStore((s) => s.setPlaying)
  const setSelection = useStore((s) => s.setSelection)
  const toggleMarkSelected = useStore((s) => s.toggleMarkSelected)
  const mutate = useStore((s) => s.mutate)

  const [drag, setDrag] = useState<DragState | null>(null)
  const [panelHeight, setPanelHeight] = useState(240)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Drag the top edge to resize the whole timeline — big casts need lanes.
  const onResizeStart = (e: ReactPointerEvent): void => {
    e.preventDefault()
    const startY = e.clientY
    const startH = panelHeight
    const move = (ev: PointerEvent): void => {
      setPanelHeight(Math.min(window.innerHeight * 0.6, Math.max(110, startH + (startY - ev.clientY))))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const evaluator = useMemo(
    () => (scene && shot ? new ShotEvaluator(scene, shot) : null),
    [scene, shot]
  )

  if (!scene || !shot) {
    return <div className="timeline" />
  }

  const duration = shot.duration
  const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)

  /* --------------------------- build the lanes --------------------------- */
  const selectAllMarksInLane = useStore.getState().selectAllMarksInLane
  const laneLabelProps = (entityId: string | 'camera'): React.HTMLAttributes<HTMLSpanElement> => ({
    onClick: () => selectAllMarksInLane(entityId),
    style: { cursor: 'pointer' },
    title: 'Click: select ALL marks in this lane (⌫ deletes them together)'
  })

  const lanes: TimelineLane[] = []
  lanes.push({
    key: 'camera',
    entityId: 'camera',
    label: (
      <span className="timeline-track-label" {...laneLabelProps('camera')}>
        🎥 CAMERA
      </span>
    ),
    marks: shot.camera.marks
  })
  if (take) {
    for (const track of take.tracks) {
      const entity = scene.entities.find((e) => e.id === track.entityId)
      if (!entity) continue
      const color = entity.label?.color ?? '#9b9ba6'
      const name = entity.label?.text || entity.name
      lanes.push({
        key: entity.id,
        entityId: entity.id,
        label: (
          <span className="timeline-track-label" {...laneLabelProps(entity.id)}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color,
                flexShrink: 0
              }}
            />
            {name}
          </span>
        ),
        marks: track.marks
      })
    }
  }

  const anyMarks = lanes.some((l) => l.marks.length > 0)

  /* ----------------------------- transport ------------------------------- */
  const onDuration = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const raw = Number(e.target.value)
    if (Number.isNaN(raw)) return
    const next = clamp(raw, 0.5, 60)
    mutate('shot duration', (doc) => {
      const sc = doc.scenes.find((s) => s.id === scene.id)
      const sh = sc?.shots.find((s) => s.id === shot.id)
      if (!sc || !sh) return
      // Duration only — NEVER clamp marks. The blocking take is SHARED
      // across shots (coverage model): clamping would silently destroy
      // every other shot's choreography, and the evaluator handles marks
      // beyond the duration fine (they're simply not reached).
      sh.duration = next
    })
    if (time > next) setTime(next)
  }

  const onFps = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const fps = Number(e.target.value)
    if (Number.isNaN(fps)) return
    mutate('shot fps', (doc) => {
      const sh = doc.scenes.flatMap((s) => s.shots).find((s) => s.id === shot.id)
      if (sh) sh.fps = fps
    })
  }

  /* ------------------------------- ruler --------------------------------- */
  const ticks: number[] = []
  for (let t = 0; t <= Math.floor(duration); t++) ticks.push(t)

  const scrubTo = (clientX: number, el: HTMLElement): void => {
    const rect = el.getBoundingClientRect()
    const x = clamp(clientX - rect.left, 0, rect.width)
    setPlaying(false)
    setTime(clamp((x / rect.width) * duration, 0, duration))
  }

  const onRulerPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    scrubTo(e.clientX, el)
  }
  const onRulerPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubTo(e.clientX, e.currentTarget)
  }

  /* ------------------------------- pills --------------------------------- */
  const laneWidth = (): number => {
    const body = bodyRef.current
    if (!body) return 400
    const lane = body.querySelector('.timeline-track-lane')
    return lane ? (lane as HTMLElement).clientWidth : 400
  }

  const beginDrag = (
    entityId: string | 'camera',
    mark: MarkBase,
    mode: 'move' | 'stretch',
    e: ReactPointerEvent<HTMLElement>
  ): void => {
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const w = laneWidth()
    const startX = e.clientX
    const startTime = mark.time
    const startHold = mark.hold
    // Shift-click multi-selection is handled on click (toggleMarkSelected);
    // don't collapse it to a single mark here on pointer-down.
    if (!e.shiftKey) setSelection({ kind: 'mark', entityId, markId: mark.id })

    const localState: DragState = { entityId, markId: mark.id, mode, time: startTime, hold: startHold }
    setDrag(localState)

    const onMove = (ev: PointerEvent): void => {
      const dt = ((ev.clientX - startX) / w) * duration
      if (mode === 'move') {
        localState.time = clamp(startTime + dt, 0, duration - startHold)
        setTime(localState.time)
      } else {
        localState.hold = clamp(startHold + dt, 0, duration - startTime)
      }
      setDrag({ ...localState })
    }

    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      mutate(mode === 'move' ? 'move mark' : 'stretch mark', (doc) => {
        const m = findMarkInDoc(doc, scene.id, shot.id, entityId, mark.id)
        if (!m) return
        if (mode === 'move') m.time = clamp(localState.time, 0, duration - m.hold)
        else m.hold = clamp(localState.hold, 0, duration - m.time)
      })
      setDrag(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const deleteMark = (entityId: string | 'camera', markId: string): void => {
    mutate('delete mark', (doc) => {
      const sc = doc.scenes.find((s) => s.id === scene.id)
      const sh = sc?.shots.find((s) => s.id === shot.id)
      if (!sc || !sh) return
      if (entityId === 'camera') {
        sh.camera.marks = sh.camera.marks.filter((m) => m.id !== markId)
      } else {
        const tk = sc.blocking.find((b) => b.id === sh.blockingTakeId)
        const tr = tk?.tracks.find((t) => t.entityId === entityId)
        if (tr) tr.marks = tr.marks.filter((m) => m.id !== markId)
      }
    })
    if (selection?.kind === 'mark' && selection.markId === markId) setSelection(null)
  }

  const playheadLeft = `${(clamp(time, 0, duration) / duration) * 100}%`

  return (
    <div className="timeline" style={{ height: panelHeight }}>
      <div
        className="timeline-resizer"
        onPointerDown={onResizeStart}
        title="Drag to resize the timeline"
      />
      <div className="timeline-toolbar">
        <button className="btn small" onClick={() => setPlaying(!playing)}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="timeline-time">
          t={time.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
        <label className="timeline-field">
          <span>Dur</span>
          <input
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={duration}
            onChange={onDuration}
            style={{ width: 62 }}
          />
        </label>
        <label className="timeline-field">
          <span>fps</span>
          <select value={shot.fps} onChange={onFps} style={{ width: 58 }}>
            <option value={24}>24</option>
            <option value={25}>25</option>
            <option value={30}>30</option>
          </select>
        </label>
        <button
          className="btn small"
          disabled={!anyMarks}
          onClick={() => useStore.getState().selectAllMarks()}
          title={`Select every mark on every lane (${window.blockout.platform.primaryModifier}A) — then ⌫ deletes them all, or shift times together in the inspector`}
        >
          Select all
        </button>
        <div className="timeline-warnings">
          {evaluator?.lineCrossings().map((c) => (
            <span
              key={`line-${c.fromMark}-${c.toMark}`}
              className="warning-chip"
              title="The camera crosses the 180° line (the axis between your two lead characters) between these marks — screen direction will flip. Intentional crossings are fine; otherwise keep coverage on one side."
            >
              🎬 180° line crossed: cam mark {c.fromMark} → {c.toMark}
            </span>
          ))}
          {evaluator?.warnings().map((w) => (
            <span
              key={`${w.entityId}-${w.legIndex}`}
              className="warning-chip"
              style={{ cursor: 'pointer' }}
              onClick={() =>
                setSelection({ kind: 'mark', entityId: w.entityId, markId: w.toMarkId })
              }
            >
              ⚠ {w.entityName}: implied {w.verdict.impliedSpeed.toFixed(1)} m/s — try{' '}
              {suggestionLabel(w.verdict.suggestion)}
            </span>
          ))}
        </div>
      </div>

      <div
        className="timeline-ruler"
        onPointerDown={onRulerPointerDown}
        onPointerMove={onRulerPointerMove}
      >
        {ticks.map((t) => (
          <div
            key={t}
            className="ruler-tick"
            style={{ left: `${(t / duration) * 100}%` }}
          >
            {t}s
          </div>
        ))}
      </div>

      <div className="timeline-body" ref={bodyRef}>
        {lanes.map((lane) => (
          <div className="timeline-track" key={lane.key}>
            {lane.label}
            <Lane
              lane={lane}
              duration={duration}
              drag={drag}
              selection={selection}
              onSelect={(markId, shiftKey) => {
                if (shiftKey) toggleMarkSelected(lane.entityId, markId)
                else setSelection({ kind: 'mark', entityId: lane.entityId, markId })
              }}
              onBeginDrag={beginDrag}
              onDelete={deleteMark}
              laneWidth={laneWidth}
            />
          </div>
        ))}
        {!anyMarks && (
          <div className="timeline-empty">
            Select the camera or an actor and press M, then click the floor to drop marks.
          </div>
        )}
        <div className="playhead" style={{ left: playheadLeft }} />
      </div>
    </div>
  )
}

interface LaneProps {
  lane: TimelineLane
  duration: number
  drag: DragState | null
  selection: ReturnType<typeof useStore.getState>['selection']
  onSelect: (markId: string, shiftKey: boolean) => void
  onBeginDrag: (
    entityId: string | 'camera',
    mark: MarkBase,
    mode: 'move' | 'stretch',
    e: ReactPointerEvent<HTMLElement>
  ) => void
  onDelete: (entityId: string | 'camera', markId: string) => void
  laneWidth: () => number
}

function Lane({
  lane,
  duration,
  drag,
  selection,
  onSelect,
  onBeginDrag,
  onDelete,
  laneWidth
}: LaneProps): JSX.Element {
  // 1-based index by time order.
  const ordered = [...lane.marks].sort((a, b) => a.time - b.time)
  const indexOf = new Map(ordered.map((m, i) => [m.id, i + 1]))

  return (
    <div className="timeline-track-lane">
      {lane.marks.map((mark) => {
        const isDragging = drag && drag.entityId === lane.entityId && drag.markId === mark.id
        const t = isDragging && drag ? drag.time : mark.time
        const hold = isDragging && drag ? drag.hold : mark.hold
        const w = laneWidth()
        const width = Math.max(22, (hold / duration) * w)
        const selected =
          (selection?.kind === 'mark' &&
            selection.entityId === lane.entityId &&
            selection.markId === mark.id) ||
          (selection?.kind === 'marks' &&
            (selection.entityId === lane.entityId || selection.entityId === '*') &&
            selection.markIds.includes(mark.id))
        return (
          <div
            key={mark.id}
            className={`mark-pill${selected ? ' selected' : ''}`}
            style={{ left: `${(t / duration) * 100}%`, width }}
            onPointerDown={(e) => onBeginDrag(lane.entityId, mark, 'move', e)}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(mark.id, e.shiftKey)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onDelete(lane.entityId, mark.id)
            }}
          >
            {indexOf.get(mark.id)}
            <span
              className="stretch"
              onPointerDown={(e) => onBeginDrag(lane.entityId, mark, 'stretch', e)}
            />
          </div>
        )
      })}
    </div>
  )
}

/** Locate a mark inside a mutable doc for a committing mutation. */
function findMarkInDoc(
  doc: { scenes: Scene[] },
  sceneId: string,
  shotId: string,
  entityId: string | 'camera',
  markId: string
): (CameraMark | ActorMark) | null {
  const scene = doc.scenes.find((s) => s.id === sceneId)
  const shot: Shot | undefined = scene?.shots.find((s) => s.id === shotId)
  if (!scene || !shot) return null
  if (entityId === 'camera') {
    return shot.camera.marks.find((m) => m.id === markId) ?? null
  }
  const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
  const track = take?.tracks.find((t) => t.entityId === entityId)
  return track?.marks.find((m) => m.id === markId) ?? null
}
