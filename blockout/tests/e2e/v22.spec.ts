// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * v2.2: crowd sequences (dance/fight/chases), action-path presets for
 * vehicles/objects, the expanded motion library, and their MCP surface.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let configDir: string

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-v22-'))
  configDir = join(dir, 'config')
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: dir, BLOCKOUT_CONFIG_DIR: configDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(400)
})

test.afterAll(async () => {
  await app?.close()
})

test('sequences UI stages a choreographed dance crowd in one click', async () => {
  // Drive the actual Library UI: set 10 performers, arm placement, click the
  // floor (v4: sequences stage exactly where you click).
  const seqBox = page.locator('.panel-section', { hasText: 'Sequences' }).first()
  await seqBox.locator('input[type="number"]').fill('10')
  await page.getByRole('button', { name: /Stage 10 performers/ }).click()
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62)
  await page.waitForTimeout(300)
  const result = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const scene = s.scene()
    const take = scene.blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const dancers = scene.entities.filter((e: any) => e.name.startsWith('Dancer'))
    const tracks = take.tracks.filter((t: any) =>
      dancers.some((d: any) => d.id === t.entityId)
    )
    return {
      dancers: dancers.length,
      tracksWithJoints: tracks.filter((t: any) => t.marks.some((m: any) => m.joints)).length,
      selection: s.selection?.kind,
      selCount: s.selection?.entityIds?.length ?? 0
    }
  })
  expect(result.dancers).toBe(10)
  expect(result.tracksWithJoints).toBe(10)
  expect(result.selection).toBe('entities')
  expect(result.selCount).toBe(10)

  // One undo step removes the whole crowd.
  const afterUndo = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.undo()
    return (window as any).__blockout.store.getState().scene().entities.length
  })
  expect(afterUndo).toBe(0)
})

test('fight and chase sequences via the store', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.spawnSequence({ type: 'fight', count: 6, style: 'paired' })
    const fight = (window as any).__blockout.store.getState().scene().entities.length
    store.spawnSequence({ type: 'carChase', count: 4, style: 'weaving', origin: { x: 60, z: 0, heading: 0 } })
    const s2 = (window as any).__blockout.store.getState()
    const cars = s2.scene().entities.filter((e: any) => e.assetId.startsWith('vehicle.'))
    const lead = cars.find((e: any) => e.label?.text === 'LEAD')
    return { fight, cars: cars.length, hasLead: !!lead }
  })
  expect(result.fight).toBe(6)
  expect(result.cars).toBe(4)
  expect(result.hasLead).toBe(true)
})

test('action preset: plane takeoff lays an altitude path from the pose', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    const plane = store.addEntity('vehicle.plane', { x: -30, y: 0, z: 20 })
    return { plane }
  })
  // Apply through the inspector UI: select the plane, pick the preset, apply.
  await page.evaluate((id: string) => {
    const store = (window as any).__blockout.store.getState()
    store.setTime(0)
    store.setSelection({ kind: 'entity', entityId: id })
  }, result.plane)
  await page.waitForTimeout(200)
  const combo = page.locator('select', { has: page.locator('option', { hasText: 'Plane Takeoff' }) }).first()
  await combo.selectOption({ label: 'Plane Takeoff' })
  await page.getByRole('button', { name: 'Apply action' }).click()
  await page.waitForTimeout(200)
  const marks = await page.evaluate((id: string) => {
    const s = (window as any).__blockout.store.getState()
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const track = take.tracks.find((t: any) => t.entityId === id)
    return track ? track.marks.map((m: any) => ({ t: m.time, y: m.position.y })) : []
  }, result.plane)
  expect(marks.length).toBeGreaterThanOrEqual(5)
  expect(marks[0].y).toBeCloseTo(0, 2)
  expect(marks[marks.length - 1].y).toBeGreaterThan(8) // it took off
})

test('MCP surface: sequence styles, action presets, spawn + apply', async () => {
  const { port, token } = JSON.parse(
    readFileSync(join(configDir, 'control.json'), 'utf8')
  )
  const rpc = async (action: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, params })
    })
    return res.json() as Promise<{ ok: boolean; data?: any }>
  }
  const seqStyles = await rpc('list_sequence_styles')
  expect(seqStyles.ok).toBe(true)
  expect(seqStyles.data.dance.length).toBeGreaterThanOrEqual(15) // mixed + 14+ dances
  expect(seqStyles.data.fight.map((s: any) => s.id)).toEqual(['paired', 'mob'])

  const actions = await rpc('list_action_presets')
  expect(actions.ok).toBe(true)
  expect(actions.data.length).toBeGreaterThanOrEqual(21)

  const spawned = await rpc('spawn_sequence', { type: 'footChase', count: 5, style: 'weaving', x: -80, z: -80 })
  expect(spawned.ok).toBe(true)
  expect(spawned.data.staged).toBe(5)

  const applied = await rpc('apply_action_preset', {
    entityId: spawned.data.entityIds[0],
    presetId: 'debris-fall'
  })
  expect(applied.ok).toBe(true)
  expect(applied.data.marks).toBeGreaterThanOrEqual(5)
})
