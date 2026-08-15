// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Reference video underlay: play any imported video (including depth-map
 * videos) ghosted over the viewport or as picture-in-picture, timeline-
 * synced, so you can match an existing shot's camera/character motion by
 * eye. The pragmatic v1 of reference ingestion.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

export function ReferenceUnderlay(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const time = useStore((s) => s.time)
  const playing = useStore((s) => s.playing)
  const folder = useStore((s) => s.projectFolder)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const shot = scene?.shots.find((s) => s.id === shotId)
  const ref = shot?.referenceVideo

  const videoRef = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState<string | null>(null)

  // Load the video bytes from the project folder into a blob URL.
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    setSrc(null)
    if (ref && folder) {
      void window.blockout.readProjectFile(folder, ref.path).then((buf) => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([buf], { type: 'video/mp4' }))
        setSrc(url)
      })
    }
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [ref?.path, folder])

  // Keep the video clock locked to the timeline.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !ref) return
    const target = Math.max(0, time + ref.timeOffset)
    if (playing) {
      if (v.paused) void v.play().catch(() => {})
      if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target
    } else {
      if (!v.paused) v.pause()
      if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target
    }
  }, [time, playing, ref])

  if (!ref || !src) return null

  const style: React.CSSProperties =
    ref.mode === 'ghost'
      ? {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          opacity: ref.opacity,
          pointerEvents: 'none',
          zIndex: 3
        }
      : {
          position: 'absolute',
          right: 12,
          bottom: 12,
          width: '32%',
          borderRadius: 8,
          border: '1px solid var(--border-strong)',
          opacity: Math.max(0.85, ref.opacity),
          pointerEvents: 'none',
          zIndex: 3
        }

  return <video ref={videoRef} src={src} style={style} muted playsInline />
}

/** Toolbar controls for the underlay (Shoot mode). */
export function ReferenceControls(): JSX.Element | null {
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const folder = useStore((s) => s.projectFolder)
  const mutate = useStore((s) => s.mutate)
  const toast = useStore((s) => s.toast)
  const [open, setOpen] = useState(false)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const shot = scene?.shots.find((s) => s.id === shotId)
  if (!shot) return null
  const ref = shot.referenceVideo

  const attach = async (): Promise<void> => {
    if (!folder) return
    const file = await window.blockout.pickFile([
      { name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'm4v'] }
    ])
    if (!file) return
    const imported = await window.blockout.importReference(folder, file)
    mutate('attach reference', (doc) => {
      for (const sc of doc.scenes) {
        const sh = sc.shots.find((x) => x.id === shot.id)
        if (sh) sh.referenceVideo = { path: imported.relativePath, opacity: 0.5, mode: 'ghost', timeOffset: 0 }
      }
    })
    setOpen(true)
    toast('Reference attached — match your blocking against it.', 'success')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`btn small ${ref ? 'active' : ''}`}
        title="Reference video underlay — match an existing shot by eye"
        onClick={() => (ref ? setOpen(!open) : void attach())}
      >
        🎞 Ref
      </button>
      {open && ref && (
        <div
          style={{
            position: 'absolute',
            top: 34,
            right: 0,
            width: 220,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border-strong)',
            borderRadius: 8,
            padding: 12,
            zIndex: 20
          }}
        >
          <div className="field">
            <label>Opacity ({Math.round(ref.opacity * 100)}%)</label>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={ref.opacity}
              onChange={(e) =>
                mutate('ref opacity', (doc) => {
                  for (const sc of doc.scenes) {
                    const sh = sc.shots.find((x) => x.id === shot.id)
                    if (sh?.referenceVideo) sh.referenceVideo.opacity = Number(e.target.value)
                  }
                })
              }
            />
          </div>
          <div className="field">
            <label>Mode</label>
            <div className="seg">
              {(['ghost', 'pip'] as const).map((m) => (
                <button
                  key={m}
                  className={ref.mode === m ? 'active' : ''}
                  onClick={() =>
                    mutate('ref mode', (doc) => {
                      for (const sc of doc.scenes) {
                        const sh = sc.shots.find((x) => x.id === shot.id)
                        if (sh?.referenceVideo) sh.referenceVideo.mode = m
                      }
                    })
                  }
                >
                  {m === 'ghost' ? 'Ghost overlay' : 'PiP'}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Time offset ({ref.timeOffset.toFixed(1)}s)</label>
            <input
              type="range"
              min={-10}
              max={10}
              step={0.1}
              value={ref.timeOffset}
              onChange={(e) =>
                mutate('ref offset', (doc) => {
                  for (const sc of doc.scenes) {
                    const sh = sc.shots.find((x) => x.id === shot.id)
                    if (sh?.referenceVideo) sh.referenceVideo.timeOffset = Number(e.target.value)
                  }
                })
              }
            />
          </div>
          <button
            className="btn small danger"
            style={{ width: '100%' }}
            onClick={() => {
              mutate('remove reference', (doc) => {
                for (const sc of doc.scenes) {
                  const sh = sc.shots.find((x) => x.id === shot.id)
                  if (sh) delete sh.referenceVideo
                }
              })
              setOpen(false)
            }}
          >
            Remove reference
          </button>
        </div>
      )}
    </div>
  )
}
