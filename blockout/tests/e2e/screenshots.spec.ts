/**
 * Visual QA harness (not part of CI): boots the app, stages a scene, and
 * captures screenshots of every mode for human/agent review.
 * Run: npx playwright test tests/e2e/screenshots.spec.ts
 * Output: test-results/screens/*.png
 */

import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
const OUT = 'test-results/screens'

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  const smokeDir = mkdtempSync(join(tmpdir(), 'blockout-screens-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('capture all modes', async () => {
  test.setTimeout(120_000)
  await page.screenshot({ path: `${OUT}/00-welcome.png` })
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/01-stage-empty.png` })

  // Stage a small scene
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.addEntity('env.cityStreet', { x: 0, y: 0, z: 0 })
    const man = store.addEntity('person.man', { x: -1, y: 0, z: 1 })
    store.addEntity('vehicle.suv', { x: 3.5, y: 0, z: -4 })
    store.addEntity('animal.dog', { x: -2.5, y: 0, z: -1 })
    store.mutate('label', (doc: any) => {
      const e = doc.scenes[0].entities.find((x: any) => x.id === man)
      e.label = { text: 'HERO', color: '#e5484d' }
    })
    store.setSelection({ kind: 'entity', entityId: man })
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/02-stage-populated.png` })

  // Shoot mode with marks
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    store.dropActorMark(man.id, { x: -1, y: 0, z: 1 })
    store.setTime(4)
    store.dropActorMark(man.id, { x: 2, y: 0, z: -6 })
    store.setTime(0)
    store.dropCameraMark({ x: 4, y: 1.6, z: 4 }, 0.5, -0.05, 35)
    store.setTime(4.5)
    store.dropCameraMark({ x: 1, y: 1.8, z: -2 }, 0.4, -0.02, 50)
    store.setTime(2)
    store.setMode('shoot')
    store.setSelection({ kind: 'camera' })
  })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/03-shoot.png` })

  // Look through camera
  await page.evaluate(() => {
    (window as any).__blockout.store.getState().setLookThrough(true)
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/04-shoot-lookthrough.png` })

  // Timeline with a mark selected
  await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setLookThrough(false)
    const shot = store.shot()
    store.setSelection({ kind: 'mark', entityId: 'camera', markId: shot.camera.marks[0].id })
  })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/05-shoot-mark-selected.png` })

  // Deliver mode
  await page.evaluate(() => {
    (window as any).__blockout.store.getState().setMode('deliver')
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/06-deliver.png` })
})

test('capture help overlay', async () => {
  await page.evaluate(() => (window as any).__blockout.store.getState().setHelpOpen(true))
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/07-help.png` })
  await page.evaluate(() => (window as any).__blockout.store.getState().setHelpOpen(false))
})
