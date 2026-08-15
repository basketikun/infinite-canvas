import { useSyncExternalStore } from 'react'
import { getDirectorResources, subscribeDirectorResources, type DirectorUpstreamResource } from '../../web/director-bridge-state'

const IS_EMBEDDED = window.parent !== window

function kindLabel(kind: DirectorUpstreamResource['resource']['kind']): string {
  if (kind === 'image') return 'IMAGE'
  if (kind === 'video') return 'VIDEO'
  if (kind === 'text') return 'BRIEF'
  return 'AUDIO'
}

function ReferenceCard({ item }: { item: DirectorUpstreamResource }): JSX.Element {
  const { resource } = item
  return (
    <article className="reference-card">
      <div className="reference-preview">
        {resource.kind === 'image' && resource.url ? <img src={resource.url} alt={item.title} /> : null}
        {resource.kind === 'video' && resource.url ? <video src={resource.url} muted playsInline preload="metadata" /> : null}
        {resource.kind === 'text' ? <span>✎</span> : null}
        {!resource.url && resource.kind !== 'text' ? <span>◇</span> : null}
      </div>
      <div className="reference-copy">
        <span className="reference-kind">{kindLabel(resource.kind)}</span>
        <strong title={item.title}>{item.title}</strong>
        {resource.kind === 'text' && resource.text ? <p>{resource.text}</p> : null}
      </div>
    </article>
  )
}

export function ReferenceDock(): JSX.Element | null {
  const resources = useSyncExternalStore(subscribeDirectorResources, getDirectorResources, getDirectorResources)
  if (!IS_EMBEDDED) return null

  return (
    <section className="reference-dock" aria-label="Director references">
      <div className="reference-dock-heading">
        <span>REFERENCES</span>
        <span className="reference-count">{resources.length}</span>
      </div>
      {resources.length ? (
        <div className="reference-list">{resources.map((item) => <ReferenceCard key={item.nodeId} item={item} />)}</div>
      ) : (
        <p className="reference-empty">Connect an image, video, or text node to use it as a reference.</p>
      )}
    </section>
  )
}
