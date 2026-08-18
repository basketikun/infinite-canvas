import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { createEntity, createProject, parseProject, serializeProject } from '@engine/schema'
import { sanitizeName } from '@engine/strings'
import { resolveConfigDir, resolveConfigPath } from '../../src/shared/config-paths'
import { ffmpegConcatEntry, normalizeProjectRelativePath } from '../../src/shared/portable-paths'
import { platformFfmpegCandidates, terminateProcessTree } from '../../src/main/ffmpeg'

describe('platform config paths', () => {
  it('preserves the historical macOS location', () => {
    expect(resolveConfigDir({ platform: 'darwin', env: {}, homeDir: '/Users/test' }))
      .toBe('/Users/test/.config/blockout')
  })

  it('uses APPDATA on Windows and supports an explicit automation override', () => {
    expect(resolveConfigPath('control.json', {
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      homeDir: 'C:\\Users\\test'
    })).toBe('C:\\Users\\test\\AppData\\Roaming\\blockout\\control.json')
    expect(resolveConfigDir({
      platform: 'win32',
      env: { BLOCKOUT_CONFIG_DIR: 'D:\\portable\\config' },
      homeDir: 'C:\\Users\\test'
    })).toBe('D:\\portable\\config')
    expect(resolveConfigDir({
      platform: 'win32',
      env: {
        APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
        BLOCKOUT_CONFIG_NAMESPACE: 'ExampleVendor/BlockoutLab'
      },
      homeDir: 'C:\\Users\\test'
    })).toBe('C:\\Users\\test\\AppData\\Roaming\\ExampleVendor\\BlockoutLab')
  })
})

describe('portable project paths', () => {
  it('accepts legacy separators and writes canonical slashes', () => {
    expect(normalizeProjectRelativePath('assets\\models\\hero.glb')).toBe('assets/models/hero.glb')
    expect(normalizeProjectRelativePath('refs//./take 01.mp4')).toBe('refs/take 01.mp4')

    const doc = createProject('Portable')
    const entity = createEntity('custom.hero', 'Hero', { x: 0, y: 0, z: 0 })
    entity.sourceFile = 'assets\\models\\hero.glb'
    doc.scenes[0]!.entities.push(entity)
    doc.scenes[0]!.shots[0]!.referenceVideo = {
      path: 'refs\\take 01.mp4', opacity: 0.5, mode: 'ghost', timeOffset: 0
    }
    const parsed = parseProject(serializeProject(doc))
    expect(parsed.issues).toEqual([])
    expect(parsed.doc?.scenes[0]?.entities[0]?.sourceFile).toBe('assets/models/hero.glb')
    expect(parsed.doc?.scenes[0]?.shots[0]?.referenceVideo?.path).toBe('refs/take 01.mp4')
  })

  it('fails closed when serialization encounters an unsafe project path', () => {
    for (const unsafePath of [
      'C:\\temp\\hero.glb',
      '\\\\server\\share\\hero.glb',
      '/tmp/hero.glb',
      'assets/../secrets.txt'
    ]) {
      const doc = createProject('Unsafe save')
      const entity = createEntity('custom.hero', 'Hero', { x: 0, y: 0, z: 0 })
      entity.sourceFile = unsafePath
      doc.scenes[0]!.entities.push(entity)
      expect(() => serializeProject(doc), unsafePath)
        .toThrow(/sourceFile: must be a relative path inside the project/)
    }
  })

  it('rejects drive, UNC, rooted, and traversal paths', () => {
    for (const path of [
      'C:\\temp\\hero.glb',
      '\\\\server\\share\\hero.glb',
      '/tmp/hero.glb',
      'assets/../secrets.txt'
    ]) expect(normalizeProjectRelativePath(path), path).toBeNull()

    const doc = createProject('Unsafe')
    const entity = createEntity('custom.hero', 'Hero', { x: 0, y: 0, z: 0 })
    entity.sourceFile = '..\\outside.glb'
    doc.scenes[0]!.entities.push(entity)
    expect(parseProject(JSON.stringify(doc)).doc).toBeNull()
  })
})

describe('portable filenames and FFmpeg paths', () => {
  it('handles Windows device names, trailing punctuation, and long components', () => {
    expect(sanitizeName('CON')).toBe('_CON')
    expect(sanitizeName('nul.txt')).toBe('_nul.txt')
    expect(sanitizeName('shot. ')).toBe('shot')
    expect(sanitizeName('a'.repeat(300)).length).toBeLessThanOrEqual(120)
    expect(sanitizeName('a'.repeat(300))).toBe(sanitizeName('a'.repeat(300)))
  })

  it('formats Windows drives, UNC paths, spaces, Unicode, and apostrophes for concat', () => {
    expect(ffmpegConcatEntry("C:\\OneDrive\\Director's Cut\\追跡.mp4"))
      .toBe("file 'C:/OneDrive/Director'\\''s Cut/追跡.mp4'")
    expect(ffmpegConcatEntry('\\\\server\\share\\clip.mp4'))
      .toBe("file '//server/share/clip.mp4'")
  })

  it('includes standard Windows FFmpeg candidates before the PATH fallback', () => {
    const candidates = platformFfmpegCandidates('win32', {
      ProgramFiles: 'C:\\Program Files',
      ChocolateyInstall: 'C:\\ProgramData\\chocolatey'
    })
    expect(candidates).toContain('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')
    expect(candidates).toContain('C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe')
  })

  it('does not wait for a future close event when an encoder already exited', async () => {
    const alreadyExited = Object.assign(new EventEmitter(), {
      exitCode: 0,
      signalCode: null,
      pid: 123,
      kill: () => {
        throw new Error('must not kill an exited child')
      }
    })
    await expect(terminateProcessTree(alreadyExited as never)).resolves.toBeUndefined()
  })
})
