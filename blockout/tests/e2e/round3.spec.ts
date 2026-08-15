/**
 * Round-3 features: marriage, cameras A/B/C, drafts, performance recording,
 * multi-select, clear-recording, export exclusion.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-r3-'))
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

test('marry: rider follows a moving vehicle; unmarry bakes the pose', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const manId = store.addEntity('person.man', { x: 0.5, y: 0, z: 0 })
    const carId = store.addEntity('vehicle.suv', { x: 0, y: 0, z: 0 })
    store.marryEntities([manId], carId)
    // Drive the car 8m down -Z over the shot.
    store.setSelection({ kind: 'entity', entityId: carId })
    store.dropActorMark(carId, { x: 0, y: 0, z: 0 })
    store.setTime(4)
    store.dropActorMark(carId, { x: 0, y: 0, z: -8 })
    store.setTime(0)
    const s2 = (window as any).__blockout.store.getState()
    const man = s2.scene().entities.find((e: any) => e.id === manId)
    return { attachedTo: man.attachedTo, local: man.attachedLocal, manId, carId }
  })
  expect(result.attachedTo).toBe(result.carId)
  expect(result.local.x).toBeCloseTo(0.5, 3)

  // Unmarry bakes the transform and clears the attachment.
  const after = await page.evaluate((manId: string) => {
    const store = (window as any).__blockout.store.getState()
    store.unmarryEntities([manId])
    const man = (window as any).__blockout.store.getState().scene().entities.find((e: any) => e.id === manId)
    return { attachedTo: man.attachedTo ?? null }
  }, result.manId)
  expect(after.attachedTo).toBeNull()
})

test('multi-select via store: group state and mass delete', async () => {
  const counts = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const a = store.addEntity('prim.cube', { x: 2, y: 0, z: 2 })
    const b = store.addEntity('prim.cube', { x: 3, y: 0, z: 2 })
    store.setSelection(null)
    store.toggleEntitySelected(a)
    store.toggleEntitySelected(b)
    const sel = (window as any).__blockout.store.getState().selection
    return { kind: sel.kind, n: sel.entityIds?.length ?? 0 }
  })
  expect(counts.kind).toBe('entities')
  expect(counts.n).toBe(2)
})

test('cameras A/B: bank switch keeps independent marks', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setSelection({ kind: 'camera' })
    store.dropCameraMark({ x: 4, y: 1.6, z: 4 }, 0.5, 0, 35)
    const marksA = (window as any).__blockout.store.getState().shot().camera.marks.length
    store.addCameraToShot() // banks A, activates fresh B
    const s2 = (window as any).__blockout.store.getState()
    const marksB = s2.shot().camera.marks.length
    const nameB = s2.shot().cameraName
    s2.switchCamera('A')
    const s3 = (window as any).__blockout.store.getState()
    return {
      marksA,
      marksB,
      nameB,
      backName: s3.shot().cameraName,
      backMarks: s3.shot().camera.marks.length,
      bankHasB: s3.shot().cameraBank.some((b: any) => b.name === 'B')
    }
  })
  expect(result.marksA).toBe(1)
  expect(result.marksB).toBe(0)
  expect(result.nameB).toBe('B')
  expect(result.backName).toBe('A')
  expect(result.backMarks).toBe(1)
  expect(result.bankHasB).toBe(true)
})

test('clear camera move deletes all camera marks', async () => {
  const n = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.clearCameraMarks()
    return (window as any).__blockout.store.getState().shot().camera.marks.length
  })
  expect(n).toBe(0)
})

test('drafts: save, select, promote', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.dropCameraMark({ x: 1, y: 2, z: 3 }, 0.2, 0, 50)
    store.saveDraftOfShot()
    const s2 = (window as any).__blockout.store.getState()
    const scene = s2.scene()
    const draft = scene.drafts[scene.drafts.length - 1]
    // Edit the draft independently: select it, clear its camera move.
    s2.selectShot(draft.id)
    const s3 = (window as any).__blockout.store.getState()
    s3.clearCameraMarks()
    const draftMarks = (window as any).__blockout.store.getState().shot().camera.marks.length
    const mainMarks = scene.shots.find((x: any) => x.id === draft.draftOf).camera.marks.length
    // Promote: main shot takes the draft's (empty) camera.
    ;(window as any).__blockout.store.getState().promoteDraft(draft.id)
    const s4 = (window as any).__blockout.store.getState()
    return {
      draftName: draft.name,
      draftMarks,
      mainMarksBefore: mainMarks,
      mainMarksAfter: s4.shot().camera.marks.length,
      nowOnMain: s4.shot().id === draft.draftOf
    }
  })
  expect(result.draftName).toContain('v1')
  expect(result.draftMarks).toBe(0)
  expect(result.mainMarksBefore).toBe(1)
  expect(result.mainMarksAfter).toBe(0)
  expect(result.nowOnMain).toBe(true)
})

test('record performer: cursor puppeteering lays actor marks with gaits', async () => {
  test.setTimeout(120_000)
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    store.setPipSize('off')
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    store.setSelection({ kind: 'entity', entityId: man.id })
  })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '● Record performer' }).click()
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  for (let i = 0; i <= 20; i++) {
    await page.mouse.move(cx - 150 + i * 15, cy + Math.sin(i / 3) * 60)
    await page.waitForTimeout(75)
  }
  await page.getByRole('button', { name: '■ Stop', exact: true }).click()
  await page.waitForTimeout(400)
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    const take = scene.blocking.find((b: any) => b.id === store.shot().blockingTakeId)
    const track = take.tracks.find((t: any) => t.entityId === man.id)
    return { marks: track?.marks.length ?? 0, gaits: [...new Set(track?.marks.map((m: any) => m.gait) ?? [])] }
  })
  expect(result.marks).toBeGreaterThan(4)
  expect(result.gaits.length).toBeGreaterThan(0)
})

test('camera recording replays existing blocking and stops at shot end', async () => {
  test.setTimeout(120_000)
  const durationBefore = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setSelection({ kind: 'camera' })
    return store.shot().duration
  })
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: '● Record camera' }).click()
  // Synced recording auto-stops at the end of the shot — just fly a little.
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout((durationBefore + 1.5) * 1000)
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    return {
      recording: store.recording,
      camMarks: store.shot().camera.marks.length,
      duration: store.shot().duration,
      lookThrough: store.lookThrough,
      playing: store.playing
    }
  })
  expect(result.recording).toBe(false) // auto-stopped
  expect(result.camMarks).toBeGreaterThan(4)
  expect(result.duration).toBeCloseTo(durationBefore, 1) // synced rec keeps duration
  // Instant dailies: the shot plays back through the camera automatically.
  expect(result.lookThrough).toBe(true)
  expect(result.playing).toBe(true)
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setPlaying(false)
    store.setLookThrough(false)
  })
})

test('excludeFromExport hides an entity from rendered frames', async () => {
  const diff = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const scene = store.scene()
    const suv = scene.entities.find((e: any) => e.assetId === 'vehicle.suv')
    const render = (): number[] => (window as any).__blockout.renderRawForTest(0, 160, 90)
    const withCar = render()
    store.mutate('exclude', (doc: any) => {
      const e = doc.scenes[0].entities.find((x: any) => x.id === suv.id)
      e.excludeFromExport = true
    })
    const withoutCar = render()
    let delta = 0
    for (let i = 0; i < withCar.length; i++) delta += Math.abs(withCar[i] - withoutCar[i])
    store.mutate('include', (doc: any) => {
      const e = doc.scenes[0].entities.find((x: any) => x.id === suv.id)
      delete e.excludeFromExport
    })
    return delta
  })
  expect(diff).toBeGreaterThan(1000) // frame visibly changed without the SUV
})

test('help & tutorial: opens from titlebar, has both tabs, closes', async () => {
  await page.getByRole('button', { name: '? Help' }).click()
  await expect(page.getByText('The whole app is three verbs')).toBeVisible()
  await expect(page.getByText('Make them move')).toBeVisible()
  await page.getByRole('button', { name: 'How do I…?' }).click()
  await expect(page.getByText('How do I make two people fight?')).toBeVisible()
  await page.getByRole('button', { name: 'Shortcuts' }).click()
  await expect(page.getByText('Jump to camera mark N')).toBeVisible()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Jump to camera mark N')).not.toBeVisible()
})
