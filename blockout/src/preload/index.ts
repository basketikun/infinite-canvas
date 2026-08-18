// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Typed IPC bridge. The renderer sees exactly this surface as
 * window.blockout — nothing else from Node.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { BlockoutAPI, PlatformInfo } from '../shared/blockout-api'

const platform: PlatformInfo = {
  platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
  isMac: process.platform === 'darwin',
  primaryModifier: process.platform === 'darwin' ? '⌘' : 'Ctrl',
  alternateModifier: process.platform === 'darwin' ? '⌥' : 'Alt',
  showInFolderLabel: process.platform === 'darwin' ? 'Reveal in Finder' : 'Show in Folder'
}

const api: BlockoutAPI = {
  platform,
  newProjectDialog: () => ipcRenderer.invoke('dialog:newProject'),
  openProjectDialog: () => ipcRenderer.invoke('dialog:openProject'),
  pickFile: (filters) => ipcRenderer.invoke('dialog:pickFile', filters),
  saveProject: (folder, json) => ipcRenderer.invoke('project:save', folder, json),
  saveBackup: (folder, json) => ipcRenderer.invoke('project:saveBackup', folder, json),
  loadProject: (folder) => ipcRenderer.invoke('project:load', folder),
  importAsset: (folder, sourcePath) => ipcRenderer.invoke('project:importAsset', folder, sourcePath),
  importScan: (folder, sourcePath) => ipcRenderer.invoke('scan:import', folder, sourcePath),
  importReference: (folder, sourcePath) => ipcRenderer.invoke('project:importReference', folder, sourcePath),
  readProjectFile: (folder, rel) => ipcRenderer.invoke('file:readAbsolute', folder, rel),
  showFolder: (path) => ipcRenderer.invoke('shell:showFolder', path),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  exportBegin: (jobId, outPath, opts) => ipcRenderer.invoke('export:begin', jobId, outPath, opts),
  exportFrame: (jobId, png) => ipcRenderer.invoke('export:frame', jobId, png),
  exportEnd: (jobId) => ipcRenderer.invoke('export:end', jobId),
  exportCancel: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  exportWriteFile: (path, data) => ipcRenderer.invoke('export:writeFile', path, data),
  exportConcat: (outPath, inputPaths) => ipcRenderer.invoke('export:concat', outPath, inputPaths),
  onExportClosed: (cb) => {
    const listener = (_e: unknown, jobId: string, code: number, log: string) => cb(jobId, code, log)
    ipcRenderer.on('export:closed', listener)
    return () => ipcRenderer.removeListener('export:closed', listener)
  },
  notifyProjectSummary: () => undefined,
  notifyThumbnail: () => undefined,
  presetsList: () => ipcRenderer.invoke('presets:list'),
  presetSave: (name, json) => ipcRenderer.invoke('presets:save', name, json),
  presetLoad: (id) => ipcRenderer.invoke('presets:load', id),
  presetDelete: (id) => ipcRenderer.invoke('presets:delete', id),
  onControlInvoke: (cb) => {
    const listener = (_e: unknown, id: string, action: string, params: unknown) =>
      cb(id, action, params)
    ipcRenderer.on('control:invoke', listener)
    return () => ipcRenderer.removeListener('control:invoke', listener)
  },
  controlResult: (id, result) => ipcRenderer.send('control:result', id, result),
  versions: () => ipcRenderer.invoke('app:versions'),
  analyzeReference: (filePath) => ipcRenderer.invoke('ai:analyzeReference', filePath)
}

contextBridge.exposeInMainWorld('blockout', api)
