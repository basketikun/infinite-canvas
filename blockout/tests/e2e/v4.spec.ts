/**
 * v4.0: sequence click-to-place, moving performers moves their choreography,
 * the ✨ Animate tab, group restyling, and the resizable timeline.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-v4-'))
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

test('sequence click-to-place stages the crowd AT the clicked spot', async () => {
  // Arm placement through the real UI, then click the center of the floor.
  const seqBox = page.locator('.panel-section', { hasText: 'Sequences' }).first()
  await seqBox.locator('input[type="number"]').fill('6')
  await page.getByRole('button', { name: /Stage 6 performers/ }).click()
  await expect(page.getByRole('button', { name: /Click the floor to place/ })).toBeVisible()

  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  // Click slightly below center — safely on the ground plane in the default view.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.62)
  await page.waitForTimeout(300)

  const result = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const dancers = s.scene().entities.filter((e: any) => e.name.startsWith('Dancer'))
    // Where did the click land? Reconstruct via the group centroid.
    const cx = dancers.reduce((a: number, d: any) => a + d.transform.position.x, 0) / dancers.length
    const cz = dancers.reduce((a: number, d: any) => a + d.transform.position.z, 0) / dancers.length
    const cam = (window as any).__blockout_scene.freeCam.position
    return {
      count: dancers.length,
      centroidDistFromCam: Math.hypot(cam.x - cx, cam.z - cz),
      placing: s.placingSequence
    }
  })
  expect(result.count).toBe(6)
  expect(result.placing).toBeNull() // placement disarmed after the click
  // The default editor camera sits ~11m out — a crowd "where you clicked"
  // must be nearby, not tens of meters off in the distance.
  expect(result.centroidDistFromCam).toBeLessThan(20)
})

test('dragging a performer moves its choreography (marks ride along)', async () => {
  // Give one dancer a clear mark path, then gizmo-drag them and compare.
  const setup = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const dancer = s.scene().entities.find((e: any) => e.name.startsWith('Dancer'))
    s.setMode('shoot')
    s.setSelection({ kind: 'entity', entityId: dancer.id })
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const track = take.tracks.find((t: any) => t.entityId === dancer.id)
    return {
      id: dancer.id,
      pos: dancer.transform.position,
      firstMark: track.marks[0].position
    }
  })
  await page.waitForTimeout(400)

  // Probe for a translate-gizmo axis and drag (same pattern as interaction.spec).
  const canvas = page.locator('.viewport-wrap canvas')
  const box = (await canvas.boundingBox())!
  let grab: { x: number; y: number } | null = null
  outer: for (let dx = -160; dx <= 160; dx += 20) {
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
  expect(grab, 'no gizmo axis under probe grid').toBeTruthy()
  await page.mouse.move(grab!.x, grab!.y)
  await page.mouse.down()
  await page.mouse.move(grab!.x + 80, grab!.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(300)

  const after = await page.evaluate((id: string) => {
    const s = (window as any).__blockout.store.getState()
    const entity = s.scene().entities.find((e: any) => e.id === id)
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const track = take.tracks.find((t: any) => t.entityId === id)
    return { pos: entity.transform.position, firstMark: track.marks[0].position }
  }, setup.id)

  const bodyDelta = {
    x: after.pos.x - setup.pos.x,
    z: after.pos.z - setup.pos.z
  }
  const markDelta = {
    x: after.firstMark.x - setup.firstMark.x,
    z: after.firstMark.z - setup.firstMark.z
  }
  const moved = Math.hypot(bodyDelta.x, bodyDelta.z)
  expect(moved).toBeGreaterThan(0.3) // the drag actually moved the body
  // …and the choreography moved with it (same rigid delta).
  expect(markDelta.x).toBeCloseTo(bodyDelta.x, 1)
  expect(markDelta.z).toBeCloseTo(bodyDelta.z, 1)
})

test('✨ Animate tab: single character and empty-selection guidance', async () => {
  await page.getByRole('button', { name: '✨ Animate' }).click()
  await expect(page.getByText('Animating:')).toBeVisible() // dancer still selected
  await expect(page.getByText('Motion presets')).toBeVisible()
  await expect(page.getByText('Action presets')).toBeVisible()
  await page.evaluate(() => (window as any).__blockout.store.getState().setSelection(null))
  await expect(page.getByText(/Select a character/)).toBeVisible()
})

test('group restyle: swap every dancer to one style in a click', async () => {
  const result = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const ids = s
      .scene()
      .entities.filter((e: any) => e.name.startsWith('Dancer'))
      .map((e: any) => e.id)
    s.setSelection({ kind: 'entities', entityIds: ids })
    s.applyMotionToEntities(ids, 'macarena')
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    const firstJointSets = ids.map((id: string) => {
      const track = take.tracks.find((t: any) => t.entityId === id)
      return JSON.stringify(track.marks[0].joints)
    })
    return { n: ids.length, allSame: new Set(firstJointSets).size === 1 }
  })
  expect(result.n).toBe(6)
  expect(result.allSame).toBe(true) // everyone now opens with the same macarena pose
})

test('group action: every selected performer gets a path from its own spot', async () => {
  const result = await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const ids = s
      .scene()
      .entities.filter((e: any) => e.name.startsWith('Dancer'))
      .map((e: any) => e.id)
      .slice(0, 3)
    s.applyActionToEntities(ids, 'run-forward')
    const take = s.scene().blocking.find((b: any) => b.id === s.shot().blockingTakeId)
    return ids.map((id: string) => {
      const track = take.tracks.find((t: any) => t.entityId === id)
      const first = track.marks[0].position
      const last = track.marks[track.marks.length - 1].position
      return Math.hypot(last.x - first.x, last.z - first.z)
    })
  })
  for (const dist of result) expect(dist).toBeGreaterThan(20) // everyone sprints
})

test('timeline is resizable and its lanes scroll', async () => {
  await expect(page.locator('.timeline-resizer')).toBeVisible()
  const heights = await page.evaluate(() => {
    const tl = document.querySelector('.timeline') as HTMLElement
    const body = document.querySelector('.timeline-body') as HTMLElement
    return {
      panel: tl.getBoundingClientRect().height,
      bodyScrollable: body.scrollHeight >= body.clientHeight,
      bodyOverflow: getComputedStyle(body).overflowY
    }
  })
  expect(heights.panel).toBeGreaterThan(200)
  expect(heights.bodyOverflow).toBe('auto') // lanes always reachable by scroll
})
