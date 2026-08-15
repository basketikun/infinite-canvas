#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resolveSpdxRootId } from './sbom-utils.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, process.argv[2] || 'release')
const manifest = JSON.parse(await readFile(resolve(root, 'ASSET_MANIFEST.json'), 'utf8'))
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'))
await mkdir(output, { recursive: true })

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this script through npm so npm_execpath is available.')
const spdx = JSON.parse(execFileSync(
  process.execPath,
  [npmCli, 'sbom', '--sbom-format', 'spdx', '--omit', 'dev'],
  { cwd: root, maxBuffer: 100 * 1024 * 1024 }
).toString())

const cyclonePath = resolve(output, 'blockout.cyclonedx.json')
const cycloneCli = resolve(root, 'node_modules', '@cyclonedx', 'cyclonedx-npm', 'bin', 'cyclonedx-npm-cli.js')
execFileSync(process.execPath, [
  cycloneCli,
  '--omit', 'dev',
  '--output-reproducible',
  '--output-format', 'JSON',
  '--output-file', cyclonePath,
  '--validate'
], { cwd: root, stdio: 'inherit' })
const cyclone = JSON.parse(await readFile(cyclonePath, 'utf8'))

async function packagedRuntime() {
  const target = process.env.BLOCKOUT_SBOM_TARGET || `${process.platform}-${process.arch}`
  if (target === 'win32-x64') {
    const asset = manifest.assets.windowsFfmpeg
    return {
      version: '7.1.5-1-g7d0e842004',
      supplier: 'BtbN/FFmpeg-Builds',
      distribution: asset.archive.url,
      files: { ffmpeg: asset.files['ffmpeg.exe'], ffprobe: asset.files['ffprobe.exe'] },
      ffmpegSource: asset.sourceArchives.find((entry) => entry.name.startsWith('FFmpeg-')),
      buildSource: asset.sourceArchives.find((entry) => entry.name.startsWith('FFmpeg-Builds-'))
    }
  }
  if (target === 'darwin-arm64' || target === 'darwin-x64') {
    const arch = target.split('-')[1]
    const asset = manifest.assets.macosFfmpeg
    const built = JSON.parse(await readFile(
      resolve(root, 'vendor', 'ffmpeg', `macos-${arch}`, 'BUILD-MANIFEST.json'),
      'utf8'
    ))
    return {
      version: '7.1.5-portable-gpl.1',
      supplier: 'Blockout portable build from mifi/ffmpeg-build-script',
      distribution: `NOASSERTION-${arch}`,
      files: { ffmpeg: built.files.ffmpeg, ffprobe: built.files.ffprobe },
      ffmpegSource: asset.sourceArchives.find((entry) => entry.name.startsWith('FFmpeg-release-')),
      buildSource: asset.sourceArchives.find((entry) => entry.name.startsWith('ffmpeg-build-script-'))
    }
  }
  throw new Error(`No packaged FFmpeg SBOM descriptor for ${target}`)
}

const runtime = await packagedRuntime()
const rootSpdxId = resolveSpdxRootId(spdx, 'blockout')
// Electron-builder and Vite consume these development-time packages to create
// binaries/bundles that are shipped at runtime. npm's --omit dev graph cannot
// infer that, so record them explicitly in both release SBOM formats.
const bundledRuntimePackages = ['electron', 'react', 'react-dom'].map((name) => {
  const metadata = lock.packages?.[`node_modules/${name}`]
  if (!metadata?.version) throw new Error(`Missing bundled runtime package ${name} in package-lock.json`)
  return { name, version: metadata.version, license: metadata.license || 'NOASSERTION' }
})
const bundledRuntimeCdxRefs = []
for (const component of bundledRuntimePackages) {
  const safeName = component.name.replace(/[^A-Za-z0-9.-]/g, '-')
  const spdxId = `SPDXRef-Package-Blockout-Bundled-${safeName}`
  const purl = `pkg:npm/${component.name}@${component.version}`
  spdx.packages.push({
    name: component.name,
    SPDXID: spdxId,
    versionInfo: component.version,
    downloadLocation: `https://registry.npmjs.org/${component.name}/-/${component.name}-${component.version}.tgz`,
    filesAnalyzed: false,
    licenseConcluded: component.license,
    licenseDeclared: component.license,
    externalRefs: [{
      referenceCategory: 'PACKAGE-MANAGER',
      referenceType: 'purl',
      referenceLocator: purl
    }]
  })
  spdx.relationships.push({
    spdxElementId: rootSpdxId,
    relationshipType: 'CONTAINS',
    relatedSpdxElement: spdxId
  })

  const cdxRef = `blockout-bundled:${component.name}:${component.version}`
  bundledRuntimeCdxRefs.push(cdxRef)
  cyclone.components.push({
    type: component.name === 'electron' ? 'application' : 'library',
    name: component.name,
    version: component.version,
    'bom-ref': cdxRef,
    purl,
    licenses: [{ license: { id: component.license } }],
    scope: 'required',
    properties: [{ name: 'blockout:delivery', value: 'bundled-runtime' }]
  })
  cyclone.dependencies.push({ ref: cdxRef })
}
const ids = {
  ffmpeg: 'SPDXRef-Package-Blockout-FFmpeg',
  ffprobe: 'SPDXRef-Package-Blockout-FFprobe',
  ffmpegSource: 'SPDXRef-Package-FFmpeg-Source',
  buildSource: 'SPDXRef-Package-FFmpeg-Build-Source'
}
const sourceRecords = [
  { id: ids.ffmpegSource, name: 'FFmpeg source', archive: runtime.ffmpegSource, license: 'GPL-3.0-or-later' },
  { id: ids.buildSource, name: 'FFmpeg build scripts', archive: runtime.buildSource, license: 'MIT' }
]
for (const [name, id] of [['ffmpeg', ids.ffmpeg], ['ffprobe', ids.ffprobe]]) {
  spdx.packages.push({
    name,
    SPDXID: id,
    versionInfo: runtime.version,
    supplier: `Organization: ${runtime.supplier}`,
    downloadLocation: runtime.distribution.startsWith('NOASSERTION') ? 'NOASSERTION' : runtime.distribution,
    filesAnalyzed: false,
    licenseConcluded: 'GPL-3.0-or-later',
    licenseDeclared: 'GPL-3.0-or-later',
    checksums: [{ algorithm: 'SHA256', checksumValue: runtime.files[name] }],
    externalRefs: [{
      referenceCategory: 'OTHER',
      referenceType: 'blockout-runtime-asset',
      referenceLocator: `sha256:${runtime.files[name]}`
    }]
  })
  spdx.relationships.push(
    { spdxElementId: rootSpdxId, relationshipType: 'CONTAINS', relatedSpdxElement: id },
    { spdxElementId: id, relationshipType: 'GENERATED_FROM', relatedSpdxElement: ids.ffmpegSource },
    { spdxElementId: id, relationshipType: 'GENERATED_FROM', relatedSpdxElement: ids.buildSource }
  )
}
for (const source of sourceRecords) {
  spdx.packages.push({
    name: source.name,
    SPDXID: source.id,
    versionInfo: source.archive.name,
    supplier: 'Organization: Blockout release provenance',
    downloadLocation: source.archive.url,
    filesAnalyzed: false,
    licenseConcluded: source.license,
    licenseDeclared: source.license,
    checksums: [{ algorithm: 'SHA256', checksumValue: source.archive.sha256 }]
  })
}

const cdxRefs = {
  ffmpeg: `blockout-runtime:ffmpeg:${runtime.version}`,
  ffprobe: `blockout-runtime:ffprobe:${runtime.version}`,
  ffmpegSource: `blockout-source:ffmpeg:${runtime.ffmpegSource.sha256}`,
  buildSource: `blockout-source:build:${runtime.buildSource.sha256}`
}
for (const name of ['ffmpeg', 'ffprobe']) {
  cyclone.components.push({
    type: 'application',
    name,
    version: runtime.version,
    'bom-ref': cdxRefs[name],
    supplier: { name: runtime.supplier },
    licenses: [{ license: { id: 'GPL-3.0-or-later' } }],
    hashes: [{ alg: 'SHA-256', content: runtime.files[name] }],
    externalReferences: runtime.distribution.startsWith('NOASSERTION') ? [] : [
      { type: 'distribution', url: runtime.distribution }
    ],
    properties: [
      { name: 'blockout:source:ffmpeg', value: runtime.ffmpegSource.url },
      { name: 'blockout:source:build-scripts', value: runtime.buildSource.url }
    ]
  })
  cyclone.dependencies.push({ ref: cdxRefs[name], dependsOn: [cdxRefs.ffmpegSource, cdxRefs.buildSource] })
}
for (const source of sourceRecords) {
  const ref = source.id === ids.ffmpegSource ? cdxRefs.ffmpegSource : cdxRefs.buildSource
  cyclone.components.push({
    type: 'file',
    name: source.name,
    version: source.archive.name,
    'bom-ref': ref,
    licenses: [{ license: { id: source.license } }],
    hashes: [{ alg: 'SHA-256', content: source.archive.sha256 }],
    externalReferences: [{ type: 'vcs', url: source.archive.url }]
  })
  cyclone.dependencies.push({ ref })
}
const rootDependency = cyclone.dependencies.find((entry) => entry.ref === cyclone.metadata.component['bom-ref'])
if (!rootDependency) throw new Error('CycloneDX root dependency was not generated')
rootDependency.dependsOn = [...new Set([
  ...rootDependency.dependsOn,
  ...bundledRuntimeCdxRefs,
  cdxRefs.ffmpeg,
  cdxRefs.ffprobe
])]

await writeFile(resolve(output, 'blockout.spdx.json'), JSON.stringify(spdx, null, 2) + '\n')
await writeFile(cyclonePath, JSON.stringify(cyclone, null, 2) + '\n')
console.log(`Wrote SPDX and CycloneDX SBOMs with packaged FFmpeg provenance to ${output}`)
