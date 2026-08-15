/**
 * Singleton access to the live SceneManager, registered by the Viewport.
 * Lives outside Viewport.tsx so the exporter doesn't import React modules.
 */

import type { SceneManager } from '../viewport/SceneManager'

let live: SceneManager | null = null

export function registerSceneManager(manager: SceneManager | null): void {
  live = manager
}

export function getSceneManager(): SceneManager | null {
  return live
}

export type { SceneManager }
