import { createWebBlockoutAdapter } from './web-adapter'
import { DIRECTOR_PROTOCOL } from './embed-bridge'
import { useStore } from '../renderer/store'

window.blockout = createWebBlockoutAdapter()

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return
  const message = event.data as { protocol?: unknown; type?: unknown; payload?: unknown }
  if (message.protocol !== DIRECTOR_PROTOCOL || message.type !== 'INIT') return

  const payload = message.payload && typeof message.payload === 'object' ? (message.payload as Record<string, unknown>) : {}
  const projectId = typeof payload.projectId === 'string' && payload.projectId ? payload.projectId : 'web-project'
  const projectName = typeof payload.projectName === 'string' && payload.projectName ? payload.projectName : 'Untitled Director'
  const state = useStore.getState()
  if (!state.doc) state.newProject(`director://${projectId}`, projectName)
})
