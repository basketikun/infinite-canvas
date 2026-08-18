#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import extract from 'extract-zip'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows FFmpeg assets must be prepared natively on Windows x64.')
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))
const asset = manifest.assets.windowsFfmpeg
const destination = resolve(root, 'vendor', 'ffmpeg', 'win-x64')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function hashFile(path) {
  return hash(await readFile(path))
}

async function preparedAssetsAreValid() {
  try {
    for (const [name, expected] of Object.entries(asset.files)) {
      if (await hashFile(join(destination, name)) !== expected) return false
    }
    return true
  } catch {
    return false
  }
}

if (await preparedAssetsAreValid()) {
  console.log(`Audited Windows FFmpeg assets already prepared in ${destination}`)
  process.exit(0)
}

const work = await mkdtemp(join(tmpdir(), 'blockout-ffmpeg-win-'))
const zipPath = join(work, asset.archive.name)
const extractDir = join(work, 'extracted')

async function findCandidates(dir, wanted, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await findCandidates(path, wanted, out)
    else if (entry.isFile() && basename(path).toLowerCase() === wanted.toLowerCase()) out.push(path)
  }
  return out
}

try {
  const response = await fetch(asset.archive.url, {
    headers: { 'User-Agent': 'Blockout-release-builder/1.0', Accept: 'application/octet-stream' }
  })
  if (!response.ok) throw new Error(`FFmpeg download failed: HTTP ${response.status}`)
  const archiveBytes = Buffer.from(await response.arrayBuffer())
  const archiveHash = hash(archiveBytes)
  if (archiveHash !== asset.archive.sha256) {
    throw new Error(`FFmpeg archive checksum mismatch: ${archiveHash}`)
  }
  await writeFile(zipPath, archiveBytes)
  await mkdir(extractDir, { recursive: true })
  await extract(zipPath, { dir: extractDir })
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })

  for (const [name, expectedHash] of Object.entries(asset.files)) {
    const candidates = await findCandidates(extractDir, name)
    let source
    for (const candidate of candidates) {
      if (await hashFile(candidate) === expectedHash) {
        source = candidate
        break
      }
    }
    if (!source) throw new Error(`${name} was missing or failed its pinned checksum`)
    await copyFile(source, join(destination, name))
  }
  console.log(`Prepared audited Windows FFmpeg assets in ${destination}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
