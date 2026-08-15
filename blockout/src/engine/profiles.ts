/**
 * Generator profiles — data, not code. Each profile describes how a target
 * AI generator consumes references and constrains exports (duration,
 * resolution), plus prompt guidance. Updating a model is a config edit.
 * Users can add profiles as JSON in the project's profiles/ folder.
 */

import type { AspectId } from './types'

export type RefMode = 'firstFrame' | 'lastFrame' | 'referenceVideo' | 'depthVideo' | 'stills'

export interface GeneratorProfile {
  id: string
  name: string
  vendor: string
  kind: 'video' | 'image'
  /** Hard per-clip duration cap in seconds (video models). */
  maxDuration?: number
  recommendedDuration?: number
  aspects: AspectId[]
  /** Export resolution (longest edge) that suits the model. */
  exportWidth: number
  fps: number
  /** Which reference inputs the model consumes, in priority order. */
  refModes: RefMode[]
  /** Sentence explaining how to attach the reference, shown in Deliver. */
  attachHint: string
  /** Extra prompt clause instructing the model to follow the reference. */
  adherenceClause: string
}

export const BUILTIN_PROFILES: GeneratorProfile[] = [
  {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    vendor: 'ByteDance',
    kind: 'video',
    maxDuration: 10,
    recommendedDuration: 5,
    aspects: ['16:9', '9:16', '4:3', '1:1'],
    exportWidth: 1920,
    fps: 24,
    refModes: ['referenceVideo', 'firstFrame'],
    attachHint:
      'Attach the reference MP4 as the motion/video reference and the first-frame still as the image reference.',
    adherenceClause:
      'Precisely match the camera movement, framing, and subject blocking of the attached reference video. Keep subject positions, screen direction, and timing identical to the reference.'
  },
  {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    vendor: 'Google',
    kind: 'video',
    maxDuration: 8,
    recommendedDuration: 8,
    aspects: ['16:9', '9:16'],
    exportWidth: 1920,
    fps: 24,
    refModes: ['firstFrame', 'referenceVideo'],
    attachHint: 'Use the first-frame still as the image input; describe the camera move in the prompt.',
    adherenceClause:
      'Follow the exact camera move and subject blocking described below, matching the attached reference frame composition at the start.'
  },
  {
    id: 'kling-2',
    name: 'Kling 2.x',
    vendor: 'Kuaishou',
    kind: 'video',
    maxDuration: 10,
    recommendedDuration: 5,
    aspects: ['16:9', '9:16', '1:1'],
    exportWidth: 1920,
    fps: 24,
    refModes: ['firstFrame', 'lastFrame', 'referenceVideo'],
    attachHint:
      'Use first-frame and last-frame stills as start/end frames; the reference video guides motion where supported.',
    adherenceClause:
      'Animate from the attached start frame to the attached end frame, matching the camera move and subject motion of the reference exactly.'
  },
  {
    id: 'ltx-2.3',
    name: 'LTX 2.3',
    vendor: 'Lightricks',
    kind: 'video',
    maxDuration: 10,
    recommendedDuration: 6,
    aspects: ['16:9', '9:16', '1:1'],
    exportWidth: 1280,
    fps: 24,
    refModes: ['depthVideo', 'referenceVideo', 'firstFrame'],
    attachHint:
      'Use the depth-pass MP4 as a depth/structure conditioning video (ComfyUI workflow included in the export).',
    adherenceClause:
      'Adhere to the depth-video structure: camera trajectory, subject silhouettes, and motion timing must match the conditioning video.'
  },
  {
    id: 'wan-2.2',
    name: 'Wan 2.2',
    vendor: 'Alibaba',
    kind: 'video',
    maxDuration: 8,
    recommendedDuration: 5,
    aspects: ['16:9', '9:16', '1:1'],
    exportWidth: 1280,
    fps: 16,
    refModes: ['depthVideo', 'referenceVideo', 'firstFrame'],
    attachHint:
      'Use the depth or reference video as VACE/control input in ComfyUI (workflow included in the export).',
    adherenceClause:
      'Match the control video: identical camera path, subject blocking, and motion timing.'
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    vendor: 'OpenAI',
    kind: 'image',
    aspects: ['16:9', '9:16', '4:3', '1:1'],
    exportWidth: 1536,
    fps: 24,
    refModes: ['stills'],
    attachHint: 'Attach the mark stills and top-down diagram as image references for composition.',
    adherenceClause:
      'Match the composition, lens feel, and subject placement of the attached reference still exactly.'
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    vendor: 'Google',
    kind: 'image',
    aspects: ['16:9', '9:16', '4:3', '1:1'],
    exportWidth: 1536,
    fps: 24,
    refModes: ['stills'],
    attachHint: 'Attach a mark still as the composition reference.',
    adherenceClause: 'Keep the exact framing and subject placement of the attached reference image.'
  },
  {
    id: 'ideogram',
    name: 'Ideogram',
    vendor: 'Ideogram',
    kind: 'image',
    aspects: ['16:9', '9:16', '4:3', '1:1'],
    exportWidth: 1536,
    fps: 24,
    refModes: ['stills'],
    attachHint: 'Attach a mark still as a style/composition reference.',
    adherenceClause: 'Match the composition of the reference image.'
  },
  {
    id: 'krea-2',
    name: 'Krea 2',
    vendor: 'Krea',
    kind: 'image',
    aspects: ['16:9', '9:16', '4:3', '1:1'],
    exportWidth: 1536,
    fps: 24,
    refModes: ['stills'],
    attachHint: 'Use a mark still as the image reference with high adherence strength.',
    adherenceClause: 'Match the reference composition and subject placement.'
  }
]

export function getProfile(id: string, extra: GeneratorProfile[] = []): GeneratorProfile {
  return (
    extra.find((p) => p.id === id) ??
    BUILTIN_PROFILES.find((p) => p.id === id) ??
    BUILTIN_PROFILES[0]!
  )
}
