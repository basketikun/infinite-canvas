/**
 * Minimal declarations for @mkkellogg/gaussian-splats-3d (MIT), which ships
 * no TypeScript types. Only the surface Blockout uses is declared: the
 * DropInViewer (a THREE.Group that renders splat scenes inside an existing
 * three.js scene) and the SceneFormat enum for loading blob URLs, where the
 * format can't be inferred from a file extension.
 */
declare module '@mkkellogg/gaussian-splats-3d' {
  import { Group } from 'three'

  export enum SceneFormat {
    Splat,
    KSplat,
    Ply,
    Spz
  }

  export interface DropInViewerOptions {
    gpuAcceleratedSort?: boolean
    sharedMemoryForWorkers?: boolean
    dynamicScene?: boolean
    freeIntermediateSplatData?: boolean
    [key: string]: unknown
  }

  export interface AddSplatSceneOptions {
    format?: SceneFormat
    showLoadingUI?: boolean
    splatAlphaRemovalThreshold?: number
    position?: [number, number, number]
    rotation?: [number, number, number, number]
    scale?: [number, number, number]
    [key: string]: unknown
  }

  export class DropInViewer extends Group {
    constructor(options?: DropInViewerOptions)
    addSplatScene(path: string, options?: AddSplatSceneOptions): PromiseLike<void>
    dispose(): Promise<void>
  }
}
