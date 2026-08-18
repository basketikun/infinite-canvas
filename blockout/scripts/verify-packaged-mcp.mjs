#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const entry = process.argv[2]
if (!entry) throw new Error('Usage: node scripts/verify-packaged-mcp.mjs <packaged-mcp-entry>')

const child = spawn(process.execPath, [resolve(entry)], {
  env: { ...process.env, BLOCKOUT_CONFIG_DIR: '' },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true
})

let stdout = ''
let stderr = ''
const timeout = setTimeout(() => {
  child.kill('SIGKILL')
  throw new Error(`Packaged MCP bridge timed out. ${stderr}`)
}, 10_000)

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk) => { stderr += chunk })
child.stdout.setEncoding('utf8')
child.stdout.on('data', (chunk) => {
  stdout += chunk
  const lines = stdout.split('\n')
  stdout = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.id !== 1) continue
    clearTimeout(timeout)
    child.stdin.end()
    const text = message.result?.content?.[0]?.text
    const forwarded = typeof text === 'string' ? JSON.parse(text) : null
    if (message.result?.isError || forwarded?.ok !== true || !Array.isArray(forwarded?.data)) {
      throw new Error(`Packaged MCP bridge did not reach the running app: ${line}`)
    }
    console.log(`Packaged MCP bridge reached Blockout through its default config namespace (${forwarded.data.length} assets).`)
  }
})
child.once('error', (error) => {
  clearTimeout(timeout)
  throw error
})

child.stdin.write(`${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'list_assets', arguments: {} }
})}\n`)
