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
import { uiText, useBlockoutI18n } from '../i18n'
import { LENS_SET, SHOT_SIZES } from '@engine/camera'
import type { AspectId, ShotSizeId } from '@engine/types'

const ASPECT_ORDER: AspectId[] = ['16:9', '9:16', '2.39:1', '4:3', '1:1']

function Hud(): JSX.Element | null {
  const { t } = useBlockoutI18n()
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
      <button onClick={cycleLens} title="焦距（点击切换）">
        <span className="hud-label">镜头</span>
        {Math.round(lens)}mm
      </button>
      <button onClick={cycleAspect} title="画幅比例（点击切换）">
        <span className="hud-label">画幅</span>
        {shot.aspect}
      </button>
      <button title="镜头时长——在时间线中编辑">
        <span className="hud-label">时长</span>
        {shot.duration.toFixed(1)}s
      </button>
      <button title="帧率">
        <span className="hud-label">帧率</span>
        {shot.fps}
      </button>
      {mode === 'shoot' && (
        <button title="此镜头中的相机标记">
          <span className="hud-label">标记</span>
          {shot.camera.marks.length}
        </button>
      )}
      <button
        className={showMarks ? 'active' : ''}
        onClick={() => setShowMarks(!showMarks)}
        title="显示/隐藏地面标记（仅编辑器可见，不会导出）"
      >
        <span className="hud-label">{showMarks ? '👁' : '🚫'}</span>
        {t('common.marks')}
      </button>
      <button
        className={showPaths ? 'active' : ''}
        onClick={() => setShowPaths(!showPaths)}
        title="显示/隐藏路径、方向箭头和时间标签（仅编辑器可见）"
      >
        <span className="hud-label">{showPaths ? '👁' : '🚫'}</span>
        {t('common.paths')}
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
          title={`自动构图：${uiText(SHOT_SIZES[size].name)}`}
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
  const label = { precise: '🎯 精确', normal: '✋ 标准', fast: '⚡ 快速' } as const
  return (
    <button
      className="btn small"
      onClick={() => setRecordControl(next[recordControl])}
      title="录制控制：精确模式平滑更强且限制速度，标准模式平衡，快速模式响应更直接；适用于角色和相机录制。点击切换。"
    >
      {label[recordControl]}
    </button>
  )
}

/** One-click cinematography framings — writes the active camera mark. */
function FramingRow(): JSX.Element {
  const framings: { kind: FramingKind; label: string; title: string }[] = [
    { kind: '2S', label: '双人', title: '双人构图：让两名角色并排入镜（选择 3–4 人可拍群像）' },
    { kind: 'OTS', label: '过肩', title: '过肩镜头：站在近处角色身后看向另一人' },
    { kind: 'REV', label: '反打', title: '反打角度：围绕主体旋转相机 180°' },
    { kind: 'TOP', label: '俯拍', title: '俯视构图：从正上方拍摄并容纳所有人' },
    { kind: 'LOW', label: '低角度', title: '低角度：膝盖高度向上拍摄主体' },
    { kind: 'DUTCH', label: '荷兰式', title: '荷兰式角度：倾斜地平线（再次点击翻转，再次点击恢复水平）' }
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
  const { t } = useBlockoutI18n()
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
      <div className="tool-row" title="排练 → 录制 → 回看：完整拍摄循环">
        <button
          className="btn small"
          onClick={rehearse}
          disabled={recording || countdown !== null}
          title="排练：从头播放并显示路径，拍摄前先检查走位"
        >
          🔁 排练
        </button>
        {recording ? (
          <button
            className="btn small"
            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            onClick={() => useStore.getState().setRecording(false)}
            title="停止录制并保存本次拍摄"
          >
            {t('viewport.stop')} take
          </button>
        ) : (
          <>
            <button
              className="btn small"
              onClick={() => startCountdown('camera')}
              disabled={countdown !== null}
              title="使用 3-2-1 倒计时录制相机运动；移动视图时已有走位会在下方回放"
            >
              ⏺ {t('viewport.recordCamera').replace('● ', '')}
            </button>
            <button
              className="btn small"
              onClick={() => startCountdown('performer')}
              disabled={countdown !== null || !singleEntity}
              title={
                singleEntity
                  ? '使用 3-2-1 倒计时录制此表演者，并用光标操控它'
                  : '请先选择一个角色或车辆，再录制其表演'
              }
            >
              ⏺ {t('viewport.recordPerformer').replace('● ', '')}
            </button>
          </>
        )}
        <button
          className="btn small"
          onClick={review}
          disabled={recording || countdown !== null}
          title="回看：通过镜头相机播放，效果与导出完全一致"
        >
          {t('viewport.review')}
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
          title="点击取消"
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
            {pending === 'performer' ? '正在录制表演…' : '正在录制相机…'} · 点击取消
          </div>
        </div>
      )}
    </>
  )
}

function GizmoModeRow(): JSX.Element {
  const { t } = useBlockoutI18n()
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
        title="使用控件箭头移动选择（G）"
      >
        ⇄ {t('viewport.move')}
      </button>
      <button
        className={`btn small ${mode === 'rotate' ? 'active' : ''}`}
        onClick={() => apply('rotate')}
        title="旋转选择——可旋转人物、车辆、道具或相机（R）"
      >
        ⟳ {t('viewport.rotate')}
      </button>
    </div>
  )
}

export function Viewport(): JSX.Element {
  const { t } = useBlockoutI18n()
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
    hint = `点击地面放置${uiText(placingChoreography.kind)}编舞（面向你）· 按 Esc 取消`
  else if (placingSequence)
    hint = `点击地面放置 ${placingSequence.count} 名表演者（面向你）· 按 Esc 取消`
  else if (placingAssetId) hint = `点击地面放置 · 按 ${window.blockout.platform.alternateModifier} 点击可连续放置 · 按 Esc 取消`
  else if (droppingMarks && selection?.kind === 'entity')
    hint = '按顺序点击地面添加标记 · 完成后按 Esc'
  else if (droppingMarks && selection?.kind === 'camera')
    hint = '点击地面添加相机标记 · 或使用“在当前视图添加相机标记”'
  else if (selection?.kind === 'entities')
    hint = `已选择 ${selection.entityIds.length} 个对象——拖动可整体移动 · 在检查器中绑定 · ⌫ 全部删除`

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
                title="观看镜头：从头通过镜头相机播放，画面与导出一致"
              >
                {t('viewport.playShot')}
              </button>
              <button
                className={`btn small ${lookThrough ? 'active' : ''}`}
                onClick={() => setLookThrough(!lookThrough)}
                title="通过镜头相机取景（C）"
              >
                {t('viewport.lookThrough')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setSelection({ kind: 'camera' })
                  emit('dropCameraMarkAtView', {})
                }}
                title="在当前视图添加相机标记"
              >
                {t('viewport.cameraMark')}
              </button>
              <button
                className={`btn small ${droppingMarks ? 'active' : ''}`}
                onClick={() => setDroppingMarks(!droppingMarks)}
                disabled={!selection}
                title="点击地面为选择添加标记（M）"
              >
                {t('viewport.marks')}
              </button>
              <button
                className={`btn small ${recording ? 'active' : ''}`}
                style={recording ? { color: 'var(--danger)', borderColor: 'var(--danger)' } : undefined}
                onClick={() => setRecording(!recording)}
                title={
                  singleEntitySelected
                    ? '录制当前角色/车辆：用光标操控，其他动作会在下方回放'
                    : '录制相机：移动视图，已有走位会在录制时回放'
                }
              >
                {recording ? t('viewport.stop') : singleEntitySelected ? t('viewport.recordPerformer') : t('viewport.recordCamera')}
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
              title="将选择放到其下方表面上——地面、桌面或卡车车厢"
            >
              ⬇ {t('viewport.ground')}
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
              {t('viewport.shotPreview')}
            </span>
            <span style={{ flex: 1 }} />
            <button
              className="btn small"
              style={{ padding: '2px 7px', fontSize: 10 }}
              title="切换预览尺寸"
              onClick={() =>
                setPipSize(pipSize === 'small' ? 'medium' : pipSize === 'medium' ? 'large' : 'small')
              }
            >
              {pipSize === 'small' ? 'S' : pipSize === 'medium' ? 'M' : 'L'}
            </button>
            <button
              className="btn small"
              style={{ padding: '2px 7px', fontSize: 10 }}
              title="隐藏预览"
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
          title="显示实时镜头预览"
        >
          {t('viewport.preview')}
        </button>
      )}
      {recording && (
        <div className="viewport-hint" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {singleEntitySelected
            ? '● 录制——在地面上移动光标，表演者会追随。■ 停止保存表演。'
            : '● 录制——环绕、平移或缩放视图，这就是镜头。■ 停止保存运动。'}
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
          <div>点击素材库项目，然后点击地面放置。</div>
        </div>
      )}
      {hasEntities && !hasMarks && mode === 'shoot' && !droppingMarks && (
        <div className="empty-state">
          <div>选择角色或相机，按 M 后点击地面添加标记。</div>
        </div>
      )}
    </>
  )
}
