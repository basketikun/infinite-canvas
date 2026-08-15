import type { BlockoutAPI } from '../shared/blockout-api'

declare global {
  interface Window {
    blockout: BlockoutAPI
  }
}

export {}
