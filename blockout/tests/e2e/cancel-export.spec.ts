import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  smokeDir = mkdtempSync(join(root, "blockout-cancel-O'Neil-追跡-"))
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      BLOCKOUT_SMOKE_DIR: smokeDir,
      BLOCKOUT_CONFIG_DIR: join(smokeDir, 'config')
    }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('cancel waits for FFmpeg and removes the partial output without a file lock', async () => {
  test.setTimeout(120_000)
  await page.getByRole('button', { name: 'New Project' }).click()
  // First project creation initializes the full GL scene; CI's GPU-less Intel runners need well over the default 5s.
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(300)

  const result = await page.evaluate(async () => {
    const blockout = (window as unknown as {
      __blockout: {
        store: { getState: () => any }
        exportShot: (options: unknown) => Promise<{ ok: boolean; error?: string }>
      }
    }).__blockout
    const state = blockout.store.getState()
    state.mutate('long cancellation test shot', (doc: any) => {
      doc.scenes[0].shots[0].duration = 20
      doc.scenes[0].shots[0].fps = 30
    })
    setTimeout(() => {
      blockout.store.getState().setExportProgress({ cancelRequested: true })
    }, 30)
    return blockout.exportShot({
      profileId: 'seedance-2',
      passes: { clean: true, depth: false, normal: false },
      labels: 'off',
      resolution: '720p'
    })
  })

  expect(result).toEqual({ ok: false, error: 'cancelled' })
  const exportsDir = join(smokeDir, 'Smoke.blockout', 'exports')
  const entries = existsSync(exportsDir)
    ? readdirSync(exportsDir, { recursive: true }).map(String)
    : []
  expect(entries.filter((entry) => entry.endsWith('.mp4'))).toEqual([])

  // On Windows this fails while ffmpeg.exe still owns the output. Successful
  // recursive deletion proves cancellation awaited process/file-handle close.
  rmSync(exportsDir, { recursive: true, force: true })
  expect(existsSync(exportsDir)).toBe(false)
})
