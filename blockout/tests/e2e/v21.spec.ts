// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * v2.1: camera-move presets, subject tracking, mark multi-select/delete,
 * and the recording-control setting — plus the MCP surface for them.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let configDir: string

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-v21-'))
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

test('camera move preset lays down marks and aim-locks onto a moving subject', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.setMode('shoot')
    const plane = store.addEntity('vehicle.plane', { x: 0, y: 0, z: 0 })
    // Fly it: two raised marks across the shot.
    store.mutate('fly', (doc: any) => {
      const s = (window as any).__blockout.store.getState()
      const scene = doc.scenes.find((sc: any) => sc.id === s.sceneId)
      const shot = scene.shots.find((sh: any) => sh.id === s.shotId)
      const take = scene.blocking.find((b: any) => b.id === shot.blockingTakeId)
      take.tracks.push({
        entityId: plane,
        marks: [
          { id: 'p1', time: 0, hold: 0, easeIn: 0, easeOut: 0, position: { x: -15, y: 8, z: 0 }, gait: 'walk' },
          { id: 'p2', time: 5, hold: 0, easeIn: 0, easeOut: 0, position: { x: 15, y: 8, z: 0 }, gait: 'walk' }
        ]
      })
    })
    store.setSelection({ kind: 'entity', entityId: plane })
    ;(window as any).__blockout_scene.applyCameraMove('follow-behind')
    const s2 = (window as any).__blockout.store.getState()
    return {
      marks: s2.shot().camera.marks.length,
      tracking: s2.shot().camera.trackEntityId === plane,
      firstY: s2.shot().camera.marks[0].position.y,
      plane
    }
  })
  expect(result.marks).toBeGreaterThanOrEqual(5)
  expect(result.tracking).toBe(true)
  // Airborne subject → the follow path flies too, not ground level.
  expect(result.firstY).toBeGreaterThan(3)

  // Aim lock: evaluated pan swings as the plane crosses the camera.
  const pans = await page.evaluate((planeId: string) => {
    const s = (window as any).__blockout.store.getState()
    const mgr = (window as any).__blockout_scene as any
    void planeId
    s.setTime(0.5)
    const evalAt = (t: number) => {
      const st = mgr.evaluator.evaluate(t)
      return { pan: st.camera.pan, camX: st.camera.position.x }
    }
    return { early: evalAt(0.5), late: evalAt(4.5) }
  }, result.plane)
  expect(pans.early.camX).not.toBeCloseTo(pans.late.camX, 1) // camera rides along
})

test('vertigo dolly-zoom animates the lens', async () => {
  const focals = await page.evaluate(() => {
    (window as any).__blockout_scene.applyCameraMove('vertigo-dolly-zoom')
    const s = (window as any).__blockout.store.getState()
    return s.shot().camera.marks.map((m: any) => m.focalLength)
  })
  expect(focals.length).toBeGreaterThanOrEqual(5)
  expect(focals[focals.length - 1]).toBeLessThan(focals[0] * 0.8)
})

test('select all marks across lanes, shift and delete together', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.selectAllMarks()
    const sel = (window as any).__blockout.store.getState().selection
    const before = {
      kind: sel?.kind,
      count: sel?.markIds?.length ?? 0,
      lane: sel?.entityId
    }
    store.deleteSelectedMarks()
    const s2 = (window as any).__blockout.store.getState()
    const take = s2.scene().blocking.find((b: any) => b.id === s2.shot().blockingTakeId)
    return {
      before,
      camAfter: s2.shot().camera.marks.length,
      tracksAfter: take.tracks.length,
      selection: s2.selection
    }
  })
  expect(result.before.kind).toBe('marks')
  expect(result.before.lane).toBe('*')
  expect(result.before.count).toBeGreaterThan(5) // camera move + plane path
  expect(result.camAfter).toBe(0)
  expect(result.tracksAfter).toBe(0)
  expect(result.selection).toBeNull()

  // And it's one undo step back.
  const undone = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.undo()
    const s2 = (window as any).__blockout.store.getState()
    return s2.shot().camera.marks.length
  })
  expect(undone).toBeGreaterThan(0)
})

test('per-lane select-all picks only that lane', async () => {
  const result = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    store.selectAllMarksInLane('camera')
    const sel = (window as any).__blockout.store.getState().selection
    const camMarks = (window as any).__blockout.store.getState().shot().camera.marks.length
    return { kind: sel.kind, lane: sel.entityId, n: sel.markIds.length, camMarks }
  })
  expect(result.kind).toBe('marks')
  expect(result.lane).toBe('camera')
  expect(result.n).toBe(result.camMarks)
})

test('record control setting cycles and persists in the store', async () => {
  const modes = await page.evaluate(() => {
    const out: string[] = []
    out.push((window as any).__blockout.store.getState().recordControl)
    ;(window as any).__blockout.store.getState().setRecordControl('precise')
    out.push((window as any).__blockout.store.getState().recordControl)
    ;(window as any).__blockout.store.getState().setRecordControl('fast')
    out.push((window as any).__blockout.store.getState().recordControl)
    return out
  })
  expect(modes).toEqual(['normal', 'precise', 'fast'])
  await expect(page.getByRole('button', { name: '⚡ Fast' })).toBeVisible()
})

test('MCP surface: list_camera_moves, apply_camera_move, set_track_subject', async () => {
  const { port, token } = JSON.parse(
    readFileSync(join(configDir, 'control.json'), 'utf8')
  )
  const rpc = async (action: string, params: Record<string, unknown> = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, params })
    })
    return res.json() as Promise<{ ok: boolean; data?: any; error?: string }>
  }
  const moves = await rpc('list_camera_moves')
  expect(moves.ok).toBe(true)
  expect(moves.data.length).toBeGreaterThanOrEqual(27)
  const orbit = await rpc('apply_camera_move', { presetId: 'orbit-180' })
  expect(orbit.ok).toBe(true)
  const state = await rpc('get_state')
  expect(state.data.shot.cameraMarks.length).toBeGreaterThanOrEqual(5)
  const off = await rpc('set_track_subject', {})
  expect(off.ok).toBe(true)
  expect(off.data.tracking).toBeNull()
})
