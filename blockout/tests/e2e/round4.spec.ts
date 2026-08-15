// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Round-4 features: one-click framings, ground snap, stage presets, motion
 * presets, boarding, flying-object marks, the stuck-after-recording fix, the
 * expanded asset catalog, and the agent control server (the MCP path).
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let configDir: string

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-r4-'))
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

test('mode switch after look-through never leaves the app stuck', async () => {
  const state = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    store.setLookThrough(true)
    store.setMode('stage') // the round-4 bug: this used to keep lookThrough on
    const s = (window as any).__blockout.store.getState()
    return { lookThrough: s.lookThrough, recording: s.recording, mode: s.mode }
  })
  expect(state.mode).toBe('stage')
  expect(state.lookThrough).toBe(false)
  expect(state.recording).toBe(false)
})

test('expanded catalog: props category, new furniture, new environments place', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const ids = ['prop.phone', 'prop.helicopter', 'furniture.poolTable', 'env.restaurant']
    const placed = ids.map((id) => store.addEntity(id, { x: 10, y: 0, z: 10 }))
    const scene = (window as any).__blockout.store.getState().scene()
    return placed.map((pid: string) => !!scene.entities.find((e: any) => e.id === pid))
  })
  expect(result.every(Boolean)).toBe(true)
})

test('framings: 2-shot and OTS write a camera mark framing both people', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    const a = store.addEntity('person.man', { x: -1, y: 0, z: 0 })
    const b = store.addEntity('person.woman', { x: 1, y: 0, z: 0 })
    store.setSelection(null)
    store.toggleEntitySelected(a)
    store.toggleEntitySelected(b)
    const mgr = (window as any).__blockout_scene
    mgr.applyFraming('2S')
    const after2S = (window as any).__blockout.store.getState().shot().camera.marks.slice(-1)[0]
    mgr.applyFraming('OTS')
    const afterOTS = (window as any).__blockout.store.getState().shot().camera.marks.slice(-1)[0]
    return { after2S, afterOTS, a, b }
  })
  // 2-shot: perpendicular to the X-axis pair → camera off on ±Z, centered on X.
  expect(Math.abs(result.after2S.position.x)).toBeLessThan(0.5)
  expect(Math.abs(result.after2S.position.z)).toBeGreaterThan(1.2)
  // OTS: near one of the two heads, meaningfully off-center on X.
  expect(Math.abs(result.afterOTS.position.x)).toBeGreaterThan(0.5)
  expect(result.afterOTS.position.y).toBeGreaterThan(1.0)
})

test('dutch: roll cycles right → left → level on the active mark', async () => {
  const rolls = await page.evaluate(() => {
    const mgr = (window as any).__blockout_scene
    const roll = () => {
      const marks = (window as any).__blockout.store.getState().shot().camera.marks
      return marks[marks.length - 1].roll
    }
    mgr.applyFraming('DUTCH')
    const r1 = roll()
    mgr.applyFraming('DUTCH')
    const r2 = roll()
    mgr.applyFraming('DUTCH')
    const r3 = roll()
    return [r1, r2, r3]
  })
  expect(rolls[0]).toBeCloseTo(0.35, 2)
  expect(rolls[1]).toBeCloseTo(-0.35, 2)
  expect(rolls[2]).toBeCloseTo(0, 2)
})

test('ground snap rests a floating object on the floor', async () => {
  const y = await page.evaluate(async () => {
    const store = (window as any).__blockout.store.getState()
    const id = store.addEntity('prim.cube', { x: 6, y: 0, z: 6 })
    store.mutate('float it', (doc: any) => {
      for (const scene of doc.scenes) {
        const e = scene.entities.find((en: any) => en.id === id)
        if (e) e.transform.position.y = 5
      }
    })
    store.setSelection({ kind: 'entity', entityId: id })
    await new Promise((r) => setTimeout(r, 150)) // let the visual sync
    ;(window as any).__blockout_scene.snapSelectionToGround()
    const e = (window as any).__blockout.store.getState().scene().entities.find((en: any) => en.id === id)
    return e.transform.position.y
  })
  expect(y).toBeLessThan(0.2)
})

test('motion preset apply lays down pose marks at the playhead', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const id = store.addEntity('person.man', { x: 3, y: 0, z: 3 })
    store.setTime(1)
    // Simulate what the inspector Apply button does through the doc directly
    // is UI logic; instead verify the data contract end-to-end via the store.
    store.setSelection({ kind: 'entity', entityId: id })
    return { id }
  })
  // Drive the actual UI: entity inspector → Motion presets → Apply.
  await page.getByRole('button', { name: 'Fight' }).click()
  await page.getByRole('button', { name: 'Apply' }).first().click()
  const marks = await page.evaluate((id: string) => {
    const s = (window as any).__blockout.store.getState()
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const track = take.tracks.find((t: any) => t.entityId === id)
    return track ? track.marks.map((m: any) => ({ t: m.time, joints: !!m.joints })) : []
  }, result.id)
  expect(marks.length).toBeGreaterThanOrEqual(2)
  expect(marks[0].t).toBeCloseTo(1, 1)
  expect(marks.every((m: { joints: boolean }) => m.joints)).toBe(true)
})

test('boarding: attachTo on a mark rides the vehicle from arrival', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const busId = store.addEntity('vehicle.bus', { x: 20, y: 0, z: 0 })
    const manId = store.addEntity('person.man', { x: 16, y: 0, z: 2 })
    store.mutate('board setup', (doc: any) => {
      const s = (window as any).__blockout.store.getState()
      const scene = doc.scenes.find((sc: any) => sc.id === s.sceneId)
      const shot = scene.shots.find((sh: any) => sh.id === s.shotId)
      const take = scene.blocking.find((b: any) => b.id === shot.blockingTakeId)
      take.tracks.push({
        entityId: busId,
        marks: [
          { id: 'bm1', time: 0, hold: 2, easeIn: 0, easeOut: 0, position: { x: 20, y: 0, z: 0 }, gait: 'walk' },
          { id: 'bm2', time: 5, hold: 0, easeIn: 0, easeOut: 0, position: { x: 20, y: 0, z: -20 }, gait: 'walk' }
        ]
      })
      take.tracks.push({
        entityId: manId,
        marks: [
          { id: 'mm1', time: 0, hold: 0, easeIn: 0, easeOut: 0, position: { x: 16, y: 0, z: 2 }, gait: 'walk' },
          { id: 'mm2', time: 1.5, hold: 0, easeIn: 0, easeOut: 0, position: { x: 19.5, y: 0, z: 0.5 }, gait: 'walk', attachTo: busId }
        ]
      })
    })
    return { busId, manId }
  })
  // Read the resolved positions through a still render path: scrub and inspect visuals.
  const pos = await page.evaluate(({ busId, manId }: { busId: string; manId: string }) => {
    const s = (window as any).__blockout.store.getState()
    s.setTime(4.5)
    return new Promise((resolve) => {
      setTimeout(() => {
        const mgr = (window as any).__blockout_scene as any
        const bus = mgr.visuals.get(busId)?.root.position
        const man = mgr.visuals.get(manId)?.root.position
        resolve({ busZ: bus?.z, manZ: man?.z })
      }, 200)
    })
  }, { busId: result.busId, manId: result.manId })
  const p = pos as { busZ: number; manZ: number }
  expect(p.busZ).toBeLessThan(-5)
  expect(Math.abs(p.manZ - p.busZ)).toBeLessThan(1.5)
})

test('stage preset: save, list, apply as a NEW scene with remapped ids', async () => {
  const result = await page.evaluate(async () => {
    const store = (window as any).__blockout.store.getState()
    const sceneCountBefore = (window as any).__blockout.store.getState().doc.scenes.length
    await store.saveStagePreset('E2E Dinner')
    const list = await (window as any).blockout.presetsList()
    const preset = list.find((p: any) => p.name === 'E2E Dinner')
    if (!preset) return { error: 'not listed' }
    await store.applyStagePreset(preset.id)
    const s2 = (window as any).__blockout.store.getState()
    const scenes = s2.doc.scenes
    const newScene = scenes[scenes.length - 1]
    // Cleanup so reruns stay tidy.
    await (window as any).blockout.presetDelete(preset.id)
    return {
      sceneCountBefore,
      sceneCountAfter: scenes.length,
      newSceneEntities: newScene.entities.length,
      currentSceneId: s2.sceneId,
      newSceneId: newScene.id,
      entityCount: preset.entityCount
    }
  })
  expect((result as any).error).toBeUndefined()
  expect(result.sceneCountAfter).toBe(result.sceneCountBefore + 1)
  expect(result.newSceneEntities).toBeGreaterThan(0)
  expect(result.newSceneEntities).toBe(result.entityCount)
  expect(result.currentSceneId).toBe(result.newSceneId) // switched to the staged copy
})

test('agent control server: HTTP rpc drives the app (the MCP path)', async () => {
  const controlPath = join(configDir, 'control.json')
  expect(existsSync(controlPath)).toBe(true)
  const { port, token } = JSON.parse(readFileSync(controlPath, 'utf8'))

  const rpc = async (action: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, params })
    })
    return res.json() as Promise<{ ok: boolean; data?: any; error?: string }>
  }

  const state = await rpc('get_state')
  expect(state.ok).toBe(true)
  expect(state.data.project).toBeTruthy()

  const added = await rpc('add_entity', { assetId: 'person.woman', x: -5, z: -5, label: 'Agent Test' })
  expect(added.ok).toBe(true)
  const after = await rpc('get_state')
  const placed = after.data.scene.entities.find((e: any) => e.id === added.data.entityId)
  expect(placed).toBeTruthy()
  expect(placed.label).toBe('Agent Test')

  // Bad auth is rejected.
  const bad = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
    body: JSON.stringify({ action: 'get_state' })
  })
  expect(bad.status).toBe(401)

  const shot = await rpc('screenshot')
  expect(shot.ok).toBe(true)
  expect(typeof shot.data.imageBase64).toBe('string')
  expect(shot.data.imageBase64.length).toBeGreaterThan(1000)
})
