// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Viewport — React shell around SceneManager: canvas lifecycle, the shot
 * HUD, look-through framing overlays (thirds grid), placement/mark hints,
 * empty states, and the reference-video underlay.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { emit, type FramingKind } from '../bus'
import { SceneManager } from './SceneManager'
import { registerSceneManager, getSceneManager as getSceneManagerSafe } from '../export/scene-access'
import { ReferenceUnderlay, ReferenceControls } from './ReferenceUnderlay'
import { LENS_SET, SHOT_SIZES } from '@engine/camera'
import type { AspectId, ShotSizeId } from '@engine/types'

const ASPECT_ORDER: AspectId[] = ['16:9', '9:16', '2.39:1', '4:3', '1:1']

function Hud(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const time = useStore((s) => s.time)
  const mutate = useStore((s) => s.mutate)
  const mode = useStore((s) => s.mode)
  const showMarks = useStore((s) => s.showMarks)
  const showPaths = useStore((s) => s.showPaths)
  const setShowMarks = useStore((s) => s.setShowMarks)
  const setShowPaths = useStore((s) => s.setShowPaths)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const shot = scene?.shots.find((s) => s.id === shotId)
  if (!shot) return null

  // Lens at playhead (from marks; default 35).
  const sorted = [...shot.camera.marks].sort((a, b) => a.time - b.time)
  let lens = sorted[0]?.focalLength ?? 35
  for (const m of sorted) if (m.time <= time + 1e-6) lens = m.focalLength

  const cycleLens = (): void => {
    const idx = LENS_SET.findIndex((l) => l >= Math.round(lens))
    const next = LENS_SET[(Math.max(0, idx) + 1) % LENS_SET.length]!
    emit('setLens', { focalLength: next })
  }

  const cycleAspect = (): void => {
    const idx = ASPECT_ORDER.indexOf(shot.aspect)
    const next = ASPECT_ORDER[(idx + 1) % ASPECT_ORDER.length]!
    mutate('aspect', (doc) => {
      for (const sc of doc.scenes) {
        const sh = sc.shots.find((x) => x.id === shot.id)
        if (sh) sh.aspect = next
      }
    })
  }

  return (
    <div className="hud">
      <button onClick={cycleLens} title="Focal length (click to cycle)">
        <span className="hud-label">LENS</span>
        {Math.round(lens)}mm
      </button>
      <button onClick={cycleAspect} title="Aspect ratio (click to cycle)">
        <span className="hud-label">AR</span>
        {shot.aspect}
      </button>
      <button title="Shot duration — edit in the timeline">
        <span className="hud-label">DUR</span>
        {shot.duration.toFixed(1)}s
      </button>
      <button title="Frame rate">
        <span className="hud-label">FPS</span>
        {shot.fps}
      </button>
      {mode === 'shoot' && (
        <button title="Camera marks in this shot">
          <span className="hud-label">MARKS</span>
          {shot.camera.marks.length}
        </button>
      )}
      <button
        className={showMarks ? 'active' : ''}
        onClick={() => setShowMarks(!showMarks)}
        title="Show/hide the spike-tape floor marks (editor only — never in exports)"
      >
        <span className="hud-label">{showMarks ? '👁' : '🚫'}</span>
        MARKS
      </button>
      <button
        className={showPaths ? 'active' : ''}
        onClick={() => setShowPaths(!showPaths)}
        title="Show/hide path ribbons, direction chevrons and time labels (editor only)"
      >
        <span className="hud-label">{showPaths ? '👁' : '🚫'}</span>
        PATHS
      </button>
    </div>
  )
}

function ShotSizeRow(): JSX.Element {
  const sizes: ShotSizeId[] = ['WS', 'FS', 'MS', 'MCU', 'CU']
  return (
    <div className="tool-row">
      {sizes.map((size) => (
        <button
          key={size}
          className="btn small"
          title={`Auto-frame: ${SHOT_SIZES[size].name}`}
          onClick={() => emit('frameSubject', { size })}
        >
          {size}
        </button>
      ))}
    </div>
  )
}

/** Recording feel: how tightly recordings chase the mouse. */
function RecordControlToggle(): JSX.Element {
  const recordControl = useStore((s) => s.recordControl)
  const setRecordControl = useStore((s) => s.setRecordControl)
  const next = { precise: 'normal', normal: 'fast', fast: 'precise' } as const
  const label = { precise: '🎯 Precise', normal: '✋ Normal', fast: '⚡ Fast' } as const
  return (
    <button
      className="btn small"
      onClick={() => setRecordControl(next[recordControl])}
      title="Recording control: Precise = heavy smoothing + speed cap (slow, exact moves), Normal = balanced, Fast = raw and quick. Applies to performer puppeteering AND camera flying. Click to cycle."
    >
      {label[recordControl]}
    </button>
  )
}

/** One-click cinematography framings — writes the active camera mark. */
function FramingRow(): JSX.Element {
  const framings: { kind: FramingKind; label: string; title: string }[] = [
    { kind: '2S', label: '2-SHOT', title: 'Two-shot: fit the two characters side by side (select 3–4 for a group shot)' },
    { kind: 'OTS', label: 'OTS', title: 'Over-the-shoulder: behind the near character, looking at the other' },
    { kind: 'REV', label: 'REV', title: 'Reverse angle: swing the camera 180° around the subjects' },
    { kind: 'TOP', label: 'TOP', title: 'Overhead: straight down, fitting everyone in frame' },
    { kind: 'LOW', label: 'LOW', title: 'Low angle: knee height, looking up at the subject' },
    { kind: 'DUTCH', label: 'DUTCH', title: 'Dutch angle: tilt the horizon (click again to flip, again to level)' }
  ]
  return (
    <div className="tool-row">
      {framings.map((f) => (
        <button key={f.kind} className="btn small" title={f.title} onClick={() => emit('applyFraming', { kind: f.kind })}>
          {f.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Take bar — the Rehearse → Record → Review loop. Purely composes existing
 * store/SceneManager calls: it wraps beginRecording/finishRecording with a
 * 3-2-1 countdown and forces path ribbons on while rehearsing.
 */
function TakeBar(): JSX.Element {
  const recording = useStore((s) => s.recording)
  const selection = useStore((s) => s.selection)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [pending, setPending] = useState<'camera' | 'performer' | null>(null)

  const singleEntity = selection?.kind === 'entity'

  // Tick the 3-2-1 countdown; at zero, arm the selection and start recording.
  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      const s = useStore.getState()
      if (pending === 'camera') s.setSelection({ kind: 'camera' })
      s.setLookThrough(false)
      s.setTime(0)
      s.setRecording(true)
      setCountdown(null)
      setPending(null)
      return
    }
    const id = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 800)
    return () => window.clearTimeout(id)
  }, [countdown, pending])

  const rehearse = (): void => {
    const s = useStore.getState()
    s.setShowPaths(true)
    s.setRecording(false)
    s.setLookThrough(false)
    s.setTime(0)
    s.setPlaying(true)
  }
  const review = (): void => {
    const s = useStore.getState()
    s.setRecording(false)
    s.setLookThrough(true)
    s.setTime(0)
    s.setPlaying(true)
  }
  const startCountdown = (which: 'camera' | 'performer'): void => {
    const s = useStore.getState()
    s.setPlaying(false)
    setPending(which)
    setCountdown(3)
  }
  const cancel = (): void => {
    setCountdown(null)
    setPending(null)
  }

  return (
    <>
      <div className="tool-row" title="Rehearse → Record → Review: the take loop">
        <button
          className="btn small"
          onClick={rehearse}
          disabled={recording || countdown !== null}
          title="Rehearse: play the take from the top with path ribbons on, so you can watch the blocking before you shoot"
        >
          🔁 Rehearse
        </button>
        {recording ? (
          <button
            className="btn small"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            onClick={() => useStore.getState().setRecording(false)}
            title="Stop recording and save the take"
          >
            ■ Stop take
          </button>
        ) : (
          <>
            <button
              className="btn small"
              onClick={() => startCountdown('camera')}
              disabled={countdown !== null}
              title="Record the camera move with a 3-2-1 countdown: fly the viewport; existing blocking replays underneath"
            >
              ⏺ Record camera
            </button>
            <button
              className="btn small"
              onClick={() => startCountdown('performer')}
              disabled={countdown !== null || !singleEntity}
              title={
                singleEntity
                  ? 'Record this performer with a 3-2-1 countdown: puppeteer it with the cursor'
                  : 'Select one character or vehicle first to record its performance'
              }
            >
              ⏺ Record performance
            </button>
          </>
        )}
        <button
          className="btn small"
          onClick={review}
          disabled={recording || countdown !== null}
          title="Review: play back through the shot camera (look-through on), exactly as it will export"
        >
          ▶ Review
        </button>
      </div>
      {countdown !== null && countdown > 0 && (
        <div
          onClick={cancel}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
            pointerEvents: 'auto',
            cursor: 'pointer',
            background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.35), rgba(0,0,0,0.55))'
          }}
          title="Click to cancel"
        >
          <div
            style={{
              fontSize: 120,
              fontWeight: 800,
              color: 'var(--danger)',
              textShadow: '0 2px 24px rgba(0,0,0,0.6)',
              lineHeight: 1
            }}
          >
            {countdown}
          </div>
          <div style={{ marginTop: 10, fontSize: 13, letterSpacing: '0.14em', color: 'var(--text-faint)' }}>
            {pending === 'performer' ? 'RECORDING PERFORMANCE…' : 'RECORDING CAMERA…'} · click to cancel
          </div>
        </div>
      )}
    </>
  )
}

function GizmoModeRow(): JSX.Element {
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate')
  const apply = (m: 'translate' | 'rotate'): void => {
    setMode(m)
    getSceneManagerSafe()?.setGizmoMode(m)
  }
  return (
    <div className="tool-row">
      <button
        className={`btn small ${mode === 'translate' ? 'active' : ''}`}
        onClick={() => apply('translate')}
        title="Move the selection with the gizmo arrows (G)"
      >
        ⇄ Move
      </button>
      <button
        className={`btn small ${mode === 'rotate' ? 'active' : ''}`}
        onClick={() => apply('rotate')}
        title="Rotate the selection — spin people, cars, props, the camera (R)"
      >
        ⟳ Rotate
      </button>
    </div>
  )
}

export function Viewport(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewRect, setViewRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [pipRect, setPipRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  const mode = useStore((s) => s.mode)
  const lookThrough = useStore((s) => s.lookThrough)
  const setLookThrough = useStore((s) => s.setLookThrough)
  const pipSize = useStore((s) => s.pipSize)
  const setPipSize = useStore((s) => s.setPipSize)
  const recording = useStore((s) => s.recording)
  const setRecording = useStore((s) => s.setRecording)
  const placingAssetId = useStore((s) => s.placingAssetId)
  const placingSequence = useStore((s) => s.placingSequence)
  const placingChoreography = useStore((s) => s.placingChoreography)
  const droppingMarks = useStore((s) => s.droppingMarks)
  const selection = useStore((s) => s.selection)
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const setSelection = useStore((s) => s.setSelection)
  const setDroppingMarks = useStore((s) => s.setDroppingMarks)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const hasEntities = (scene?.entities.length ?? 0) > 0
  const hasMarks =
    (scene?.shots.some((sh) => sh.camera.marks.length > 0) ?? false) ||
    (scene?.blocking.some((b) => b.tracks.some((t) => t.marks.length > 0)) ?? false)

  useEffect(() => {
    if (!canvasRef.current) return
    const manager = new SceneManager(canvasRef.current)
    manager.onViewRect = (rect) => setViewRect(rect)
    manager.onPipRect = (rect) =>
      setPipRect((prev) =>
        prev?.x === rect?.x && prev?.y === rect?.y && prev?.w === rect?.w && prev?.h === rect?.h
          ? prev
          : rect
      )
    registerSceneManager(manager)
    return () => {
      registerSceneManager(null)
      manager.dispose()
    }
  }, [])

  const showLetterbox = (lookThrough || mode === 'deliver') && viewRect

  const singleEntitySelected = selection?.kind === 'entity'

  let hint: string | null = null
  if (placingChoreography)
    hint = `Click the floor to stage this ${placingChoreography.kind} routine there (facing you) · Esc to cancel`
  else if (placingSequence)
    hint = `Click the floor to stage ${placingSequence.count} performers there (facing you) · Esc to cancel`
  else if (placingAssetId) hint = `Click the floor to place · ${window.blockout.platform.alternateModifier}-click to place multiple · Esc to cancel`
  else if (droppingMarks && selection?.kind === 'entity')
    hint = 'Click the floor to drop marks in order · Esc when done'
  else if (droppingMarks && selection?.kind === 'camera')
    hint = 'Click the floor to drop a camera mark · or use “Drop camera mark at view”'
  else if (selection?.kind === 'entities')
    hint = `${selection.entityIds.length} selected — drag moves the group · Marry in the inspector · ⌫ deletes all`

  return (
    <>
      <canvas ref={canvasRef} />
      {mode !== 'deliver' && <Hud />}
      {mode !== 'deliver' && (
        <div className="viewport-tools">
          {mode === 'shoot' && (
            <div className="tool-row">
              <button
                className="btn small primary"
                onClick={() => {
                  const s = useStore.getState()
                  s.setLookThrough(true)
                  s.setTime(0)
                  s.setPlaying(true)
                }}
                title="Watch the shot: plays from the top through the shot camera (the designed frame, exactly as it will export)"
              >
                ▶ Play shot
              </button>
              <button
                className={`btn small ${lookThrough ? 'active' : ''}`}
                onClick={() => setLookThrough(!lookThrough)}
                title="Look through the shot camera (C)"
              >
                🎥 Look through
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setSelection({ kind: 'camera' })
                  emit('dropCameraMarkAtView', {})
                }}
                title="Drop a camera mark at the current view"
              >
                + Cam mark
              </button>
              <button
                className={`btn small ${droppingMarks ? 'active' : ''}`}
                onClick={() => setDroppingMarks(!droppingMarks)}
                disabled={!selection}
                title="Drop marks for the selection by clicking the floor (M)"
              >
                + Marks
              </button>
              <button
                className={`btn small ${recording ? 'active' : ''}`}
                style={recording ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
                onClick={() => setRecording(!recording)}
                title={
                  singleEntitySelected
                    ? 'Record THIS character/vehicle: puppeteer it with the cursor; other motion replays underneath'
                    : 'Record the camera: fly the viewport; existing blocking replays while you record'
                }
              >
                {recording ? '■ Stop' : singleEntitySelected ? '● Record performer' : '● Record camera'}
              </button>
              <RecordControlToggle />
              <ReferenceControls />
            </div>
          )}
          {mode === 'shoot' && <ShotSizeRow />}
          {mode === 'shoot' && <FramingRow />}
          {mode === 'shoot' && <TakeBar />}
          <GizmoModeRow />
          <div className="tool-row">
            <button
              className="btn small"
              disabled={!selection || (selection.kind !== 'entity' && selection.kind !== 'entities')}
              onClick={() => getSceneManagerSafe()?.snapSelectionToGround()}
              title="Rest the selection on whatever is beneath it — floor, table, truck bed"
            >
              ⬇ Ground
            </button>
          </div>
        </div>
      )}
      {mode === 'shoot' && <ReferenceUnderlay />}

      {/* PiP live shot preview chrome */}
      {pipRect && !lookThrough && mode !== 'deliver' && (
        <div
          style={{
            position: 'absolute',
            left: pipRect.x - 1,
            top: pipRect.y - 1,
            width: pipRect.w + 2,
            height: pipRect.h + 2,
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            zIndex: 5,
            pointerEvents: 'none'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: -26,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              pointerEvents: 'auto'
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text-faint)' }}>
              SHOT PREVIEW
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn small"
              style={{ padding: '2px 7px', fontSize: 10 }}
              title="Cycle preview size"
              onClick={() =>
                setPipSize(pipSize === 'small' ? 'medium' : pipSize === 'medium' ? 'large' : 'small')
              }
            >
              {pipSize === 'small' ? 'S' : pipSize === 'medium' ? 'M' : 'L'}
            </button>
            <button
              className="btn small"
              style={{ padding: '2px 7px', fontSize: 10 }}
              title="Hide preview"
              onClick={() => setPipSize('off')}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {pipSize === 'off' && !lookThrough && mode !== 'deliver' && (
        <button
          className="btn small"
          style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 5 }}
          onClick={() => setPipSize('medium')}
          title="Show the live shot preview"
        >
          🎥 Preview
        </button>
      )}
      {recording && (
        <div className="viewport-hint" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {singleEntitySelected
            ? '● REC — move the cursor over the floor; the performer chases it. ■ Stop saves the performance.'
            : '● REC — fly the view (orbit/pan/zoom); this is the shot. ■ Stop saves the move.'}
        </div>
      )}

      {showLetterbox && viewRect && (
        <div
          style={{
            position: 'absolute',
            left: viewRect.x,
            top: viewRect.y,
            width: viewRect.w,
            height: viewRect.h,
            pointerEvents: 'none',
            zIndex: 4
          }}
        >
          {/* Rule-of-thirds grid */}
          {[1, 2].map((i) => (
            <div
              key={`v${i}`}
              style={{
                position: 'absolute',
                left: `${(i / 3) * 100}%`,
                top: 0,
                bottom: 0,
                width: 1,
                background: 'rgba(255,255,255,0.14)'
              }}
            />
          ))}
          {[1, 2].map((i) => (
            <div
              key={`h${i}`}
              style={{
                position: 'absolute',
                top: `${(i / 3) * 100}%`,
                left: 0,
                right: 0,
                height: 1,
                background: 'rgba(255,255,255,0.14)'
              }}
            />
          ))}
          {/* Action-safe area */}
          <div
            style={{
              position: 'absolute',
              inset: '5%',
              border: '1px solid rgba(255,255,255,0.10)'
            }}
          />
        </div>
      )}

      {hint && <div className="viewport-hint">{hint}</div>}

      {!hasEntities && mode === 'stage' && (
        <div className="empty-state">
          <div style={{ fontSize: 36 }}>🎬</div>
          <div>Click a library item, then click the floor to place it.</div>
        </div>
      )}
      {hasEntities && !hasMarks && mode === 'shoot' && !droppingMarks && (
        <div className="empty-state">
          <div>Select an actor or the camera, press M, then click the floor to drop marks.</div>
        </div>
      )}
    </>
  )
}
