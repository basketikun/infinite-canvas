import { createWebBlockoutAdapter } from './web-adapter'
import { DIRECTOR_PROTOCOL } from './embed-bridge'
import { currentProjectJson, useStore } from '../renderer/store'
import { setDirectorResources } from './director-bridge-state'
import { setBlockoutLocale } from '../renderer/i18n'

window.blockout = createWebBlockoutAdapter()

let initializing = false
let summaryTimer: number | null = null

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback
}

function applyDirectorTheme(payload: unknown): void {
  const root = document.documentElement
  const bridge = record(payload)
  const theme = record(bridge.theme)
  const canvas = record(theme.canvas)
  const node = record(theme.node)
  const toolbar = record(theme.toolbar)
  const mode = theme.mode === 'dark' ? 'dark' : 'light'
  const set = (name: string, value: unknown, fallback: string): void => {
    root.style.setProperty(name, stringValue(value, fallback))
  }

  root.dataset.theme = mode
  set('--bg', canvas.background, mode === 'dark' ? '#181715' : '#f4f2ed')
  set('--bg-panel', node.panel, mode === 'dark' ? '#1f1d1a' : '#fbfaf7')
  set('--bg-raised', node.fill, mode === 'dark' ? '#292524' : '#e7e5df')
  set('--bg-hover', toolbar.itemHover, mode === 'dark' ? '#3a3631' : '#efede8')
  set('--border', node.stroke, mode === 'dark' ? '#44403c' : '#d6d3ca')
  set('--border-strong', toolbar.border, mode === 'dark' ? '#57534e' : '#c8c3b8')
  set('--text', node.text, mode === 'dark' ? '#f5f5f4' : '#292524')
  set('--text-dim', node.muted, mode === 'dark' ? '#d6d3d1' : '#57534e')
  set('--text-faint', node.faint, mode === 'dark' ? '#78716c' : '#a8a29e')
  set('--viewport-grid', canvas.line, mode === 'dark' ? 'rgba(245,245,244,.10)' : 'rgba(68,64,60,.12)')
  set('--viewport-chrome', 'color-mix(in srgb, var(--bg-panel) 94%, transparent)', 'rgba(17,17,19,.86)')
  set('--viewport-chrome-border', 'color-mix(in srgb, var(--border-strong) 86%, transparent)', 'var(--border)')
  set('--viewport-chrome-hover', 'color-mix(in srgb, var(--bg-hover) 92%, transparent)', 'var(--bg-hover)')
  set('--viewport-chrome-shadow', mode === 'dark' ? '0 10px 28px rgba(0,0,0,.30)' : '0 10px 28px rgba(41,37,36,.14)', '0 10px 28px rgba(0,0,0,.28)')
  set('--accent-soft', mode === 'dark' ? 'rgba(245,165,36,.12)' : 'rgba(180,112,13,.12)', 'rgba(245,165,36,.12)')
}

function publishProjectSummary(): void {
  const state = useStore.getState()
  const scene = state.scene()
  const shot = state.shot()
  const focalLength = shot?.camera.marks.length ? shot.camera.marks[shot.camera.marks.length - 1]?.focalLength : 35
  window.blockout.notifyProjectSummary({
    sceneName: scene?.name ?? '',
    shotName: shot?.name ?? '',
    duration: shot?.duration ?? 0,
    fps: shot?.fps ?? 0,
    focalLength: Number.isFinite(focalLength) ? focalLength : 35,
    entityCount: scene?.entities.length ?? 0
  })
}

function scheduleProjectSummary(): void {
  if (summaryTimer !== null) window.clearTimeout(summaryTimer)
  summaryTimer = window.setTimeout(() => {
    summaryTimer = null
    publishProjectSummary()
  }, 500)
}

useStore.subscribe(scheduleProjectSummary)

async function initializeDirectorProject(payload: Record<string, unknown>): Promise<void> {
  if (initializing) return

  const projectId = typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : 'web-project'
  const projectName = typeof payload.projectName === 'string' && payload.projectName ? payload.projectName : 'Untitled Director'
  const folder = `director://${projectId}`
  const existing = useStore.getState()
  if (existing.doc && existing.projectFolder === folder) return

  initializing = true
  try {
    const { json, backupJson, backupNewer } = await window.blockout.loadProject(folder)
    const loadFromJson = useStore.getState().loadFromJson

    if (backupNewer && backupJson && loadFromJson(folder, backupJson)) {
      useStore.getState().toast('已从自动保存备份恢复未保存内容——点击“保存”以保留。', 'success')
      return
    }
    if (json && loadFromJson(folder, json)) return
    if (backupJson && loadFromJson(folder, backupJson)) {
      useStore.getState().toast('已从自动保存备份恢复。', 'success')
      return
    }

    useStore.getState().newProject(folder, projectName)
    const createdJson = currentProjectJson()
    if (createdJson && (await window.blockout.saveProject(folder, createdJson))) {
      useStore.getState().markSaved()
    }
  } catch (error) {
    console.error('[blockout-web] failed to initialize Director project', error)
    if (!useStore.getState().doc) useStore.getState().newProject(folder, projectName)
  } finally {
    initializing = false
    scheduleProjectSummary()
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return
  const message = event.data as { protocol?: unknown; type?: unknown; payload?: unknown }
  if (message.protocol !== DIRECTOR_PROTOCOL) return

  const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
  if (message.type === 'THEME_UPDATE') {
    setBlockoutLocale(payload.locale)
    applyDirectorTheme(payload.theme)
    return
  }
  if (message.type !== 'INIT') return

  setBlockoutLocale(payload.locale)
  applyDirectorTheme(payload.theme)
  setDirectorResources(payload.upstream)
  void initializeDirectorProject(payload)
})
