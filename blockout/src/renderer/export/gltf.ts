/**
 * Blender handoff: bake the current shot — entities, blocking motion, and
 * the animated camera (rig shake included) — into a .glb that Blender
 * imports natively, plus a helper script that sets scene fps/resolution
 * and the active camera.
 */

import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { ShotEvaluator } from '@engine/evaluate'
import { ASPECT_RATIOS } from '@engine/camera'
import { useStore } from '../store'
import { buildAsset } from '../viewport/builders'
import { exportDims } from './exporter'
import { getProfile } from '@engine/profiles'

import { sanitizeName as sanitize, uniqueName } from '@engine/strings'

export async function exportGlb(profileId: string): Promise<{ ok: boolean; packagePath?: string; error?: string }> {
  const s = useStore.getState()
  const scene = s.scene()
  const shot = s.shot()
  const folder = s.projectFolder
  if (!scene || !shot || !folder) return { ok: false, error: 'No open shot.' }

  const evaluator = new ShotEvaluator(scene, shot)
  const root = new THREE.Scene()
  root.name = `Blockout_${sanitize(shot.name)}`

  // Rebuild entities fresh (clean graph, no selection/overlay state).
  // Node names must be unique — animation tracks target nodes BY NAME, so
  // two entities both labeled "Thug" would drive the wrong body otherwise.
  const usedNames = new Set<string>()
  const nodes = new Map<string, THREE.Group>()
  for (const entity of scene.entities) {
    const built = buildAsset(entity.assetId, entity.params)
    const g = new THREE.Group()
    g.name = uniqueName(sanitize(entity.label?.text || entity.name || entity.id), usedNames)
    g.add(built.group)
    g.position.set(entity.transform.position.x, entity.transform.position.y, entity.transform.position.z)
    g.rotation.y = entity.transform.rotationY
    g.scale.setScalar(entity.transform.scale)
    built.setTint(entity.label?.color ?? null)
    root.add(g)
    nodes.set(entity.id, g)
  }

  // Camera
  const state0 = evaluator.evaluate(0)
  const aspect = ASPECT_RATIOS[shot.aspect]
  const cam = new THREE.PerspectiveCamera((state0.camera.vfov * 180) / Math.PI, aspect, 0.05, 500)
  cam.name = `ShotCam_${sanitize(shot.name)}`
  cam.rotation.order = 'YXZ'
  root.add(cam)

  // Bake tracks at shot fps.
  const frames = Math.max(2, Math.round(shot.duration * shot.fps) + 1)
  const times = new Float32Array(frames)
  const camPos = new Float32Array(frames * 3)
  const camQuat = new Float32Array(frames * 4)
  const entityData = new Map<string, { pos: Float32Array; quat: Float32Array }>()
  const take = scene.blocking.find((b) => b.id === shot.blockingTakeId)
  const trackedIds = new Set((take?.tracks ?? []).filter((t) => t.marks.length > 0).map((t) => t.entityId))
  for (const id of trackedIds) {
    entityData.set(id, { pos: new Float32Array(frames * 3), quat: new Float32Array(frames * 4) })
  }

  const q = new THREE.Quaternion()
  const e = new THREE.Euler(0, 0, 0, 'YXZ')
  for (let f = 0; f < frames; f++) {
    const t = Math.min(shot.duration, f / shot.fps)
    times[f] = t
    const st = evaluator.evaluate(t)
    camPos[f * 3] = st.camera.position.x
    camPos[f * 3 + 1] = st.camera.position.y
    camPos[f * 3 + 2] = st.camera.position.z
    e.set(st.camera.tilt, st.camera.pan, st.camera.roll)
    q.setFromEuler(e)
    camQuat[f * 4] = q.x
    camQuat[f * 4 + 1] = q.y
    camQuat[f * 4 + 2] = q.z
    camQuat[f * 4 + 3] = q.w
    for (const es of st.entities) {
      const data = entityData.get(es.entityId)
      if (!data) continue
      data.pos[f * 3] = es.position.x
      data.pos[f * 3 + 1] = es.position.y
      data.pos[f * 3 + 2] = es.position.z
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), es.heading)
      data.quat[f * 4] = q.x
      data.quat[f * 4 + 1] = q.y
      data.quat[f * 4 + 2] = q.z
      data.quat[f * 4 + 3] = q.w
    }
  }

  const tracks: THREE.KeyframeTrack[] = [
    new THREE.VectorKeyframeTrack(`${cam.name}.position`, Array.from(times), Array.from(camPos)),
    new THREE.QuaternionKeyframeTrack(`${cam.name}.quaternion`, Array.from(times), Array.from(camQuat))
  ]
  for (const [id, data] of entityData) {
    const node = nodes.get(id)
    if (!node) continue
    tracks.push(
      new THREE.VectorKeyframeTrack(`${node.name}.position`, Array.from(times), Array.from(data.pos)),
      new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, Array.from(times), Array.from(data.quat))
    )
  }
  const clip = new THREE.AnimationClip(`Shot_${sanitize(shot.name)}`, shot.duration, tracks)

  const exporter = new GLTFExporter()
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      root,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true, animations: [clip] }
    )
  })

  const dims = exportDims(getProfile(profileId), shot.aspect)
  const base = `${folder}/exports/${sanitize(scene.name)}/Shot-${sanitize(shot.name)}`
  const glbPath = `${base}/${sanitize(shot.name)}.glb`
  await window.blockout.exportWriteFile(glbPath, glb)
  await window.blockout.exportWriteFile(
    `${base}/blender_import.py`,
    [
      '# Blockout → Blender helper. Run in Blender: Scripting tab → open this file → Run.',
      '# Imports the .glb next to this script, sets fps/resolution, activates the shot camera.',
      'import bpy, os',
      '',
      `GLB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "${sanitize(shot.name)}.glb")`,
      'bpy.ops.import_scene.gltf(filepath=GLB)',
      `bpy.context.scene.render.fps = ${shot.fps}`,
      `bpy.context.scene.render.resolution_x = ${dims.width}`,
      `bpy.context.scene.render.resolution_y = ${dims.height}`,
      'bpy.context.scene.frame_start = 0',
      `bpy.context.scene.frame_end = ${Math.round(shot.duration * shot.fps)}`,
      'for obj in bpy.context.scene.objects:',
      `    if obj.type == "CAMERA" and obj.name.startswith("ShotCam"):`,
      '        bpy.context.scene.camera = obj',
      '        break',
      'print("Blockout shot imported.")',
      ''
    ].join('\n')
  )
  return { ok: true, packagePath: glbPath }
}
