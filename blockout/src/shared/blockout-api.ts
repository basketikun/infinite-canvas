export interface PlatformInfo {
  platform: 'macos' | 'windows' | 'linux'
  isMac: boolean
  primaryModifier: '⌘' | 'Ctrl'
  alternateModifier: '⌥' | 'Alt'
  showInFolderLabel: 'Reveal in Finder' | 'Show in Folder'
}

export interface BlockoutAPI {
  readonly platform: PlatformInfo
  newProjectDialog(): Promise<{ folder: string; name: string } | null>
  openProjectDialog(): Promise<string | null>
  pickFile(filters: { name: string; extensions: string[] }[]): Promise<string | null>
  saveProject(folder: string, json: string): Promise<boolean>
  saveBackup(folder: string, json: string): Promise<boolean>
  loadProject(folder: string): Promise<{
    json: string | null
    backupJson: string | null
    backupNewer: boolean
    folder: string
  }>
  importAsset(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  importScan(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  importReference(folder: string, sourcePath: string): Promise<{ relativePath: string; name: string }>
  readProjectFile(folder: string, relativePath: string): Promise<ArrayBuffer>
  showFolder(path: string): Promise<void>
  openExternal(url: string): Promise<boolean>
  exportBegin(
    jobId: string,
    outPath: string,
    opts: { fps: number; width: number; height: number; framesExpected: number }
  ): Promise<boolean>
  exportFrame(jobId: string, png: ArrayBuffer): Promise<boolean>
  exportEnd(jobId: string): Promise<boolean>
  exportCancel(jobId: string): Promise<boolean>
  exportWriteFile(path: string, data: ArrayBuffer | string): Promise<boolean>
  exportStillToCanvas?(png: ArrayBuffer, metadata: { title: string; width: number; height: number; time: number }): Promise<boolean>
  exportConcat(outPath: string, inputPaths: string[]): Promise<{ ok: boolean; error?: string }>
  onExportClosed(cb: (jobId: string, code: number, log: string) => void): () => void
  notifyProjectSummary(summary: Record<string, unknown>): void
  notifyThumbnail(png: ArrayBuffer): void
  versions(): Promise<{
    app: string
    electron: string
    node: string
    platform: NodeJS.Platform
    productName: string
  }>
  presetsList(): Promise<{ id: string; name: string; savedAt: string; entityCount: number }[]>
  presetSave(name: string, json: string): Promise<{ ok: boolean; id?: string; error?: string }>
  presetLoad(id: string): Promise<string | null>
  presetDelete(id: string): Promise<boolean>
  onControlInvoke(cb: (id: string, action: string, params: unknown) => void): () => void
  controlResult(id: string, result: { ok: boolean; data?: unknown; error?: string }): void
  analyzeReference(filePath: string): Promise<
    | {
        ok: true
        layout: {
          entities: {
            assetId: string
            x: number
            z: number
            rotationDeg: number
            pose: 'stand' | 'sit' | 'crouch' | 'lie' | 'gesture'
            label: string
            labelColor: string
            scale: number
          }[]
          lighting: 'day' | 'goldenHour' | 'night' | 'interiorWarm' | 'interiorCool' | 'club'
          camera: { x: number; y: number; z: number; panDeg: number; tiltDeg: number; focalLength: number }
          notes: string
        }
      }
    | { ok: false; error: string }
  >
}
