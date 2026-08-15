// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Deliver mode: pick a generator profile, choose passes, export the
 * package, copy the generated prompt, and hand off to Blender/ComfyUI.
 */

import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { BUILTIN_PROFILES, getProfile } from '@engine/profiles'
import { generatePrompt } from '@engine/prompt'
import {
  exportShot,
  exportAnimatic,
  exportContactSheet,
  exportDims,
  exportStillAtPlayhead,
  type ExportResolution
} from '../export/exporter'
import { exportGlb } from '../export/gltf'

export function DeliverPanel(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const progress = useStore((s) => s.exportProgress)
  const setExportProgress = useStore((s) => s.setExportProgress)
  const toast = useStore((s) => s.toast)
  const mutate = useStore((s) => s.mutate)

  const scene = doc?.scenes.find((s) => s.id === sceneId)
  const shot = scene?.shots.find((s) => s.id === shotId)

  const [profileId, setProfileId] = useState(doc?.settings.defaultProfileId ?? 'seedance-2')
  const [passes, setPasses] = useState({ clean: true, depth: true, normal: false })
  const [labels, setLabels] = useState<'on' | 'stillsOnly' | 'off'>('stillsOnly')
  const [resolution, setResolution] = useState<ExportResolution>('auto')

  const profile = getProfile(profileId)
  const prompt = useMemo(
    () => (scene && shot ? generatePrompt(scene, shot, profile) : ''),
    [scene, shot, profile]
  )

  if (!scene || !shot) {
    return (
      <div className="deliver-panel">
        <div className="panel-title">Deliver</div>
        <p style={{ color: 'var(--text-dim)' }}>Select a shot to export.</p>
      </div>
    )
  }

  const dims = exportDims(profile, shot.aspect, resolution)
  const overCap = profile.maxDuration !== undefined && shot.duration > profile.maxDuration
  const pct =
    progress.totalFrames > 0 ? Math.round((progress.frame / progress.totalFrames) * 100) : 0

  const run = async (): Promise<void> => {
    const res = await exportShot({ profileId, passes, labels, resolution })
    if (res.ok && res.packagePath) {
      toast('Export complete.', 'success')
      void window.blockout.showFolder(res.packagePath)
    } else if (res.error && res.error !== 'cancelled') {
      toast(`Export failed: ${res.error}`, 'error')
    }
  }

  return (
    <div className="deliver-panel">
      <div className="panel-title">Deliver — {scene.name} / Shot {shot.name}</div>

      <div className="field">
        <label>Target generator</label>
        <select
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value)
            mutate('default profile', (doc) => {
              doc.settings.defaultProfileId = e.target.value
            })
          }}
        >
          {BUILTIN_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.vendor})
            </option>
          ))}
        </select>
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        {profile.attachHint}
      </p>

      {overCap && (
        <div className="warning-chip" style={{ marginBottom: 10 }}>
          ⚠ Shot is {shot.duration.toFixed(1)}s but {profile.name} caps clips at{' '}
          {profile.maxDuration}s — consider shortening.
        </div>
      )}

      <div className="field">
        <label>
          Output — {dims.width}×{dims.height} @ {shot.fps}fps · {shot.aspect}
        </label>
        <div className="seg">
          <button className={passes.clean ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, clean: !p.clean }))}>
            Clean
          </button>
          <button className={passes.depth ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, depth: !p.depth }))}>
            Depth
          </button>
          <button className={passes.normal ? 'active' : ''} onClick={() => setPasses((p) => ({ ...p, normal: !p.normal }))}>
            Normal
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
          Physical-sky presets render into the <b>Clean</b> plate (deterministic, byte-reproducible) and
          are held out of the Depth and Normal passes. Imported 3D scans are a staging aid and stay out
          of every pass; they&apos;re listed in the package&apos;s <code>metadata.json</code>.
        </p>
      </div>

      <div className="field">
        <label>Resolution</label>
        <div className="seg">
          <button
            className={resolution === 'auto' ? 'active' : ''}
            onClick={() => setResolution('auto')}
            title={`The profile's native size`}
          >
            Auto
          </button>
          <button
            className={resolution === '720p' ? 'active' : ''}
            onClick={() => setResolution('720p')}
            title="720p — what Seedance accepts for reference files. Applies to videos, stills, and animatics."
          >
            720p
          </button>
          <button
            className={resolution === '1080p' ? 'active' : ''}
            onClick={() => setResolution('1080p')}
            title="1080p"
          >
            1080p
          </button>
        </div>
      </div>

      <div className="field">
        <label>Labels</label>
        <div className="seg">
          <button className={labels === 'on' ? 'active' : ''} onClick={() => setLabels('on')}>
            In video
          </button>
          <button className={labels === 'stillsOnly' ? 'active' : ''} onClick={() => setLabels('stillsOnly')}>
            Stills only
          </button>
          <button className={labels === 'off' ? 'active' : ''} onClick={() => setLabels('off')}>
            Off
          </button>
        </div>
      </div>

      {progress.running ? (
        <div className="field">
          <label>
            {progress.label} {progress.frame}/{progress.totalFrames}
          </label>
          <div className="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <button
            className="btn small danger"
            style={{ marginTop: 8 }}
            onClick={() => setExportProgress({ cancelRequested: true })}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ width: '100%', marginBottom: 10 }}
          disabled={!passes.clean && !passes.depth && !passes.normal}
          onClick={() => void run()}
        >
          Export shot package
        </button>
      )}

      <button
        className="btn"
        style={{ width: '100%', marginBottom: 10 }}
        disabled={progress.running}
        onClick={() =>
          void exportStillAtPlayhead(profileId, resolution, labels !== 'off').then((r) => {
            if (r.ok && r.packagePath) {
              toast('Frame exported.', 'success')
              void window.blockout.showFolder(r.packagePath)
            } else if (r.error) toast(`Frame export failed: ${r.error}`, 'error')
          })
        }
        title="Export ONLY the frame at the playhead as a full-quality PNG — scrub to the exact moment you want first"
      >
        📸 Export this frame (at playhead)
      </button>

      {progress.lastPackagePath && !progress.running && (
        <button
          className="btn small"
          style={{ width: '100%', marginBottom: 14 }}
          onClick={() => void window.blockout.showFolder(progress.lastPackagePath!)}
        >
          {window.blockout.platform.isMac ? 'Reveal last export in Finder' : 'Show last export in Folder'}
        </button>
      )}

      <div className="panel-title" style={{ marginTop: 10 }}>
        Prompt for {profile.name}
      </div>
      <div className="prompt-box">{prompt}</div>
      <button
        className="btn small"
        style={{ width: '100%', margin: '8px 0 18px' }}
        onClick={() => {
          void navigator.clipboard.writeText(prompt)
          toast('Prompt copied.', 'success')
        }}
      >
        Copy prompt
      </button>

      <div className="panel-title">Scene tools</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportAnimatic(profileId, resolution).then((r) => {
              if (r.ok && r.packagePath) {
                toast('Animatic exported.', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error && r.error !== 'cancelled') toast(`Animatic failed: ${r.error}`, 'error')
            })
          }
        >
          Export scene animatic ({scene.shots.length} shots)
        </button>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportContactSheet().then((r) => {
              if (r.ok && r.packagePath) {
                toast('Contact sheet exported.', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error) toast(`Contact sheet failed: ${r.error}`, 'error')
            })
          }
        >
          Export contact sheet
        </button>
        <button
          className="btn"
          disabled={progress.running}
          onClick={() =>
            void exportGlb(profileId).then((r) => {
              if (r.ok && r.packagePath) {
                toast('Blender package exported (.glb + import script).', 'success')
                void window.blockout.showFolder(r.packagePath)
              } else if (r.error) toast(`glTF export failed: ${r.error}`, 'error')
            })
          }
        >
          Export to Blender (.glb)
        </button>
      </div>
    </div>
  )
}
