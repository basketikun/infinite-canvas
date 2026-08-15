/**
 * 3D-scan (Gaussian splat) import e2e: launch the real built app, import a
 * synthetic .splat file through the store (the same path the Library button
 * calls), and assert the scan attaches to the scene, persists through
 * save/parse, and that the app stays fully responsive whether or not the
 * splat renderer finishes loading in the test environment.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string
let splatPath: string

/** Antimatter15 .splat format: 32 bytes per splat —
 *  position f32×3, scale f32×3, color u8 RGBA, rotation quat u8×4 (128-centered). */
function makeSyntheticSplat(path: string, count = 64): void {
  const buf = Buffer.alloc(count * 32)
  for (let i = 0; i < count; i++) {
    const o = i * 32
    // A small colorful ring of splats around the origin, at ground height.
    const angle = (i / count) * Math.PI * 2
    buf.writeFloatLE(Math.cos(angle) * 2, o + 0)
    buf.writeFloatLE(0.5 + 0.2 * Math.sin(angle * 3), o + 4)
    buf.writeFloatLE(Math.sin(angle) * 2, o + 8)
    buf.writeFloatLE(0.08, o + 12)
    buf.writeFloatLE(0.08, o + 16)
    buf.writeFloatLE(0.08, o + 20)
    buf[o + 24] = Math.round(128 + 127 * Math.cos(angle))
    buf[o + 25] = 180
    buf[o + 26] = Math.round(128 + 127 * Math.sin(angle))
    buf[o + 27] = 255 // opaque
    buf[o + 28] = 255 // quat w=1 → 255? antimatter15 stores (c*128+128); w=1 → 255 clamped
    buf[o + 29] = 128
    buf[o + 30] = 128
    buf[o + 31] = 128
  }
  writeFileSync(path, buf)
}

test.beforeAll(async () => {
  smokeDir = mkdtempSync(join(tmpdir(), 'blockout-scans-'))
  splatPath = join(smokeDir, 'synthetic-location.splat')
  makeSyntheticSplat(splatPath)
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

test('importScan copies the file into the project and attaches a ScanRef', async () => {
  await page.evaluate(async (path) => {
    const w = window as unknown as { __blockout: { store: any } }
    await w.__blockout.store.getState().importScan(path)
  }, splatPath)

  const scan = await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const scene = w.__blockout.store.getState().scene()
    return scene.scans?.[0] ?? null
  })
  expect(scan).not.toBeNull()
  expect(scan.name).toBe('synthetic-location')
  expect(scan.file.startsWith('scans/')).toBe(true)
  expect(scan.visible).toBe(true)

  // The file was copied into the project's scans/ folder.
  const scansDir = join(smokeDir, 'Smoke.blockout', 'scans')
  expect(existsSync(scansDir)).toBe(true)
  expect(readdirSync(scansDir).some((f) => f.endsWith('.splat'))).toBe(true)
})

test('scan transforms + visibility edit and the app stays responsive', async () => {
  const state = await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const store = w.__blockout.store.getState()
    const id = store.scene().scans[0].id
    store.updateScanTransform(id, { position: { x: 2, y: 0, z: -3 }, rotationY: 0.5, scale: 1.5 })
    store.setScanVisible(id, false)
    store.setScanVisible(id, true)
    // The app must remain fully usable with a scan in the scene.
    store.addEntity('person.man', { x: 0, y: 0, z: 0 })
    const scene = store.scene()
    return { scan: scene.scans[0], entities: scene.entities.length }
  })
  expect(state.scan.position).toEqual({ x: 2, y: 0, z: -3 })
  expect(state.scan.rotationY).toBeCloseTo(0.5)
  expect(state.scan.scale).toBeCloseTo(1.5)
  expect(state.scan.visible).toBe(true)
  expect(state.entities).toBe(1)
})

test('scans persist through save and reload-parse', async () => {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(300)
  const projectFile = join(smokeDir, 'Smoke.blockout', 'project.json')
  expect(existsSync(projectFile)).toBe(true)
  const doc = JSON.parse(readFileSync(projectFile, 'utf-8'))
  const scans = doc.scenes[0].scans
  expect(scans).toHaveLength(1)
  expect(scans[0].file.startsWith('scans/')).toBe(true)
  expect(scans[0].position).toEqual({ x: 2, y: 0, z: -3 })
})

test('removeScan detaches the ref and the viewport survives', async () => {
  const remaining = await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const store = w.__blockout.store.getState()
    store.removeScan(store.scene().scans[0].id)
    return store.scene().scans.length
  })
  expect(remaining).toBe(0)
  // Still responsive: mode switch works after the splat teardown.
  await page.locator('.mode-switch button', { hasText: 'SHOOT' }).click()
  await expect(page.locator('.timeline')).toBeVisible()
})
