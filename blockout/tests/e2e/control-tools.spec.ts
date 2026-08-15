/**
 * Control-server e2e for the choreography + 3D-scan agent tools: launch the
 * built app, create a project, then drive the localhost control server exactly
 * as the MCP bridge (mcp/blockout-mcp.mjs) would — read the discovery file,
 * POST /rpc actions, and assert they land in the live store. Covers
 * spawn_choreography and import_scan (the two systems these tools expose),
 * plus the discovery tools they depend on.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string
let splatPath: string
let port: number
let token: string

/** Minimal Antimatter15 .splat (32 bytes/splat) so import_scan has a real file. */
function makeSyntheticSplat(path: string, count = 32): void {
  const buf = Buffer.alloc(count * 32)
  for (let i = 0; i < count; i++) {
    const o = i * 32
    const a = (i / count) * Math.PI * 2
    buf.writeFloatLE(Math.cos(a) * 2, o + 0)
    buf.writeFloatLE(0.5, o + 4)
    buf.writeFloatLE(Math.sin(a) * 2, o + 8)
    buf.writeFloatLE(0.08, o + 12)
    buf.writeFloatLE(0.08, o + 16)
    buf.writeFloatLE(0.08, o + 20)
    buf[o + 24] = 180
    buf[o + 25] = 180
    buf[o + 26] = 180
    buf[o + 27] = 255
    buf[o + 28] = 255
    buf[o + 29] = 128
    buf[o + 30] = 128
    buf[o + 31] = 128
  }
  writeFileSync(path, buf)
}

/** POST a control action the same way the MCP bridge does. */
async function rpc<T>(action: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, params })
  })
  expect(res.status).toBe(200)
  return (await res.json()) as { ok: boolean; data?: T; error?: string }
}

test.beforeAll(async () => {
  smokeDir = mkdtempSync(join(tmpdir(), 'blockout-control-'))
  splatPath = join(smokeDir, 'living-room.splat')
  makeSyntheticSplat(splatPath)

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await expect(page.locator('.mode-switch')).toBeVisible()

  const { readFileSync } = await import('fs')
  const discoveryFile = join(homedir(), '.config', 'blockout', 'control.json')
  expect(existsSync(discoveryFile)).toBe(true)
  ;({ port, token } = JSON.parse(readFileSync(discoveryFile, 'utf-8')) as { port: number; token: string })
})

test.afterAll(async () => {
  await app?.close()
})

test('list_choreography_options exposes the vocabulary', async () => {
  const body = await rpc<{ kinds: string[]; styles: Record<string, unknown[]>; formations: unknown[]; endings: Record<string, unknown[]> }>(
    'list_choreography_options'
  )
  expect(body.ok).toBe(true)
  expect(body.data?.kinds).toEqual(['dance', 'fight', 'chase'])
  expect(body.data?.styles.dance.length).toBeGreaterThan(0)
  expect(body.data?.formations.length).toBeGreaterThan(0)
  expect(body.data?.endings.fight.length).toBeGreaterThan(0)
})

test('list_motion_presets lists the motion library with the expected fields', async () => {
  const all = await rpc<{ id: string; name: string; category: string; duration: number }[]>('list_motion_presets')
  expect(all.ok).toBe(true)
  expect((all.data ?? []).length).toBeGreaterThan(100)
  expect(all.data?.[0]).toHaveProperty('duration')
  // Filtering by a new category returns only that category.
  const dance = await rpc<{ category: string }[]>('list_motion_presets', { category: 'dance' })
  expect(dance.data?.every((m) => m.category === 'dance')).toBe(true)
})

test('spawn_choreography stages performers and their marks', async () => {
  const body = await rpc<{ kind: string; staged: number; entityIds: string[] }>('spawn_choreography', {
    kind: 'dance',
    performers: 4,
    style: 'hiphop',
    durationS: 6,
    seed: 7
  })
  expect(body.ok).toBe(true)
  expect(body.data?.kind).toBe('dance')
  expect(body.data?.staged).toBe(4)
  expect(body.data?.entityIds.length).toBe(4)

  // The performers exist in the live scene and carry timeline marks.
  const info = await page.evaluate((ids: string[]) => {
    const w = window as unknown as { __blockout: { store: { getState: () => { scene: () => any } } } }
    const scene = w.__blockout.store.getState().scene()
    const take = scene.blocking[0]
    const withMarks = ids.filter((id: string) => (take.tracks.find((t: any) => t.entityId === id)?.marks.length ?? 0) > 0)
    return { entities: scene.entities.length, withMarks: withMarks.length }
  }, body.data!.entityIds)
  expect(info.entities).toBeGreaterThanOrEqual(4)
  expect(info.withMarks).toBe(4)
})

test('choreograph_entities retargets existing people', async () => {
  // Place two people, then choreograph just those two.
  const a = await rpc<{ entityId: string }>('add_entity', { assetId: 'person.man', x: -1, z: 0 })
  const b = await rpc<{ entityId: string }>('add_entity', { assetId: 'person.woman', x: 1, z: 0 })
  const body = await rpc<{ choreographed: number }>('choreograph_entities', {
    entityIds: [a.data!.entityId, b.data!.entityId],
    kind: 'fight',
    style: 'brawl',
    durationS: 6,
    seed: 3
  })
  expect(body.ok).toBe(true)
  expect(body.data?.choreographed).toBe(2)
})

test('import_scan copies the file in and returns the ScanRef; set/remove work', async () => {
  const body = await rpc<{ scan: { id: string; name: string; file: string; visible: boolean } }>('import_scan', {
    sourcePath: splatPath
  })
  expect(body.ok).toBe(true)
  const scan = body.data!.scan
  expect(scan.name).toBe('living-room')
  expect(scan.file.startsWith('scans/')).toBe(true)
  expect(scan.visible).toBe(true)
  expect(existsSync(join(smokeDir, 'Smoke.blockout', scan.file))).toBe(true)

  // get_state now lists the scan so an agent can discover its id.
  const state = await rpc<{ scene: { scans: { id: string }[] } }>('get_state')
  expect(state.data?.scene.scans.some((s) => s.id === scan.id)).toBe(true)

  // Transform + visibility toggle.
  const moved = await rpc<{ scan: { position: { x: number }; scale: number; visible: boolean } }>('set_scan_transform', {
    scanId: scan.id,
    position: { x: 2 },
    rotationDeg: 90,
    scale: 1.5,
    visible: false
  })
  expect(moved.ok).toBe(true)
  expect(moved.data?.scan.position.x).toBe(2)
  expect(moved.data?.scan.scale).toBe(1.5)
  expect(moved.data?.scan.visible).toBe(false)

  // Removal.
  const removed = await rpc<{ removed: string }>('remove_scan', { scanId: scan.id })
  expect(removed.ok).toBe(true)
  const after = await rpc<{ scene: { scans: { id: string }[] } }>('get_state')
  expect(after.data?.scene.scans.some((s) => s.id === scan.id)).toBe(false)
})
