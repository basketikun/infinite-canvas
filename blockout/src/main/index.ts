// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Electron main process: window lifecycle, project folder I/O, ffmpeg
 * export orchestration. All filesystem access lives here; the renderer
 * talks through the typed IPC surface in src/preload.
 */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { mkdir, readFile, writeFile, copyFile, stat, rm } from 'fs/promises'
import { join, dirname, basename, extname, resolve, sep } from 'path'
import { registerPresetsIpc } from './presets'
import { startControlServer } from './control'
import { friendlyFfmpegError, resolveFfmpeg, terminateProcessTree } from './ffmpeg'
import { sanitizeName } from '../engine/strings'
import { ffmpegConcatEntry, normalizeProjectRelativePath } from '../shared/portable-paths'
import { DISTRIBUTION } from '../shared/distribution'
// Inlined at build time — app.getVersion() reports Electron's own version
// when launched unpackaged (e2e runs `electron out/main/index.js`).
import { version as APP_VERSION } from '../../package.json'

const isDev = !!process.env.ELECTRON_RENDERER_URL

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: 'Blockout',
    backgroundColor: '#111113',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true
    }
  })

  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
  if (process.platform === 'win32') app.setAppUserModelId(DISTRIBUTION.appId)
  createWindow()
  registerPresetsIpc()
  void startControlServer(() => mainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* --------------------------------- IPC ---------------------------------- */

ipcMain.handle('dialog:newProject', async () => {
  // Smoke-test hook: bypass the native dialog so CI can drive the app.
  if (process.env.BLOCKOUT_SMOKE_DIR) {
    const folder = join(process.env.BLOCKOUT_SMOKE_DIR, 'Smoke.blockout')
    await mkdir(join(folder, 'assets'), { recursive: true })
    await mkdir(join(folder, 'exports'), { recursive: true })
    return { folder, name: 'Smoke' }
  }
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create Blockout Project',
    buttonLabel: 'Create',
    nameFieldLabel: 'Project name',
    defaultPath: join(app.getPath('documents'), 'Untitled.blockout')
  })
  if (result.canceled || !result.filePath) return null
  const withoutExtension = result.filePath.replace(/\.blockout$/i, '')
  const name = sanitizeName(basename(withoutExtension))
  const folder = join(dirname(withoutExtension), `${name}.blockout`)
  await mkdir(folder, { recursive: true })
  await mkdir(join(folder, 'assets'), { recursive: true })
  await mkdir(join(folder, 'exports'), { recursive: true })
  return { folder, name }
})

ipcMain.handle('dialog:openProject', async () => {
  if (process.env.BLOCKOUT_SMOKE_DIR) {
    return join(process.env.BLOCKOUT_SMOKE_DIR, 'Smoke.blockout')
  }
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Blockout Project',
    properties: ['openDirectory'],
    message: 'Choose a .blockout project folder'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:pickFile', async (_e, filters: { name: string; extensions: string[] }[]) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('project:save', async (_e, folder: string, json: string) => {
  await mkdir(folder, { recursive: true })
  // Atomic-ish write: temp file then rename would be ideal; write+fsync is
  // acceptable here since autosave keeps a rolling backup too.
  await writeFile(join(folder, 'project.json'), json, 'utf-8')
  return true
})

ipcMain.handle('project:saveBackup', async (_e, folder: string, json: string) => {
  await mkdir(join(folder, '.autosave'), { recursive: true })
  await writeFile(join(folder, '.autosave', 'project.autosave.json'), json, 'utf-8')
  return true
})

ipcMain.handle('project:load', async (_e, folder: string) => {
  const main = join(folder, 'project.json')
  const backup = join(folder, '.autosave', 'project.autosave.json')
  const out: {
    json: string | null
    backupJson: string | null
    backupNewer: boolean
    folder: string
  } = { json: null, backupJson: null, backupNewer: false, folder }
  let mainTime = 0
  let backupTime = 0
  try {
    out.json = await readFile(main, 'utf-8')
    mainTime = (await stat(main)).mtimeMs
  } catch {}
  try {
    out.backupJson = await readFile(backup, 'utf-8')
    backupTime = (await stat(backup)).mtimeMs
  } catch {}
  // A meaningfully-newer autosave means the app died with unsaved work.
  out.backupNewer = backupTime > mainTime + 1500 && out.backupJson !== out.json
  return out
})

ipcMain.handle('project:importAsset', async (_e, folder: string, sourcePath: string) => {
  const assetsDir = join(folder, 'assets')
  await mkdir(assetsDir, { recursive: true })
  const sourceName = sanitizeName(basename(sourcePath))
  const name = sanitizeName(`${Date.now().toString(36)}-${sourceName}`)
  const dest = join(assetsDir, name)
  await copyFile(sourcePath, dest)
  return { relativePath: `assets/${name}`, name: sanitizeName(basename(sourcePath, extname(sourcePath))) }
})

// Copy an external Gaussian-splat / photogrammetry scan into the open
// project's scans/ folder. The scan stays with the project so it can be
// served over the relative-path bridge and travels with the .blockout folder.
ipcMain.handle('scan:import', async (_e, folder: string, sourcePath: string) => {
  const scansDir = join(folder, 'scans')
  await mkdir(scansDir, { recursive: true })
  const name = `${Date.now().toString(36)}-${basename(sourcePath)}`
  const dest = join(scansDir, name)
  await copyFile(sourcePath, dest)
  // Posix-style so the stored doc stays portable across macOS/Windows.
  return { relativePath: `scans/${name}`, name: basename(sourcePath, extname(sourcePath)) }
})

// Copy an external reference clip into the open project's refs/ folder. Used by
// the set_reference control action (Motion Previs Studio handoff) so a solved
// reference video lives alongside the project and can be served relative-path.
ipcMain.handle('project:importReference', async (_e, folder: string, sourcePath: string) => {
  const refsDir = join(folder, 'refs')
  await mkdir(refsDir, { recursive: true })
  const sourceName = sanitizeName(basename(sourcePath))
  const name = sanitizeName(`${Date.now().toString(36)}-${sourceName}`)
  const dest = join(refsDir, name)
  await copyFile(sourcePath, dest)
  return { relativePath: `refs/${name}`, name: sanitizeName(basename(sourcePath, extname(sourcePath))) }
})

ipcMain.handle('file:readAbsolute', async (_e, folder: string, relativePath: string) => {
  // Only serve files inside the project folder (resolve + separator check
  // so "/a/b" can't leak "/a/bad" and "../" can't escape).
  const portablePath = normalizeProjectRelativePath(relativePath)
  if (!portablePath) throw new Error('path must be relative to the project folder')
  const base = resolve(folder)
  const full = resolve(base, ...portablePath.split('/'))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('path escapes project folder')
  const data = await readFile(full)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
})

ipcMain.handle('shell:showFolder', async (_e, path: string) => {
  shell.showItemInFolder(path)
})

const EXTERNAL_LINK_ALLOWLIST = new Set(['wassermanproductions.com', 'wasserman.ai'])

ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^www\./, '')
  if (parsed.protocol !== 'https:' || !EXTERNAL_LINK_ALLOWLIST.has(host)) return false
  await shell.openExternal(url)
  return true
})

/* ------------------------------ export jobs ----------------------------- */

interface ExportJob {
  ffmpeg: ChildProcess
  /** Attached immediately after spawn so cancellation can await the real close event. */
  closed: Promise<void>
  outPath: string
  framesExpected: number
  framesReceived: number
  /** Set when ffmpeg dies or its stdin errors — writes must stop failing loudly, not crash. */
  dead: boolean
  deadReason: string
}

const jobs = new Map<string, ExportJob>()

ipcMain.handle(
  'export:begin',
  async (
    _e,
    jobId: string,
    outPath: string,
    opts: { fps: number; width: number; height: number; framesExpected: number }
  ) => {
    const ffmpegPath = await resolveFfmpeg()
    await mkdir(dirname(outPath), { recursive: true })
    // Raw RGBA in: byte-deterministic (no per-frame PNG encode) and fast.
    // WebGL readPixels is bottom-up, hence vflip.
    const args = [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${opts.width}x${opts.height}`,
      '-framerate', String(opts.fps),
      '-i', '-',
      '-vf', 'vflip',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outPath
    ]
    const child = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
    let stderrTail = ''
    child.stderr?.on('data', (d: Buffer) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000)
    })
    const job: ExportJob = {
      ffmpeg: child,
      closed,
      outPath,
      framesExpected: opts.framesExpected,
      framesReceived: 0,
      dead: false,
      deadReason: ''
    }
    jobs.set(jobId, job)
    // If ffmpeg exits or its pipe breaks mid-stream (disk full, encoder
    // error, missing binary), later writes would raise unhandled EPIPE and
    // take down the main process — absorb it and mark the job dead instead.
    child.stdin?.on('error', (err) => {
      job.dead = true
      job.deadReason = `encoder pipe error: ${String(err)}`
    })
    child.on('close', (code) => {
      job.dead = true
      job.deadReason = job.deadReason || `ffmpeg exited ${code}`
      mainWindow?.webContents.send('export:closed', jobId, code ?? -1, stderrTail || job.deadReason)
      jobs.delete(jobId)
    })
    child.on('error', (err) => {
      job.dead = true
      job.deadReason = friendlyFfmpegError(err)
    })
    return true
  }
)

ipcMain.handle('export:frame', async (_e, jobId: string, frame: ArrayBuffer) => {
  const job = jobs.get(jobId)
  if (!job) throw new Error(`no export job ${jobId}`)
  if (job.dead) throw new Error(job.deadReason || 'encoder terminated')
  job.framesReceived++
  const buf = Buffer.from(frame)
  const stdin = job.ffmpeg.stdin!
  if (!stdin.write(buf)) {
    // Wait for drain, but never hang if the pipe dies while parked.
    await new Promise<void>((resolve) => {
      const done = (): void => {
        stdin.removeListener('drain', done)
        stdin.removeListener('error', done)
        stdin.removeListener('close', done)
        resolve()
      }
      stdin.once('drain', done)
      stdin.once('error', done)
      stdin.once('close', done)
    })
    if (job.dead) throw new Error(job.deadReason || 'encoder terminated')
  }
  return true
})

ipcMain.handle('export:end', async (_e, jobId: string) => {
  const job = jobs.get(jobId)
  if (!job) return false
  job.ffmpeg.stdin?.end()
  return true
})

ipcMain.handle('export:cancel', async (_e, jobId: string) => {
  const job = jobs.get(jobId)
  if (!job) return false
  job.dead = true
  job.deadReason = 'cancelled'
  await terminateProcessTree(job.ffmpeg)
  await job.closed
  await rm(job.outPath, { force: true })
  return true
})

ipcMain.handle('export:writeFile', async (_e, path: string, data: ArrayBuffer | string) => {
  await mkdir(dirname(path), { recursive: true })
  if (typeof data === 'string') await writeFile(path, data, 'utf-8')
  else await writeFile(path, Buffer.from(data))
  return true
})

ipcMain.handle(
  'export:concat',
  async (_e, outPath: string, inputPaths: string[]) => {
    const ffmpegPath = await resolveFfmpeg()
    await mkdir(dirname(outPath), { recursive: true })
    const listPath = join(dirname(outPath), `.concat-${Date.now()}.txt`)
    const listBody = inputPaths.map(ffmpegConcatEntry).join('\n')
    await writeFile(listPath, listBody, 'utf-8')
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const child = spawn(ffmpegPath, [
        '-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath
      ], { windowsHide: true })
      let err = ''
      child.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)))
      child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err }))
      child.on('error', (e2) => resolve({ ok: false, error: friendlyFfmpegError(e2) }))
    })
    try {
      await rm(listPath)
    } catch {}
    return result
  }
)

/* ---------------------------- AI reference ------------------------------ */

ipcMain.handle('ai:analyzeReference', async (_e, filePath: string) => {
  const { analyzeReference } = await import('./analyze')
  return analyzeReference(filePath)
})

/* Smoke-test hook: allows Playwright to drive export without dialogs. */
ipcMain.handle('app:versions', () => ({
  app: APP_VERSION,
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  productName: app.getName()
}))
