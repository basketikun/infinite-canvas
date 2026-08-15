/**
 * Populate-from-reference: pick an image or video, have Claude reconstruct
 * its staging (src/main/analyze.ts), and apply the returned layout to the
 * current scene — entities with poses and labels, lighting, and a camera
 * mark matching the reference framing. One undo step reverts everything.
 */

import { useStore } from '../store'
import { createEntity, createCameraMark } from '@engine/schema'
import { assetSpec } from '@engine/assets'
import type { GaitId } from '@engine/types'

const DEG2RAD = Math.PI / 180

export async function populateFromReference(): Promise<void> {
  const s = useStore.getState()
  if (!s.doc || !s.sceneId) return
  const file = await window.blockout.pickFile([
    { name: 'Reference image or video', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v'] }
  ])
  if (!file) return

  s.toast('Analyzing reference with Claude — this takes ~30–90 seconds…', 'info')
  const result = await window.blockout.analyzeReference(file)
  if (!result.ok) {
    s.toast(result.error, 'error')
    return
  }

  const { layout } = result
  const sceneId = s.sceneId
  const shotId = s.shotId

  s.mutate('populate from reference', (doc) => {
    const scene = doc.scenes.find((x) => x.id === sceneId)
    if (!scene) return

    for (const item of layout.entities) {
      const spec = assetSpec(item.assetId)
      const entity = createEntity(item.assetId, spec.name, { x: item.x, y: 0, z: item.z })
      entity.transform.rotationY = item.rotationDeg * DEG2RAD
      if (item.scale && item.scale > 0 && Math.abs(item.scale - 1) > 0.01) {
        entity.transform.scale = Math.min(5, Math.max(0.1, item.scale))
      }
      if (item.label) {
        entity.label = { text: item.label, color: item.labelColor || '#f5a524' }
        entity.name = item.label
      }
      if (item.pose && item.pose !== 'stand' && item.assetId.startsWith('person.')) {
        entity.params = { ...entity.params, pose: item.pose as GaitId }
      }
      scene.entities.push(entity)
    }

    scene.environment.lighting = layout.lighting

    // Camera suggestion: only when the current shot has no marks yet — never
    // overwrite a camera move the filmmaker already built.
    const shot = scene.shots.find((x) => x.id === shotId)
    if (shot && shot.camera.marks.length === 0) {
      const cam = layout.camera
      shot.camera.marks.push(
        createCameraMark(
          { x: cam.x, y: Math.max(0.2, cam.y), z: cam.z },
          0,
          cam.panDeg * DEG2RAD,
          cam.tiltDeg * DEG2RAD,
          Math.min(300, Math.max(8, cam.focalLength))
        )
      )
    }
  })

  const camNote =
    useStore.getState().shot()?.camera.marks.length === 1
      ? ' Camera Mark 1 set to match the reference framing — check the shot preview.'
      : ''
  s.toast(`Staged ${layout.entities.length} elements from the reference.${camNote} ${layout.notes}`, 'success')
}
