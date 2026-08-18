export type DirectorResourceKind = 'image' | 'video' | 'audio' | 'text'

export type DirectorUpstreamResource = {
  nodeId: string
  title: string
  resource: {
    kind: DirectorResourceKind
    text?: string
    url?: string
  }
}

let resources: DirectorUpstreamResource[] = []
const listeners = new Set<() => void>()

function isResource(value: unknown): value is DirectorUpstreamResource {
  if (!value || typeof value !== 'object') return false
  const item = value as { nodeId?: unknown; title?: unknown; resource?: unknown }
  if (typeof item.nodeId !== 'string' || typeof item.title !== 'string' || !item.resource || typeof item.resource !== 'object') return false
  const resource = item.resource as { kind?: unknown; text?: unknown; url?: unknown }
  return ['image', 'video', 'audio', 'text'].includes(String(resource.kind)) &&
    (resource.text === undefined || typeof resource.text === 'string') &&
    (resource.url === undefined || typeof resource.url === 'string')
}

export function setDirectorResources(next: unknown): void {
  resources = Array.isArray(next) ? next.filter(isResource) : []
  listeners.forEach((listener) => listener())
}

export function getDirectorResources(): DirectorUpstreamResource[] {
  return resources
}

export function subscribeDirectorResources(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
