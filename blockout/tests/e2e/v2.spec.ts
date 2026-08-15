/** v2.0: version bump and the expanded location/prop catalog. */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'blockout-v2-'))
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

test('app reports the package.json version', async () => {
  const v = await page.evaluate(() => (window as any).blockout.versions())
  // Read the source of truth so version bumps don't break the suite.
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'))
  expect(v.app).toBe(pkg.version)
})

test('v2 locations place and build without errors', async () => {
  const envs = [
    'env.trainInterior',
    'env.boatInterior',
    'env.postOffice',
    'env.supermarket',
    'env.movieTheater',
    'env.indoorMall',
    'env.outdoorMall',
    'env.stripMall',
    'env.residentialStreet',
    'env.downtown',
    'env.sky',
    'env.backyard',
    'env.playgroundPark',
    'env.park',
    'env.hotelLobby',
    'env.hotelRoom',
    'env.diner',
    'env.coffeeShop',
    'env.gasStation',
    'env.parkingGarage',
    'env.policeStation',
    'env.church',
    'env.schoolHallway',
    'env.airportTerminal',
    'env.casino',
    'env.trainStation',
    'env.stadium',
    'env.constructionSite',
    'env.cemetery',
    'env.houseFull'
  ]
  const results = await page.evaluate((ids: string[]) => {
    const out: { id: string; placed: boolean }[] = []
    for (let i = 0; i < ids.length; i++) {
      const store = (window as any).__blockout.store.getState()
      // Spread them out so kits don't stack; each placement builds its visual.
      const eid = store.addEntity(ids[i], { x: (i % 6) * 60, y: 0, z: Math.floor(i / 6) * 60 })
      const scene = (window as any).__blockout.store.getState().scene()
      out.push({ id: ids[i], placed: !!scene.entities.find((e: any) => e.id === eid) })
    }
    return out
  }, envs)
  const missing = results.filter((r) => !r.placed).map((r) => r.id)
  expect(missing, `failed to place: ${missing.join(', ')}`).toHaveLength(0)
  // The renderer built visuals for all of them (no builder crashes).
  const visualCount = await page.evaluate(() => (window as any).__blockout_scene.visuals.size)
  expect(visualCount).toBeGreaterThanOrEqual(envs.length)
})

test('v2 props place, including the flying cloud and backyard set', async () => {
  const props = [
    'prop.hotTub',
    'prop.bbqGrill',
    'prop.firepit',
    'prop.poolLounger',
    'prop.patioUmbrellaTable',
    'prop.picnicTable',
    'prop.swingSet',
    'prop.slide',
    'prop.trampoline',
    'prop.basketballHoop',
    'prop.gazebo',
    'prop.shed',
    'prop.gasPump',
    'prop.busShelter',
    'prop.slotMachine',
    'prop.cashRegister',
    'prop.squirtGun',
    'prop.cloud'
  ]
  const ok = await page.evaluate((ids: string[]) => {
    const store = (window as any).__blockout.store.getState()
    return ids.map((id, i) => {
      const eid = store.addEntity(id, { x: -20 - i * 5, y: 0, z: -20 })
      const scene = (window as any).__blockout.store.getState().scene()
      return !!scene.entities.find((e: any) => e.id === eid)
    })
  }, props)
  expect(ok.every(Boolean)).toBe(true)
  // The cloud floats — its geometry is built well above its origin so it
  // hangs in the air (same pattern as the helicopter).
  const cloudY = await page.evaluate(() => {
    const store = (window as any).__blockout.store.getState()
    const id = store.addEntity('prop.cloud', { x: 50, y: 0, z: 50 })
    return new Promise((resolve) =>
      setTimeout(() => {
        const v = (window as any).__blockout_scene.visuals.get(id)
        v.root.updateWorldMatrix(true, true)
        let maxWorldY = 0
        v.root.traverse((o: any) => {
          // matrixWorld.elements[13] is the world-space Y translation.
          if (o.isMesh) maxWorldY = Math.max(maxWorldY, o.matrixWorld.elements[13])
        })
        resolve(maxWorldY)
      }, 200)
    )
  })
  expect(cloudY as number).toBeGreaterThan(1.5)
})
