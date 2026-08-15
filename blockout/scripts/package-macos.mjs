#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  throw new Error('macOS packages must be built natively on the target architecture.')
}
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this command through npm so npm_execpath is available.')
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const builderCli = require.resolve('electron-builder/cli.js')
const runNpm = (script) => execFileSync(process.execPath, [npmCli, 'run', script], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})

runNpm('prepare:ffmpeg:mac')
runNpm('verify:release-assets')
runNpm('build')
execFileSync(process.execPath, [
  builderCli,
  '--mac',
  `--${process.arch}`,
  '--config',
  'electron-builder.yml',
  '--publish',
  'never'
], { cwd: root, env: process.env, stdio: 'inherit' })
