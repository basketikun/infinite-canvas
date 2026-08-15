#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml')
const { validateConfiguration } = require('app-builder-lib/out/util/config/config')
const { DebugLogger } = require('builder-util')

const root = resolve(import.meta.dirname, '..')
const configNames = process.argv.slice(2)
if (configNames.length === 0) configNames.push('electron-builder.yml')
for (const name of configNames) {
  const config = load(await readFile(resolve(root, name), 'utf8'))
  await validateConfiguration(config, new DebugLogger(false))
}
console.log(configNames.length === 1
  ? 'electron-builder configuration is valid'
  : 'electron-builder configurations are valid')
