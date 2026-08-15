// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Control-server e2e for the `set_reference` action (Motion Previs Studio
 * handoff): launch the built app, create a project, generate a tiny clip,
 * read the localhost control server's discovery file, POST a set_reference
 * RPC, and assert the active shot gained a referenceVideo AND the clip was
 * copied into the project's refs/ folder.
 */

import { _electron as electron, test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { execFileSync, spawn } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

let app: ElectronApplication
let page: Page
let smokeDir: string
let clipPath: string
let configDir: string
const APP_VERSION = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as { version: string }).version

function callBridgeGetState(): Promise<{ isError?: boolean; content?: { text?: string }[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'mcp', 'blockout-mcp.mjs')], {
      env: { ...process.env, BLOCKOUT_CONFIG_DIR: configDir },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`MCP bridge timed out: ${stderr}`))
    }, 10_000)
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line) as { id?: number; result?: { isError?: boolean; content?: { text?: string }[] } }
        if (message.id === 1 && message.result) {
          clearTimeout(timer)
          child.kill()
          resolve(message.result)
        }
      }
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_state', arguments: {} }
    }) + '\n')
  })
}

test.beforeAll(async () => {
  const root = process.env.BLOCKOUT_E2E_ROOT || tmpdir()
  mkdirSync(root, { recursive: true })
  smokeDir = mkdtempSync(join(root, 'blockout-setref-'))
  configDir = join(smokeDir, 'config')

  // Generate a tiny 1s test clip with the explicitly configured/system FFmpeg.
  const ffmpeg = process.env.BLOCKOUT_FFMPEG || 'ffmpeg'
  clipPath = join(smokeDir, 'reference-clip.mp4')
  execFileSync(ffmpeg, [
    '-y',
    '-f', 'lavfi',
    '-i', 'testsrc=size=320x240:rate=12:duration=1',
    '-pix_fmt', 'yuv420p',
    clipPath
  ], { stdio: 'ignore' })

  app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, BLOCKOUT_SMOKE_DIR: smokeDir, BLOCKOUT_CONFIG_DIR: configDir }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('set_reference control action attaches a reference and copies the clip into refs/', async () => {
  // Create a project so there is a projectFolder + an active shot.
  await page.getByRole('button', { name: 'New Project' }).click()
  // First project creation initializes the full GL scene; CI's GPU-less Intel runners need well over the default 5s.
  await expect(page.locator('.mode-switch')).toBeVisible({ timeout: 30_000 })

  // Read the control server's discovery file (written on app launch).
  const discoveryFile = join(configDir, 'control.json')
  expect(existsSync(discoveryFile)).toBe(true)
  const descriptor = JSON.parse(readFileSync(discoveryFile, 'utf-8')) as {
    protocolVersion: number
    app: string
    appVersion: string
    port: number
    token: string
    pid: number
    startedAt: string
    capabilities: string[]
  }
  expect(descriptor).toMatchObject({
    protocolVersion: 1,
    app: 'blockout',
    appVersion: APP_VERSION,
    pid: expect.any(Number),
    startedAt: expect.any(String),
    capabilities: expect.arrayContaining(['health', 'rpc', 'set_reference', 'motion-handoff-v1'])
  })
  const { port, token } = descriptor

  // POST the set_reference RPC exactly as Motion Previs Studio would.
  const res = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'set_reference',
      params: { videoPath: clipPath, mode: 'ghost', opacity: 0.5 }
    })
  })
  const body = (await res.json()) as {
    ok: boolean
    data?: { handoffVersion: number; path: string; mode: string; opacity: number }
    error?: string
  }
  expect(res.status).toBe(200)
  expect(body.ok).toBe(true)
  expect(body.data?.mode).toBe('ghost')
  expect(body.data?.opacity).toBe(0.5)
  expect(body.data?.handoffVersion).toBe(1)
  expect(body.data?.path.startsWith('refs/')).toBe(true)

  const versionedRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'set_reference',
      params: { handoffVersion: 1, videoPath: clipPath, mode: 'pip', opacity: 0.75 }
    })
  })
  const versionedBody = await versionedRes.json() as { ok: boolean; data?: { handoffVersion: number } }
  expect(versionedBody).toMatchObject({ ok: true, data: { handoffVersion: 1 } })

  const unsupportedRes = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      action: 'set_reference',
      params: { handoffVersion: 2, videoPath: clipPath }
    })
  })
  const unsupportedBody = await unsupportedRes.json() as { ok: boolean; error?: string }
  expect(unsupportedBody.ok).toBe(false)
  expect(unsupportedBody.error).toContain('Unsupported Motion Previs handoffVersion 2')

  // The active shot now carries a referenceVideo pointing at the copied file.
  const ref = await page.evaluate(() => {
    const w = window as unknown as { __blockout: { store: { getState: () => { shot: () => { referenceVideo?: unknown } | undefined } } } }
    return w.__blockout.store.getState().shot()?.referenceVideo ?? null
  })
  expect(ref).not.toBeNull()
  const refVideo = ref as { path: string; mode: string; opacity: number; timeOffset: number }
  expect(refVideo.mode).toBe('pip')
  expect(refVideo.opacity).toBe(0.75)
  expect(refVideo.timeOffset).toBe(0)

  // The clip was physically copied into the project's refs/ folder.
  const copied = join(smokeDir, 'Smoke.blockout', refVideo.path)
  expect(existsSync(copied)).toBe(true)

  // The packaged/source MCP bridge consumes protocol-v1 descriptors.
  const versionedBridge = await callBridgeGetState()
  expect(versionedBridge.isError).not.toBe(true)
  expect(versionedBridge.content?.[0]?.text).toContain('"ok":true')

  // Existing clients/installations may still have the original unversioned
  // descriptor. The bridge deliberately keeps that wire shape compatible.
  writeFileSync(discoveryFile, JSON.stringify({ port, token, pid: descriptor.pid }))
  const legacyBridge = await callBridgeGetState()
  expect(legacyBridge.isError).not.toBe(true)
  expect(legacyBridge.content?.[0]?.text).toContain('"ok":true')
})
