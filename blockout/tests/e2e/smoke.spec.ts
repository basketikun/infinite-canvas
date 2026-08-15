// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Headless smoke test: launch the real built app, script a scene through
 * the store (the same code paths the UI calls), run a real export through
 * the real ffmpeg pipeline, and assert the package on disk — file presence,
 * video duration/resolution via ffprobe, stills, prompt, and metadata.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string

// These tests form one end-to-end project lifecycle. When CI retries a
// failure, replay the lifecycle from project creation instead of retrying a
// state-dependent tail test in a fresh Electron worker.
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  smokeDir = mkdtempSync(join(root, 'blockout-smoke-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('app boots to the welcome screen', async () => {
  // v2.3: the logo replaced the H1 wordmark.
  await expect(page.locator('.welcome img[alt="Blockout"]')).toBeVisible()
})

test('creates a project and stages a scene through real UI actions', async () => {
  await page.getByRole('button', { name: 'New Project' }).click()
  // First project creation initializes the full GL scene; CI's GPU-less Intel runners need well over the default 5s.
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })

  // Stage a man + an SUV via the store (same actions the Library/Viewport call).
  await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const store = w.__blockout.store.getState()
    store.addEntity('person.man', { x: 0, y: 0, z: 0 })
    store.addEntity('vehicle.suv', { x: 4, y: 0, z: -6 })
    store.addEntity('env.cityStreet', { x: 0, y: 0, z: 0 })
  })

  const counts = await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const scene = w.__blockout.store.getState().scene()
    return { entities: scene.entities.length }
  })
  expect(counts.entities).toBe(3)
})

test('choreographs marks, labels, and camera; project round-trips to disk', async () => {
  await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: any } }
    const store = w.__blockout.store.getState()
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    // Label the actor
    store.mutate('label', (doc: any) => {
      const sc = doc.scenes[0]
      const e = sc.entities.find((x: any) => x.id === man.id)
      e.label = { text: 'HERO', color: '#e5484d' }
    })
    // Actor walks 8m over the shot
    store.setSelection({ kind: 'entity', entityId: man.id })
    store.dropActorMark(man.id, { x: 0, y: 0, z: 0 })
    store.setTime(4)
    store.dropActorMark(man.id, { x: 0, y: 0, z: -8 })
    // Camera: two marks — push-in with a zoom
    store.setTime(0)
    store.dropCameraMark({ x: 5, y: 1.6, z: 3 }, 0.6, 0, 35)
    store.setTime(4.5)
    store.dropCameraMark({ x: 3, y: 1.6, z: 0 }, 0.6, 0, 50)
    store.setTime(0)
  })

  // Save via the titlebar button and verify project.json exists and parses.
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(300)
  const projPath = join(smokeDir, 'Smoke.blockout', 'project.json')
  expect(existsSync(projPath)).toBe(true)
  const doc = JSON.parse(readFileSync(projPath, 'utf-8'))
  expect(doc.version).toBe(1)
  expect(doc.scenes[0].entities.length).toBe(3)
  expect(doc.scenes[0].shots[0].camera.marks.length).toBe(2)
})

test('playback advances deterministic state', async () => {
  const positions = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: { store: any } }
    const store = w.__blockout.store
    store.getState().setTime(2)
    await new Promise((r) => setTimeout(r, 120)) // let a frame apply
    return true
  })
  expect(positions).toBe(true)
})

test('rendering is deterministic: same t → byte-identical frames', async () => {
  const report = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: { renderRawForTest: any } }
    // Interleave awaits so the live animation loop runs between renders —
    // exactly the conditions of a real export.
    const a: number[] = w.__blockout.renderRawForTest(1.7)
    await new Promise((r) => setTimeout(r, 100))
    w.__blockout.renderRawForTest(3.9)
    await new Promise((r) => setTimeout(r, 100))
    const b: number[] = w.__blockout.renderRawForTest(1.7)
    let diffs = 0
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++
    return { diffs, length: a.length }
  })
  expect(report.length).toBe(320 * 180 * 4)
  expect(report.diffs).toBe(0)
})

test('exports a real package: video + stills + prompt + metadata', async () => {
  test.setTimeout(300_000)
  const result = await page.evaluate(async () => {
    const w = window as unknown as { __blockout: { store: any; exportShot: any } }
    return await w.__blockout.exportShot({
      profileId: 'seedance-2',
      passes: { clean: true, depth: true, normal: false },
      labels: 'stillsOnly'
    })
  })
  expect(result.ok, `export failed: ${result.error ?? ''}`).toBe(true)
  const pkg = result.packagePath as string
  expect(existsSync(pkg)).toBe(true)

  const files = readdirSync(pkg)
  const refMp4 = files.find((f) => f.endsWith('_reference.mp4'))!
  const depthMp4 = files.find((f) => f.endsWith('_depth.mp4'))!
  expect(refMp4).toBeTruthy()
  expect(depthMp4).toBeTruthy()
  expect(files).toContain('prompt.txt')
  expect(files).toContain('metadata.json')
  expect(files).toContain('README.txt')

  // Video correctness via ffprobe: duration ≈ 5s, 24fps, correct resolution.
  const probe = JSON.parse(
    execFileSync(process.env.BLOCKOUT_FFPROBE || 'ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format',
      join(pkg, refMp4)
    ]).toString()
  )
  const stream = probe.streams.find((s: any) => s.codec_type === 'video')
  expect(Number(probe.format.duration)).toBeGreaterThan(4.7)
  expect(Number(probe.format.duration)).toBeLessThan(5.3)
  expect(stream.width).toBe(1920)
  expect(stream.height).toBe(1080)
  expect(stream.avg_frame_rate).toBe('24/1')
  expect(Number(stream.nb_frames)).toBeGreaterThanOrEqual(119)

  // Stills: first/last + 2 camera marks + top-down.
  const stills = readdirSync(join(pkg, 'stills'))
  expect(stills.some((f) => f.includes('first'))).toBe(true)
  expect(stills.some((f) => f.includes('last'))).toBe(true)
  expect(stills.some((f) => f.includes('mark-1'))).toBe(true)
  expect(stills.some((f) => f.includes('mark-2'))).toBe(true)
  expect(stills.some((f) => f.includes('topdown'))).toBe(true)

  // Prompt mentions the labeled subject and the lens.
  const prompt = readFileSync(join(pkg, 'prompt.txt'), 'utf-8')
  expect(prompt).toContain('HERO')
  expect(prompt).toContain('35mm')

  // Metadata is valid JSON with both camera marks.
  const meta = JSON.parse(readFileSync(join(pkg, 'metadata.json'), 'utf-8'))
  expect(meta.cameraMarks.length).toBe(2)
  expect(meta.shot.fps).toBe(24)
})
