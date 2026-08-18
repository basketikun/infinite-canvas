import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/workbench')
const target = resolve(source, '../../../web/public/plugins/blockout/workbench')

await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true, force: true })
console.log(`[blockout] synced Web workbench → ${target}`)
