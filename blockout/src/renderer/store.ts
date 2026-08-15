/**
 * Application state (zustand). One store owns the document, selection,
 * playback, and undo. All document mutations flow through mutate(), which
 * snapshots for undo and marks the project dirty — components never edit
 * the doc directly.
 */

import { create } from 'zustand'
import type { ProjectDoc, Scene, Shot, Entity, V3, GaitId, AspectId } from '@engine/types'
import {
  createProject,
  createScene,
  createShot,
  createEntity,
  createActorMark,
  createCameraMark,
  createScan,
  serializeProject,
  parseProject
} from '@engine/schema'
import { assetSpec } from '@engine/assets'
import { newId } from '@engine/ids'
import { generateSequence, choreographMotion } from '@engine/sequences'
import { buildRoutine } from '@engine/choreography'
import { ACTION_PRESETS } from '@engine/action-presets'

export type Mode = 'stage' | 'shoot' | 'deliver'

export type Selection =
  | { kind: 'entity'; entityId: string }
  | { kind: 'entities'; entityIds: string[] } // shift-click multi-select
  | { kind: 'camera' }
  | { kind: 'scan'; scanId: string } // an imported 3D-scan environment
  | { kind: 'mark'; entityId: string | 'camera'; markId: string }
  | { kind: 'marks'; entityId: string | 'camera'; markIds: string[] } // shift-click on pills
  | null

/** All entity ids covered by the current selection (single or multi). */
export function selectedEntityIds(sel: Selection): string[] {
  if (sel?.kind === 'entity') return [sel.entityId]
  if (sel?.kind === 'entities') return sel.entityIds
  return []
}

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface ExportProgress {
  running: boolean
  label: string
  frame: number
  totalFrames: number
  cancelRequested: boolean
  lastPackagePath?: string
  error?: string
}

interface BlockoutState {
  mode: Mode
  projectFolder: string | null
  doc: ProjectDoc | null
  sceneId: string | null
  shotId: string | null
  selection: Selection
  /** Asset id armed for click-to-place from the library. */
  placingAssetId: string | null
  /** Armed sequence: next floor click stages the crowd THERE. */
  placingSequence: { type: import('@engine/sequences').SequenceType; count: number; style: string } | null
  /** Armed choreography routine: next floor click stages the routine THERE. */
  placingChoreography: import('@engine/choreography').RoutineSpec | null
  /** When true, clicking the floor drops a mark for the selection. */
  droppingMarks: boolean
  lookThrough: boolean
  /** Picture-in-picture live shot preview size. */
  pipSize: 'off' | 'small' | 'medium' | 'large'
  /** Help & tutorial overlay. */
  helpOpen: boolean
  /** Spike-tape floor marks visible in the editor (HUD "Marks" eye). */
  showMarks: boolean
  /** Path ribbons + chevrons + time labels visible in the editor (HUD "Paths" eye). */
  showPaths: boolean
  /** The "Set your marks" blocking-coach walkthrough overlay. */
  coachOpen: boolean
  /** True while performing a live camera-move recording. */
  recording: boolean
  /** How tightly recording follows the mouse: precise = heavy smoothing. */
  recordControl: 'precise' | 'normal' | 'fast'
  playing: boolean
  time: number
  dirty: boolean
  undoStack: string[]
  redoStack: string[]
  toasts: Toast[]
  exportProgress: ExportProgress

  /* --- lifecycle --- */
  newProject(folder: string, name: string): void
  loadFromJson(folder: string, json: string): boolean
  markSaved(): void

  /* --- navigation --- */
  setMode(mode: Mode): void
  selectScene(sceneId: string): void
  selectShot(shotId: string): void
  setSelection(sel: Selection): void
  setPlacingAsset(assetId: string | null): void
  setPlacingSequence(seq: { type: import('@engine/sequences').SequenceType; count: number; style: string } | null): void
  setPlacingChoreography(spec: import('@engine/choreography').RoutineSpec | null): void
  setDroppingMarks(on: boolean): void
  setLookThrough(on: boolean): void
  setPipSize(size: 'off' | 'small' | 'medium' | 'large'): void
  setRecording(on: boolean): void
  setRecordControl(mode: 'precise' | 'normal' | 'fast'): void
  /** Select every mark in one timeline lane (camera or an entity). */
  selectAllMarksInLane(entityId: string | 'camera'): void
  /** Select every mark on every lane of the current shot. */
  selectAllMarks(): void
  /** Delete the marks in the current mark/marks selection. */
  deleteSelectedMarks(): void
  setHelpOpen(open: boolean): void
  setShowMarks(on: boolean): void
  setShowPaths(on: boolean): void
  setCoachOpen(open: boolean): void

  /* --- playback --- */
  setPlaying(playing: boolean): void
  setTime(time: number): void

  /* --- document mutations (all undoable) --- */
  mutate(label: string, fn: (doc: ProjectDoc) => void): void
  undo(): void
  redo(): void

  /* --- convenience accessors --- */
  scene(): Scene | null
  shot(): Shot | null

  /* --- high-level operations --- */
  addEntity(assetId: string, position: V3): string
  addSceneAfter(): void
  addShotToScene(sceneId: string): void
  dropActorMark(entityId: string, position: V3): void
  dropCameraMark(position: V3, pan: number, tilt: number, focalLength: number): void
  /** Shift-click: add/remove an entity from a multi-selection. */
  toggleEntitySelected(entityId: string): void
  /** Shift-click on a timeline pill: add/remove a mark from a multi-selection. */
  toggleMarkSelected(entityId: string | 'camera', markId: string): void
  /** Marry entities to a parent: they follow its motion at a fixed offset. */
  marryEntities(childIds: string[], parentId: string): void
  /** Detach entities, baking their current world pose into the transform. */
  unmarryEntities(entityIds: string[]): void
  /** Switch the shot's active camera to a bank entry by name ('A','B',…). */
  switchCamera(name: string): void
  /** Bank the active camera and start a fresh one (B, C, …). */
  addCameraToShot(): void
  /** Delete the active camera's move (all its marks) — e.g. to re-record. */
  clearCameraMarks(): void
  /** Snapshot the current shot as a draft version ("1A v2"). */
  saveDraftOfShot(): void
  /**
   * Drop a whole choreographed sequence — N dancers, a brawl, a chase —
   * into the current scene as one undoable step.
   */
  spawnSequence(opts: {
    type: import('@engine/sequences').SequenceType
    count: number
    style: string
    origin?: { x: number; z: number; heading: number }
  }): void
  /**
   * Drop a full choreography routine — a dance number, a paired fight, a
   * chase — into the scene at `at`, spawning fresh performers, as one
   * undoable step.
   */
  spawnChoreography(spec: import('@engine/choreography').RoutineSpec, at: { x: number; z: number; heading: number }): void
  /**
   * Apply a choreography routine to the currently selected PERSON entities:
   * keeps their assets/labels, replaces their track in the active take.
   */
  choreographSelected(spec: import('@engine/choreography').RoutineSpec): void
  /**
   * Apply a choreography routine to specific PERSON entities by id — the
   * selection-independent core of `choreographSelected`, so non-UI callers
   * (agent control) don't have to touch selection. Returns how many
   * performers were choreographed.
   */
  choreographEntities(entityIds: string[], spec: import('@engine/choreography').RoutineSpec): number
  /**
   * Restyle performers in place: replace each selected PERSON's choreography
   * with a motion preset (swap the dance, change the strike) at their spots.
   */
  applyMotionToEntities(entityIds: string[], presetId: string): void
  /** Replace each selected entity's path with an action preset from its pose. */
  applyActionToEntities(entityIds: string[], presetId: string): void
  /**
   * Import a Gaussian-splat / photogrammetry scan file into the project's
   * scans/ folder and attach it to the current scene as an environment.
   * Renderer-only content: hidden from every export pass.
   */
  importScan(sourcePath: string): Promise<void>
  /** Remove a scan from the current scene (leaves the copied file on disk). */
  removeScan(scanId: string): void
  /** Toggle a scan's editor-viewport visibility. */
  setScanVisible(scanId: string, visible: boolean): void
  /** Patch a scan's transform (position / rotationY / scale). */
  updateScanTransform(
    scanId: string,
    patch: Partial<{ position: V3; rotationY: number; scale: number; flipped: boolean }>
  ): void
  /** Save the current scene's staging as a reusable, globally persistent preset. */
  saveStagePreset(name: string): Promise<void>
  /** Stage a preset into a brand-new scene (originals stay untouched). */
  applyStagePreset(id: string): Promise<void>
  /** Copy a draft's content back into its main shot. */
  promoteDraft(draftId: string): void
  deleteDraft(draftId: string): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: string): void
  setExportProgress(p: Partial<ExportProgress>): void
}

const MAX_UNDO = 100

/** Coalesce rapid same-label mutations (slider swipes) into one undo step. */
let lastMutateLabel = ''
let lastMutateAt = 0
const COALESCE_MS = 800

/** After restoring a snapshot, make scene/shot ids point at real objects. */
function reconcileSelection(doc: ProjectDoc, sceneId: string | null, shotId: string | null): {
  sceneId: string | null
  shotId: string | null
} {
  const scene = doc.scenes.find((s) => s.id === sceneId) ?? doc.scenes[0] ?? null
  const shot = scene?.shots.find((s) => s.id === shotId) ?? scene?.shots[0] ?? null
  return { sceneId: scene?.id ?? null, shotId: shot?.id ?? null }
}

export const useStore = create<BlockoutState>((set, get) => ({
  mode: 'stage',
  projectFolder: null,
  doc: null,
  sceneId: null,
  shotId: null,
  selection: null,
  placingAssetId: null,
  placingSequence: null,
  placingChoreography: null,
  droppingMarks: false,
  lookThrough: false,
  pipSize: 'medium',
  recording: false,
  recordControl: 'normal',
  helpOpen: false,
  showMarks: true,
  showPaths: true,
  coachOpen: false,
  playing: false,
  time: 0,
  dirty: false,
  undoStack: [],
  redoStack: [],
  toasts: [],
  exportProgress: { running: false, label: '', frame: 0, totalFrames: 0, cancelRequested: false },

  newProject(folder, name) {
    const doc = createProject(name)
    const scene = doc.scenes[0]!
    set({
      doc,
      projectFolder: folder,
      sceneId: scene.id,
      shotId: scene.shots[0]!.id,
      mode: 'stage',
      selection: null,
      undoStack: [],
      redoStack: [],
      dirty: true,
      time: 0,
      playing: false
    })
  },

  loadFromJson(folder, json) {
    const { doc, issues } = parseProject(json)
    if (!doc) {
      get().toast(`Could not open project: ${issues[0]?.message ?? 'unknown error'}`, 'error')
      return false
    }
    const scene = doc.scenes[0] ?? null
    set({
      doc,
      projectFolder: folder,
      sceneId: scene?.id ?? null,
      shotId: scene?.shots[0]?.id ?? null,
      mode: 'stage',
      selection: null,
      undoStack: [],
      redoStack: [],
      dirty: false,
      time: 0,
      playing: false
    })
    return true
  },

  markSaved: () => set({ dirty: false }),

  setMode(mode) {
    // Mode switches remount the viewport and scene/shot switches rebuild the
    // evaluator — both would corrupt an in-flight export.
    if (get().exportProgress.running) return
    // Leaving for another mode must never trap the user in the camera view
    // (look-through has no exit button outside Shoot) or keep a recording
    // rolling against a viewport that no longer shows it.
    set({
      mode,
      placingAssetId: null,
      placingSequence: null,
      placingChoreography: null,
      droppingMarks: false,
      lookThrough: false,
      recording: false,
      playing: mode === 'deliver' ? get().playing : false
    })
  },
  selectScene(sceneId) {
    if (get().exportProgress.running) return
    const doc = get().doc
    const scene = doc?.scenes.find((s) => s.id === sceneId)
    set({ sceneId, shotId: scene?.shots[0]?.id ?? null, selection: null, time: 0, playing: false })
  },
  selectShot(shotId) {
    // exportAnimatic/contact-sheet iterate shots internally; they bypass this
    // guard by toggling exportProgress around each hop. User clicks land here.
    if (get().exportProgress.running) return
    set({ shotId, time: 0, playing: false })
  },
  setSelection: (selection) => set({ selection, droppingMarks: false }),
  setPlacingAsset: (placingAssetId) => set({ placingAssetId, placingSequence: null, placingChoreography: null }),
  setPlacingSequence: (placingSequence) => set({ placingSequence, placingAssetId: null, placingChoreography: null }),
  setPlacingChoreography: (placingChoreography) =>
    set({ placingChoreography, placingAssetId: null, placingSequence: null }),
  setDroppingMarks: (droppingMarks) => set({ droppingMarks }),
  setLookThrough: (lookThrough) => set({ lookThrough }),
  setPipSize: (pipSize) => set({ pipSize }),
  setRecording: (recording) => set({ recording }),
  setRecordControl: (recordControl) => set({ recordControl }),

  selectAllMarksInLane(entityId) {
    const scene = get().scene()
    const shot = get().shot()
    if (!scene || !shot) return
    const markIds =
      entityId === 'camera'
        ? shot.camera.marks.map((m) => m.id)
        : (scene.blocking
            .find((b) => b.id === shot.blockingTakeId)
            ?.tracks.find((t) => t.entityId === entityId)
            ?.marks.map((m) => m.id) ?? [])
    if (markIds.length === 0) return
    set({ selection: { kind: 'marks', entityId, markIds } })
  },

  selectAllMarks() {
    // Cross-lane selection reuses the per-lane shape with entityId '*'.
    const scene = get().scene()
    const shot = get().shot()
    if (!scene || !shot) return
    const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
    const all = [
      ...shot.camera.marks.map((m) => m.id),
      ...(take?.tracks.flatMap((t) => t.marks.map((m) => m.id)) ?? [])
    ]
    if (all.length === 0) return
    set({ selection: { kind: 'marks', entityId: '*', markIds: all } })
  },

  deleteSelectedMarks() {
    const sel = get().selection
    if (!sel || (sel.kind !== 'mark' && sel.kind !== 'marks')) return
    const ids = new Set(sel.kind === 'mark' ? [sel.markId] : sel.markIds)
    const n = ids.size
    get().mutate(n > 1 ? `delete ${n} marks` : 'delete mark', (doc) => {
      for (const scene of doc.scenes) {
        for (const shot of [...scene.shots, ...(scene.drafts ?? [])]) {
          shot.camera.marks = shot.camera.marks.filter((m) => !ids.has(m.id))
        }
        for (const take of scene.blocking) {
          for (const track of take.tracks) {
            track.marks = track.marks.filter((m) => !ids.has(m.id))
          }
          take.tracks = take.tracks.filter((t) => t.marks.length > 0)
        }
      }
    })
    set({ selection: null })
    get().toast(n > 1 ? `Deleted ${n} marks.` : 'Mark deleted.', 'info')
  },
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setShowMarks: (showMarks) => set({ showMarks }),
  setShowPaths: (showPaths) => set({ showPaths }),
  setCoachOpen: (coachOpen) => set({ coachOpen }),

  setPlaying(playing) {
    const { shot, time } = get()
    const s = shot()
    // Restart from 0 when hitting play at the end.
    if (playing && s && time >= s.duration - 0.01) set({ time: 0 })
    set({ playing })
  },
  setTime: (time) => set({ time }),

  mutate(label, fn) {
    const { doc, undoStack, exportProgress } = get()
    if (!doc) return
    if (exportProgress.running) {
      // The export loop is reading this document frame by frame; editing it
      // mid-export would change the video partway through.
      get().toast('Editing is locked while an export is running.', 'info')
      return
    }
    const next = structuredClone(doc)
    fn(next)
    const now = Date.now()
    const coalesce = label === lastMutateLabel && now - lastMutateAt < COALESCE_MS
    lastMutateLabel = label
    lastMutateAt = now
    if (coalesce) {
      // Keep the snapshot taken at the start of the swipe; just move the doc.
      set({ doc: next, dirty: true })
    } else {
      const snapshot = serializeProject(doc)
      set({
        doc: next,
        dirty: true,
        undoStack: [...undoStack.slice(-MAX_UNDO + 1), snapshot],
        redoStack: []
      })
    }
  },

  undo() {
    const { doc, undoStack, redoStack, sceneId, shotId, exportProgress } = get()
    if (!doc || undoStack.length === 0 || exportProgress.running) return
    lastMutateLabel = '' // an undo ends any coalescing run
    const prev = undoStack[undoStack.length - 1]!
    const { doc: restored } = parseProject(prev)
    if (!restored) return
    set({
      doc: restored,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, serializeProject(doc)],
      dirty: true,
      selection: null,
      // The restored doc may not contain the current scene/shot (e.g. undo
      // of "add shot") — point at real objects so the UI never goes blank.
      ...reconcileSelection(restored, sceneId, shotId)
    })
  },

  redo() {
    const { doc, undoStack, redoStack, sceneId, shotId, exportProgress } = get()
    if (!doc || redoStack.length === 0 || exportProgress.running) return
    lastMutateLabel = ''
    const next = redoStack[redoStack.length - 1]!
    const { doc: restored } = parseProject(next)
    if (!restored) return
    set({
      doc: restored,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, serializeProject(doc)],
      dirty: true,
      selection: null,
      ...reconcileSelection(restored, sceneId, shotId)
    })
  },

  scene() {
    const { doc, sceneId } = get()
    return doc?.scenes.find((s) => s.id === sceneId) ?? null
  },

  shot() {
    const { shotId } = get()
    const scene = get().scene()
    if (!scene) return null
    return (
      scene.shots.find((s) => s.id === shotId) ??
      scene.drafts?.find((s) => s.id === shotId) ??
      null
    )
  },

  addEntity(assetId, position) {
    const spec = assetSpec(assetId)
    const sceneId = get().sceneId
    const entity = createEntity(assetId, spec.name, position)
    get().mutate('add entity', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      // Number duplicates: "Man 2", "Man 3"…
      const count = scene.entities.filter((e) => e.assetId === assetId).length
      if (count > 0) entity.name = `${spec.name} ${count + 1}`
      scene.entities.push(entity)
    })
    set({ selection: { kind: 'entity', entityId: entity.id } })
    return entity.id
  },

  addSceneAfter() {
    get().mutate('add scene', (doc) => {
      const number = doc.scenes.length + 1
      doc.scenes.push(createScene(number))
    })
    const doc = get().doc!
    const added = doc.scenes[doc.scenes.length - 1]!
    get().selectScene(added.id)
  },

  addShotToScene(sceneId) {
    let newShotId: string | null = null
    get().mutate('add shot', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const letter = String.fromCharCode(65 + (scene.shots.length % 26))
      const shot = createShot(scene, `${scene.number}${letter}`)
      scene.shots.push(shot)
      newShotId = shot.id
    })
    if (newShotId) set({ shotId: newShotId, time: 0 })
  },

  dropActorMark(entityId, position) {
    const { sceneId, shotId, time } = get()
    get().mutate('drop mark', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      if (!scene || !shot) return
      const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
      if (!take) return
      let track = take.tracks.find((t) => t.entityId === entityId)
      if (!track) {
        track = { entityId, marks: [] }
        take.tracks.push(track)
      }
      const gait: GaitId = 'walk'
      // First mark lands at t=0 (starting position); later marks at playhead
      // or spaced 2s after the last mark, whichever is later.
      const lastTime = track.marks.reduce((m, k) => Math.max(m, k.time + k.hold), -1)
      const t = track.marks.length === 0 ? 0 : Math.max(time, lastTime + 2)
      track.marks.push(createActorMark(position, Math.min(t, shot.duration), gait))
    })
  },

  dropCameraMark(position, pan, tilt, focalLength) {
    const { sceneId, shotId, time } = get()
    get().mutate('drop camera mark', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      if (!shot) return
      const marks = shot.camera.marks
      const lastTime = marks.reduce((m, k) => Math.max(m, k.time + k.hold), -1)
      const t = marks.length === 0 ? 0 : Math.max(time, lastTime + 2)
      marks.push(createCameraMark(position, Math.min(t, shot.duration), pan, tilt, focalLength))
    })
  },

  toggleEntitySelected(entityId) {
    const sel = get().selection
    let ids = selectedEntityIds(sel)
    if (sel && sel.kind !== 'entity' && sel.kind !== 'entities') ids = []
    ids = ids.includes(entityId) ? ids.filter((i) => i !== entityId) : [...ids, entityId]
    set({
      selection:
        ids.length === 0
          ? null
          : ids.length === 1
            ? { kind: 'entity', entityId: ids[0]! }
            : { kind: 'entities', entityIds: ids },
      droppingMarks: false
    })
  },

  toggleMarkSelected(entityId, markId) {
    const sel = get().selection
    let ids: string[] = []
    if (sel?.kind === 'mark' && sel.entityId === entityId) ids = [sel.markId]
    else if (sel?.kind === 'marks' && sel.entityId === entityId) ids = [...sel.markIds]
    ids = ids.includes(markId) ? ids.filter((i) => i !== markId) : [...ids, markId]
    set({
      selection:
        ids.length === 0
          ? null
          : ids.length === 1
            ? { kind: 'mark', entityId, markId: ids[0]! }
            : { kind: 'marks', entityId, markIds: ids }
    })
  },

  marryEntities(childIds, parentId) {
    const sceneId = get().sceneId
    let married = 0
    let cycles = 0
    get().mutate('marry entities', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      // World pose through the marriage chain (parents may be married too).
      const worldOf = (id: string, depth = 0): { x: number; y: number; z: number; rotY: number } => {
        const e = scene.entities.find((x) => x.id === id)
        if (!e) return { x: 0, y: 0, z: 0, rotY: 0 }
        if (e.attachedTo && e.attachedLocal && depth < 4) {
          const p = worldOf(e.attachedTo, depth + 1)
          const cos = Math.cos(p.rotY)
          const sin = Math.sin(p.rotY)
          const l = e.attachedLocal
          return {
            x: p.x + l.x * cos + l.z * sin,
            y: p.y + l.y,
            z: p.z - l.x * sin + l.z * cos,
            rotY: p.rotY + l.rotY
          }
        }
        return { ...e.transform.position, rotY: e.transform.rotationY }
      }
      const wouldCycle = (childId: string): boolean => {
        let cursor: string | undefined = parentId
        for (let i = 0; i < 8 && cursor; i++) {
          if (cursor === childId) return true
          cursor = scene.entities.find((x) => x.id === cursor)?.attachedTo
        }
        return false
      }
      const pw = worldOf(parentId)
      for (const childId of childIds) {
        if (childId === parentId) continue
        if (wouldCycle(childId)) {
          cycles++
          continue
        }
        const child = scene.entities.find((x) => x.id === childId)
        if (!child) continue
        const cw = worldOf(childId)
        const dx = cw.x - pw.x
        const dz = cw.z - pw.z
        const cos = Math.cos(pw.rotY)
        const sin = Math.sin(pw.rotY)
        child.attachedTo = parentId
        child.attachedLocal = {
          x: dx * cos - dz * sin,
          y: cw.y - pw.y,
          z: dx * sin + dz * cos,
          rotY: cw.rotY - pw.rotY
        }
        married++
      }
    })
    if (married > 0) get().toast(`Married ${married} to the anchor — they now move together.`, 'success')
    if (cycles > 0) get().toast('Skipped a marriage that would loop back on itself.', 'error')
  },

  unmarryEntities(entityIds) {
    const sceneId = get().sceneId
    get().mutate('unmarry entities', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const worldOf = (id: string, depth = 0): { x: number; y: number; z: number; rotY: number } => {
        const e = scene.entities.find((x) => x.id === id)
        if (!e) return { x: 0, y: 0, z: 0, rotY: 0 }
        if (e.attachedTo && e.attachedLocal && depth < 4) {
          const p = worldOf(e.attachedTo, depth + 1)
          const cos = Math.cos(p.rotY)
          const sin = Math.sin(p.rotY)
          const l = e.attachedLocal
          return {
            x: p.x + l.x * cos + l.z * sin,
            y: p.y + l.y,
            z: p.z - l.x * sin + l.z * cos,
            rotY: p.rotY + l.rotY
          }
        }
        return { ...e.transform.position, rotY: e.transform.rotationY }
      }
      for (const id of entityIds) {
        const entity = scene.entities.find((x) => x.id === id)
        if (!entity?.attachedTo) continue
        const w = worldOf(id)
        entity.transform.position = { x: w.x, y: w.y, z: w.z }
        entity.transform.rotationY = w.rotY
        delete entity.attachedTo
        delete entity.attachedLocal
      }
    })
    get().toast('Unmarried — they move independently again.', 'info')
  },

  switchCamera(name) {
    const { sceneId, shotId } = get()
    get().mutate('switch camera', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot =
        scene?.shots.find((s) => s.id === shotId) ?? scene?.drafts?.find((s) => s.id === shotId)
      if (!shot?.cameraBank) return
      const idx = shot.cameraBank.findIndex((b) => b.name === name)
      if (idx < 0) return
      const incoming = shot.cameraBank[idx]!
      shot.cameraBank[idx] = { name: shot.cameraName ?? 'A', camera: shot.camera }
      shot.camera = incoming.camera
      shot.cameraName = incoming.name
    })
    set({ selection: { kind: 'camera' } })
  },

  addCameraToShot() {
    const { sceneId, shotId } = get()
    let added = ''
    get().mutate('add camera', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot =
        scene?.shots.find((s) => s.id === shotId) ?? scene?.drafts?.find((s) => s.id === shotId)
      if (!shot) return
      const used = new Set([shot.cameraName ?? 'A', ...(shot.cameraBank ?? []).map((b) => b.name)])
      let letter = 'B'
      for (let i = 1; i < 26; i++) {
        const candidate = String.fromCharCode(65 + i)
        if (!used.has(candidate)) {
          letter = candidate
          break
        }
      }
      shot.cameraBank = shot.cameraBank ?? []
      shot.cameraBank.push({ name: shot.cameraName ?? 'A', camera: shot.camera })
      shot.camera = {
        sensorId: shot.camera.sensorId,
        rig: 'sticks',
        rigIntensity: 0.5,
        seed: Math.floor(Math.random() * 1e9),
        marks: []
      }
      shot.cameraName = letter
      added = letter
    })
    if (added) {
      set({ selection: { kind: 'camera' } })
      get().toast(`Camera ${added} added — frame it and drop marks. Switch cameras with the A/B chips.`, 'success')
    }
  },

  clearCameraMarks() {
    const { sceneId, shotId } = get()
    get().mutate('clear camera move', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot =
        scene?.shots.find((s) => s.id === shotId) ?? scene?.drafts?.find((s) => s.id === shotId)
      if (shot) shot.camera.marks = []
    })
    get().toast('Camera move cleared — record or drop new marks.', 'info')
  },

  saveDraftOfShot() {
    const { sceneId, shotId } = get()
    let draftName = ''
    get().mutate('save draft', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      const current =
        scene.shots.find((s) => s.id === shotId) ?? scene.drafts?.find((s) => s.id === shotId)
      if (!current) return
      const mainId = current.draftOf ?? current.id
      const main = scene.shots.find((s) => s.id === mainId) ?? current
      const clone = structuredClone(current)
      clone.id = newId('shot')
      clone.draftOf = mainId
      clone.camera.marks = clone.camera.marks.map((m) => ({ ...m, id: newId('cmark') }))
      clone.cameraBank = clone.cameraBank?.map((b) => ({
        ...b,
        camera: { ...b.camera, marks: b.camera.marks.map((m) => ({ ...m, id: newId('cmark') })) }
      }))
      scene.drafts = scene.drafts ?? []
      const version = scene.drafts.filter((d) => d.draftOf === mainId).length + 1
      clone.name = `${main.name} v${version}`
      draftName = clone.name
      scene.drafts.push(clone)
    })
    if (draftName) get().toast(`Saved as draft "${draftName}" — keep experimenting safely.`, 'success')
  },

  promoteDraft(draftId) {
    const { sceneId } = get()
    let promotedInto: string | null = null
    get().mutate('promote draft', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const draft = scene?.drafts?.find((d) => d.id === draftId)
      if (!scene || !draft?.draftOf) return
      const main = scene.shots.find((s) => s.id === draft.draftOf)
      if (!main) return
      main.duration = draft.duration
      main.fps = draft.fps
      main.aspect = draft.aspect
      main.blockingTakeId = draft.blockingTakeId
      main.camera = structuredClone(draft.camera)
      main.cameraName = draft.cameraName
      main.cameraBank = draft.cameraBank ? structuredClone(draft.cameraBank) : undefined
      main.notes = draft.notes
      main.referenceVideo = draft.referenceVideo ? { ...draft.referenceVideo } : undefined
      promotedInto = main.id
    })
    if (promotedInto) {
      set({ shotId: promotedInto, time: 0, playing: false })
      get().toast('Draft promoted — it is now the shot.', 'success')
    }
  },

  deleteDraft(draftId) {
    const { sceneId, shotId } = get()
    let fallback: string | null = null
    get().mutate('delete draft', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene?.drafts) return
      const draft = scene.drafts.find((d) => d.id === draftId)
      scene.drafts = scene.drafts.filter((d) => d.id !== draftId)
      if (shotId === draftId) fallback = draft?.draftOf ?? scene.shots[0]?.id ?? null
    })
    if (fallback) set({ shotId: fallback, time: 0, playing: false })
  },

  spawnSequence(opts) {
    const { sceneId, shotId } = get()
    const duration = get().shot()?.duration ?? 8
    const origin = opts.origin ?? { x: 0, z: 0, heading: 0 }
    const specs = generateSequence({
      type: opts.type,
      count: opts.count,
      style: opts.style,
      origin,
      duration
    })
    const newIds: string[] = []
    get().mutate(`stage ${opts.type} sequence`, (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
      if (!scene || !take) return
      for (const spec of specs) {
        const entity = createEntity(spec.assetId, spec.name, { ...spec.position })
        entity.transform.rotationY = spec.rotationY
        if (spec.label) entity.label = { ...spec.label }
        scene.entities.push(entity)
        newIds.push(entity.id)
        if (spec.marks.length > 0) {
          take.tracks.push({
            entityId: entity.id,
            marks: spec.marks.map((m) => ({
              id: newId('mark'),
              time: m.time,
              hold: m.hold,
              easeIn: m.easeIn,
              easeOut: m.easeOut,
              position: { ...m.position },
              gait: m.gait,
              joints: m.joints ? { ...m.joints } : undefined
            }))
          })
        }
      }
    })
    if (newIds.length > 0) {
      set({ selection: { kind: 'entities', entityIds: newIds } })
      get().toast(
        `${newIds.length} performers staged and choreographed — ▶ to watch. Drag the group to reposition; every performer stays individually editable.`,
        'success'
      )
    }
  },

  spawnChoreography(spec, at) {
    const { sceneId, shotId } = get()
    const duration = get().shot()?.duration ?? spec.durationS
    const specs = buildRoutine({ ...spec, durationS: duration }, { origin: at })
    const newIds: string[] = []
    get().mutate(`choreograph ${spec.kind}`, (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
      if (!scene || !take) return
      for (const espec of specs) {
        const entity = createEntity(espec.assetId, espec.name, { ...espec.position })
        entity.transform.rotationY = espec.rotationY
        if (espec.label) entity.label = { ...espec.label }
        scene.entities.push(entity)
        newIds.push(entity.id)
        if (espec.marks.length > 0) {
          take.tracks.push({
            entityId: entity.id,
            marks: espec.marks.map((m) => ({
              id: newId('mark'),
              time: m.time,
              hold: m.hold,
              easeIn: m.easeIn,
              easeOut: m.easeOut,
              position: { ...m.position },
              gait: m.gait,
              arriveHeading: m.arriveHeading,
              joints: m.joints ? { ...m.joints } : undefined
            }))
          })
        }
      }
    })
    if (newIds.length > 0) {
      set({ selection: { kind: 'entities', entityIds: newIds } })
      get().toast(
        `Choreographed ${spec.kind} with ${newIds.length} performer${newIds.length > 1 ? 's' : ''} — ▶ to watch. Every performer stays individually editable.`,
        'success'
      )
    }
  },

  choreographSelected(spec) {
    get().choreographEntities(selectedEntityIds(get().selection), spec)
  },

  choreographEntities(entityIds, spec) {
    const { sceneId, shotId } = get()
    const scene = get().scene()
    const people = entityIds
      .map((id) => scene?.entities.find((e) => e.id === id))
      .filter((e): e is Entity => !!e && e.assetId.startsWith('person.'))
    if (people.length === 0) {
      get().toast('Choreography applies to people — select characters first.', 'info')
      return 0
    }
    // Stage the routine around the group's centroid, facing the first pick.
    const cx = people.reduce((s, e) => s + e.transform.position.x, 0) / people.length
    const cz = people.reduce((s, e) => s + e.transform.position.z, 0) / people.length
    const heading = people[0]!.transform.rotationY
    const duration = get().shot()?.duration ?? spec.durationS
    const specs = buildRoutine(
      { ...spec, performers: people.length, durationS: duration },
      { origin: { x: cx, z: cz, heading } }
    )
    let applied = 0
    get().mutate(`apply choreography: ${spec.kind}`, (doc) => {
      const dScene = doc.scenes.find((s) => s.id === sceneId)
      const shot = dScene?.shots.find((s) => s.id === shotId)
      const take = dScene?.blocking.find((b) => b.id === shot?.blockingTakeId)
      if (!dScene || !take) return
      for (let i = 0; i < people.length && i < specs.length; i++) {
        const entity = dScene.entities.find((e) => e.id === people[i]!.id)
        const espec = specs[i]!
        if (!entity) continue
        entity.transform.rotationY = espec.rotationY
        let track = take.tracks.find((t) => t.entityId === entity.id)
        if (!track) {
          track = { entityId: entity.id, marks: [] }
          take.tracks.push(track)
        }
        track.marks = espec.marks.map((m) => ({
          id: newId('mark'),
          time: m.time,
          hold: m.hold,
          easeIn: m.easeIn,
          easeOut: m.easeOut,
          position: { ...m.position },
          gait: m.gait,
          arriveHeading: m.arriveHeading,
          joints: m.joints ? { ...m.joints } : undefined
        }))
        applied++
      }
    })
    if (applied > 0)
      get().toast(`Choreographed ${applied} performer${applied > 1 ? 's' : ''} — ▶ to watch.`, 'success')
    return applied
  },

  applyMotionToEntities(entityIds, presetId) {
    const { sceneId, shotId } = get()
    const duration = get().shot()?.duration ?? 8
    let applied = 0
    get().mutate('restyle: motion', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
      if (!scene || !take) return
      for (const id of entityIds) {
        const entity = scene.entities.find((e) => e.id === id)
        if (!entity || !entity.assetId.startsWith('person.')) continue
        const specs = choreographMotion(
          presetId,
          { ...entity.transform.position },
          entity.transform.rotationY,
          duration
        )
        if (!specs || specs.length === 0) continue
        let track = take.tracks.find((t) => t.entityId === id)
        if (!track) {
          track = { entityId: id, marks: [] }
          take.tracks.push(track)
        }
        track.marks = specs.map((m) => ({
          id: newId('mark'),
          time: m.time,
          hold: m.hold,
          easeIn: m.easeIn,
          easeOut: m.easeOut,
          position: { ...m.position },
          gait: m.gait,
          joints: m.joints ? { ...m.joints } : undefined
        }))
        applied++
      }
    })
    if (applied > 0) get().toast(`Restyled ${applied} performer${applied > 1 ? 's' : ''} — ▶ to watch.`, 'success')
    else get().toast('That style applies to people — select characters.', 'info')
  },

  applyActionToEntities(entityIds, presetId) {
    const { sceneId, shotId } = get()
    const duration = get().shot()?.duration ?? 8
    const preset = ACTION_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    let applied = 0
    get().mutate('restyle: action', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const shot = scene?.shots.find((s) => s.id === shotId)
      const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
      if (!scene || !take) return
      for (const id of entityIds) {
        const entity = scene.entities.find((e) => e.id === id)
        if (!entity) continue
        const specs = preset.generate({
          start: {
            x: entity.transform.position.x,
            y: entity.transform.position.y,
            z: entity.transform.position.z,
            heading: entity.transform.rotationY
          },
          duration
        })
        let track = take.tracks.find((t) => t.entityId === id)
        if (!track) {
          track = { entityId: id, marks: [] }
          take.tracks.push(track)
        }
        track.marks = specs.map((m) => ({
          id: newId('mark'),
          time: m.time,
          hold: m.hold,
          easeIn: m.easeIn,
          easeOut: m.easeOut,
          position: { ...m.position },
          gait: m.gait
        }))
        applied++
      }
    })
    if (applied > 0) get().toast(`Applied ${preset.name} to ${applied} performer${applied > 1 ? 's' : ''}.`, 'success')
  },

  async importScan(sourcePath) {
    const { sceneId, projectFolder } = get()
    if (!projectFolder) {
      get().toast('Open or save a project before importing a scan.', 'error')
      return
    }
    let result: { relativePath: string; name: string }
    try {
      result = await window.blockout.importScan(projectFolder, sourcePath)
    } catch (e) {
      get().toast(`Scan import failed: ${(e as Error).message}`, 'error')
      return
    }
    const scan = createScan(result.name, result.relativePath, { x: 0, y: 0, z: 0 })
    get().mutate('import 3D scan', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene) return
      scene.scans = scene.scans ?? []
      // Number duplicates: "living-room 2", "living-room 3"…
      const count = scene.scans.filter((s) => s.name === scan.name).length
      if (count > 0) scan.name = `${scan.name} ${count + 1}`
      scene.scans.push(scan)
    })
    set({ selection: { kind: 'scan', scanId: scan.id } })
    get().toast(
      `Scan "${scan.name}" imported — block your action inside it. Scans stay in the editor and never appear in exports.`,
      'success'
    )
  },

  removeScan(scanId) {
    const { sceneId, selection } = get()
    get().mutate('remove scan', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      if (!scene?.scans) return
      scene.scans = scene.scans.filter((s) => s.id !== scanId)
    })
    if (selection?.kind === 'scan' && selection.scanId === scanId) set({ selection: null })
  },

  setScanVisible(scanId, visible) {
    const { sceneId } = get()
    get().mutate('scan visibility', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const scan = scene?.scans?.find((s) => s.id === scanId)
      if (scan) scan.visible = visible
    })
  },

  updateScanTransform(scanId, patch) {
    const { sceneId } = get()
    get().mutate('scan transform', (doc) => {
      const scene = doc.scenes.find((s) => s.id === sceneId)
      const scan = scene?.scans?.find((s) => s.id === scanId)
      if (!scan) return
      if (patch.position) scan.position = { ...scan.position, ...patch.position }
      if (patch.rotationY !== undefined) scan.rotationY = patch.rotationY
      if (patch.scale !== undefined) scan.scale = Math.max(0.01, patch.scale)
      if (patch.flipped !== undefined) {
        if (patch.flipped) scan.flipped = true
        else delete scan.flipped
      }
    })
  },

  async saveStagePreset(name) {
    const scene = get().scene()
    if (!scene) return
    // A preset is the STAGING: entities + environment + blocking choreography.
    // Shots/cameras stay with the project — presets are starting points.
    const payload = {
      presetVersion: 1,
      name,
      environment: structuredClone(scene.environment),
      entities: structuredClone(scene.entities),
      blocking: structuredClone(scene.blocking)
    }
    const res = await window.blockout.presetSave(name, JSON.stringify(payload))
    if (res.ok) get().toast(`Preset "${name}" saved — reuse it from the Library in any project.`, 'success')
    else get().toast(`Could not save preset: ${res.error ?? 'unknown error'}`, 'error')
  },

  async applyStagePreset(id) {
    const json = await window.blockout.presetLoad(id)
    if (!json) {
      get().toast('Preset not found — it may have been deleted.', 'error')
      return
    }
    let payload: {
      name?: string
      environment?: Scene['environment']
      entities?: Scene['entities']
      blocking?: Scene['blocking']
    }
    try {
      payload = JSON.parse(json)
    } catch {
      get().toast('Preset file is corrupted.', 'error')
      return
    }
    // Stage into a brand-new scene with fresh ids so the preset (and any
    // scene it was saved from) is never mutated by later edits.
    let newSceneId: string | null = null
    get().mutate('apply stage preset', (doc) => {
      const scene = createScene(doc.scenes.length + 1)
      if (payload.name) scene.name = payload.name
      if (payload.environment) scene.environment = structuredClone(payload.environment)
      const idMap = new Map<string, string>()
      for (const src of payload.entities ?? []) {
        const e = structuredClone(src)
        const fresh = newId('ent')
        idMap.set(e.id, fresh)
        e.id = fresh
        scene.entities.push(e)
      }
      // Remap marriages and choreography onto the fresh entity ids.
      for (const e of scene.entities) {
        if (e.attachedTo) e.attachedTo = idMap.get(e.attachedTo) ?? undefined
      }
      const master = scene.blocking[0]!
      for (const take of payload.blocking ?? []) {
        for (const track of take.tracks) {
          const entityId = idMap.get(track.entityId)
          if (!entityId) continue
          master.tracks.push({
            entityId,
            marks: track.marks.map((m) => ({
              ...structuredClone(m),
              id: newId('mark'),
              attachTo: m.attachTo ? idMap.get(m.attachTo) : undefined
            }))
          })
        }
      }
      doc.scenes.push(scene)
      newSceneId = scene.id
    })
    if (newSceneId) {
      get().selectScene(newSceneId)
      get().toast(`Staged "${payload.name ?? 'preset'}" as a new scene — the original preset is untouched.`, 'success')
    }
  },

  toast(text, kind = 'info') {
    const id = newId('toast')
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), 5000)
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setExportProgress: (p) =>
    set((s) => ({ exportProgress: { ...s.exportProgress, ...p } }))
}))

/** Serialize current doc for saving. */
export function currentProjectJson(): string | null {
  const doc = useStore.getState().doc
  return doc ? serializeProject(doc) : null
}

export type { AspectId, Entity }
