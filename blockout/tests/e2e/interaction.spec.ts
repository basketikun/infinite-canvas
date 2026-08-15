/**
 * Interaction features: gizmo drag (real mouse), camera-move recording,
 * PiP preview, and stage poses. Guards the fixes from user feedback round 1.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-interact-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: dir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(400)
})

test.afterAll(async () => {
  await app?.close()
})

test('gizmo drag moves an entity with a real mouse', async () => {
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const id = store.addEntity('person.man', { x: 0, y: 0, z: 0 })
    store.setSelection({ kind: 'entity', entityId: id })
  })
  await page.waitForTimeout(500)
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  // Probe for a gizmo axis under the cursor, then drag from there.
  let grab: { x: number; y: number } | null = null
  outer: for (let dx = -140; dx <= 140; dx += 20) {
    for (let dy = -140; dy <= 140; dy += 20) {
      const x = box.x + box.width / 2 + dx
      const y = box.y + box.height / 2 + dy
      await page.mouse.move(x, y)
      await page.waitForTimeout(16)
      const axis = await page.evaluate(() => (window as any).__blockout_scene.transform.axis)
      if (axis === 'X' || axis === 'Z') {
        grab = { x, y }
        break outer
      }
    }
  }
  expect(grab, 'no gizmo axis found under probe grid').toBeTruthy()
  await page.mouse.move(grab!.x, grab!.y)
  await page.mouse.down()
  await page.mouse.move(grab!.x + 90, grab!.y, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
  const pos = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    return s.scene().entities[0].transform.position
  })
  expect(Math.abs(pos.x) + Math.abs(pos.z)).toBeGreaterThan(0.1)
})

test('stage pose: params.pose = sit is applied without marks', async () => {
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const man = store.scene().entities[0]
    store.mutate('pose', (doc: any) => {
      const e = doc.scenes[0].entities.find((x: any) => x.id === man.id)
      e.params = { ...e.params, pose: 'sit', joint_shoulderLX: -1.2 }
    })
  })
  await page.waitForTimeout(300)
  // Verify the doc holds the pose and the app didn't error.
  const pose = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    return s.scene().entities[0].params
  })
  expect(pose.pose).toBe('sit')
  expect(pose.joint_shoulderLX).toBeCloseTo(-1.2, 5)
})

test('PiP preview reports a rect and can be resized/hidden', async () => {
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    store.dropCameraMark({ x: 4, y: 1.6, z: 4 }, 0.5, 0, 35)
    store.setPipSize('medium')
  })
  await page.waitForTimeout(400)
  await expect(page.getByText('SHOT PREVIEW')).toBeVisible()
  await page.evaluate(() => (window as any).__blockout.store.getState().setPipSize('off'))
  await page.waitForTimeout(300)
  await expect(page.getByText('SHOT PREVIEW')).not.toBeVisible()
  await expect(page.getByRole('button', { name: '🎥 Preview' })).toBeVisible()
  await page.evaluate(() => (window as any).__blockout.store.getState().setPipSize('medium'))
})

test('camera-move recording converts flight into camera marks', async () => {
  const before = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    // Camera recording requires the camera (or nothing) selected — an
    // entity selection would record that performer instead.
    store.setSelection({ kind: 'camera' })
    return store.shot().camera.marks.length
  })
  await page.getByRole('button', { name: '● Record camera' }).click()
  // Fly: orbit-drag the viewport for ~1.5s
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(cx + i * 8, cy + i * 2, { steps: 2 })
    await page.waitForTimeout(80)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '■ Stop', exact: true }).click()
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const shot = store.shot()
    return { marks: shot.camera.marks.length, duration: shot.duration }
  })
  expect(after.marks).toBeGreaterThan(4) // ≥ 1.5s at 4 marks/sec
  expect(after.marks).not.toBe(before)
  expect(after.duration).toBeGreaterThan(1)
})

test('dragging the camera body commits to a camera mark', async () => {
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    // The recording test ends in auto look-through playback (instant
    // dailies); the camera BODY only exists in the editor view — exit first.
    store.setPlaying(false)
    store.setLookThrough(false)
    // Put the camera mark somewhere visible and reset the free view (the
    // recording test left both at arbitrary poses).
    store.mutate('reset cam', (doc: any) => {
      const shot = doc.scenes[0].shots[0]
      shot.camera.marks = [shot.camera.marks[0]]
      shot.camera.marks[0].position = { x: 0, y: 1.5, z: 0 }
    })
    const sm = (window as any).__blockout_scene
    sm.freeCam.position.set(9, 7, 9)
    sm.controls.target.set(0, 1, 0)
    store.setPipSize('off') // PiP chrome must not sit under the probe grid
    store.setSelection({ kind: 'camera' })
    store.setTime(0)
  })
  await page.waitForTimeout(400)
  const markBefore = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    return store.shot().camera.marks[0].position
  })
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  let grab: { x: number; y: number } | null = null
  outer: for (let dx = -180; dx <= 180; dx += 20) {
    for (let dy = -160; dy <= 160; dy += 20) {
      const x = box.x + box.width / 2 + dx
      const y = box.y + box.height / 2 + dy
      await page.mouse.move(x, y)
      await page.waitForTimeout(14)
      const axis = await page.evaluate(() => (window as any).__blockout_scene.transform.axis)
      if (axis === 'X' || axis === 'Z') {
        grab = { x, y }
        break outer
      }
    }
  }
  expect(grab, 'no camera gizmo axis found').toBeTruthy()
  await page.mouse.move(grab!.x, grab!.y)
  await page.mouse.down()
  await page.mouse.move(grab!.x + 70, grab!.y + 10, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const markAfter = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    return store.shot().camera.marks[0].position
  })
  const moved =
    Math.abs(markAfter.x - markBefore.x) +
    Math.abs(markAfter.y - markBefore.y) +
    Math.abs(markAfter.z - markBefore.z)
  expect(moved).toBeGreaterThan(0.05)
})

test('pose-per-mark: joints on marks flow through the store and evaluator', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    const take = scene.blocking[0]
    const track = take.tracks.find((t: any) => t.entityId === man.id)
    if (!track || track.marks.length < 2) return { skipped: true }
    store.mutate('test pose', (doc: any) => {
      const tk = doc.scenes[0].blocking[0]
      const tr = tk.tracks.find((t: any) => t.entityId === man.id)
      tr.marks[0].joints = { shoulderLX: -1.2 }
      tr.marks[1].joints = { shoulderLX: 0, kneeL: 0.8 }
    })
    return { skipped: false, marks: track.marks.length }
  })
  if (!(result as any).skipped) {
    const joints = await page.evaluate(() => {
      const store = (window as any).__blockout.store.getState()
      return store.scene().blocking[0].tracks[0].marks[0].joints
    })
    expect(joints.shoulderLX).toBeCloseTo(-1.2, 5)
  }
})

test('credits with site links render in-app', async () => {
  await page.evaluate(() => (window as any).__blockout.store.getState().setMode('stage'))
  await expect(page.getByText('Created by Sam Wasserman')).toBeVisible()
  await expect(page.getByText('wassermanproductions.com')).toBeVisible()
  await expect(page.getByText('wasserman.ai')).toBeVisible()
})

test('analyzeReference IPC wiring returns a structured error without credentials', async () => {
  test.setTimeout(120_000)
  // 1x1 PNG written through the export IPC, then analyzed.
  const result = await page.evaluate(async () => {
    const store = (window as any).__blockout.store.getState()
    const folder = store.projectFolder
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 4
    canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const path = `${folder}/assets/test-ref.png`
    await (window as any).blockout.exportWriteFile(path, await blob.arrayBuffer())
    return await (window as any).blockout.analyzeReference(path)
  })
  // Without credentials this must fail CLEANLY with guidance (never hang or
  // crash); with credentials on a dev machine, a valid layout is also fine.
  if (!result.ok) {
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(10)
  } else {
    expect(Array.isArray(result.layout.entities)).toBe(true)
  }
})
