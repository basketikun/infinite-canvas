/** Performance probe: 50-entity scene must hold ~60fps in the viewport. */
import { _electron as electron, test, expect } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

test('50-entity scene holds 60fps', async () => {
  test.setTimeout(120_000)
  const dir = mkdtempSync(join(tmpdir(), 'blockout-perf-'))
  const app = await electron.launch({ args: ['out/main/index.js'], env: { ...process.env, BLOCKOUT_SMOKE_DIR: dir } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(400)
  const fps = await page.evaluate(async () => {
    const store = (window as any).__blockout.store.getState()
    store.addEntity('env.cityStreet', { x: 0, y: 0, z: 0 })
    const ids = ['person.man','person.woman','vehicle.sedan','vehicle.suv','animal.dog','furniture.couch','furniture.chair','prim.cube']
    for (let i = 0; i < 49; i++) {
      const a = ids[i % ids.length]
      store.addEntity(a, { x: (i % 7) * 2.2 - 7, y: 0, z: Math.floor(i / 7) * 2.2 - 7 })
    }
    // Get an actor walking so animation cost is included
    const scene = store.scene()
    const man = scene.entities.find((e: any) => e.assetId === 'person.man')
    store.dropActorMark(man.id, { x: -7, y: 0, z: -7 })
    store.setTime(4); store.dropActorMark(man.id, { x: 7, y: 0, z: 7 }); store.setTime(0)
    store.setPlaying(true)
    await new Promise((r) => setTimeout(r, 500)) // warm up
    const t0 = performance.now()
    let frames = 0
    await new Promise<void>((resolve) => {
      const tick = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve() }
      requestAnimationFrame(tick)
    })
    return frames / ((performance.now() - t0) / 1000)
  })
  console.log('FPS:', Math.round(fps))
  await app.close()
  expect(fps).toBeGreaterThan(50)
})
