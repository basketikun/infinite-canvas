// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Localhost-only HTTP control server. External agents (MCP clients, Codex,
 * Hermes, …) drive a running Blockout by POSTing actions here; each action
 * is forwarded to the renderer over IPC and its reply is returned as JSON.
 *
 * Discovery + auth are file-based: on startup we write a versioned descriptor
 * in Blockout's platform config directory (mode 0600) and delete it on quit. A
 * client reads that file to learn the random port and bearer token.
 */

import { app, ipcMain, type BrowserWindow } from 'electron'
import http from 'http'
import crypto from 'crypto'
import { mkdir, writeFile, rm } from 'fs/promises'
import { resolveConfigDir, resolveConfigPath } from '../shared/config-paths'
import { version as APP_VERSION } from '../../package.json'

interface Pending {
  resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void
  timer: NodeJS.Timeout
}

const CONFIG_DIR = resolveConfigDir()
const DISCOVERY_FILE = resolveConfigPath('control.json')
const MAX_BODY = 10 * 1024 * 1024 // 10 MB
const CONTROL_PROTOCOL_VERSION = 1
const CONTROL_CAPABILITIES = ['health', 'rpc', 'set_reference', 'motion-handoff-v1'] as const

// Per-action timeouts: rendering/exporting legitimately take longer.
function timeoutForAction(action: string): number {
  if (action === 'export_shot') return 600_000
  if (action === 'screenshot') return 120_000
  return 30_000
}

export async function startControlServer(getWindow: () => BrowserWindow | null): Promise<void> {
  const token = crypto.randomBytes(24).toString('hex')
  const pending = new Map<string, Pending>()

  // Registered ONCE — a per-request listener would leak and double-resolve.
  ipcMain.on('control:result', (_e, id: string, result: { ok: boolean; data?: unknown; error?: string }) => {
    const p = pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    pending.delete(id)
    p.resolve(result)
  })

  function invoke(action: string, params: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const win = getWindow()
    if (!win) return Promise.resolve({ ok: false, error: 'Blockout window not open' })
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, error: 'timeout — is the app busy?' })
      }, timeoutForAction(action))
      pending.set(id, { resolve, timer })
      win.webContents.send('control:invoke', id, action, params ?? {})
    })
  }

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      const json = JSON.stringify(body)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(json)
    }

    if (req.method === 'GET' && req.url === '/health') {
      send(200, {
        ok: true,
        protocolVersion: CONTROL_PROTOCOL_VERSION,
        app: 'blockout',
        appVersion: APP_VERSION,
        capabilities: CONTROL_CAPABILITIES
      })
      return
    }

    if (req.method === 'POST' && req.url === '/rpc') {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${token}`) {
        send(401, { ok: false, error: 'unauthorized' })
        return
      }
      let body = ''
      let aborted = false
      req.on('data', (chunk: Buffer) => {
        body += chunk
        if (body.length > MAX_BODY) {
          aborted = true
          send(413, { ok: false, error: 'request body too large' })
          req.destroy()
        }
      })
      req.on('end', () => {
        if (aborted) return
        let parsed: { action?: unknown; params?: unknown }
        try {
          parsed = JSON.parse(body || '{}')
        } catch {
          send(400, { ok: false, error: 'invalid JSON body' })
          return
        }
        if (typeof parsed.action !== 'string') {
          send(400, { ok: false, error: 'missing "action"' })
          return
        }
        const win = getWindow()
        if (!win) {
          send(503, { ok: false, error: 'Blockout window not open' })
          return
        }
        void invoke(parsed.action, parsed.params).then((result) => {
          if (result.error === 'timeout — is the app busy?') {
            send(504, result)
          } else {
            send(200, result)
          }
        })
      })
      return
    }

    send(404, { ok: false, error: 'not found' })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(
    DISCOVERY_FILE,
    JSON.stringify({
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      app: 'blockout',
      appVersion: APP_VERSION,
      port,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      capabilities: CONTROL_CAPABILITIES
    }),
    { mode: 0o600 }
  )

  app.on('will-quit', () => {
    void rm(DISCOVERY_FILE).catch(() => {})
  })

  console.log(`[blockout] control server on 127.0.0.1:${port}`)
}
