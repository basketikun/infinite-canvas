// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Global stage-preset storage. Presets are reusable staging setups saved
 * outside any project in Blockout's platform config directory.
 */

import { ipcMain } from 'electron'
import { mkdir, readFile, writeFile, readdir, rm } from 'fs/promises'
import { join } from 'path'
import { resolveConfigPath } from '../shared/config-paths'

interface PresetFile {
  id: string
  name: string
  savedAt: string
  entityCount: number
  payload: unknown
}

type PresetMeta = Pick<PresetFile, 'id' | 'name' | 'savedAt' | 'entityCount'>

const PRESETS_DIR = resolveConfigPath('presets')

/** Strip anything not [a-z0-9-] so a preset id can't traverse out of the dir. */
function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'preset'
  )
}

export function registerPresetsIpc(): void {
  ipcMain.handle('presets:list', async (): Promise<PresetMeta[]> => {
    let files: string[]
    try {
      files = await readdir(PRESETS_DIR)
    } catch {
      return []
    }
    const metas: PresetMeta[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const raw = await readFile(join(PRESETS_DIR, file), 'utf-8')
        const parsed = JSON.parse(raw) as PresetFile
        if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') continue
        metas.push({
          id: parsed.id,
          name: parsed.name,
          savedAt: parsed.savedAt,
          entityCount: parsed.entityCount ?? 0
        })
      } catch {
        // Skip unparseable / partially-written files rather than failing the list.
      }
    }
    metas.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''))
    return metas
  })

  ipcMain.handle(
    'presets:save',
    async (_e, name: string, json: string): Promise<{ ok: boolean; id?: string; error?: string }> => {
      try {
        const payload = JSON.parse(json) as { entities?: unknown[] }
        const id = `${slugify(name)}-${Date.now().toString(36)}`
        const entityCount = Array.isArray(payload.entities) ? payload.entities.length : 0
        const record: PresetFile = {
          id,
          name: name.trim() || 'Untitled preset',
          savedAt: new Date().toISOString(),
          entityCount,
          payload
        }
        await mkdir(PRESETS_DIR, { recursive: true })
        await writeFile(join(PRESETS_DIR, `${sanitizeId(id)}.json`), JSON.stringify(record, null, 2), 'utf-8')
        return { ok: true, id }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle('presets:load', async (_e, id: string): Promise<string | null> => {
    try {
      const raw = await readFile(join(PRESETS_DIR, `${sanitizeId(id)}.json`), 'utf-8')
      const parsed = JSON.parse(raw) as PresetFile
      return JSON.stringify(parsed.payload)
    } catch {
      return null
    }
  })

  ipcMain.handle('presets:delete', async (_e, id: string): Promise<boolean> => {
    try {
      await rm(join(PRESETS_DIR, `${sanitizeId(id)}.json`))
      return true
    } catch {
      return false
    }
  })
}
