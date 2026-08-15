#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import pngToIco from 'png-to-ico'

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const source = join(root, 'src', 'renderer', 'assets', 'logo.png')
const destination = join(root, 'build', 'icon.ico')
const work = await mkdtemp(join(tmpdir(), 'blockout-icon-'))
const ffmpegPath = process.env.BLOCKOUT_FFMPEG ||
  (process.platform === 'win32' ? join(root, 'vendor', 'ffmpeg', 'win-x64', 'ffmpeg.exe') : 'ffmpeg')

try {
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const images = []
  for (const size of sizes) {
    const output = join(work, `icon-${size}.png`)
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-vf', `scale=${size}:${size}:flags=lanczos`, '-frames:v', '1', output
    ])
    images.push(output)
  }
  await writeFile(destination, await pngToIco(images))
  console.log(`Wrote ${destination} (${sizes.join(', ')}px)`)
} finally {
  await rm(work, { recursive: true, force: true })
}
