#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

const logoHash = await sha256(resolve(root, manifest.assets.applicationLogo.path))
if (logoHash !== manifest.assets.applicationLogo.sha256) {
  throw new Error(`application logo checksum mismatch: ${logoHash}`)
}
const windowsIconHash = await sha256(resolve(root, manifest.assets.windowsIcon.path))
if (windowsIconHash !== manifest.assets.windowsIcon.sha256) {
  throw new Error(`Windows icon checksum mismatch: ${windowsIconHash}`)
}
const macPatchHash = await sha256(resolve(root, manifest.assets.macosFfmpeg.buildPatch.path))
if (macPatchHash !== manifest.assets.macosFfmpeg.buildPatch.sha256) {
  throw new Error(`macOS FFmpeg patch checksum mismatch: ${macPatchHash}`)
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
for (const rejected of ['ffmpeg-static', '@derhuerst/ffprobe-static']) {
  if (packageJson.dependencies?.[rejected] || packageJson.devDependencies?.[rejected] ||
    packageJson.optionalDependencies?.[rejected]) {
    throw new Error(`rejected static media package is still declared: ${rejected}`)
  }
}

console.log('Verified application logo, Windows icon, macOS build patch, and media dependency boundary')
