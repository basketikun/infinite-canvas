import type { BlockoutAPI } from '../shared/blockout-api'
import { EmbedBridge } from './embed-bridge'

type ExportOptions = { fps: number; width: number; height: number; framesExpected: number }

function asBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value
  if (value && typeof value === 'object' && 'ok' in value && typeof value.ok === 'boolean') return value.ok
  return fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function browserPlatform(): BlockoutAPI['platform'] {
  const isMac = /Mac/i.test(navigator.platform)
  const isWindows = /Win/i.test(navigator.platform)
  return {
    platform: isMac ? 'macos' : isWindows ? 'windows' : 'linux',
    isMac,
    primaryModifier: isMac ? '⌘' : 'Ctrl',
    alternateModifier: isMac ? '⌥' : 'Alt',
    showInFolderLabel: isMac ? 'Reveal in Finder' : 'Show in Folder'
  }
}

export function createWebBlockoutAdapter(): BlockoutAPI {
  const bridge = new EmbedBridge()
  const request = <T>(type: string, payload?: unknown): Promise<T> => bridge.request<T>(type, payload)

  const api: BlockoutAPI = {
    platform: browserPlatform(),
    newProjectDialog: async () => null,
    openProjectDialog: async () => null,
    pickFile: async () => null,
    saveProject: async (folder, json) => asBoolean(await request('PROJECT_SAVE', { folder, json })),
    saveBackup: async (folder, json) => asBoolean(await request('PROJECT_SAVE_BACKUP', { folder, json })),
    loadProject: async (folder) => {
      const result = asRecord(await request('PROJECT_LOAD', { folder }))
      return {
        json: typeof result.json === 'string' ? result.json : null,
        backupJson: typeof result.backupJson === 'string' ? result.backupJson : null,
        backupNewer: result.backupNewer === true,
        folder: typeof result.folder === 'string' ? result.folder : folder
      }
    },
    importAsset: (folder, sourcePath) => request('FILE_IMPORT', { kind: 'asset', folder, sourcePath }),
    importScan: (folder, sourcePath) => request('FILE_IMPORT', { kind: 'scan', folder, sourcePath }),
    importReference: (folder, sourcePath) => request('FILE_IMPORT', { kind: 'reference', folder, sourcePath }),
    readProjectFile: (folder, relativePath) => request('FILE_READ', { folder, relativePath }),
    showFolder: async (path) => {
      bridge.notify('SHOW_FOLDER', { path })
    },
    openExternal: async (url) => {
      if (!/^https:\/\//i.test(url)) return false
      return Boolean(window.open(url, '_blank', 'noopener,noreferrer'))
    },
    exportBegin: async (jobId, outPath, opts: ExportOptions) => asBoolean(await request('EXPORT_BEGIN', { jobId, outPath, opts })),
    exportFrame: async (jobId, png) => asBoolean(await request('EXPORT_FRAME', { jobId, png })),
    exportEnd: async (jobId) => asBoolean(await request('EXPORT_END', { jobId })),
    exportCancel: async (jobId) => asBoolean(await request('EXPORT_CANCEL', { jobId })),
    exportWriteFile: async (path, data) => asBoolean(await request('EXPORT_WRITE_FILE', { path, data })),
    exportConcat: async (outPath, inputPaths) => {
      const result = asRecord(await request('EXPORT_CONCAT', { outPath, inputPaths }))
      return { ok: result.ok === true, error: typeof result.error === 'string' ? result.error : undefined }
    },
    onExportClosed: (callback) =>
      bridge.on('EXPORT_CLOSED', (payload) => {
        const value = asRecord(payload)
        callback(String(value.jobId ?? ''), Number(value.code ?? -1), String(value.log ?? ''))
      }),
    notifyProjectSummary: (summary) => bridge.notify('PROJECT_SUMMARY_UPDATE', summary),
    notifyThumbnail: (png) => bridge.notify('THUMBNAIL_UPDATE', { png }),
    versions: async () => ({
      app: '5.1.1-web',
      electron: '',
      node: '',
      platform: browserPlatform().platform === 'macos' ? 'darwin' : browserPlatform().platform === 'windows' ? 'win32' : 'linux',
      productName: 'Blockout'
    }),
    presetsList: () => request('PRESETS_LIST'),
    presetSave: (name, json) => request('PRESET_SAVE', { name, json }),
    presetLoad: (id) => request('PRESET_LOAD', { id }),
    presetDelete: async (id) => asBoolean(await request('PRESET_DELETE', { id })),
    onControlInvoke: (callback) =>
      bridge.on('AGENT_CALL', (payload) => {
        const value = asRecord(payload)
        callback(String(value.id ?? ''), String(value.action ?? ''), value.params)
      }),
    controlResult: (id, result) => bridge.notify('AGENT_RESULT', { id, result }),
    analyzeReference: async () => ({ ok: false, error: 'Reference analysis is not available in Blockout Web yet.' })
  }

  bridge.notify('READY', { app: 'blockout', version: '5.1.1-web' })
  return api
}
