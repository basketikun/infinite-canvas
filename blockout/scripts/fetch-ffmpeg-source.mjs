#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputDir = resolve(root, process.argv[2] || 'release/ffmpeg-corresponding-source')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))
const platformArchives = process.platform === 'win32'
  ? manifest.assets.windowsFfmpeg.sourceArchives
  : process.platform === 'darwin'
    ? manifest.assets.macosFfmpeg.sourceArchives
    : [
        ...manifest.assets.macosFfmpeg.sourceArchives,
        ...manifest.assets.windowsFfmpeg.sourceArchives
      ]
const archives = [...new Map(platformArchives.map((archive) => [archive.sha256, archive])).values()]

await mkdir(outputDir, { recursive: true })
for (const archive of archives) {
  const outputPath = resolve(outputDir, archive.name)
  execFileSync('curl', [
    '-fL', '--retry', '3', '--user-agent', 'Blockout-release-builder/1.0',
    '-o', outputPath, archive.url
  ], { stdio: 'inherit' })
  const actual = createHash('sha256').update(await readFile(outputPath)).digest('hex')
  if (actual !== archive.sha256) throw new Error(`${archive.name} checksum mismatch: ${actual}`)
  console.log(`Verified ${archive.name}`)
}
