/**
 * SceneManager — the imperative three.js world behind the Viewport.
 *
 * Owns: renderer, scene graph, lighting presets, entity objects, marks &
 * path visuals, the shot camera, playback (applying ShotEvaluator state),
 * selection/placement/mark-drop interactions, and the render hooks the
 * exporter reuses (renderFrameAt with clean/depth/normal passes).
 *
 * React (Viewport.tsx) is a thin shell around this class.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { ViewHelper } from 'three/examples/jsm/helpers/ViewHelper.js'
import { DropInViewer, SceneFormat } from '@mkkellogg/gaussian-splats-3d'
import { ShotEvaluator } from '@engine/evaluate'
import { newId } from '@engine/ids'
import { GAITS } from '@engine/gaits'
import {
  frameSubject as frameSubjectMath,
  ASPECT_RATIOS,
  horizontalFov,
  verticalFov
} from '@engine/camera'
import { entityHeight } from '@engine/assets'
import { headingOf } from '@engine/path'
import { CAMERA_MOVE_PRESETS } from '@engine/camera-moves'
import type { Entity, LightingPresetId, Scene as DocScene, Shot } from '@engine/types'
import { useStore, selectedEntityIds } from '../store'
import { on } from '../bus'
import { buildAsset, markMesh, labelSprite, type BuiltAsset } from './builders'

const RAD2DEG = 180 / Math.PI

/**
 * Recording feel per Control setting. `rate` is the exponential-approach
 * response of the puppeteer chase (lower = smoother/laggier), `maxSpeed` a
 * hard cap in m/s, `orbit` scales the viewport fly speed while recording the
 * camera, `wheel` scales the altitude wheel, `damping` the orbit damping.
 */
const RECORD_TUNING = {
  precise: { rate: 4, maxSpeed: 4, orbit: 0.35, wheel: 0.004, damping: 0.06 },
  normal: { rate: 8, maxSpeed: 12, orbit: 0.65, wheel: 0.01, damping: 0.12 },
  fast: { rate: 16, maxSpeed: 40, orbit: 1.0, wheel: 0.02, damping: 0.3 }
} as const

interface EntityVisual {
  entity: Entity
  built: BuiltAsset
  root: THREE.Group
  label?: THREE.Sprite
  customLoaded?: boolean
}

export type RenderPass = 'clean' | 'depth' | 'normal'

export class SceneManager {
  readonly scene = new THREE.Scene()
  readonly renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement

  /** Free navigation camera. */
  private freeCam: THREE.PerspectiveCamera
  private controls: OrbitControls
  /** The shot camera — what gets exported. */
  readonly shotCam: THREE.PerspectiveCamera

  private transform: TransformControls
  private raycaster = new THREE.Raycaster()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  private visuals = new Map<string, EntityVisual>()
  private overlay = new THREE.Group() // marks, paths, camera body — hidden in exports
  /** Spike-tape mark visuals (toggled by the HUD "Marks" eye). */
  private marksGroup = new THREE.Group()
  /** Path ribbons + chevrons + time labels (toggled by the HUD "Paths" eye). */
  private pathsGroup = new THREE.Group()
  /** Chevron/time-label decorations for the SELECTED lane's path only. */
  private selectionPathObjects: THREE.Object3D[] = []
  private cameraBody: THREE.Group
  private selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xf5a524)
  /** Additional boxes for multi-selection members. */
  private extraSelectionBoxes: THREE.BoxHelper[] = []
  /** Doc transforms snapshotted when a gizmo drag starts (group moves). */
  private dragStart: Map<string, { pos: THREE.Vector3; rotY: number }> | null = null
  private dragAnchorId: string | null = null
  /** Last pointer position in NDC — drives entity performance recording. */
  private lastPointerNdc = new THREE.Vector2(0, 0)

  private sun: THREE.DirectionalLight
  private ambient: THREE.HemisphereLight
  private clubLights: THREE.PointLight[] = []
  /** Physical-sky dome for the *Sky lighting presets. Part of the clean export
   *  (deterministic scattering from the sun position); hidden in depth/normal
   *  passes and whenever a non-sky preset is active. */
  private sky: Sky
  private skyEnabled = false
  /** Bottom-right orientation gizmo (editor-only; never rendered into exports). */
  private viewHelper: ViewHelper | null = null
  /** Emissive tint applied to the selected entity in the editor. Cleared during
   *  every export pass so selection never affects exported pixels. */
  private tintedMaterials: { mat: THREE.MeshStandardMaterial; emissive: number; intensity: number }[] = []

  private evaluator: ShotEvaluator | null = null
  private docScene: DocScene | null = null
  private shot: Shot | null = null

  /**
   * Depth pass material: LINEAR view-space depth normalized to the scene's
   * actual near/far range, white-near black-far (the inverted-depth
   * convention depth ControlNets expect). Three's MeshDepthMaterial packs
   * non-linear frag depth, which over a 0.05..500 camera range crushes
   * everything past arm's length into a handful of gray levels — useless
   * for conditioning. Cached; uniforms set per frame (finding of the audit).
   */
  private depthMaterial = new THREE.ShaderMaterial({
    uniforms: { uNear: { value: 0.5 }, uFar: { value: 30 } },
    vertexShader: `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uNear;
      uniform float uFar;
      varying float vViewZ;
      void main() {
        float d = 1.0 - clamp((vViewZ - uNear) / (uFar - uNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(d), 1.0);
      }`
  })
  private normalMaterial = new THREE.MeshNormalMaterial()

  private raf = 0
  private lastFrameAt = 0
  private disposed = false
  private unsubscribers: (() => void)[] = []
  /** True while an export owns the scene — the live loop stands down. */
  suspendLive = false

  /** Imported 3D scans (Gaussian splats). Editor staging only: hidden from
   *  every export pass — worker-based splat sorting cannot guarantee the
   *  byte-deterministic renders the export contract requires, and splats
   *  have no meaning in the depth/normal passes. */
  private scansGroup = new THREE.Group()
  private scanVisuals = new Map<
    string,
    { file: string; holder: THREE.Group; viewer: DropInViewer | null; loading: boolean }
  >()

  /** Set by Viewport for overlay layout (letterbox rect in CSS px). */
  onViewRect?: (rect: { x: number; y: number; w: number; h: number } | null) => void
  /** Set by Viewport: the PiP shot-preview rect in CSS px (null = hidden). */
  onPipRect?: (rect: { x: number; y: number; w: number; h: number } | null) => void

  /** Live performance-recording state (camera flight or entity puppeteering). */
  private recSamples: { t: number; pos: THREE.Vector3; pan: number; tilt: number; roll: number }[] = []
  private entitySamples: { t: number; x: number; y: number; z: number }[] = []
  private recStartedAt = 0
  private recLens = 35
  /** 'camera' or the entity id being puppeteered. */
  private recTarget: string = 'camera'
  /** True when recording against the playback clock (other motion replays). */
  private recPlaybackSynced = false
  /** Flight altitude of the puppeteered entity (scroll wheel adjusts it). */
  private recHeight = 0
  /** Smoothed puppeteer position — the entity approaches the cursor instead
   *  of snapping to it, so recordings are controllable, not jittery. */
  private recCursor = new THREE.Vector3()
  private recPrevFrame = 0
  private savedOrbitSpeeds: { rotate: number; pan: number; zoom: number } | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.45

    this.scene.background = new THREE.Color(0x1a1c20)

    this.freeCam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500)
    this.freeCam.position.set(9, 7, 9)
    this.shotCam = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 500)
    this.shotCam.rotation.order = 'YXZ'

    this.controls = new OrbitControls(this.freeCam, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.target.set(0, 1, 0)

    // Ground: soft grid (editor chrome — lives in overlay so exports never
    // include it) + shadow-catching plane (stays: contact shadows read well)
    const grid = new THREE.GridHelper(60, 60, 0x33343a, 0x27282d)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.6
    this.overlay.add(grid)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.ShadowMaterial({ opacity: 0.3 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    ground.name = '__ground'
    this.scene.add(ground)

    // Lights
    this.ambient = new THREE.HemisphereLight(0xbfd4e6, 0x3a3a40, 0.7)
    this.scene.add(this.ambient)
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -25
    this.sun.shadow.camera.right = 25
    this.sun.shadow.camera.top = 25
    this.sun.shadow.camera.bottom = -25
    this.sun.shadow.camera.far = 100
    this.sun.shadow.bias = -0.0004
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)
    for (let i = 0; i < 4; i++) {
      const colors = [0xe5484d, 0x3b82f6, 0x46a758, 0xd6409f]
      const light = new THREE.PointLight(colors[i]!, 0, 18)
      light.position.set(Math.cos((i / 4) * Math.PI * 2) * 4, 3.4, Math.sin((i / 4) * Math.PI * 2) * 4)
      this.clubLights.push(light)
      this.scene.add(light)
    }

    // Physical sky dome (huge, backside). Invisible until a *Sky preset is
    // active. Kept out of the overlay so it CAN reach the clean export pass.
    this.sky = new Sky()
    this.sky.scale.setScalar(45000)
    this.sky.visible = false
    this.sky.name = '__sky'
    this.scene.add(this.sky)

    // Camera body visual (selectable, draggable in shoot mode)
    this.cameraBody = this.buildCameraBody()
    // Marks + paths live in their own toggleable sub-groups of the overlay.
    this.overlay.add(this.marksGroup)
    this.overlay.add(this.pathsGroup)
    this.overlay.add(this.cameraBody)
    this.scene.add(this.overlay)

    this.selectionBox.visible = false
    this.scene.add(this.selectionBox)

    // Gizmo
    this.transform = new TransformControls(this.freeCam, canvas)
    this.transform.setTranslationSnap(0.05)
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15))
    this.transform.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value
      this.controls.enabled = !dragging
      if (dragging) this.beginGizmoDrag()
      else this.commitGizmo()
    })
    this.scene.add(this.transform.getHelper ? this.transform.getHelper() : (this.transform as unknown as THREE.Object3D))

    // Orientation gizmo (bottom-right). Rendered in its own corner viewport in
    // the live loop only — it is never part of this.scene, so exports are clean.
    this.viewHelper = new ViewHelper(this.freeCam, canvas)
    this.viewHelper.setLabels('X', 'Y', 'Z')

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    window.addEventListener('keydown', this.onKeyDown)

    // Store subscriptions: rebuild world on doc/scene/shot change.
    this.unsubscribers.push(
      useStore.subscribe((state, prev) => {
        if (
          state.doc !== prev.doc ||
          state.sceneId !== prev.sceneId ||
          state.shotId !== prev.shotId
        ) {
          this.syncFromStore()
        }
        if (state.selection !== prev.selection || state.mode !== prev.mode) {
          this.syncSelection()
        }
        if (state.showMarks !== prev.showMarks || state.showPaths !== prev.showPaths) {
          this.applyOverlayToggles()
        }
        if (state.recording !== prev.recording) {
          if (state.recording) this.beginRecording()
          else this.finishRecording()
        }
      })
    )

    // Bus commands
    this.unsubscribers.push(on('frameSubject', ({ size }) => this.autoFrame(size)))
    this.unsubscribers.push(on('applyFraming', ({ kind }) => this.applyFraming(kind)))
    this.unsubscribers.push(on('setLens', ({ focalLength }) => this.setLens(focalLength)))
    this.unsubscribers.push(on('dropCameraMarkAtView', () => this.dropCameraMarkAtView()))
    this.unsubscribers.push(
      on('focusSelection', () => {
        const target = this.selectedObject()
        if (target) {
          const p = new THREE.Vector3()
          target.getWorldPosition(p)
          this.controls.target.copy(p)
        }
      })
    )

    this.syncFromStore()
    this.lastFrameAt = performance.now()
    this.loop()
    // Automation/debug surface (see AGENTS.md).
    ;(window as unknown as Record<string, unknown>).__blockout_scene = this
  }

  /* ------------------------------ lifecycle ----------------------------- */

  dispose(): void {
    this.disposed = true
    for (const id of [...this.scanVisuals.keys()]) this.removeScanVisual(id)
    cancelAnimationFrame(this.raf)
    this.unsubscribers.forEach((u) => u())
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKeyDown)
    this.controls.dispose()
    this.transform.dispose()
    this.viewHelper?.dispose()
    this.renderer.dispose()
  }

  /* ------------------------------- helpers ------------------------------ */

  private buildCameraBody(): THREE.Group {
    const g = new THREE.Group()
    const mat = new THREE.MeshBasicMaterial({ color: 0xf5f5f7, wireframe: false })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.4), mat)
    body.name = '__camera'
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 12), mat)
    lens.rotation.x = Math.PI / 2
    lens.position.z = -0.28
    lens.name = '__camera'
    g.add(body, lens)
    // Frustum direction hint
    const coneGeo = new THREE.ConeGeometry(0.5, 1.2, 4, 1, true)
    const cone = new THREE.Mesh(
      coneGeo,
      new THREE.MeshBasicMaterial({ color: 0xf5a524, wireframe: true, transparent: true, opacity: 0.35 })
    )
    cone.rotation.x = -Math.PI / 2
    cone.rotation.y = Math.PI / 4
    cone.position.z = -1.0
    g.add(cone)
    return g
  }

  private currentState() {
    return useStore.getState()
  }

  private syncFromStore(): void {
    const s = this.currentState()
    const docScene = s.scene()
    const shot = s.shot()
    this.docScene = docScene
    this.shot = shot
    this.evaluator = docScene && shot ? new ShotEvaluator(docScene, shot) : null

    // --- diff entities
    const wanted = new Map((docScene?.entities ?? []).map((e) => [e.id, e]))
    for (const [id, visual] of this.visuals) {
      if (!wanted.has(id)) {
        this.removeEntityVisual(visual)
        this.visuals.delete(id)
      }
    }
    for (const entity of wanted.values()) {
      const existing = this.visuals.get(entity.id)
      if (!existing || existing.entity.assetId !== entity.assetId || existing.entity.params !== entity.params) {
        if (existing) this.removeEntityVisual(existing)
        this.addEntityVisual(entity)
      } else {
        existing.entity = entity
        this.applyEntityBase(existing)
        this.syncLabel(existing)
      }
    }

    this.rebuildOverlay()
    this.applyEnvironment()
    this.syncScans()
    this.applyTime(s.time)
    this.syncSelection()
  }

  /* ------------------------- 3D scans (splats) -------------------------- */

  /** Diff the scene's ScanRefs against loaded splat viewers. */
  private syncScans(): void {
    if (!this.scansGroup.parent) this.scene.add(this.scansGroup)
    const s = this.currentState()
    const wanted = new Map((this.docScene?.scans ?? []).map((r) => [r.id, r]))

    for (const [id, visual] of this.scanVisuals) {
      const ref = wanted.get(id)
      if (!ref || ref.file !== visual.file) {
        this.removeScanVisual(id)
      }
    }
    for (const ref of wanted.values()) {
      const existing = this.scanVisuals.get(ref.id)
      if (!existing) {
        const holder = new THREE.Group()
        holder.name = '__scan'
        this.scansGroup.add(holder)
        const visual = { file: ref.file, holder, viewer: null, loading: true }
        this.scanVisuals.set(ref.id, visual)
        void this.loadScan(ref.id, ref.file, s.projectFolder)
      }
      this.applyScanTransform(ref.id)
    }
  }

  private applyScanTransform(scanId: string): void {
    const ref = this.docScene?.scans?.find((r) => r.id === scanId)
    const visual = this.scanVisuals.get(scanId)
    if (!ref || !visual) return
    visual.holder.position.set(ref.position.x, ref.position.y, ref.position.z)
    // Pitch-π rights upside-down (Y-down) scans; yaw still applies on top.
    visual.holder.rotation.set(ref.flipped ? Math.PI : 0, ref.rotationY, 0)
    visual.holder.scale.setScalar(ref.scale)
    visual.holder.visible = ref.visible
  }

  private removeScanVisual(scanId: string): void {
    const visual = this.scanVisuals.get(scanId)
    if (!visual) return
    this.scanVisuals.delete(scanId)
    this.scansGroup.remove(visual.holder)
    if (visual.viewer) {
      visual.holder.remove(visual.viewer)
      // dispose() tears down workers + GPU buffers; failures are non-fatal.
      Promise.resolve(visual.viewer.dispose()).catch(() => undefined)
    }
  }

  /** Async splat load with stale-guard: the scene may change mid-flight. */
  private async loadScan(scanId: string, file: string, projectFolder: string | null): Promise<void> {
    const toast = this.currentState().toast
    const fail = (message: string): void => {
      const visual = this.scanVisuals.get(scanId)
      if (visual) visual.loading = false
      toast(message, 'error')
    }
    if (!projectFolder) return fail('Scan load failed: no open project folder.')

    const ext = file.toLowerCase().split('.').pop() ?? ''
    const format = { ply: SceneFormat.Ply, splat: SceneFormat.Splat, ksplat: SceneFormat.KSplat, spz: SceneFormat.Spz }[
      ext
    ]
    if (format === undefined) return fail(`Scan format ".${ext}" is not supported (.ply/.splat/.ksplat/.spz).`)

    let url: string
    try {
      const buffer = await window.blockout.readProjectFile(projectFolder, file)
      url = URL.createObjectURL(new Blob([buffer]))
    } catch (e) {
      return fail(`Scan load failed: ${(e as Error).message}`)
    }

    const stale = (): boolean => {
      const visual = this.scanVisuals.get(scanId)
      return this.disposed || !visual || visual.file !== file
    }
    if (stale()) return URL.revokeObjectURL(url)

    const viewer = new DropInViewer({
      // No SharedArrayBuffer requirements, no GPU sort: maximum portability
      // inside Electron's renderer at grey-box-previs scene sizes.
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
      freeIntermediateSplatData: true
    })
    // The lib's loader can reject outside its returned promise (internal
    // fetch in a detached chain) — belt-and-braces: try/catch the call AND
    // run a timeout failsafe so `loading` can never wedge on silently.
    let settled = false
    const succeed = (): void => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      if (stale()) {
        Promise.resolve(viewer.dispose()).catch(() => undefined)
        return
      }
      const visual = this.scanVisuals.get(scanId)!
      visual.viewer = viewer
      visual.loading = false
      visual.holder.add(viewer)
      this.applyScanTransform(scanId)
    }
    const reject = (e: unknown): void => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      Promise.resolve(viewer.dispose()).catch(() => undefined)
      fail(`Scan load failed: ${e instanceof Error ? e.message : 'unreadable splat file'}`)
    }
    try {
      viewer.addSplatScene(url, { format, showLoadingUI: false, splatAlphaRemovalThreshold: 5 }).then(succeed, reject)
    } catch (e) {
      return reject(e)
    }
    window.setTimeout(() => {
      if (!settled) reject(new Error('timed out after 90s'))
    }, 90_000)
  }

  /** Remove a visual and free its GPU resources (long sessions must not leak). */
  private removeEntityVisual(visual: EntityVisual): void {
    this.scene.remove(visual.root)
    visual.root.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose()
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) m.dispose()
      }
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose()
        o.material.dispose()
      }
    })
  }

  private addEntityVisual(entity: Entity): void {
    const built = buildAsset(entity.assetId, entity.params)
    const root = new THREE.Group()
    root.add(built.group)
    root.userData.entityId = entity.id
    this.scene.add(root)
    const visual: EntityVisual = { entity, built, root }
    this.visuals.set(entity.id, visual)
    this.applyEntityBase(visual)
    this.syncLabel(visual)
    if (entity.assetId.startsWith('custom.') && entity.sourceFile) {
      void this.loadCustomModel(visual)
    }
  }

  private async loadCustomModel(visual: EntityVisual): Promise<void> {
    const folder = this.currentState().projectFolder
    const rel = visual.entity.sourceFile
    if (!folder || !rel) return
    try {
      const buf = await window.blockout.readProjectFile(folder, rel)
      const loader = new GLTFLoader()
      loader.parse(buf, '', (gltf) => {
        if (this.disposed || !this.visuals.has(visual.entity.id)) return
        visual.root.remove(visual.built.group)
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true
            o.receiveShadow = true
          }
        })
        visual.root.add(gltf.scene)
        visual.customLoaded = true
      })
    } catch (e) {
      useStore.getState().toast(`Could not load model: ${String(e)}`, 'error')
    }
  }

  private applyEntityBase(visual: EntityVisual): void {
    const t = visual.entity.transform
    visual.root.position.set(t.position.x, t.position.y, t.position.z)
    visual.root.rotation.y = t.rotationY
    visual.root.scale.setScalar(t.scale)
    visual.built.setTint(visual.entity.label?.color ?? null)
  }

  private syncLabel(visual: EntityVisual): void {
    if (visual.label) {
      visual.root.remove(visual.label)
      visual.label.material.map?.dispose()
      visual.label.material.dispose()
      visual.label = undefined
    }
    const label = visual.entity.label
    if (label && label.text) {
      const sprite = labelSprite(label.text, label.color)
      const h = entityHeight(visual.entity.assetId, 1, visual.entity.params)
      sprite.position.y = h + 0.35
      visual.root.add(sprite)
      visual.label = sprite
    }
  }

  /** Marks + paths + camera path visuals. */
  private markObjects: THREE.Object3D[] = []

  private rebuildOverlay(): void {
    // This runs on every mutation — dispose or the mark sprites' canvas
    // textures and path geometries pile up on the GPU all session.
    for (const o of this.markObjects) {
      o.parent?.remove(o)
      o.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry.dispose()
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          for (const m of mats) m.dispose()
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose()
          child.material.dispose()
        }
      })
    }
    this.markObjects = []
    const scene = this.docScene
    const shot = this.shot
    if (!scene || !shot || !this.evaluator) return

    const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
    if (take) {
      for (const track of take.tracks) {
        const entity = scene.entities.find((e) => e.id === track.entityId)
        const color = entity?.label?.color ?? '#f5a524'
        const sorted = [...track.marks].sort((a, b) => a.time - b.time)
        sorted.forEach((mark, i) => {
          const m = markMesh(color, i + 1)
          m.position.set(mark.position.x, mark.position.y + 0.01, mark.position.z)
          m.userData.markId = mark.id
          m.userData.entityId = track.entityId
          this.marksGroup.add(m)
          this.markObjects.push(m)
        })
      }
    }
    const sortedCam = [...shot.camera.marks].sort((a, b) => a.time - b.time)
    sortedCam.forEach((mark, i) => {
      const m = markMesh('#7dd3fc', i + 1)
      m.position.set(mark.position.x, mark.position.y + 0.01, mark.position.z)
      m.userData.markId = mark.id
      m.userData.entityId = 'camera'
      this.marksGroup.add(m)
      this.markObjects.push(m)
    })

    // Paths
    for (const path of this.evaluator.paths()) {
      const pts = path.points.map((p) => new THREE.Vector3(p.x, p.y + 0.02, p.z))
      if (pts.length < 2) continue
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const isCam = path.entityId === 'camera'
      const line = new THREE.Line(
        geo,
        new THREE.LineDashedMaterial({
          color: isCam ? 0x7dd3fc : new THREE.Color(path.color ?? '#f5a524'),
          dashSize: 0.15,
          gapSize: 0.1,
          transparent: true,
          opacity: 0.8
        })
      )
      line.computeLineDistances()
      this.pathsGroup.add(line)
      this.markObjects.push(line)
    }

    this.rebuildSelectionDecorations()
    this.applyOverlayToggles()
  }

  /** Store-driven visibility for the Marks and Paths overlay groups. */
  private applyOverlayToggles(): void {
    const s = this.currentState()
    this.marksGroup.visible = s.showMarks
    this.pathsGroup.visible = s.showPaths
  }

  /**
   * Direction chevrons + "t=2.4s" time labels along the SELECTED lane's path.
   * Editor chrome (lives in pathsGroup, hidden in every export). Rebuilt on
   * both blocking changes and selection changes so it always tracks the pick.
   */
  private rebuildSelectionDecorations(): void {
    for (const o of this.selectionPathObjects) {
      o.parent?.remove(o)
      o.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          const mats = Array.isArray(child.material) ? child.material : [child.material]
          for (const m of mats) m.dispose()
        }
        if (child instanceof THREE.Sprite) {
          child.material.map?.dispose()
          child.material.dispose()
        }
      })
    }
    this.selectionPathObjects = []
    if (!this.evaluator || !this.docScene || !this.shot) return

    // Which lane is selected? (entity id or 'camera')
    const sel = this.currentState().selection
    let laneId: string | null = null
    if (sel?.kind === 'entity') laneId = sel.entityId
    else if (sel?.kind === 'entities') laneId = sel.entityIds[sel.entityIds.length - 1] ?? null
    else if (sel?.kind === 'camera') laneId = 'camera'
    if (!laneId) return

    const path = this.evaluator.paths().find((p) => p.entityId === laneId)
    const isCam = laneId === 'camera'
    const color = new THREE.Color(isCam ? '#7dd3fc' : (path?.color ?? '#f5a524'))

    // Chevrons: small arrowheads pointing along travel at even path samples.
    if (path && path.points.length >= 2) {
      const pts = path.points.map((p) => new THREE.Vector3(p.x, p.y + 0.03, p.z))
      const chevronCount = Math.min(10, Math.max(3, Math.floor(pts.length / 6)))
      const chevMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
      for (let c = 1; c <= chevronCount; c++) {
        const idx = Math.min(pts.length - 2, Math.floor((c / (chevronCount + 1)) * (pts.length - 1)))
        const a = pts[idx]!
        const b = pts[idx + 1]!
        const dir = b.clone().sub(a)
        if (dir.lengthSq() < 1e-6) continue
        dir.normalize()
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 4), chevMat)
        cone.position.copy(a)
        // Cone points +Y by default; rotate to face the travel direction.
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        this.pathsGroup.add(cone)
        this.selectionPathObjects.push(cone)
      }
    }

    // Time labels at every mark of the selected lane.
    const marks = isCam
      ? this.shot.camera.marks
      : (this.docScene.blocking
          .find((b) => b.id === this.shot!.blockingTakeId)
          ?.tracks.find((t) => t.entityId === laneId)?.marks ?? [])
    for (const mark of [...marks].sort((a, b) => a.time - b.time)) {
      const sprite = labelSprite(`t=${mark.time.toFixed(1)}s`, isCam ? '#7dd3fc' : (path?.color ?? '#f5a524'))
      sprite.position.set(mark.position.x, mark.position.y + 0.55, mark.position.z)
      sprite.scale.multiplyScalar(0.8)
      this.pathsGroup.add(sprite)
      this.selectionPathObjects.push(sprite)
    }
  }

  /* ----------------------------- environment ---------------------------- */

  private applyEnvironment(): void {
    const env = this.docScene?.environment
    if (!env) return
    const presets: Record<
      LightingPresetId,
      { sky: number; sun: number; sunColor: number; ambient: number; bg: number; club: number }
    > = {
      day: { sky: 0xcfe0ef, sun: 3.2, sunColor: 0xfff4e0, ambient: 1.15, bg: 0x394048, club: 0 },
      goldenHour: { sky: 0xf5c396, sun: 2.8, sunColor: 0xff9a3c, ambient: 0.8, bg: 0x3a2d1e, club: 0 },
      night: { sky: 0x2c3e5a, sun: 0.7, sunColor: 0x7a9cc6, ambient: 0.4, bg: 0x11151c, club: 0 },
      interiorWarm: { sky: 0xffe0b3, sun: 1.6, sunColor: 0xffd9a0, ambient: 0.95, bg: 0x27231d, club: 0 },
      interiorCool: { sky: 0xd0e4f5, sun: 1.7, sunColor: 0xe8f2ff, ambient: 1.0, bg: 0x212528, club: 0 },
      club: { sky: 0x281a35, sun: 0.2, sunColor: 0x8844ff, ambient: 0.3, bg: 0x0b0810, club: 40 },
      // Physical-sky presets: base scene lights approximate the sky's own key.
      middaySky: { sky: 0xbcd6f0, sun: 3.4, sunColor: 0xfff6e8, ambient: 1.2, bg: 0x8fb4dc, club: 0 },
      goldenHourSky: { sky: 0xf0c79a, sun: 2.6, sunColor: 0xffb15a, ambient: 0.85, bg: 0xcaa070, club: 0 },
      blueHourSky: { sky: 0x53617f, sun: 1.0, sunColor: 0x9fb6d8, ambient: 0.6, bg: 0x2c3550, club: 0 }
    }
    // Deterministic atmospheric-scattering parameters per sky preset (no time /
    // random inputs → byte-identical renders every export).
    const SKY_PARAMS: Partial<
      Record<LightingPresetId, { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number }>
    > = {
      middaySky: { turbidity: 2.2, rayleigh: 1.2, mieCoefficient: 0.005, mieDirectionalG: 0.8 },
      goldenHourSky: { turbidity: 6.5, rayleigh: 2.6, mieCoefficient: 0.008, mieDirectionalG: 0.86 },
      blueHourSky: { turbidity: 4.0, rayleigh: 3.4, mieCoefficient: 0.006, mieDirectionalG: 0.9 }
    }
    const p = presets[env.lighting]
    this.ambient.color.set(p.sky)
    this.ambient.intensity = p.ambient
    this.sun.intensity = p.sun
    this.sun.color.set(p.sunColor)
    this.scene.background = new THREE.Color(p.bg)
    for (const l of this.clubLights) l.intensity = p.club

    // Sun direction from azimuth/elevation.
    const r = 30
    const sunDir = new THREE.Vector3(
      Math.cos(env.sunAzimuth) * Math.cos(env.sunElevation) * r,
      Math.sin(env.sunElevation) * r,
      Math.sin(env.sunAzimuth) * Math.cos(env.sunElevation) * r
    )
    this.sun.position.copy(sunDir)
    this.sun.target.position.set(0, 0, 0)

    // Physical sky dome. Enabled only for the *Sky presets; the sun uniform is
    // a pure function of the scene's sun direction, so it stays deterministic.
    const skyCfg = SKY_PARAMS[env.lighting]
    this.skyEnabled = !!skyCfg
    this.sky.visible = this.skyEnabled
    if (skyCfg) {
      const u = this.sky.material.uniforms
      u.turbidity!.value = skyCfg.turbidity
      u.rayleigh!.value = skyCfg.rayleigh
      u.mieCoefficient!.value = skyCfg.mieCoefficient
      u.mieDirectionalG!.value = skyCfg.mieDirectionalG
      u.sunPosition!.value.copy(sunDir).normalize()
    }

    this.scene.fog = env.fog > 0.01 ? new THREE.FogExp2(p.bg, env.fog * 0.06) : null
  }

  /* ------------------------------ interaction --------------------------- */

  private pointerNdc(e: PointerEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect()
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
  }

  /** While puppeteering, the scroll wheel is the ALTITUDE control — fly a
   *  plate, a plane, or a chunk of collapsing building through the air. */
  private onWheel = (e: WheelEvent): void => {
    const s = this.currentState()
    if (!s.recording || this.recTarget === 'camera') return // orbit zoom otherwise
    e.preventDefault()
    e.stopImmediatePropagation()
    const tune = RECORD_TUNING[s.recordControl]
    this.recHeight = Math.min(60, Math.max(0, this.recHeight - e.deltaY * tune.wheel))
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect()
    this.lastPointerNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    // Pointer is on the transform gizmo (axis set on hover) — the gizmo owns
    // this interaction; running selection logic would detach it mid-grab.
    if (this.transform.dragging || this.transform.axis) return
    const s = this.currentState()
    if (s.mode === 'deliver') return
    // While recording a performance, clicks must not change the selection.
    if (s.recording) return
    // Orientation gizmo (bottom-right) gets first refusal: a hit snaps the free
    // camera to that axis (orbiting the current target) and consumes the click.
    if (!s.lookThrough && this.viewHelper) {
      this.viewHelper.center.copy(this.controls.target)
      if (this.viewHelper.handleClick(e)) return
    }
    const ndc = this.pointerNdc(e)
    this.raycaster.setFromCamera(ndc, s.lookThrough ? this.shotCam : this.freeCam)

    // 1) Placement
    if (s.placingAssetId) {
      const point = this.groundHit()
      if (point) {
        const y = this.surfaceHeightAt(point)
        s.addEntity(s.placingAssetId, { x: point.x, y, z: point.z })
        if (!e.altKey) s.setPlacingAsset(null)
      }
      return
    }

    // 1b) Sequence placement: the crowd stages exactly where you click,
    // facing the camera.
    if (s.placingSequence) {
      const point = this.groundHit()
      if (point) {
        const toCam = this.freeCam.position.clone().sub(point)
        const heading = headingOf({ x: toCam.x, y: 0, z: toCam.z })
        const seq = s.placingSequence
        s.setPlacingSequence(null)
        s.spawnSequence({ ...seq, origin: { x: point.x, z: point.z, heading } })
      }
      return
    }

    // 1c) Choreography placement: the routine stages where you click, facing
    // the camera.
    if (s.placingChoreography) {
      const point = this.groundHit()
      if (point) {
        const toCam = this.freeCam.position.clone().sub(point)
        const heading = headingOf({ x: toCam.x, y: 0, z: toCam.z })
        const spec = s.placingChoreography
        s.setPlacingChoreography(null)
        s.spawnChoreography(spec, { x: point.x, z: point.z, heading })
      }
      return
    }

    // 2) Mark dropping
    if (s.droppingMarks && s.selection) {
      const point = this.groundHit()
      if (point) {
        if (s.selection.kind === 'entity') {
          s.dropActorMark(s.selection.entityId, { x: point.x, y: 0, z: point.z })
        } else if (s.selection.kind === 'camera') {
          // Keep the shot cam's current height/orientation/lens; move to click.
          s.dropCameraMark(
            { x: point.x, y: this.shotCam.position.y, z: point.z },
            this.shotCam.rotation.y,
            this.shotCam.rotation.x,
            this.currentLens()
          )
        }
      }
      return
    }

    // 3) Selection
    const pickables: THREE.Object3D[] = []
    for (const v of this.visuals.values()) pickables.push(v.root)
    pickables.push(this.cameraBody)
    const hits = this.raycaster.intersectObjects(pickables, true)
    // Label sprites float above heads — picking through them selects what
    // the user actually aimed at.
    const hit = hits.find((h) => !(h.object instanceof THREE.Sprite))
    if (hit) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        if (o.userData.entityId) {
          const id = o.userData.entityId as string
          // Shift-click: build/extend a multi-selection.
          if (e.shiftKey) s.toggleEntitySelected(id)
          else s.setSelection({ kind: 'entity', entityId: id })
          return
        }
        if (o === this.cameraBody) {
          s.setSelection({ kind: 'camera' })
          return
        }
        o = o.parent
      }
    }
    // Clicked empty space (shift-click on empty keeps the multi-selection)
    if (!this.transform.dragging && !e.shiftKey) s.setSelection(null)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const inField =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement
    if (inField) return
    if (e.key === 'g' || e.key === 'G') this.setGizmoMode('translate')
    if (e.key === 'r' || e.key === 'R') this.setGizmoMode('rotate')
    if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault()
      this.duplicateSelection()
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
      // ⌘A selects every mark in the shot (⇧⌘A: just the current lane).
      const s = this.currentState()
      if (s.mode === 'shoot') {
        e.preventDefault()
        const sel = s.selection
        if (e.shiftKey && (sel?.kind === 'mark' || sel?.kind === 'marks')) {
          s.selectAllMarksInLane(sel.entityId)
        } else if (e.shiftKey && sel?.kind === 'entity') {
          s.selectAllMarksInLane(sel.entityId)
        } else if (e.shiftKey && sel?.kind === 'camera') {
          s.selectAllMarksInLane('camera')
        } else {
          s.selectAllMarks()
        }
      }
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const s = this.currentState()
      const sel = s.selection
      if (sel?.kind === 'mark' || sel?.kind === 'marks') s.deleteSelectedMarks()
      else this.deleteSelection()
    }
  }

  private groundHit(): THREE.Vector3 | null {
    const target = new THREE.Vector3()
    return this.raycaster.ray.intersectPlane(this.groundPlane, target) ? target : null
  }

  /** Gravity-aware placement: stack on whatever is under the cursor. */
  private surfaceHeightAt(point: THREE.Vector3): number {
    const down = new THREE.Raycaster(
      new THREE.Vector3(point.x, 50, point.z),
      new THREE.Vector3(0, -1, 0)
    )
    const meshes: THREE.Object3D[] = []
    for (const v of this.visuals.values()) meshes.push(v.root)
    const hits = down.intersectObjects(meshes, true).filter((h) => !(h.object instanceof THREE.Sprite))
    return hits.length > 0 ? Math.max(0, hits[0]!.point.y) : 0
  }

  private selectedObject(): THREE.Object3D | null {
    const sel = this.currentState().selection
    if (!sel) return null
    if (sel.kind === 'entity') return this.visuals.get(sel.entityId)?.root ?? null
    if (sel.kind === 'entities') {
      const last = sel.entityIds[sel.entityIds.length - 1]
      return last ? (this.visuals.get(last)?.root ?? null) : null
    }
    if (sel.kind === 'camera') return this.cameraBody
    return null
  }

  /** Set the gizmo mode; entities rotate around Y only (they stay upright). */
  setGizmoMode(mode: 'translate' | 'rotate'): void {
    this.transform.setMode(mode)
    this.applyGizmoAxisLimits()
  }

  private applyGizmoAxisLimits(): void {
    const sel = this.currentState().selection
    const isEntity = sel?.kind === 'entity' || sel?.kind === 'entities'
    if (this.transform.mode === 'rotate' && isEntity) {
      this.transform.showX = false
      this.transform.showZ = false
      this.transform.showY = true
    } else {
      this.transform.showX = true
      this.transform.showY = true
      this.transform.showZ = true
    }
  }

  private syncSelection(): void {
    const s = this.currentState()
    const obj = this.selectedObject()
    this.transform.detach()
    this.selectionBox.visible = false
    for (const box of this.extraSelectionBoxes) {
      this.scene.remove(box)
      box.dispose()
    }
    this.extraSelectionBoxes = []

    const isEntitySel = s.selection?.kind === 'entity' || s.selection?.kind === 'entities'
    if (obj && !s.lookThrough && s.mode !== 'deliver') {
      // Entities are transformable in BOTH Stage and Shoot (move/rotate);
      // the camera body likewise (drags commit to the active camera mark).
      if (isEntitySel) this.transform.attach(obj)
      if (s.selection?.kind === 'camera') this.transform.attach(this.cameraBody)
      this.applyGizmoAxisLimits()
    }
    if (obj) {
      this.selectionBox.setFromObject(obj)
      this.selectionBox.visible = true
    }
    // Extra boxes for the other members of a multi-selection.
    if (s.selection?.kind === 'entities') {
      for (const id of s.selection.entityIds.slice(0, -1)) {
        const visual = this.visuals.get(id)
        if (!visual) continue
        const box = new THREE.BoxHelper(visual.root, 0x7dd3fc)
        this.scene.add(box)
        this.extraSelectionBoxes.push(box)
      }
    }

    // Subtle emissive tint on the selected entities (editor-only; cleared in
    // every export pass by renderFrameAt). Cheaper/safer than an OutlinePass —
    // no EffectComposer on the render path.
    this.clearSelectionTint()
    if (!s.lookThrough && s.mode !== 'deliver') {
      const ids = selectedEntityIds(s.selection)
      for (const id of ids) {
        const visual = this.visuals.get(id)
        // Env kits are room-scale — a whole-asset glow paints the entire set.
        // Their selection reads fine from the selection box alone.
        if (visual && !visual.entity.assetId.startsWith('env.')) this.tintEntity(visual.root)
      }
    }

    this.rebuildSelectionDecorations()
  }

  /** Apply a faint emissive glow to every standard material under a root. */
  private tintEntity(root: THREE.Object3D): void {
    const seen = new Set(this.tintedMaterials.map((t) => t.mat))
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        if (!std || !('emissive' in std) || !std.emissive) continue
        // A material shared across meshes must be recorded once — a second
        // push would remember the TINTED values as "original".
        if (seen.has(std)) continue
        seen.add(std)
        this.tintedMaterials.push({
          mat: std,
          emissive: std.emissive.getHex(),
          intensity: std.emissiveIntensity ?? 1
        })
        std.emissive.setHex(0x2b6cff)
        std.emissiveIntensity = 0.12
      }
    })
  }

  /** Restore every tinted material to its pre-selection emissive. */
  private clearSelectionTint(): void {
    for (const t of this.tintedMaterials) {
      t.mat.emissive.setHex(t.emissive)
      t.mat.emissiveIntensity = t.intensity
    }
    this.tintedMaterials = []
  }

  /** Snapshot doc transforms of every selected entity when a drag starts. */
  private beginGizmoDrag(): void {
    const s = this.currentState()
    const ids = selectedEntityIds(s.selection)
    if (ids.length === 0) {
      this.dragStart = null
      this.dragAnchorId = null
      return
    }
    this.dragAnchorId = ids[ids.length - 1]!
    this.dragStart = new Map()
    for (const id of ids) {
      const visual = this.visuals.get(id)
      if (visual) {
        this.dragStart.set(id, {
          pos: visual.root.position.clone(),
          rotY: visual.root.rotation.y
        })
      }
    }
  }

  /** Rigid-group transform: apply the anchor's drag delta to a member. */
  private groupTransformed(
    start: { pos: THREE.Vector3; rotY: number },
    anchorStart: { pos: THREE.Vector3; rotY: number },
    anchorNow: { pos: THREE.Vector3; rotY: number }
  ): { pos: THREE.Vector3; rotY: number } {
    const dRot = anchorNow.rotY - anchorStart.rotY
    const rel = start.pos.clone().sub(anchorStart.pos)
    const cos = Math.cos(dRot)
    const sin = Math.sin(dRot)
    // Y-rotation of the offset about the anchor pivot (matches heading math)
    const rx = rel.x * cos + rel.z * sin
    const rz = -rel.x * sin + rel.z * cos
    return {
      pos: new THREE.Vector3(anchorNow.pos.x + rx, anchorNow.pos.y + rel.y, anchorNow.pos.z + rz),
      rotY: start.rotY + dRot
    }
  }

  private commitGizmo(): void {
    const s = this.currentState()
    const sel = s.selection
    if (!sel) return

    if (sel.kind === 'camera') {
      // Dragging the camera body writes the active camera mark (or creates
      // the first one). Rotation commits pan/tilt/roll too (R to rotate).
      const pos = this.cameraBody.position
      const e = new THREE.Euler().setFromQuaternion(this.cameraBody.quaternion, 'YXZ')
      const mark = this.activeCameraMark()
      if (!mark) {
        s.dropCameraMark({ x: pos.x, y: pos.y, z: pos.z }, e.y, e.x, 35)
        return
      }
      const shotId = this.shot?.id
      s.mutate('move camera', (doc) => {
        for (const scene of doc.scenes) {
          const shot = scene.shots.find((x) => x.id === shotId)
          const m = shot?.camera.marks.find((x) => x.id === mark.id)
          if (m) {
            m.position = { x: pos.x, y: pos.y, z: pos.z }
            m.pan = e.y
            m.tilt = e.x
            m.roll = e.z
          }
        }
      })
      return
    }

    const ids = selectedEntityIds(sel)
    if (ids.length === 0) return
    const anchorId = this.dragAnchorId ?? ids[ids.length - 1]!
    const anchorVisual = this.visuals.get(anchorId)
    const anchorStart = this.dragStart?.get(anchorId)
    if (!anchorVisual) return
    const anchorNow = {
      pos: anchorVisual.root.position.clone(),
      rotY: anchorVisual.root.rotation.y
    }
    const scale = anchorVisual.root.scale.x
    const dragStart = this.dragStart
    this.dragStart = null
    this.dragAnchorId = null

    s.mutate(ids.length > 1 ? 'move group' : 'move entity', (doc) => {
      for (const scene of doc.scenes) {
        for (const id of ids) {
          const entity = scene.entities.find((e) => e.id === id)
          if (!entity) continue
          let next: { pos: THREE.Vector3; rotY: number }
          if (id === anchorId || !anchorStart || !dragStart?.get(id)) {
            next = id === anchorId ? anchorNow : null!
            if (!next) continue
          } else {
            next = this.groupTransformed(dragStart.get(id)!, anchorStart, anchorNow)
          }
          if (entity.attachedTo && entity.attachedLocal) {
            // Married: a drag adjusts the local offset on the parent instead
            // of the world transform (the evaluator would snap it back).
            const parentVisual = this.visuals.get(entity.attachedTo)
            if (parentVisual) {
              const ph = parentVisual.root.rotation.y
              const dx = next.pos.x - parentVisual.root.position.x
              const dz = next.pos.z - parentVisual.root.position.z
              const cos = Math.cos(ph)
              const sin = Math.sin(ph)
              entity.attachedLocal = {
                x: dx * cos - dz * sin,
                y: next.pos.y - parentVisual.root.position.y,
                z: dx * sin + dz * cos,
                rotY: next.rotY - ph
              }
            }
          } else {
            entity.transform.position = { x: next.pos.x, y: Math.max(0, next.pos.y), z: next.pos.z }
            entity.transform.rotationY = next.rotY
            if (id === anchorId) entity.transform.scale = scale
          }
          // Choreography rides along: a performer's MARKS define where it
          // is, so moving the body without its path would just snap back.
          // Apply the same rigid motion (translate + rotate about the drag
          // anchor) to every mark the entity owns.
          const startPose = dragStart?.get(id)
          if (startPose && anchorStart) {
            for (const take of scene.blocking) {
              const track = take.tracks.find((t) => t.entityId === id)
              if (!track) continue
              for (const m of track.marks) {
                const mapped = this.groupTransformed(
                  { pos: new THREE.Vector3(m.position.x, m.position.y, m.position.z), rotY: 0 },
                  anchorStart,
                  anchorNow
                )
                m.position = {
                  x: mapped.pos.x,
                  y: Math.max(0, mapped.pos.y),
                  z: mapped.pos.z
                }
              }
            }
          }
        }
      }
    })
  }

  private duplicateSelection(): void {
    const s = this.currentState()
    const ids = selectedEntityIds(s.selection)
    for (const id of ids) {
      const visual = this.visuals.get(id)
      if (!visual) continue
      const e = visual.entity
      s.addEntity(e.assetId, {
        x: e.transform.position.x + 0.8,
        y: e.transform.position.y,
        z: e.transform.position.z + 0.8
      })
    }
  }

  private deleteSelection(): void {
    const s = this.currentState()
    const ids = selectedEntityIds(s.selection)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    s.mutate(ids.length > 1 ? 'delete entities' : 'delete entity', (doc) => {
      for (const scene of doc.scenes) {
        scene.entities = scene.entities.filter((e) => !idSet.has(e.id))
        for (const entity of scene.entities) {
          // Widow any marriages pointing at a deleted parent.
          if (entity.attachedTo && idSet.has(entity.attachedTo)) {
            delete entity.attachedTo
            delete entity.attachedLocal
          }
        }
        for (const take of scene.blocking) {
          take.tracks = take.tracks.filter((t) => !idSet.has(t.entityId))
        }
        // A camera mounted to a deleted entity would silently re-base its
        // local-frame marks to world space — unmount instead.
        for (const shot of [...scene.shots, ...(scene.drafts ?? [])]) {
          if (shot.camera.mountEntityId && idSet.has(shot.camera.mountEntityId)) {
            delete shot.camera.mountEntityId
          }
        }
      }
    })
    s.setSelection(null)
  }

  /**
   * Ground snap: rest each selected entity's base on whatever is under it
   * (the floor, a table, a truck bed) — one click, no fiddling with Y.
   */
  snapSelectionToGround(): void {
    const s = this.currentState()
    const ids = selectedEntityIds(s.selection)
    if (ids.length === 0) {
      s.toast('Select something to snap to the ground first.', 'info')
      return
    }
    const updates = new Map<string, number>()
    for (const id of ids) {
      const visual = this.visuals.get(id)
      if (!visual) continue
      const box = new THREE.Box3().setFromObject(visual.root)
      if (box.isEmpty()) continue
      // Surface under the entity's center, ignoring itself.
      const center = box.getCenter(new THREE.Vector3())
      const down = new THREE.Raycaster(
        new THREE.Vector3(center.x, box.min.y - 0.01, center.z),
        new THREE.Vector3(0, -1, 0)
      )
      const others: THREE.Object3D[] = []
      for (const [otherId, v] of this.visuals) if (otherId !== id) others.push(v.root)
      const hits = down
        .intersectObjects(others, true)
        .filter((h) => !(h.object instanceof THREE.Sprite))
      const surfaceY = hits.length > 0 ? Math.max(0, hits[0]!.point.y) : 0
      const newY = visual.root.position.y + (surfaceY - box.min.y)
      updates.set(id, newY)
    }
    if (updates.size === 0) return
    s.mutate('snap to ground', (doc) => {
      for (const scene of doc.scenes) {
        for (const [id, y] of updates) {
          const entity = scene.entities.find((e) => e.id === id)
          if (entity && !entity.attachedTo) entity.transform.position.y = y
        }
      }
    })
  }

  /* --------------------------- camera commands -------------------------- */

  private currentLens(): number {
    if (!this.evaluator || !this.shot) return 35
    return this.evaluator.evaluate(this.currentState().time).camera.focalLength
  }

  /** Closest camera mark at/before the playhead — the one live edits write to. */
  private activeCameraMark() {
    const shot = this.shot
    if (!shot || shot.camera.marks.length === 0) return null
    const t = this.currentState().time
    const sorted = [...shot.camera.marks].sort((a, b) => a.time - b.time)
    let active = sorted[0]!
    for (const m of sorted) if (m.time <= t + 1e-6) active = m
    return active
  }

  private setLens(focalLength: number): void {
    const s = this.currentState()
    const mark = this.activeCameraMark()
    if (!mark) {
      // No marks yet: drop one at the current view with this lens.
      this.dropCameraMarkAtView(focalLength)
      return
    }
    s.mutate('set lens', (doc) => {
      for (const scene of doc.scenes) {
        for (const shot of scene.shots) {
          const m = shot.camera.marks.find((x) => x.id === mark.id)
          if (m) m.focalLength = focalLength
        }
      }
    })
  }

  private dropCameraMarkAtView(focalLength?: number): void {
    const s = this.currentState()
    const cam = s.lookThrough ? this.shotCam : this.freeCam
    const pos = cam.position
    // Extract pan/tilt from the camera's world direction.
    const dir = new THREE.Vector3()
    cam.getWorldDirection(dir)
    const pan = headingOf({ x: dir.x, y: 0, z: dir.z })
    const tilt = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
    s.dropCameraMark({ x: pos.x, y: pos.y, z: pos.z }, pan, tilt, focalLength ?? this.currentLens())
    s.setSelection({ kind: 'camera' })
  }

  private autoFrame(size: Parameters<typeof frameSubjectMath>[0]): void {
    const s = this.currentState()
    // Frame the selected entity, or the first person in the scene.
    let subjectId: string | null = s.selection?.kind === 'entity' ? s.selection.entityId : null
    if (!subjectId) {
      const person = this.docScene?.entities.find((e) => e.assetId.startsWith('person.'))
      subjectId = person?.id ?? this.docScene?.entities[0]?.id ?? null
    }
    if (!subjectId || !this.shot || !this.evaluator) {
      s.toast('Place a subject first, then auto-frame.', 'info')
      return
    }
    const state = this.evaluator.evaluate(s.time)
    const es = state.entities.find((e) => e.entityId === subjectId)
    const entity = this.docScene!.entities.find((e) => e.id === subjectId)
    if (!es || !entity) return

    const subjectHeight = entityHeight(entity.assetId, entity.transform.scale, entity.params)
    const lens = this.currentLens()
    const { distance, targetHeight } = frameSubjectMath(
      size,
      subjectHeight,
      this.shot.camera.sensorId,
      lens,
      this.shot.aspect
    )
    // Keep the current camera→subject azimuth; step back to `distance`.
    const camState = state.camera
    let az = Math.atan2(camState.position.x - es.position.x, camState.position.z - es.position.z)
    if (!isFinite(az)) az = 0
    const px = es.position.x + Math.sin(az) * distance
    const pz = es.position.z + Math.cos(az) * distance
    const py = es.position.y + targetHeight
    const pan = headingOf({ x: es.position.x - px, y: 0, z: es.position.z - pz })
    const dy = es.position.y + targetHeight - py
    const tilt = Math.atan2(dy, distance)

    const mark = this.activeCameraMark()
    if (!mark) {
      s.dropCameraMark({ x: px, y: py, z: pz }, pan, tilt, lens)
    } else {
      s.mutate('auto-frame', (doc) => {
        for (const scene of doc.scenes) {
          for (const shot of scene.shots) {
            const m = shot.camera.marks.find((x) => x.id === mark.id)
            if (m) {
              m.position = { x: px, y: py, z: pz }
              m.pan = pan
              m.tilt = tilt
            }
          }
        }
      })
    }
    s.setSelection({ kind: 'camera' })
  }

  /* --------------------------- framing presets --------------------------- */

  /**
   * Subjects for framing presets: the selected entities if any are people
   * (or anything explicitly selected), otherwise every person in the scene.
   * Evaluated at the playhead so mid-move blocking frames correctly.
   */
  private framingSubjects(): { id: string; pos: THREE.Vector3; height: number }[] {
    if (!this.evaluator || !this.docScene) return []
    const s = this.currentState()
    const state = this.evaluator.evaluate(s.time)
    const selected = selectedEntityIds(s.selection)
    let entities = this.docScene.entities.filter((e) => selected.includes(e.id))
    if (entities.length < 2) {
      entities = this.docScene.entities.filter((e) => e.assetId.startsWith('person.'))
    }
    if (entities.length === 0) entities = this.docScene.entities.slice(0, 2)
    const out: { id: string; pos: THREE.Vector3; height: number }[] = []
    for (const e of entities) {
      const es = state.entities.find((x) => x.entityId === e.id)
      if (!es) continue
      out.push({
        id: e.id,
        pos: new THREE.Vector3(es.position.x, es.position.y, es.position.z),
        height: entityHeight(e.assetId, e.transform.scale, e.params)
      })
    }
    return out
  }

  /** Write a full pose to the active camera mark (or drop one if none). */
  private writeCameraPose(
    label: string,
    pos: THREE.Vector3,
    pan: number,
    tilt: number,
    roll?: number
  ): void {
    const s = this.currentState()
    const lens = this.currentLens()
    const mark = this.activeCameraMark()
    if (!mark) {
      s.dropCameraMark({ x: pos.x, y: pos.y, z: pos.z }, pan, tilt, lens)
      if (roll !== undefined) {
        const fresh = this.activeCameraMark()
        if (fresh) {
          s.mutate(label, (doc) => {
            for (const scene of doc.scenes)
              for (const shot of scene.shots) {
                const m = shot.camera.marks.find((x) => x.id === fresh.id)
                if (m) m.roll = roll
              }
          })
        }
      }
    } else {
      s.mutate(label, (doc) => {
        for (const scene of doc.scenes)
          for (const shot of scene.shots) {
            const m = shot.camera.marks.find((x) => x.id === mark.id)
            if (m) {
              m.position = { x: pos.x, y: pos.y, z: pos.z }
              m.pan = pan
              m.tilt = tilt
              if (roll !== undefined) m.roll = roll
            }
          }
      })
    }
    s.setSelection({ kind: 'camera' })
  }

  private panTiltToward(from: THREE.Vector3, to: THREE.Vector3): { pan: number; tilt: number } {
    const pan = headingOf({ x: to.x - from.x, y: 0, z: to.z - from.z })
    const flat = Math.hypot(to.x - from.x, to.z - from.z)
    const tilt = Math.atan2(to.y - from.y, Math.max(flat, 1e-4))
    return { pan, tilt }
  }

  /** One-click cinematography: 2-shot, OTS, reverse, overhead, low, dutch. */
  applyFraming(kind: import('../bus').FramingKind): void {
    const s = this.currentState()
    if (!this.shot || !this.evaluator) return
    const subjects = this.framingSubjects()
    const camState = this.evaluator.evaluate(s.time).camera
    const camPos = new THREE.Vector3(
      camState.position.x,
      camState.position.y,
      camState.position.z
    )
    if (subjects.length === 0) {
      s.toast('Place at least one character first.', 'info')
      return
    }
    const primary = subjects[0]!
    const lens = this.currentLens()
    const aspect = this.shot.aspect
    const sensor = this.shot.camera.sensorId

    if (kind === 'DUTCH') {
      // Cycle the tilt of the horizon: level → right → left → level.
      const mark = this.activeCameraMark()
      const current = mark?.roll ?? 0
      const next = Math.abs(current) < 0.05 ? 0.35 : current > 0 ? -0.35 : 0
      const { pan, tilt } = this.panTiltToward(
        camPos,
        primary.pos.clone().add(new THREE.Vector3(0, primary.height * 0.85, 0))
      )
      this.writeCameraPose(
        'dutch angle',
        camPos,
        mark ? mark.pan : pan,
        mark ? mark.tilt : tilt,
        next
      )
      s.toast(next === 0 ? 'Horizon level' : `Dutch ${next > 0 ? 'right' : 'left'}`, 'info')
      return
    }

    if (kind === 'REV') {
      // Reverse angle: swing 180° about the subjects' midpoint, same distance.
      const mid =
        subjects.length >= 2
          ? subjects[0]!.pos.clone().add(subjects[1]!.pos).multiplyScalar(0.5)
          : primary.pos.clone()
      const pos = new THREE.Vector3(2 * mid.x - camPos.x, camPos.y, 2 * mid.z - camPos.z)
      const look = mid.clone().setY(primary.pos.y + primary.height * 0.75)
      const { pan, tilt } = this.panTiltToward(pos, look)
      this.writeCameraPose('reverse angle', pos, pan, tilt)
      return
    }

    if (kind === 'OTS') {
      if (subjects.length < 2) {
        s.toast('Over-the-shoulder needs two characters — select both.', 'info')
        return
      }
      // Foreground shoulder = the subject closer to the current camera.
      const [a, b] = subjects
      const near = camPos.distanceTo(a!.pos) <= camPos.distanceTo(b!.pos) ? a! : b!
      const far = near === a ? b! : a!
      const back = near.pos.clone().sub(far.pos).setY(0).normalize()
      if (back.lengthSq() < 1e-6) back.set(0, 0, 1)
      const side = new THREE.Vector3(back.z, 0, -back.x)
      // Keep the camera's current side of the axis so cutting stays on-line.
      const camSide = camPos.clone().sub(near.pos)
      if (camSide.dot(side) < 0) side.negate()
      const pos = near.pos
        .clone()
        .add(back.multiplyScalar(0.75))
        .add(side.multiplyScalar(0.45))
        .setY(near.pos.y + near.height * 0.92)
      const look = far.pos.clone().setY(far.pos.y + far.height * 0.88)
      const { pan, tilt } = this.panTiltToward(pos, look)
      this.writeCameraPose('over-the-shoulder', pos, pan, tilt)
      return
    }

    if (kind === 'TOP') {
      // Overhead: fit everyone with the vertical FOV, looking straight down.
      const mid = new THREE.Vector3()
      for (const sub of subjects) mid.add(sub.pos)
      mid.multiplyScalar(1 / subjects.length)
      let span = 3
      for (const sub of subjects) span = Math.max(span, mid.distanceTo(sub.pos) * 2 + 2)
      const vfov = verticalFov(sensor, lens, aspect)
      const h = Math.max(4, span / 2 / Math.tan(vfov / 2) + 1)
      const pos = new THREE.Vector3(mid.x, mid.y + h, mid.z + 0.01)
      this.writeCameraPose('overhead', pos, camState.pan, -Math.PI / 2 + 0.001)
      return
    }

    if (kind === 'LOW') {
      // Low angle: knee height, looking up at the primary subject's head.
      const toCam = camPos.clone().sub(primary.pos).setY(0)
      if (toCam.lengthSq() < 1e-4) toCam.set(0, 0, 1)
      const dist = THREE.MathUtils.clamp(toCam.length(), 1.6, 4)
      toCam.normalize()
      const pos = primary.pos
        .clone()
        .add(toCam.multiplyScalar(dist))
        .setY(primary.pos.y + 0.35)
      const look = primary.pos.clone().setY(primary.pos.y + primary.height * 0.95)
      const { pan, tilt } = this.panTiltToward(pos, look)
      this.writeCameraPose('low angle', pos, pan, tilt)
      return
    }

    // 2S — group framing perpendicular to the pair (works for 3/4-shots too:
    // it fits however many subjects are selected).
    if (subjects.length < 2) {
      s.toast('A two-shot needs two characters — select them first.', 'info')
      return
    }
    const a = subjects[0]!
    const b = subjects[subjects.length - 1]!
    const mid = new THREE.Vector3()
    for (const sub of subjects) mid.add(sub.pos)
    mid.multiplyScalar(1 / subjects.length)
    const axis = b.pos.clone().sub(a.pos).setY(0)
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
    axis.normalize()
    const perp = new THREE.Vector3(axis.z, 0, -axis.x)
    // Stay on the camera's current side of the line (the 180° rule).
    if (camPos.clone().sub(mid).dot(perp) < 0) perp.negate()
    let span = 0
    for (const sub of subjects) {
      span = Math.max(span, Math.abs(sub.pos.clone().sub(mid).dot(axis)) * 2)
    }
    span += 1.6 // shoulder margin on both ends
    const tallest = Math.max(...subjects.map((sub) => sub.height))
    const hfov = horizontalFov(sensor, lens)
    const vfov = verticalFov(sensor, lens, aspect)
    const dist = Math.max(
      span / 2 / Math.tan(hfov / 2),
      (tallest + 0.4) / 2 / Math.tan(vfov / 2),
      1.5
    )
    const pos = mid.clone().add(perp.multiplyScalar(dist)).setY(mid.y + tallest * 0.62)
    const look = mid.clone().setY(mid.y + tallest * 0.55)
    const { pan, tilt } = this.panTiltToward(pos, look)
    this.writeCameraPose(subjects.length > 2 ? 'group shot' : 'two-shot', pos, pan, tilt)
  }

  /**
   * Apply a classic camera-move preset (orbit, crane, drone follow, vertigo…)
   * to the active camera: generates marks over the whole shot relative to the
   * subject — sampling the subject's own motion so moves ride along with a
   * flying plane or a walking actor. Enables aim-lock tracking when the move
   * calls for it. One undo step; adjust any mark afterwards.
   */
  applyCameraMove(presetId: string): void {
    const s = this.currentState()
    const preset = CAMERA_MOVE_PRESETS.find((p) => p.id === presetId)
    if (!preset || !this.shot || !this.evaluator || !this.docScene) return
    const subjects = this.framingSubjects()
    const subject = subjects[0]
    if (!subject) {
      s.toast('Place a subject first — camera moves are built around one.', 'info')
      return
    }
    const entity = this.docScene.entities.find((e) => e.id === subject.id)!
    const evaluator = this.evaluator
    const cam0 = evaluator.evaluate(0).camera
    const duration = this.shot.duration
    const specs = preset.generate({
      subjectAt: (t) => {
        const st = evaluator.evaluate(Math.min(Math.max(t, 0), duration))
        const es = st.entities.find((e) => e.entityId === subject.id)
        return es
          ? { x: es.position.x, y: es.position.y, z: es.position.z, heading: es.heading }
          : { x: subject.pos.x, y: subject.pos.y, z: subject.pos.z, heading: 0 }
      },
      subjectHeight: entityHeight(entity.assetId, entity.transform.scale, entity.params),
      camera: {
        x: cam0.position.x,
        y: cam0.position.y,
        z: cam0.position.z,
        pan: cam0.pan,
        tilt: cam0.tilt,
        focalLength: cam0.focalLength
      },
      duration
    })
    const shotId = this.shot.id
    const marks = specs.map((spec) => ({
      id: newId('cmark'),
      time: spec.time,
      hold: spec.hold,
      easeIn: spec.easeIn,
      easeOut: spec.easeOut,
      position: { ...spec.position },
      pan: spec.pan,
      tilt: spec.tilt,
      roll: spec.roll,
      focalLength: spec.focalLength
    }))
    s.mutate(`camera move: ${preset.name}`, (doc) => {
      for (const scene of doc.scenes) {
        const shot =
          scene.shots.find((x) => x.id === shotId) ?? scene.drafts?.find((x) => x.id === shotId)
        if (!shot) continue
        shot.camera.marks = marks
        // Aim-lock moves stay glued to the subject even if marks are re-timed
        // or dragged; framed moves (whip pan, static pan) aim by their marks.
        if (preset.track) shot.camera.trackEntityId = subject.id
        else delete shot.camera.trackEntityId
      }
    })
    s.setSelection({ kind: 'camera' })
    s.toast(
      `${preset.name} on ${entity.label?.text || entity.name} — ▶ to watch, then drag any mark to adjust.`,
      'success'
    )
  }

  /**
   * Where the editor camera is looking, on the ground, facing back at the
   * camera — the natural spot to drop a staged sequence.
   */
  viewCenterOnGround(): { x: number; z: number; heading: number } {
    const dir = new THREE.Vector3()
    this.freeCam.getWorldDirection(dir)
    const heading = headingOf({ x: -dir.x, y: 0, z: -dir.z })
    const ray = new THREE.Ray(this.freeCam.position.clone(), dir)
    const point = new THREE.Vector3()
    if (ray.intersectPlane(this.groundPlane, point)) {
      return { x: point.x, z: point.z, heading }
    }
    // Looking at the horizon: use a spot 12m ahead at ground level.
    const ahead = this.freeCam.position.clone().add(dir.multiplyScalar(12))
    return { x: ahead.x, z: ahead.z, heading }
  }

  /* ------------------------------ recording ----------------------------- */

  private beginRecording(): void {
    this.recSamples = []
    this.entitySamples = []
    this.recStartedAt = performance.now()
    this.recPrevFrame = performance.now()
    this.recLens = this.currentLens()
    const s = this.currentState()
    const tune = RECORD_TUNING[s.recordControl]

    // Tame the viewport controls while recording — Precise mode flies the
    // camera at a fraction of editing speed and adds damping so moves land
    // where you intend them.
    this.savedOrbitSpeeds = {
      rotate: this.controls.rotateSpeed,
      pan: this.controls.panSpeed,
      zoom: this.controls.zoomSpeed
    }
    this.controls.rotateSpeed = tune.orbit
    this.controls.panSpeed = tune.orbit
    this.controls.zoomSpeed = tune.orbit
    this.controls.enableDamping = true
    this.controls.dampingFactor = tune.damping

    // Target: a single selected entity means "record ITS move" (puppeteer
    // with the cursor); anything else records the camera.
    const ids = selectedEntityIds(s.selection)
    this.recTarget = ids.length === 1 ? ids[0]! : 'camera'

    // Playback-synced when there is other motion to perform against — the
    // existing choreography replays while you record, so a camera flight
    // (or a second character) lands in sync with it.
    const take = this.docScene?.blocking.find((b) => b.id === this.shot?.blockingTakeId)
    const hasOtherMotion =
      this.recTarget === 'camera'
        ? !!take?.tracks.some((t) => t.marks.length > 0)
        : !!take?.tracks.some((t) => t.entityId !== this.recTarget && t.marks.length > 0) ||
          (this.shot?.camera.marks.length ?? 0) > 0
    this.recPlaybackSynced = hasOtherMotion

    if (this.recPlaybackSynced) {
      s.setTime(0)
      s.setPlaying(true)
    } else {
      s.setPlaying(false)
    }

    if (this.recTarget === 'camera') {
      s.toast(
        this.recPlaybackSynced
          ? 'Recording camera — the blocking replays while you fly the viewport. Stops at the end of the shot.'
          : 'Recording — fly the viewport; the shot camera follows. Click ■ to stop.',
        'info'
      )
    } else {
      // Start the flight plane at the entity's current altitude so props
      // already in the air (or on tables) record from where they sit.
      const startPos = this.visuals.get(this.recTarget)?.root.position
      this.recHeight = startPos?.y ?? 0
      this.recCursor.copy(startPos ?? new THREE.Vector3())
      this.controls.enableZoom = false // wheel = altitude while puppeteering
      s.toast(
        this.recPlaybackSynced
          ? 'Recording performance — steer with the cursor while the rest replays. Scroll = altitude.'
          : 'Recording performance — steer with the cursor; scroll wheel raises/lowers it (fly a plate, a plane, debris). Click ■ to stop.',
        'info'
      )
    }
  }

  private finishRecording(): void {
    const s = this.currentState()
    s.setPlaying(false)
    this.controls.enableZoom = true
    this.controls.enableDamping = false
    if (this.savedOrbitSpeeds) {
      this.controls.rotateSpeed = this.savedOrbitSpeeds.rotate
      this.controls.panSpeed = this.savedOrbitSpeeds.pan
      this.controls.zoomSpeed = this.savedOrbitSpeeds.zoom
      this.savedOrbitSpeeds = null
    }
    if (this.recTarget !== 'camera') {
      this.finishEntityRecording()
      return
    }
    const shotId = this.shot?.id
    const samples = this.recSamples
    this.recSamples = []
    if (!shotId || samples.length < 5) {
      if (samples.length > 0) s.toast('Recording too short — nothing saved.', 'info')
      return
    }
    const length = this.recPlaybackSynced
      ? (this.shot?.duration ?? 5)
      : Math.min(60, Math.max(0.5, samples[samples.length - 1]!.t))
    // Downsample to a mark every 250ms (plus the final pose). Marks with
    // zero easing replay the move exactly; the rig still layers on top.
    const step = 0.25
    const lens = this.recLens
    const marks: import('@engine/types').CameraMark[] = []
    let cursor = 0
    for (let t = 0; t <= length + 1e-6; t += step) {
      while (cursor < samples.length - 1 && samples[cursor]!.t < t) cursor++
      const sm = samples[cursor]!
      marks.push({
        id: newId('cmark'),
        time: Math.min(t, length),
        hold: 0,
        easeIn: 0,
        easeOut: 0,
        position: { x: sm.pos.x, y: sm.pos.y, z: sm.pos.z },
        pan: sm.pan,
        tilt: sm.tilt,
        roll: sm.roll,
        focalLength: lens
      })
    }
    s.mutate('record camera move', (doc) => {
      for (const scene of doc.scenes) {
        const shot =
          scene.shots.find((x) => x.id === shotId) ?? scene.drafts?.find((x) => x.id === shotId)
        if (shot) {
          shot.camera.marks = marks
          if (!this.recPlaybackSynced) shot.duration = Math.round(length * 10) / 10
        }
      }
    })
    s.setSelection({ kind: 'camera' })
    // Instant dailies: show the filmmaker THE SHOT, not the editor view.
    s.setLookThrough(true)
    s.setTime(0)
    s.setPlaying(true)
    s.toast(
      `Recorded ${length.toFixed(1)}s — playing back your shot. Press C to exit the camera view.`,
      'success'
    )
  }

  /** Convert a puppeteered entity performance into actor marks. */
  private finishEntityRecording(): void {
    const s = this.currentState()
    const entityId = this.recTarget
    const shotId = this.shot?.id
    const samples = this.entitySamples
    this.entitySamples = []
    if (!shotId || samples.length < 5) {
      if (samples.length > 0) s.toast('Recording too short — nothing saved.', 'info')
      return
    }
    const length = this.recPlaybackSynced
      ? (this.shot?.duration ?? 5)
      : Math.min(60, Math.max(0.5, samples[samples.length - 1]!.t))

    const step = 0.25
    const marks: import('@engine/types').ActorMark[] = []
    let cursor = 0
    let prev: { x: number; z: number } | null = null
    for (let t = 0; t <= length + 1e-6; t += step) {
      while (cursor < samples.length - 1 && samples[cursor]!.t < t) cursor++
      const sm = samples[cursor]!
      // Gait for the leg ENDING at this mark, from its implied speed.
      let gait: import('@engine/types').GaitId = 'walk'
      if (prev) {
        const speed = Math.hypot(sm.x - prev.x, sm.z - prev.z) / step
        gait = speed > 3.4 ? 'run' : speed > 2.0 ? 'jog' : 'walk'
      }
      marks.push({
        id: newId('mark'),
        time: Math.min(t, length),
        hold: 0,
        easeIn: 0,
        easeOut: 0,
        position: { x: sm.x, y: sm.y, z: sm.z }, // altitude preserved — flights replay
        gait
      })
      prev = { x: sm.x, z: sm.z }
    }

    s.mutate('record performance', (doc) => {
      for (const scene of doc.scenes) {
        const shot =
          scene.shots.find((x) => x.id === shotId) ?? scene.drafts?.find((x) => x.id === shotId)
        if (!shot) continue
        const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
        if (!take) continue
        let track = take.tracks.find((tr) => tr.entityId === entityId)
        if (!track) {
          track = { entityId, marks: [] }
          take.tracks.push(track)
        }
        track.marks = marks
        if (!this.recPlaybackSynced) shot.duration = Math.round(length * 10) / 10
      }
    })
    s.setSelection({ kind: 'entity', entityId })
    // Replay the performance immediately so the take can be judged.
    s.setTime(0)
    s.setPlaying(true)
    s.toast(
      `Performance recorded — ${marks.length} marks over ${length.toFixed(1)}s. Now select the camera and ● Record to fly it while this replays.`,
      'success'
    )
  }

  /* ------------------------------- playback ----------------------------- */

  private applyTime(t: number): void {
    if (!this.evaluator || !this.shot) return
    const state = this.evaluator.evaluate(t)
    const live = this.currentState()
    const puppeteering = live.recording && this.recTarget !== 'camera' ? this.recTarget : null

    for (const es of state.entities) {
      const visual = this.visuals.get(es.entityId)
      if (!visual) continue
      // An active gizmo drag owns this object's transform — re-applying the
      // evaluator pose every frame would freeze the drag in place. Same for
      // every member of a live group drag and a puppeteered recording target.
      if (this.transform.dragging && this.dragStart?.has(es.entityId)) continue
      if (this.transform.dragging && this.transform.object === visual.root) continue
      if (puppeteering === es.entityId) continue
      visual.root.position.set(es.position.x, es.position.y, es.position.z)
      // Static entities keep their authored Y (a lamp stays on its table);
      // tracked and MARRIED entities take the evaluator's Y (a rider keeps
      // its height offset on a moving vehicle).
      if (!this.entityHasTrack(es.entityId) && !visual.entity.attachedTo) {
        visual.root.position.y = visual.entity.transform.position.y
      }
      visual.root.rotation.y = es.heading
      // Stage-level pose (params.pose: a person sits on the bus without any
      // marks) and manual joint offsets (params.joint_*: fight/dance poses).
      const params = visual.entity.params
      let gait = es.gait
      if (!this.entityHasTrack(es.entityId) && typeof params?.pose === 'string') {
        gait = params.pose as typeof es.gait
      }
      let overrides: Record<string, number> | undefined
      if (params) {
        for (const key of Object.keys(params)) {
          const v = params[key]
          if (key.startsWith('joint_') && typeof v === 'number' && v !== 0) {
            (overrides ??= {})[key.slice(6)] = v
          }
        }
      }
      // Mark-keyframed joints (pose-per-mark choreography, interpolated by
      // the evaluator) layer additively on the entity's static pose offsets.
      if (es.joints) {
        for (const [key, v] of Object.entries(es.joints)) {
          if (v === 0) continue
          ;(overrides ??= {})[key] = (overrides?.[key] ?? 0) + v
        }
      }
      const stride = GAITS[gait].strideLength * Math.max(visual.entity.transform.scale, 0.2)
      const phase = stride > 0 ? (es.distanceTravelled / stride) % 1 : 0
      visual.built.animate?.({
        gait,
        phase,
        speed: es.speed,
        distance: es.distanceTravelled,
        time: t,
        overrides
      })
    }

    // Live group drag: the other members of a multi-selection follow the
    // anchor rigidly while the gizmo moves it.
    if (this.transform.dragging && this.dragStart && this.dragAnchorId) {
      const anchorVisual = this.visuals.get(this.dragAnchorId)
      const anchorStart = this.dragStart.get(this.dragAnchorId)
      if (anchorVisual && anchorStart) {
        const anchorNow = {
          pos: anchorVisual.root.position.clone(),
          rotY: anchorVisual.root.rotation.y
        }
        for (const [id, start] of this.dragStart) {
          if (id === this.dragAnchorId) continue
          const member = this.visuals.get(id)
          if (!member) continue
          const next = this.groupTransformed(start, anchorStart, anchorNow)
          member.root.position.copy(next.pos)
          member.root.rotation.y = next.rotY
        }
      }
    }

    // Marriage live-follow: attached entities ride their parent's CURRENT
    // visual (covers gizmo drags before commit; matches the evaluator at
    // rest). Three passes settle rider-on-cart-on-truck chains.
    for (let pass = 0; pass < 3; pass++) {
      for (const visual of this.visuals.values()) {
        const e = visual.entity
        if (!e.attachedTo || !e.attachedLocal) continue
        if (this.entityHasTrack(e.id)) continue
        if (this.transform.dragging && this.dragStart?.has(e.id)) continue // being adjusted
        if (puppeteering === e.id) continue
        const parent = this.visuals.get(e.attachedTo)
        if (!parent) continue
        const h = parent.root.rotation.y
        const cos = Math.cos(h)
        const sin = Math.sin(h)
        const l = e.attachedLocal
        visual.root.position.set(
          parent.root.position.x + l.x * cos + l.z * sin,
          parent.root.position.y + l.y,
          parent.root.position.z - l.x * sin + l.z * cos
        )
        visual.root.rotation.y = h + l.rotY
      }
    }

    // Shot camera
    const c = state.camera
    this.shotCam.position.set(c.position.x, c.position.y, c.position.z)
    this.shotCam.rotation.set(c.tilt, c.pan, c.roll, 'YXZ')
    this.shotCam.fov = c.vfov * RAD2DEG
    this.shotCam.aspect = ASPECT_RATIOS[this.shot.aspect]
    this.shotCam.updateProjectionMatrix()

    // Camera body visual follows the shot camera — unless the user is
    // dragging it (the drag commits to a camera mark on release).
    if (!(this.transform.dragging && this.transform.object === this.cameraBody)) {
      this.cameraBody.position.copy(this.shotCam.position)
      this.cameraBody.rotation.copy(this.shotCam.rotation)
    }
  }

  private entityHasTrack(entityId: string): boolean {
    const take = this.docScene?.blocking.find((b) => b.id === this.shot?.blockingTakeId)
    return !!take?.tracks.some((tr) => tr.entityId === entityId && tr.marks.length > 0)
  }

  private loop = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastFrameAt) / 1000)
    this.lastFrameAt = now
    // While exporting, the export loop owns scene state; rendering the live
    // view concurrently would perturb it mid-frame.
    if (this.suspendLive) return

    const s = this.currentState()
    if (s.playing && this.shot) {
      let t = s.time + dt
      if (t >= this.shot.duration) t = 0 // loop
      s.setTime(t)
    }
    this.applyTime(s.time)
    this.controls.update()
    if (this.viewHelper?.animating) this.viewHelper.update(dt)

    // Live recording. Playback-synced recordings sample against the shot
    // clock (the choreography replays underneath); free recordings run on
    // wall time and define the shot duration when stopped.
    if (s.recording) {
      const t = this.recPlaybackSynced ? s.time : (now - this.recStartedAt) / 1000
      // Playback wrapped past the end before the auto-stop fired — end now
      // rather than recording a second lap over the first.
      const lastT =
        this.recTarget === 'camera'
          ? this.recSamples[this.recSamples.length - 1]?.t
          : this.entitySamples[this.entitySamples.length - 1]?.t
      if (this.recPlaybackSynced && lastT !== undefined && t < lastT) {
        s.setRecording(false)
        return
      }
      if (this.recTarget === 'camera') {
        // The shot camera mirrors the free camera — what you see is the shot.
        this.shotCam.position.copy(this.freeCam.position)
        const e = new THREE.Euler().setFromQuaternion(this.freeCam.quaternion, 'YXZ')
        this.shotCam.rotation.set(e.x, e.y, e.z, 'YXZ')
        this.recSamples.push({
          t,
          pos: this.freeCam.position.clone(),
          pan: e.y,
          tilt: e.x,
          roll: e.z
        })
      } else {
        // Puppeteer: the selected entity chases the point under the cursor
        // on its FLIGHT PLANE (scroll wheel raises/lowers it — a plate can
        // arc through the air, a plane can climb), facing travel direction.
        // The chase is SMOOTHED and speed-capped per the Control setting so
        // a twitchy mouse doesn't become a twitchy performance.
        this.raycaster.setFromCamera(this.lastPointerNdc, this.freeCam)
        const flightPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.recHeight)
        const point = new THREE.Vector3()
        const hit = this.raycaster.ray.intersectPlane(flightPlane, point)
        const visual = this.visuals.get(this.recTarget)
        if (hit && visual) {
          const tune = RECORD_TUNING[s.recordControl]
          const dt = Math.min(0.1, Math.max(1 / 240, (now - this.recPrevFrame) / 1000))
          this.recPrevFrame = now
          point.y = this.recHeight
          // Exponential approach toward the cursor…
          const k = 1 - Math.exp(-tune.rate * dt)
          const step = point.clone().sub(this.recCursor).multiplyScalar(k)
          // …clamped to a max speed so precision mode can't overshoot.
          const maxStep = tune.maxSpeed * dt
          if (step.length() > maxStep) step.setLength(maxStep)
          this.recCursor.add(step)
          const dx = this.recCursor.x - visual.root.position.x
          const dz = this.recCursor.z - visual.root.position.z
          if (dx * dx + dz * dz > 1e-6) {
            visual.root.rotation.y = headingOf({ x: dx, y: 0, z: dz })
          }
          visual.root.position.copy(this.recCursor)
          this.entitySamples.push({ t, x: this.recCursor.x, y: this.recCursor.y, z: this.recCursor.z })
        }
      }
      // Auto-stop: at the end of the shot when synced, at 60s otherwise.
      const cap = this.recPlaybackSynced ? (this.shot?.duration ?? 60) - 1 / 60 : 60
      if (t >= cap) s.setRecording(false)
    }

    // Resize
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.floor(rect.width))
    const h = Math.max(1, Math.floor(rect.height))
    const size = this.renderer.getSize(new THREE.Vector2())
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false)
      this.freeCam.aspect = w / h
      this.freeCam.updateProjectionMatrix()
    }

    this.overlay.visible = s.mode !== 'deliver'
    // While recording, the free camera IS the shot camera — a body visual
    // at your own eye position would fill the frame.
    this.cameraBody.visible = !s.lookThrough && s.mode !== 'deliver' && !s.recording

    if (s.lookThrough || s.mode === 'deliver') {
      // Letterboxed shot-camera view.
      const aspect = this.shot ? ASPECT_RATIOS[this.shot.aspect] : 16 / 9
      let vw = w
      let vh = Math.round(w / aspect)
      if (vh > h) {
        vh = h
        vw = Math.round(h * aspect)
      }
      const vx = Math.floor((w - vw) / 2)
      const vy = Math.floor((h - vh) / 2)
      this.renderer.setScissorTest(true)
      this.renderer.setClearColor(0x000000)
      this.renderer.setScissor(0, 0, w, h)
      this.renderer.setViewport(0, 0, w, h)
      this.renderer.clear()
      this.renderer.setScissor(vx, vy, vw, vh)
      this.renderer.setViewport(vx, vy, vw, vh)
      this.renderer.render(this.scene, this.shotCam)
      this.renderer.setScissorTest(false)
      this.onViewRect?.({ x: vx, y: h - vy - vh, w: vw, h: vh })
    } else {
      this.renderer.setViewport(0, 0, w, h)
      this.renderer.render(this.scene, this.freeCam)
      this.onViewRect?.(null)

      // Picture-in-picture live shot preview (bottom-right): always shows
      // what the SHOT camera sees — chrome-free, like the export will be.
      // (mode is never 'deliver' in this branch — that renders look-through)
      if (s.pipSize !== 'off' && this.shot && !s.recording) {
        const frac = s.pipSize === 'small' ? 0.18 : s.pipSize === 'large' ? 0.42 : 0.28
        const aspect = ASPECT_RATIOS[this.shot.aspect]
        const pw = Math.max(120, Math.round(w * frac))
        const ph = Math.round(pw / aspect)
        const margin = 14
        const px = w - pw - margin
        const py = margin // GL viewport origin is bottom-left

        const overlayWas = this.overlay.visible
        const bodyWas = this.cameraBody.visible
        const selWas = this.selectionBox.visible
        const gizmo = this.transform.getHelper
          ? this.transform.getHelper()
          : (this.transform as unknown as THREE.Object3D)
        const gizmoWas = gizmo.visible
        this.overlay.visible = false
        this.cameraBody.visible = false
        this.selectionBox.visible = false
        gizmo.visible = false

        // The PiP mirrors the shot as it will export — selection tint is
        // editor chrome and must not color it.
        for (const t of this.tintedMaterials) {
          t.mat.emissive.setHex(t.emissive)
          t.mat.emissiveIntensity = t.intensity
        }

        this.shotCam.aspect = aspect
        this.shotCam.updateProjectionMatrix()
        this.renderer.setScissorTest(true)
        this.renderer.setScissor(px, py, pw, ph)
        this.renderer.setViewport(px, py, pw, ph)
        this.renderer.render(this.scene, this.shotCam)
        this.renderer.setScissorTest(false)

        for (const t of this.tintedMaterials) {
          t.mat.emissive.setHex(0x2b6cff)
          t.mat.emissiveIntensity = 0.12
        }
        this.overlay.visible = overlayWas
        this.cameraBody.visible = bodyWas
        this.selectionBox.visible = selWas
        gizmo.visible = gizmoWas
        this.onPipRect?.({ x: px, y: h - py - ph, w: pw, h: ph })
      } else {
        this.onPipRect?.(null)
      }

      // Orientation gizmo, bottom-right. Editor-only: its own corner viewport,
      // rendered after the scene, never part of any export. (This branch is the
      // free-cam view — mode is already stage/shoot here.)
      // Skip it while the PiP is open: three's ViewHelper hardcodes the same
      // bottom-right corner the PiP overlay occupies.
      const pipOpen = s.pipSize !== 'off' && this.shot !== null
      if (!s.recording && !pipOpen) {
        this.renderer.setViewport(0, 0, w, h)
        // autoClear must be off here: the helper's internal render() would
        // otherwise clear the whole canvas (clears ignore viewports), wiping
        // the scene that was just drawn. It clearDepth()s on its own.
        const autoClearWas = this.renderer.autoClear
        this.renderer.autoClear = false
        this.viewHelper?.render(this.renderer)
        this.renderer.autoClear = autoClearWas
      }
    }

    // Keep selection box tracking its object. Hide it entirely in
    // look-through/deliver (a camera-selection helper drawn from inside the
    // camera reads as a stray line across the frame).
    if (s.lookThrough || s.mode === 'deliver') {
      this.selectionBox.visible = false
    } else if (s.selection) {
      const obj = this.selectedObject()
      if (obj) {
        this.selectionBox.setFromObject(obj)
        this.selectionBox.visible = true
      }
    }
  }

  /* -------------------------- export render hook ------------------------ */

  /** Camera-to-scene distance range at the CURRENT applied time. */
  private measureDepthRange(): { near: number; far: number } {
    const camPos = this.shotCam.position
    let minD = Infinity
    let maxD = 0
    const box = new THREE.Box3()
    for (const v of this.visuals.values()) {
      box.setFromObject(v.root)
      if (box.isEmpty()) continue
      minD = Math.min(minD, Math.max(0.1, box.distanceToPoint(camPos)))
      const center = box.getCenter(new THREE.Vector3())
      const radius = box.getSize(new THREE.Vector3()).length() / 2
      maxD = Math.max(maxD, camPos.distanceTo(center) + radius)
    }
    if (!isFinite(minD)) return { near: 0.5, far: 30 }
    return { near: minD, far: maxD }
  }

  /**
   * Shot-wide depth range: union of per-frame ranges sampled across the
   * duration, so the exported depth gradient never re-normalizes mid-shot.
   */
  computeShotDepthRange(duration: number, samples = 24): { near: number; far: number } {
    let near = Infinity
    let far = 0
    for (let i = 0; i <= samples; i++) {
      this.applyTime((i / samples) * duration)
      const r = this.measureDepthRange()
      near = Math.min(near, r.near)
      far = Math.max(far, r.far)
    }
    if (!isFinite(near)) return { near: 0.5, far: 30 }
    return { near, far }
  }

  /**
   * Deterministically render one frame at time t into an export renderer.
   * Used by the exporter (offscreen canvas) and stills/diagram generation.
   */
  renderFrameAt(
    exportRenderer: THREE.WebGLRenderer,
    t: number,
    width: number,
    height: number,
    pass: RenderPass,
    opts: { showLabels: boolean; camera?: THREE.Camera; depthRange?: { near: number; far: number } } = {
      showLabels: true
    }
  ): void {
    this.applyTime(t)
    const overlayWas = this.overlay.visible
    this.overlay.visible = false
    // Scans are editor staging only — never in exports (determinism contract).
    const scansWas = this.scansGroup.visible
    this.scansGroup.visible = false
    // Entities the filmmaker excluded from exports stay editor-only.
    const excludedStates: [THREE.Object3D, boolean][] = []
    for (const v of this.visuals.values()) {
      if (v.entity.excludeFromExport) {
        excludedStates.push([v.root, v.root.visible])
        v.root.visible = false
      }
    }
    // Editor chrome must never reach an export: selection box + gizmo.
    const selectionWas = this.selectionBox.visible
    this.selectionBox.visible = false
    const gizmo = this.transform.getHelper ? this.transform.getHelper() : (this.transform as unknown as THREE.Object3D)
    const gizmoWas = gizmo.visible
    gizmo.visible = false
    const labelStates: [THREE.Sprite, boolean][] = []
    for (const v of this.visuals.values()) {
      if (v.label) {
        labelStates.push([v.label, v.label.visible])
        v.label.visible = opts.showLabels && pass === 'clean'
      }
    }
    // Selection emissive tint must never reach exported pixels — neutralize it
    // for the duration of the render, then restore the editor glow.
    const tintWas = this.tintedMaterials.map((t) => ({ hex: t.mat.emissive.getHex(), intensity: t.mat.emissiveIntensity }))
    for (const t of this.tintedMaterials) {
      t.mat.emissive.setHex(t.emissive)
      t.mat.emissiveIntensity = t.intensity
    }
    // The physical sky belongs in the clean plate only — as a giant textured
    // box it would swamp the depth/normal passes (background, not geometry).
    const skyWas = this.sky.visible
    if (pass !== 'clean') this.sky.visible = false
    const bgWas = this.scene.background
    const fogWas = this.scene.fog
    if (pass === 'depth') {
      // Use the shot-wide range when provided (exporter precomputes it so
      // the gradient is temporally stable); fall back to this frame's range.
      const range = opts.depthRange ?? this.measureDepthRange()
      this.depthMaterial.uniforms.uNear!.value = range.near
      this.depthMaterial.uniforms.uFar!.value = Math.max(range.far, range.near + 1)
      this.scene.overrideMaterial = this.depthMaterial
      this.scene.background = new THREE.Color(0x000000)
      this.scene.fog = null
    } else if (pass === 'normal') {
      this.scene.overrideMaterial = this.normalMaterial
      this.scene.background = new THREE.Color(0x000000)
      this.scene.fog = null
    }

    const cam = (opts.camera as THREE.PerspectiveCamera) ?? this.shotCam
    if (cam === this.shotCam) {
      this.shotCam.aspect = width / height
      this.shotCam.updateProjectionMatrix()
    }
    exportRenderer.setSize(width, height, false)
    exportRenderer.setViewport(0, 0, width, height)
    // Render twice: the first render after another GL context has touched
    // shared three.js state can differ by one warm-up frame; the second is
    // always converged. Byte-determinism is worth one extra rasterization.
    exportRenderer.render(this.scene, cam)
    exportRenderer.render(this.scene, cam)

    this.scene.overrideMaterial = null
    this.scene.background = bgWas
    this.scene.fog = fogWas
    this.sky.visible = skyWas
    // Restore the editor selection tint.
    this.tintedMaterials.forEach((t, i) => {
      const w = tintWas[i]
      if (w) {
        t.mat.emissive.setHex(w.hex)
        t.mat.emissiveIntensity = w.intensity
      }
    })
    this.scansGroup.visible = scansWas
    this.overlay.visible = overlayWas
    this.selectionBox.visible = selectionWas
    gizmo.visible = gizmoWas
    for (const [sprite, was] of labelStates) sprite.visible = was
    for (const [root, was] of excludedStates) root.visible = was
  }

  /** Top-down blocking diagram camera + overlay paths forced visible. */
  renderTopDown(exportRenderer: THREE.WebGLRenderer, width: number, height: number): void {
    // Fit an ortho camera around everything interesting.
    const box = new THREE.Box3()
    for (const v of this.visuals.values()) box.expandByObject(v.root)
    for (const m of this.markObjects) box.expandByObject(m)
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 2, 5))
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const span = Math.max(size.x, size.z) * 0.65 + 2
    const cam = new THREE.OrthographicCamera(-span, span, span * (height / width), -span * (height / width), 0.1, 200)
    cam.position.set(center.x, 60, center.z)
    cam.up.set(0, 0, -1)
    cam.lookAt(center.x, 0, center.z)

    this.applyTime(0)
    const overlayWas = this.overlay.visible
    const camBodyWas = this.cameraBody.visible
    const scansWas = this.scansGroup.visible
    const marksWas = this.marksGroup.visible
    const pathsWas = this.pathsGroup.visible
    this.overlay.visible = true
    this.cameraBody.visible = true
    this.scansGroup.visible = false
    // The blocking diagram is ABOUT the marks and paths — force them on even if
    // the editor HUD toggles have hidden them.
    this.marksGroup.visible = true
    this.pathsGroup.visible = true
    exportRenderer.setSize(width, height, false)
    exportRenderer.render(this.scene, cam)
    this.overlay.visible = overlayWas
    this.cameraBody.visible = camBodyWas
    this.scansGroup.visible = scansWas
    this.marksGroup.visible = marksWas
    this.pathsGroup.visible = pathsWas
  }
}
