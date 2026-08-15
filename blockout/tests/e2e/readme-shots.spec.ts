/**
 * README / docs showcase screenshots (NOT part of CI).
 *
 * Regenerates the marketing stills under docs/images/. Every test is gated
 * behind README_SHOTS so the normal Playwright run skips this file entirely.
 *
 *   README_SHOTS=1 npx playwright test tests/e2e/readme-shots.spec.ts
 *
 * Each scene is staged through the documented automation surface
 * (window.__blockout.store + window.__blockout_scene) — the same store actions
 * agents and other e2e specs use.
 */

import { _electron as electron, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const OUT = 'docs/images'
const GATE = !process.env.README_SHOTS

let app: ElectronApplication
let page: Page

/** Fly the free (editor) viewport camera to a chosen position + target. */
async function flyCam(
  p: Page,
  pos: [number, number, number],
  target: [number, number, number]
) {
  await p.evaluate(
    ({ pos, target }) => {
      const sm = (window as any).__blockout_scene
      sm.freeCam.position.set(pos[0], pos[1], pos[2])
      sm.controls.target.set(target[0], target[1], target[2])
      sm.controls.update?.()
    },
    { pos, target }
  )
  await p.waitForTimeout(350)
}

/**
 * Frame a set of entities: compute their world bounding box from the live
 * scene objects and place the free camera on a chosen azimuth/elevation just
 * far enough back to hold them, tilted down at the group center. This keeps
 * the camera close to the performers (so tall environment geometry never sits
 * between the lens and the action) while still reading as a wide staging view.
 */
async function frameEntities(
  p: Page,
  entityIds: string[] | null,
  opts: { azimuthDeg: number; elevationDeg: number; distScale?: number; lift?: number } = {
    azimuthDeg: 35,
    elevationDeg: 28
  }
) {
  await p.evaluate(
    ({ entityIds, opts }) => {
      const sm = (window as any).__blockout_scene
      const s = (window as any).__blockout.store.getState()
      const ids: string[] =
        entityIds ??
        s
          .scene()
          .entities.filter((e: any) => !e.assetId.startsWith('env.'))
          .map((e: any) => e.id)
      // Gather world positions of the live visuals; fall back to doc positions.
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
      const add = (x: number, y: number, z: number) => {
        box.min[0] = Math.min(box.min[0], x); box.max[0] = Math.max(box.max[0], x)
        box.min[1] = Math.min(box.min[1], y); box.max[1] = Math.max(box.max[1], y)
        box.min[2] = Math.min(box.min[2], z); box.max[2] = Math.max(box.max[2], z)
      }
      for (const id of ids) {
        const v = sm.visuals?.get(id)
        const ent = s.scene().entities.find((e: any) => e.id === id)
        if (v?.root) {
          const pos = v.root.position
          add(pos.x, pos.y, pos.z)
        } else if (ent) {
          add(ent.position.x, ent.position.y, ent.position.z)
        }
      }
      if (!isFinite(box.min[0])) { add(0, 0, 0); add(2, 2, 2) }
      const c = [
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2 + (opts.lift ?? 0.6),
        (box.min[2] + box.max[2]) / 2
      ]
      const span = Math.max(
        4,
        box.max[0] - box.min[0],
        box.max[2] - box.min[2],
        (box.max[1] - box.min[1]) * 1.4
      )
      const dist = span * (opts.distScale ?? 1.15) + 6
      const az = (opts.azimuthDeg * Math.PI) / 180
      const el = (opts.elevationDeg * Math.PI) / 180
      const horiz = Math.cos(el) * dist
      const camX = c[0] + Math.sin(az) * horiz
      const camZ = c[2] + Math.cos(az) * horiz
      const camY = c[1] + Math.sin(el) * dist
      sm.freeCam.position.set(camX, camY, camZ)
      sm.controls.target.set(c[0], c[1], c[2])
      sm.controls.update?.()
    },
    { entityIds, opts }
  )
  await p.waitForTimeout(400)
}

/** Clear any lingering toasts so they don't clutter a capture. */
async function clearToasts(p: Page) {
  await p.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    for (const t of [...s.toasts]) s.dismissToast(t.id)
  })
  await p.waitForTimeout(150)
}

/** Fresh empty scene between captures so they don't bleed into each other. */
async function newScene(p: Page) {
  await p.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addSceneAfter()
    const s2 = (window as any).__blockout.store.getState()
    s2.setLookThrough(false)
    s2.setMode('stage')
    s2.setTime(0)
  })
  await p.waitForTimeout(500)
}

test.beforeAll(async () => {
  test.skip(GATE, 'docs generator — set README_SHOTS=1 to run')
  mkdirSync(OUT, { recursive: true })
  const smokeDir = mkdtempSync(join(tmpdir(), 'blockout-readme-'))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir }
  })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {})
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'New Project' }).click()
  await page.waitForTimeout(700)
})

test.afterAll(async () => {
  await app?.close()
})

function verify(name: string) {
  const size = statSync(join(OUT, name)).size
  console.log(`  ${name}: ${(size / 1024).toFixed(0)} KB`)
  if (size < 100_000) throw new Error(`${name} is only ${size} bytes — capture looks empty`)
}

test('hero — downtown car chase, shoot mode, PiP preview', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addEntity('env.downtown', { x: 0, y: 0, z: 0 })
    // Chase runs down -Z from the origin; frame it from a high 3/4 angle.
    s.spawnSequence({
      type: 'carChase',
      count: 5,
      style: 'weaving',
      origin: { x: 0, z: 0, heading: 0 }
    })
    // The generator marks the cars 'run', whose vehicle speed band starts at
    // ~26 m/s — this ~15.6 m/s city chase then floods the HUD with too-slow
    // warning chips. 'walk' on a vehicle just means "drive" (6–33 m/s band).
    s.mutate('pace chase', (doc: any) => {
      const scene = doc.scenes.find((sc: any) => sc.id === s.scene().id)
      for (const take of scene.blocking)
        for (const tr of take.tracks)
          for (const m of tr.marks) if (m.gait !== 'stand') m.gait = 'walk'
    })
    // Witnesses on the sidewalks (buildings sit at x=+-11).
    const a = s.addEntity('person.man', { x: -5.2, y: 0, z: 6 })
    const b = s.addEntity('person.woman', { x: 5.2, y: 0, z: 8 })
    s.mutate('label', (doc: any) => {
      const scene = doc.scenes.find((sc: any) => sc.id === s.scene().id)
      const ea = scene.entities.find((e: any) => e.id === a)
      const eb = scene.entities.find((e: any) => e.id === b)
      if (ea) ea.label = { text: 'WITNESS', color: '#4c9df5' }
      if (eb) eb.label = { text: 'BYSTANDER', color: '#e5c07b' }
    })
    s.setMode('shoot')
    // Two camera marks (a short push down the near kerb) so the move reads as a
    // real dolly, and the HUD Marks/Paths toggles stay on so spike-tape numbered
    // floor marks + path ribbons render along the corridor.
    s.setShowMarks(true)
    s.setShowPaths(true)
    s.dropCameraMark({ x: 4.5, y: 2.2, z: 11 }, -0.12, -0.06, 35)
    s.setTime(2.6)
    s.dropCameraMark({ x: 3.2, y: 1.8, z: 2 }, -0.18, -0.04, 42)
    s.setTime(0.9)
    s.setSelection(null)
  })
  await page.waitForTimeout(300)
  await clearToasts(page)
  // Downtown's street runs down the Z axis between buildings at x=+-11 — stay
  // low and close on the near kerb so the oncoming chase reads large down the
  // corridor with the spike-tape marks + path ribbon leading into it.
  await flyCam(page, [-2.6, 2.0, 8.5], [1.0, 0.8, -9])
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/hero.png` })
  verify('hero.png')
})

test('stage-crowd — stage env, 20 dancers, pulled back', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await newScene(page)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addEntity('env.stage', { x: 0, y: 0, z: 0 })
    // Perform downstage on the main floor so the raised stage + lit truss read
    // as the backdrop (the platform sits at z=3, deck at y=1, truss overhead).
    // The Choreographer stages a real routine: 20 dancers, mixed styles, a
    // circle formation with canon + mirroring — one undoable step.
    s.spawnChoreography(
      {
        kind: 'dance',
        performers: 20,
        durationS: 8,
        seed: 7,
        style: 'mixed',
        formation: 'circle',
        canon: true,
        mirror: true,
        formationChange: true
      },
      { x: 0, z: -5, heading: 0 }
    )
    s.setMode('stage')
    s.setTime(1.6)
    s.setSelection(null)
  })
  await page.waitForTimeout(500)
  await clearToasts(page)
  // Low front-of-house 3/4: the tan deck fills the floor and the lit truss
  // arcs overhead behind the crowd (dancers sit at ground, z ~= -4..-10).
  await flyCam(page, [2.5, 3.4, 5], [0, 0.9, -7])
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/stage-crowd.png` })
  verify('stage-crowd.png')
})

test('shoot-followcam — plane flying, follow-behind, look-through', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await newScene(page)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.setMode('shoot')
    const id = s.addEntity('vehicle.plane', { x: -6, y: 6, z: 20 })
    // Scale the plane down so the drone-behind rig holds it as a whole
    // aircraft, not a fuselage wall.
    s.mutate('scale', (doc: any) => {
      const scene = doc.scenes.find((sc: any) => sc.id === s.scene().id)
      const e = scene.entities.find((x: any) => x.id === id)
      if (e) e.transform.scale = 0.5
    })
    // A gentle banking climb: drifts +X while rising 6 -> 12m over ~45m, so
    // the follow cam reads a 3/4 tail view of the aircraft.
    s.setTime(0)
    s.dropActorMark(id, { x: -6, y: 6, z: 20 })
    s.setTime(2.5)
    s.dropActorMark(id, { x: 0, y: 9, z: -2 })
    s.setTime(5)
    s.dropActorMark(id, { x: 8, y: 12, z: -25 })
    s.setTime(0)
    s.setSelection({ kind: 'entity', entityId: id })
    return id
  })
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    const sm = (window as any).__blockout_scene
    sm.applyCameraMove('follow-behind')
    const s = (window as any).__blockout.store.getState()
    // Deselect so no gizmo/selection billboard sits in front of the lens.
    s.setSelection(null)
    s.setLookThrough(true)
    s.setTime(1.6)
  })
  await page.waitForTimeout(900)
  await clearToasts(page)
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${OUT}/shoot-followcam.png` })
  verify('shoot-followcam.png')
})

test('timeline-choreo — fight sequence, timeline lanes, inspector', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await newScene(page)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addEntity('env.warehouse', { x: 0, y: 0, z: 0 })
    // The Choreographer's paired fight: attack -> reaction exchanges where each
    // reaction lands mid-attack. Eight fighters = four pairs of timeline lanes.
    s.spawnChoreography(
      {
        kind: 'fight',
        performers: 8,
        durationS: 8,
        seed: 5,
        style: 'martial-arts',
        mirror: true,
        ending: 'finish'
      },
      { x: 0, z: -3, heading: 0 }
    )
    s.setMode('shoot')
    // Mid-exchange, so a strike and its reaction read as a clash of poses.
    s.setTime(2.1)
  })
  await page.waitForTimeout(400)
  // Select one fighter so its lane + inspector are highlighted.
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    const fighter = s.scene().entities.find((e: any) => e.assetId.startsWith('person.'))
    if (fighter) s.setSelection({ kind: 'entity', entityId: fighter.id })
  })
  await page.waitForTimeout(400)
  await clearToasts(page)
  await frameEntities(page, null, { azimuthDeg: 32, elevationDeg: 24, distScale: 1.0, lift: 1.0 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/timeline-choreo.png` })
  verify('timeline-choreo.png')
})

test('backyard — pool, props, golden hour', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await newScene(page)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addEntity('env.backyard', { x: 0, y: 0, z: 0 })
    s.addEntity('prop.bbqGrill', { x: -4, y: 0, z: 2 })
    s.addEntity('prop.trampoline', { x: 5, y: 0, z: 3 })
    s.addEntity('person.child', { x: 2, y: 0, z: -4 })
    s.addEntity('animal.dog', { x: -1.5, y: 0, z: 1 })
    // Physical-sky preset: a real atmospheric-scattering dome lit by the sun
    // (deterministic; renders byte-identically in the clean export). Drop the
    // sun low so the whole dome goes warm golden-hour and the light rakes long.
    s.mutate('goldenHourSky', (doc: any) => {
      const scene = doc.scenes.find((sc: any) => sc.id === s.scene().id)
      scene.environment.lighting = 'goldenHourSky'
      scene.environment.sunElevation = 0.13
      scene.environment.sunAzimuth = -1.15
    })
    s.setMode('stage')
    s.setSelection(null)
  })
  await page.waitForTimeout(500)
  await clearToasts(page)
  // Low 3/4 from the grill side across the pool so the warm sky dome fills the
  // background behind the fence, the low sun rakes long shadows, and the
  // trampoline/pool/dog all sit in the mid-ground (not looming in foreground).
  await flyCam(page, [-7.5, 3.0, 10], [1.5, 0.6, -3])
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/backyard.png` })
  verify('backyard.png')
})

test('deliver — export panel on a staged shot', async () => {
  test.skip(GATE, 'docs generator')
  test.setTimeout(120_000)
  await newScene(page)
  await page.evaluate(() => {
    const s = (window as any).__blockout.store.getState()
    s.addEntity('env.downtown', { x: 0, y: 0, z: 0 })
    const hero = s.addEntity('person.man', { x: -1, y: 0, z: 1 })
    s.addEntity('vehicle.suv', { x: 4, y: 0, z: -5 })
    s.mutate('label', (doc: any) => {
      const scene = doc.scenes.find((sc: any) => sc.id === s.scene().id)
      const e = scene.entities.find((x: any) => x.id === hero)
      if (e) e.label = { text: 'THIEF', color: '#e5484d' }
    })
    s.dropActorMark(hero, { x: -1, y: 0, z: 1 })
    s.setTime(3)
    s.dropActorMark(hero, { x: 2, y: 0, z: -5 })
    s.setTime(0)
    s.dropCameraMark({ x: 4, y: 1.6, z: 4 }, 0.5, -0.05, 35)
    s.setMode('deliver')
  })
  await page.waitForTimeout(600)
  await clearToasts(page)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/deliver.png` })
  verify('deliver.png')
})
