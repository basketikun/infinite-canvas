export const DIRECTOR_PROTOCOL = 'infinite-canvas-director-v1' as const

export interface DirectorMessage {
  protocol: typeof DIRECTOR_PROTOCOL
  requestId?: string
  type: string
  payload?: unknown
  error?: string
}

type Listener = (payload: unknown, message: DirectorMessage) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: number
}

function requestId(): string {
  const random = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `blockout-${Date.now().toString(36)}-${random}`
}

function parentOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*'
  } catch {
    return '*'
  }
}

function isDirectorMessage(value: unknown): value is DirectorMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<DirectorMessage>
  return message.protocol === DIRECTOR_PROTOCOL && typeof message.type === 'string'
}

export class EmbedBridge {
  private readonly target: Window
  private readonly targetOrigin: string
  private readonly pending = new Map<string, PendingRequest>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (this.target !== window && event.source !== this.target) return
    if (!isDirectorMessage(event.data)) return

    const message = event.data
    if (message.requestId) {
      const pending = this.pending.get(message.requestId)
      if (pending) {
        window.clearTimeout(pending.timer)
        this.pending.delete(message.requestId)
        if (message.error) pending.reject(new Error(message.error))
        else pending.resolve(message.payload)
      }
    }

    this.listeners.get(message.type)?.forEach((listener) => listener(message.payload, message))
  }

  constructor(target: Window = window.parent) {
    this.target = target
    this.targetOrigin = parentOrigin()
    window.addEventListener('message', this.onMessage)
  }

  request<T>(type: string, payload?: unknown, timeoutMs = 15_000): Promise<T> {
    const id = requestId()
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Director Bridge request timed out: ${type}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      this.target.postMessage({ protocol: DIRECTOR_PROTOCOL, requestId: id, type, payload }, this.targetOrigin)
    })
  }

  notify(type: string, payload?: unknown): void {
    this.target.postMessage({ protocol: DIRECTOR_PROTOCOL, type, payload }, this.targetOrigin)
  }

  on(type: string, listener: Listener): () => void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(type)
    }
  }

  dispose(): void {
    window.removeEventListener('message', this.onMessage)
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer)
      pending.reject(new Error('Director Bridge disposed'))
    })
    this.pending.clear()
    this.listeners.clear()
  }
}
