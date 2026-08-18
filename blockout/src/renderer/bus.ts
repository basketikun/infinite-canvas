/**
 * Tiny typed event bus for UI → viewport commands (auto-framing, lens
 * changes) that need the live 3D context and don't belong in the document.
 */

import type { ShotSizeId } from '@engine/types'

export type FramingKind = '2S' | 'OTS' | 'REV' | 'TOP' | 'LOW' | 'DUTCH'

export interface BusEvents {
  /** Reframe the shot camera to a shot size on the selected subject. */
  frameSubject: { size: ShotSizeId }
  /** One-click cinematography framings (two-shot, over-the-shoulder, …). */
  applyFraming: { kind: FramingKind }
  /** Set the live camera focal length (updates current/last camera mark). */
  setLens: { focalLength: number }
  /** Point the free viewport camera at the current selection. */
  focusSelection: Record<string, never>
  /** Drop a camera mark at the current live camera pose. */
  dropCameraMarkAtView: Record<string, never>
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

const handlers = new Map<keyof BusEvents, Set<Handler<never>>>()

export function on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
  let set = handlers.get(event)
  if (!set) {
    set = new Set()
    handlers.set(event, set)
  }
  set.add(handler as Handler<never>)
  return () => set!.delete(handler as Handler<never>)
}

export function emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
  handlers.get(event)?.forEach((h) => (h as Handler<K>)(payload))
}
