import { createWebBlockoutAdapter } from './web-adapter'
import { DIRECTOR_PROTOCOL } from './embed-bridge'
import { currentProjectJson, useStore } from '../renderer/store'
import { setDirectorResources } from './director-bridge-state'

window.blockout = createWebBlockoutAdapter()

let initializing = false
let summaryTimer: number | null = null

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
      useStore.getState().toast('Restored unsaved work from the autosave backup — Save to keep it.', 'success')
      return
    }
    if (json && loadFromJson(folder, json)) return
    if (backupJson && loadFromJson(folder, backupJson)) {
      useStore.getState().toast('Recovered from autosave backup.', 'success')
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
  if (message.protocol !== DIRECTOR_PROTOCOL || message.type !== 'INIT') return

  const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
  setDirectorResources(payload.upstream)
  void initializeDirectorProject(payload)
})
