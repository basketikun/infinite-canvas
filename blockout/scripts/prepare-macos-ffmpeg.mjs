#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('macOS FFmpeg assets must be built natively on macOS arm64 or x64.')
}

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))
const asset = manifest.assets.macosFfmpeg
const destination = resolve(root, 'vendor', 'ffmpeg', `macos-${process.arch}`)
const buildManifestPath = resolve(destination, 'BUILD-MANIFEST.json')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function hashFile(path) {
  return hash(await readFile(path))
}

async function existingBuildIsValid() {
  try {
    const built = JSON.parse(await readFile(buildManifestPath, 'utf8'))
    if (built.buildRepositoryCommit !== asset.buildRepositoryCommit ||
      built.ffmpegCommit !== asset.ffmpegCommit ||
      built.patchSha256 !== asset.buildPatch.sha256) return false
    for (const name of ['ffmpeg', 'ffprobe', 'LICENSE.txt']) {
      if (await hashFile(resolve(destination, name)) !== built.files[name]) return false
    }
    return true
  } catch {
    return false
  }
}

if (await existingBuildIsValid()) {
  console.log(`Audited macOS FFmpeg assets already prepared in ${destination}`)
  process.exit(0)
}

const buildFromSource = process.argv.includes('--build-from-source')
const prebuilt = asset.prebuilt?.[process.arch]

if (prebuilt && !buildFromSource) {
  const vendorDir = resolve(root, 'vendor', 'ffmpeg')
  const work = await mkdtemp(join(tmpdir(), 'blockout-ffmpeg-macos-prebuilt-'))
  try {
    const archivePath = resolve(work, prebuilt.name)
    execFileSync('curl', [
      '-fL', '--retry', '3', '--user-agent', 'Blockout-release-builder/1.0',
      '-o', archivePath, prebuilt.url
    ], { stdio: 'inherit' })
    const actual = await hashFile(archivePath)
    if (actual !== prebuilt.sha256) throw new Error(`${prebuilt.name} checksum mismatch: ${actual}`)
    await mkdir(vendorDir, { recursive: true })
    await rm(destination, { recursive: true, force: true })
    execFileSync('tar', ['-xzf', archivePath, '-C', vendorDir])
    if (!(await existingBuildIsValid())) {
      throw new Error(`${prebuilt.name} failed provenance or checksum validation against the pinned manifest`)
    }
    console.log(`Downloaded audited macOS FFmpeg assets into ${destination}`)
    process.exit(0)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

const patchPath = resolve(root, asset.buildPatch.path)
if (await hashFile(patchPath) !== asset.buildPatch.sha256) {
  throw new Error('macOS FFmpeg build patch checksum mismatch')
}

const work = await mkdtemp(join(tmpdir(), 'blockout-ffmpeg-macos-'))
const sourceDir = resolve(work, 'source')
const packagesDir = resolve(sourceDir, 'packages')

async function downloadVerified(archive, destinationPath) {
  execFileSync('curl', [
    '-fL', '--retry', '3', '--user-agent', 'Blockout-release-builder/1.0',
    '-o', destinationPath, archive.url
  ], { stdio: 'inherit' })
  const actual = await hashFile(destinationPath)
  if (actual !== archive.sha256) throw new Error(`${archive.name} checksum mismatch: ${actual}`)
}

try {
  await mkdir(sourceDir, { recursive: true })
  const [buildSource, ...dependencySources] = asset.sourceArchives
  const buildArchive = resolve(work, buildSource.name)
  await downloadVerified(buildSource, buildArchive)
  execFileSync('tar', ['-xzf', buildArchive, '-C', sourceDir, '--strip-components=1'])
  execFileSync('patch', ['-p1', '-i', patchPath], { cwd: sourceDir, stdio: 'inherit' })

  await mkdir(packagesDir, { recursive: true })
  for (const archive of dependencySources) {
    await downloadVerified(archive, resolve(packagesDir, archive.name))
  }

  execFileSync('bash', ['build-ffmpeg', '--build'], {
    cwd: sourceDir,
    env: { ...process.env, NUMJOBS: process.env.NUMJOBS || '' },
    stdio: 'inherit'
  })

  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  await copyFile(resolve(sourceDir, 'workspace', 'bin', 'ffmpeg'), resolve(destination, 'ffmpeg'))
  await copyFile(resolve(sourceDir, 'workspace', 'bin', 'ffprobe'), resolve(destination, 'ffprobe'))
  await copyFile(
    resolve(packagesDir, 'FFmpeg-release-7.1.5-portable-gpl.1', 'COPYING.GPLv3'),
    resolve(destination, 'LICENSE.txt')
  )
  await chmod(resolve(destination, 'ffmpeg'), 0o755)
  await chmod(resolve(destination, 'ffprobe'), 0o755)

  const files = {
    ffmpeg: await hashFile(resolve(destination, 'ffmpeg')),
    ffprobe: await hashFile(resolve(destination, 'ffprobe')),
    'LICENSE.txt': await hashFile(resolve(destination, 'LICENSE.txt'))
  }
  if (files['LICENSE.txt'] !== asset.licenseSha256) throw new Error('FFmpeg GPL license checksum mismatch')
  const configuration = execFileSync(resolve(destination, 'ffmpeg'), ['-version'], { encoding: 'utf8' })
    .split('\n').map((line) => line.trim()).find((line) => line.startsWith('configuration:')) || ''
  await writeFile(buildManifestPath, JSON.stringify({
    schemaVersion: 1,
    platform: 'darwin',
    arch: process.arch,
    buildRepositoryCommit: asset.buildRepositoryCommit,
    ffmpegCommit: asset.ffmpegCommit,
    patchSha256: asset.buildPatch.sha256,
    configuration,
    files
  }, null, 2) + '\n')
  console.log(`Built audited macOS FFmpeg assets in ${destination}`)
} finally {
  await rm(work, { recursive: true, force: true })
}
