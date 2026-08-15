// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Renderer side of the agent control server (see src/main/control.ts and
 * mcp/blockout-mcp.mjs). External agents — Claude Code, Codex, Hermes, any
 * MCP client — drive the app through a whitelist of actions executed here
 * against the same store/scene paths the UI uses, so everything an agent
 * does is undoable, autosaved, and visible live.
 */

import { useStore } from '../store'
import { ASSET_CATALOG, assetSpec } from '@engine/assets'
import { createActorMark, createCameraMark } from '@engine/schema'
import { newId } from '@engine/ids'
import { renderStillPngForTest } from '../export/exporter'
import { getSceneManager } from '../export/scene-access'
import type { AspectId, GaitId } from '@engine/types'
import type { ChoreoKind, FormationId, RoutineSpec } from '@engine/choreography'
import type { FramingKind } from '../bus'

type Params = Record<string, unknown>
type ControlResult = { ok: boolean; data?: unknown; error?: string }

const str = (p: Params, k: string): string | undefined =>
  typeof p[k] === 'string' ? (p[k] as string) : undefined
const flt = (p: Params, k: string): number | undefined =>
  typeof p[k] === 'number' && isFinite(p[k] as number) ? (p[k] as number) : undefined
const bool = (p: Params, k: string): boolean | undefined =>
  typeof p[k] === 'boolean' ? (p[k] as boolean) : undefined
const strList = (p: Params, k: string): string[] =>
  Array.isArray(p[k]) ? (p[k] as unknown[]).filter((v): v is string => typeof v === 'string') : []

const toRad = (deg: number): number => (deg * Math.PI) / 180
const toDeg = (rad: number): number => Math.round((rad * 180) / Math.PI)

function requireManager(): NonNullable<ReturnType<typeof getSceneManager>> {
  const m = getSceneManager()
  if (!m) throw new Error('Viewport not ready yet — try again in a moment.')
  return m
}

function requireDoc(): void {
  if (!useStore.getState().doc) {
    throw new Error('No project open — create or open a project in the app first.')
  }
}

function summary(): unknown {
  const s = useStore.getState()
  const scene = s.scene()
  const shot = s.shot()
  const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
  return {
    project: s.doc?.name ?? null,
    mode: s.mode,
    time: s.time,
    scene: scene
      ? {
          id: scene.id,
          name: scene.name,
          lighting: scene.environment.lighting,
          entities: scene.entities.map((e) => ({
            id: e.id,
            name: e.name,
            assetId: e.assetId,
            x: e.transform.position.x,
            y: e.transform.position.y,
            z: e.transform.position.z,
            rotationDeg: toDeg(e.transform.rotationY),
            label: e.label?.text,
            attachedTo: e.attachedTo,
            markCount: take?.tracks.find((t) => t.entityId === e.id)?.marks.length ?? 0
          })),
          scans: (scene.scans ?? []).map((sc) => ({
            id: sc.id,
            name: sc.name,
            visible: sc.visible,
            x: sc.position.x,
            y: sc.position.y,
            z: sc.position.z,
            rotationDeg: toDeg(sc.rotationY),
            scale: sc.scale
          }))
        }
      : null,
    shot: shot
      ? {
          id: shot.id,
          name: shot.name,
          duration: shot.duration,
          fps: shot.fps,
          aspect: shot.aspect,
          camera: shot.cameraName ?? 'A',
          cameraMarks: shot.camera.marks.map((m, i) => ({
            index: i + 1,
            time: m.time,
            x: m.position.x,
            y: m.position.y,
            z: m.position.z,
            panDeg: toDeg(m.pan),
            tiltDeg: toDeg(m.tilt),
            focalLength: m.focalLength
          }))
        }
      : null,
    allShots: scene?.shots.map((sh) => ({ id: sh.id, name: sh.name })) ?? [],
    conventions:
      'meters; +X right, -Z forward; heading/pan 0 faces -Z; rotationDeg/panDeg clockwise from above'
  }
}

/**
 * Build a validated `RoutineSpec` from control params (shared by
 * spawn_choreography and choreograph_entities). The engine stays pure — this
 * renderer side picks the default seed when none is supplied.
 */
function routineSpecFromParams(params: Params): RoutineSpec {
  const kind = str(params, 'kind') as ChoreoKind | undefined
  if (!kind || !['dance', 'fight', 'chase'].includes(kind)) {
    throw new Error("kind must be 'dance', 'fight', or 'chase'.")
  }
  const spec: RoutineSpec = {
    kind,
    performers: Math.round(flt(params, 'performers') ?? (kind === 'dance' ? 6 : 2)),
    durationS: flt(params, 'durationS') ?? useStore.getState().shot()?.duration ?? 8,
    seed: flt(params, 'seed') ?? Math.floor(Math.random() * 1e9)
  }
  const style = str(params, 'style')
  if (style) spec.style = style
  const bpm = flt(params, 'bpm')
  if (bpm !== undefined) spec.bpm = bpm
  const formation = str(params, 'formation')
  if (formation) spec.formation = formation as FormationId
  const ending = str(params, 'ending')
  if (ending) spec.ending = ending
  const canon = bool(params, 'canon')
  if (canon !== undefined) spec.canon = canon
  const mirror = bool(params, 'mirror')
  if (mirror !== undefined) spec.mirror = mirror
  const formationChange = bool(params, 'formationChange')
  if (formationChange !== undefined) spec.formationChange = formationChange
  return spec
}

async function execute(action: string, params: Params): Promise<unknown> {
  const s = useStore.getState()
  switch (action) {
    case 'get_state':
      requireDoc()
      return summary()

    case 'list_assets': {
      const cat = str(params, 'category')
      return ASSET_CATALOG.filter((a) => !cat || a.category === cat).map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category
      }))
    }

    case 'add_entity': {
      requireDoc()
      const assetId = str(params, 'assetId') ?? ''
      if (!ASSET_CATALOG.some((a) => a.id === assetId)) {
        throw new Error(`Unknown assetId "${assetId}" — call list_assets for valid ids.`)
      }
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const entityId = s.addEntity(assetId, { x, y: 0, z })
      const rotationDeg = flt(params, 'rotationDeg')
      const label = str(params, 'label')
      if (rotationDeg !== undefined || label) {
        s.mutate('agent: place entity', (doc) => {
          for (const scene of doc.scenes) {
            const e = scene.entities.find((en) => en.id === entityId)
            if (!e) continue
            if (rotationDeg !== undefined) e.transform.rotationY = toRad(rotationDeg)
            if (label) e.label = { text: label, color: e.label?.color ?? '#3b82f6' }
          }
        })
      }
      return { entityId, name: assetSpec(assetId)?.name }
    }

    case 'move_entity': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      let found = false
      s.mutate('agent: move entity', (doc) => {
        for (const scene of doc.scenes) {
          const e = scene.entities.find((en) => en.id === entityId)
          if (!e) continue
          found = true
          const x = flt(params, 'x')
          const y = flt(params, 'y')
          const z = flt(params, 'z')
          const rotationDeg = flt(params, 'rotationDeg')
          if (x !== undefined) e.transform.position.x = x
          if (y !== undefined) e.transform.position.y = y
          if (z !== undefined) e.transform.position.z = z
          if (rotationDeg !== undefined) e.transform.rotationY = toRad(rotationDeg)
        }
      })
      if (!found) throw new Error(`No entity "${entityId}" — call get_state for ids.`)
      return { moved: entityId }
    }

    case 'delete_entity': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      let found = false
      s.mutate('agent: delete entity', (doc) => {
        for (const scene of doc.scenes) {
          if (!scene.entities.some((e) => e.id === entityId)) continue
          found = true
          scene.entities = scene.entities.filter((e) => e.id !== entityId)
          for (const take of scene.blocking) {
            take.tracks = take.tracks.filter((t) => t.entityId !== entityId)
          }
          for (const sh of scene.shots) {
            if (sh.camera.mountEntityId === entityId) delete sh.camera.mountEntityId
          }
        }
      })
      if (!found) throw new Error(`No entity "${entityId}".`)
      if (useStore.getState().selection?.kind === 'entity') s.setSelection(null)
      return { deleted: entityId }
    }

    case 'add_actor_mark': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const time = flt(params, 'time') ?? 0
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const y = flt(params, 'y') ?? 0
      const gait = (str(params, 'gait') ?? 'walk') as GaitId
      let ok = false
      s.mutate('agent: actor mark', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        const take = scene?.blocking.find((b) => b.id === shot?.blockingTakeId)
        if (!scene || !take || !scene.entities.some((e) => e.id === entityId)) return
        let track = take.tracks.find((t) => t.entityId === entityId)
        if (!track) {
          track = { entityId, marks: [] }
          take.tracks.push(track)
        }
        track.marks.push(createActorMark({ x, y, z }, time, gait))
        ok = true
      })
      if (!ok) throw new Error(`No entity "${entityId}" in the current scene.`)
      return { added: true }
    }

    case 'add_camera_mark': {
      requireDoc()
      const mark = createCameraMark(
        { x: flt(params, 'x') ?? 0, y: flt(params, 'y') ?? 1.6, z: flt(params, 'z') ?? 4 },
        flt(params, 'time') ?? 0,
        toRad(flt(params, 'panDeg') ?? 0),
        toRad(flt(params, 'tiltDeg') ?? 0),
        flt(params, 'focalLength') ?? 35
      )
      s.mutate('agent: camera mark', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        shot?.camera.marks.push(mark)
      })
      return { added: true }
    }

    case 'clear_camera_marks':
      requireDoc()
      s.clearCameraMarks()
      return { cleared: true }

    case 'set_shot': {
      requireDoc()
      s.mutate('agent: set shot', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        const name = str(params, 'name')
        const duration = flt(params, 'duration')
        const fps = flt(params, 'fps')
        const aspect = str(params, 'aspect') as AspectId | undefined
        if (name) shot.name = name
        // Never clamp marks on duration change — blocking is shared.
        if (duration !== undefined) shot.duration = Math.min(600, Math.max(0.5, duration))
        if (fps === 24 || fps === 25 || fps === 30) shot.fps = fps
        if (aspect && ['16:9', '9:16', '2.39:1', '4:3', '1:1'].includes(aspect)) {
          shot.aspect = aspect
        }
      })
      return { ok: true }
    }

    case 'new_shot': {
      requireDoc()
      const sceneId = useStore.getState().sceneId
      if (!sceneId) throw new Error('No scene selected.')
      s.addShotToScene(sceneId)
      const st = useStore.getState()
      const name = str(params, 'name')
      if (name) {
        st.mutate('agent: name shot', (doc) => {
          const scene = doc.scenes.find((sc) => sc.id === sceneId)
          const shot = scene?.shots.find((sh) => sh.id === st.shotId)
          if (shot) shot.name = name
        })
      }
      return { shotId: useStore.getState().shotId }
    }

    case 'apply_framing': {
      requireDoc()
      const kind = str(params, 'kind') as FramingKind | undefined
      if (!kind || !['2S', 'OTS', 'REV', 'TOP', 'LOW', 'DUTCH'].includes(kind)) {
        throw new Error('kind must be one of 2S, OTS, REV, TOP, LOW, DUTCH.')
      }
      requireManager().applyFraming(kind)
      return { applied: kind }
    }

    case 'apply_camera_move': {
      requireDoc()
      const presetId = str(params, 'presetId') ?? ''
      const subjectId = str(params, 'entityId')
      if (subjectId) {
        if (!s.scene()?.entities.some((e) => e.id === subjectId)) {
          throw new Error(`No entity "${subjectId}".`)
        }
        s.setSelection({ kind: 'entity', entityId: subjectId })
      }
      const { CAMERA_MOVE_PRESETS } = await import('@engine/camera-moves')
      if (!CAMERA_MOVE_PRESETS.some((p) => p.id === presetId)) {
        throw new Error(
          `Unknown presetId "${presetId}". Valid: ${CAMERA_MOVE_PRESETS.map((p) => p.id).join(', ')}`
        )
      }
      requireManager().applyCameraMove(presetId)
      return { applied: presetId }
    }

    case 'list_camera_moves': {
      const { CAMERA_MOVE_PRESETS } = await import('@engine/camera-moves')
      return CAMERA_MOVE_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        track: p.track
      }))
    }

    case 'set_track_subject': {
      requireDoc()
      const entityId = str(params, 'entityId') // empty/undefined = off
      if (entityId && !s.scene()?.entities.some((e) => e.id === entityId)) {
        throw new Error(`No entity "${entityId}".`)
      }
      s.mutate('agent: track subject', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        if (entityId) shot.camera.trackEntityId = entityId
        else delete shot.camera.trackEntityId
      })
      return { tracking: entityId ?? null }
    }

    case 'list_action_presets': {
      const { ACTION_PRESETS } = await import('@engine/action-presets')
      return ACTION_PRESETS.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        suggestedAssets: p.suggestedAssets
      }))
    }

    case 'apply_action_preset': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const presetId = str(params, 'presetId') ?? ''
      const { ACTION_PRESETS } = await import('@engine/action-presets')
      const preset = ACTION_PRESETS.find((p) => p.id === presetId)
      if (!preset) {
        throw new Error(
          `Unknown presetId "${presetId}". Valid: ${ACTION_PRESETS.map((p) => p.id).join(', ')}`
        )
      }
      const scene = s.scene()
      const shot = s.shot()
      const entity = scene?.entities.find((e) => e.id === entityId)
      if (!scene || !shot || !entity) throw new Error(`No entity "${entityId}".`)
      const specs = preset.generate({
        start: {
          x: entity.transform.position.x,
          y: entity.transform.position.y,
          z: entity.transform.position.z,
          heading: entity.transform.rotationY
        },
        duration: shot.duration
      })
      s.mutate('agent: action preset', (doc) => {
        const sc = doc.scenes.find((x) => x.id === scene.id)
        const sh = sc?.shots.find((x) => x.id === shot.id)
        const take = sc?.blocking.find((b) => b.id === sh?.blockingTakeId)
        if (!take) return
        let track = take.tracks.find((t) => t.entityId === entityId)
        if (!track) {
          track = { entityId, marks: [] }
          take.tracks.push(track)
        }
        track.marks = specs.map((spec) => ({
          id: newId('mark'),
          time: spec.time,
          hold: spec.hold,
          easeIn: spec.easeIn,
          easeOut: spec.easeOut,
          position: { ...spec.position },
          gait: spec.gait
        }))
      })
      return { applied: presetId, marks: specs.length }
    }

    case 'list_sequence_styles': {
      const { sequenceStyles } = await import('@engine/sequences')
      return {
        dance: sequenceStyles('dance'),
        fight: sequenceStyles('fight'),
        footChase: sequenceStyles('footChase'),
        carChase: sequenceStyles('carChase')
      }
    }

    case 'spawn_sequence': {
      requireDoc()
      const type = str(params, 'type') as
        | import('@engine/sequences').SequenceType
        | undefined
      if (!type || !['dance', 'fight', 'footChase', 'carChase'].includes(type)) {
        throw new Error('type must be dance | fight | footChase | carChase.')
      }
      const count = flt(params, 'count') ?? 10
      const style = str(params, 'style') ?? (type === 'dance' ? 'mixed' : type === 'fight' ? 'paired' : 'straight')
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const headingDeg = flt(params, 'headingDeg') ?? 0
      s.spawnSequence({ type, count, style, origin: { x, z, heading: toRad(headingDeg) } })
      const after = useStore.getState()
      const sel = after.selection
      return {
        staged: sel?.kind === 'entities' ? sel.entityIds.length : 0,
        entityIds: sel?.kind === 'entities' ? sel.entityIds : []
      }
    }

    case 'list_choreography_options': {
      const { choreoStyles, choreoFormations, choreoEndings } = await import('@engine/choreography')
      const kinds: ChoreoKind[] = ['dance', 'fight', 'chase']
      return {
        kinds,
        styles: Object.fromEntries(kinds.map((k) => [k, choreoStyles(k)])),
        formations: choreoFormations(),
        endings: Object.fromEntries(kinds.map((k) => [k, choreoEndings(k)]))
      }
    }

    case 'spawn_choreography': {
      requireDoc()
      const spec = routineSpecFromParams(params)
      const x = flt(params, 'x') ?? 0
      const z = flt(params, 'z') ?? 0
      const headingDeg = flt(params, 'headingDeg') ?? 0
      s.spawnChoreography(spec, { x, z, heading: toRad(headingDeg) })
      const sel = useStore.getState().selection
      return {
        kind: spec.kind,
        staged: sel?.kind === 'entities' ? sel.entityIds.length : 0,
        entityIds: sel?.kind === 'entities' ? sel.entityIds : []
      }
    }

    case 'choreograph_entities': {
      requireDoc()
      const entityIds = strList(params, 'entityIds')
      if (entityIds.length === 0) {
        throw new Error('entityIds must be a non-empty array of person entity ids.')
      }
      const spec = routineSpecFromParams(params)
      const applied = s.choreographEntities(entityIds, spec)
      if (applied === 0) {
        throw new Error('No matching performers — choreography applies to people (person.* entities).')
      }
      return { kind: spec.kind, choreographed: applied }
    }

    case 'list_motion_presets': {
      const { MOTION_PRESETS } = await import('@engine/motions')
      const category = str(params, 'category')
      return MOTION_PRESETS.filter((m) => !category || m.category === category).map((m) => ({
        id: m.id,
        name: m.name,
        category: m.category,
        duration: m.duration
      }))
    }

    case 'import_scan': {
      requireDoc()
      const sourcePath = str(params, 'sourcePath') ?? str(params, 'path') ?? ''
      if (!sourcePath) {
        throw new Error('sourcePath is required — an absolute path to a .ply/.splat/.spz/.ksplat file.')
      }
      const before = new Set((s.scene()?.scans ?? []).map((sc) => sc.id))
      await s.importScan(sourcePath)
      const scan = (useStore.getState().scene()?.scans ?? []).find((sc) => !before.has(sc.id))
      if (!scan) {
        throw new Error('Scan import failed — check the file path and that the project has been saved.')
      }
      return { scan }
    }

    case 'set_scan_transform': {
      requireDoc()
      const scanId = str(params, 'scanId') ?? ''
      const scan = s.scene()?.scans?.find((sc) => sc.id === scanId)
      if (!scan) throw new Error(`No scan "${scanId}" — call get_state or import_scan.`)
      const patch: { position?: { x: number; y: number; z: number }; rotationY?: number; scale?: number } = {}
      const pos = params.position
      if (pos && typeof pos === 'object') {
        const pp = pos as Params
        patch.position = {
          x: flt(pp, 'x') ?? scan.position.x,
          y: flt(pp, 'y') ?? scan.position.y,
          z: flt(pp, 'z') ?? scan.position.z
        }
      }
      const rotationDeg = flt(params, 'rotationDeg')
      if (rotationDeg !== undefined) patch.rotationY = toRad(rotationDeg)
      const scale = flt(params, 'scale')
      if (scale !== undefined) patch.scale = scale
      const flipped = bool(params, 'flipped')
      if (flipped !== undefined) (patch as { flipped?: boolean }).flipped = flipped
      if (patch.position || patch.rotationY !== undefined || patch.scale !== undefined || flipped !== undefined) {
        s.updateScanTransform(scanId, patch)
      }
      const visible = bool(params, 'visible')
      if (visible !== undefined) s.setScanVisible(scanId, visible)
      const updated = useStore.getState().scene()?.scans?.find((sc) => sc.id === scanId)
      return { scan: updated }
    }

    case 'remove_scan': {
      requireDoc()
      const scanId = str(params, 'scanId') ?? ''
      if (!s.scene()?.scans?.some((sc) => sc.id === scanId)) {
        throw new Error(`No scan "${scanId}" — call get_state for scan ids.`)
      }
      s.removeScan(scanId)
      return { removed: scanId }
    }

    case 'snap_to_ground': {
      requireDoc()
      const entityId = str(params, 'entityId') ?? ''
      const scene = s.scene()
      if (!scene?.entities.some((e) => e.id === entityId)) {
        throw new Error(`No entity "${entityId}".`)
      }
      s.setSelection({ kind: 'entity', entityId })
      requireManager().snapSelectionToGround()
      return { snapped: entityId }
    }

    case 'set_time':
      requireDoc()
      s.setTime(Math.max(0, flt(params, 't') ?? 0))
      return { time: useStore.getState().time }

    case 'play':
      requireDoc()
      s.setTime(0)
      s.setPlaying(true)
      return { playing: true }

    case 'stop':
      s.setPlaying(false)
      return { playing: false }

    case 'screenshot': {
      requireDoc()
      // Rendered through the SHOT camera at the playhead — what will export.
      const png = await renderStillPngForTest(useStore.getState().time, 960, 540)
      let binary = ''
      const bytes = new Uint8Array(png)
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
      return { imageBase64: btoa(binary) }
    }

    case 'set_reference': {
      requireDoc()
      const handoffVersion = flt(params, 'handoffVersion')
      if (handoffVersion !== undefined && handoffVersion !== 1) {
        throw new Error(`Unsupported Motion Previs handoffVersion ${handoffVersion}; Blockout supports version 1.`)
      }
      const videoPath = str(params, 'videoPath') ?? str(params, 'path') ?? ''
      if (!videoPath) throw new Error('videoPath is required.')
      const folder = useStore.getState().projectFolder
      if (!folder) throw new Error('No project folder — save the project first.')
      const mode = str(params, 'mode') === 'pip' ? 'pip' : 'ghost'
      const rawOpacity = flt(params, 'opacity')
      const opacity = rawOpacity === undefined ? 0.5 : Math.min(1, Math.max(0, rawOpacity))
      // Copy the external clip into the project's refs/ folder so it travels
      // with the project and can be served by relative path.
      const imported = await window.blockout.importReference(folder, videoPath)
      let attached = false
      s.mutate('agent: set reference', (doc) => {
        const scene = doc.scenes.find((sc) => sc.id === useStore.getState().sceneId)
        const shot = scene?.shots.find((sh) => sh.id === useStore.getState().shotId)
        if (!shot) return
        shot.referenceVideo = { path: imported.relativePath, opacity, mode, timeOffset: 0 }
        attached = true
      })
      if (!attached) throw new Error('No active shot to attach the reference to.')
      return { attached: true, handoffVersion: 1, path: imported.relativePath, mode, opacity }
    }

    case 'list_presets':
      return await window.blockout.presetsList()

    case 'save_preset': {
      requireDoc()
      const name = str(params, 'name')
      if (!name) throw new Error('name is required.')
      await s.saveStagePreset(name)
      return { saved: name }
    }

    case 'apply_preset': {
      requireDoc()
      const id = str(params, 'id')
      if (!id) throw new Error('id is required — call list_presets.')
      await s.applyStagePreset(id)
      return { applied: id }
    }

    default:
      throw new Error(`Unknown action "${action}".`)
  }
}

/** Wire up control-invoke handling. Returns an unsubscribe for teardown. */
export function registerControlHandler(): () => void {
  return window.blockout.onControlInvoke((id, action, params) => {
    void (async () => {
      let result: ControlResult
      try {
        const data = await execute(action, (params ?? {}) as Params)
        result = { ok: true, data }
      } catch (e) {
        result = { ok: false, error: (e as Error).message }
      }
      window.blockout.controlResult(id, result)
    })()
  })
}
