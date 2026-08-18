#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function auditConfiguration(executable, requiredFlags, forbiddenFlags) {
  const version = execFileSync(executable, ['-version'], { encoding: 'utf8' })
  const configuration = version.split('\n').map((line) => line.trim())
    .find((line) => line.startsWith('configuration:')) || ''
  if (!configuration) throw new Error(`RELEASE BLOCKED: unable to inspect ${executable} configure flags.`)
  for (const flag of requiredFlags) {
    if (!configuration.includes(flag)) throw new Error(`RELEASE BLOCKED: ${executable} is missing ${flag}.`)
  }
  for (const flag of forbiddenFlags) {
    if (configuration.includes(flag)) throw new Error(`RELEASE BLOCKED: ${executable} contains ${flag}.`)
  }
  return configuration
}

if (process.platform === 'win32' && process.arch === 'x64') {
  const asset = manifest.assets.windowsFfmpeg
  const assetDir = resolve(root, 'vendor', 'ffmpeg', 'win-x64')
  for (const [name, expected] of Object.entries(asset.files)) {
    const actual = await sha256(resolve(assetDir, name))
    if (actual !== expected) throw new Error(`RELEASE BLOCKED: ${name} checksum mismatch: ${actual}`)
  }
  for (const executable of ['ffmpeg.exe', 'ffprobe.exe']) {
    auditConfiguration(
      resolve(assetDir, executable),
      asset.requiredConfigureFlags,
      asset.forbiddenConfigureFlags
    )
  }
  console.log('Windows FFmpeg/FFprobe redistribution audit passed')
} else if (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) {
  const asset = manifest.assets.macosFfmpeg
  const assetDir = resolve(root, 'vendor', 'ffmpeg', `macos-${process.arch}`)
  const built = JSON.parse(await readFile(resolve(assetDir, 'BUILD-MANIFEST.json'), 'utf8'))
  if (built.buildRepositoryCommit !== asset.buildRepositoryCommit ||
    built.ffmpegCommit !== asset.ffmpegCommit || built.patchSha256 !== asset.buildPatch.sha256) {
    throw new Error('RELEASE BLOCKED: macOS FFmpeg build provenance does not match the pinned manifest.')
  }
  for (const name of ['ffmpeg', 'ffprobe', 'LICENSE.txt']) {
    const actual = await sha256(resolve(assetDir, name))
    if (actual !== built.files[name]) throw new Error(`RELEASE BLOCKED: ${name} checksum mismatch: ${actual}`)
  }
  if (built.files['LICENSE.txt'] !== asset.licenseSha256) {
    throw new Error('RELEASE BLOCKED: macOS FFmpeg GPL license checksum mismatch.')
  }
  for (const executable of ['ffmpeg', 'ffprobe']) {
    auditConfiguration(
      resolve(assetDir, executable),
      asset.requiredConfigureFlags,
      asset.forbiddenConfigureFlags
    )
    const linked = execFileSync('otool', ['-L', resolve(assetDir, executable)], { encoding: 'utf8' })
    for (const line of linked.split('\n').slice(1).map((value) => value.trim()).filter(Boolean)) {
      if (!line.startsWith('/usr/lib/') && !line.startsWith('/System/Library/')) {
        throw new Error(`RELEASE BLOCKED: ${executable} links a non-system library: ${line}`)
      }
    }
  }
  console.log(`macOS ${process.arch} FFmpeg/FFprobe redistribution audit passed`)
} else {
  throw new Error('RELEASE BLOCKED: no audited FFmpeg release asset is pinned for this platform/architecture.')
}
