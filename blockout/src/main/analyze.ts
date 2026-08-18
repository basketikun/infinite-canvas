// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * Reference analysis: send a reference image (or a frame extracted from a
 * reference video) to Claude with vision + structured outputs, and get back
 * a scene layout in Blockout's own coordinate system — entities, poses,
 * labels, lighting, and a camera suggestion matching the reference framing.
 *
 * Runs in the Electron main process. Auth resolves from ANTHROPIC_API_KEY
 * or an `ant auth login` profile via the SDK's standard credential chain.
 */

import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'child_process'
import { readFile, mkdir, rm } from 'fs/promises'
import { join, extname } from 'path'
import { ASSET_CATALOG } from '../engine/assets'
import { resolveConfigPath } from '../shared/config-paths'
import { friendlyFfmpegError, resolveFfmpeg } from './ffmpeg'

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.avi'])
const MEDIA_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

export interface AnalyzedEntity {
  assetId: string
  x: number
  z: number
  rotationDeg: number
  pose: 'stand' | 'sit' | 'crouch' | 'lie' | 'gesture'
  label: string
  labelColor: string
  scale: number
}

export interface AnalyzedLayout {
  entities: AnalyzedEntity[]
  lighting: 'day' | 'goldenHour' | 'night' | 'interiorWarm' | 'interiorCool' | 'club'
  camera: { x: number; y: number; z: number; panDeg: number; tiltDeg: number; focalLength: number }
  notes: string
}

export type AnalyzeResult = { ok: true; layout: AnalyzedLayout } | { ok: false; error: string }

const ASSET_IDS = ASSET_CATALOG.map((a) => a.id)

const LAYOUT_SCHEMA = {
  type: 'object',
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          assetId: { type: 'string', enum: ASSET_IDS },
          x: { type: 'number' },
          z: { type: 'number' },
          rotationDeg: { type: 'number' },
          pose: { type: 'string', enum: ['stand', 'sit', 'crouch', 'lie', 'gesture'] },
          label: { type: 'string' },
          labelColor: {
            type: 'string',
            enum: ['', '#e5484d', '#f5a524', '#46a758', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f97316']
          },
          scale: { type: 'number' }
        },
        required: ['assetId', 'x', 'z', 'rotationDeg', 'pose', 'label', 'labelColor', 'scale'],
        additionalProperties: false
      }
    },
    lighting: {
      type: 'string',
      enum: ['day', 'goldenHour', 'night', 'interiorWarm', 'interiorCool', 'club']
    },
    camera: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' },
        panDeg: { type: 'number' },
        tiltDeg: { type: 'number' },
        focalLength: { type: 'number' }
      },
      required: ['x', 'y', 'z', 'panDeg', 'tiltDeg', 'focalLength'],
      additionalProperties: false
    },
    notes: { type: 'string' }
  },
  required: ['entities', 'lighting', 'camera', 'notes'],
  additionalProperties: false
} as const

function buildSystemPrompt(): string {
  const catalog = ASSET_CATALOG.map((a) => `${a.id} (${a.name}, ~${a.height}m tall)`).join('; ')
  return [
    'You are the scene-layout engine of Blockout, a film previs tool. You are shown one reference image from a film or photo. Reconstruct its staging as a 3D grey-box scene the filmmaker will refine.',
    '',
    'COORDINATE SYSTEM: meters, Y up, ground is the XZ plane, scene roughly centered on the origin. rotationDeg is yaw: 0 faces -Z, 90 faces -X, 180 faces +Z, 270 faces +X (counterclockwise seen from above). The camera: y is height above ground; panDeg uses the same yaw convention; tiltDeg positive looks up, negative looks down; focalLength in millimeters on a Super 35 sensor (24 = wide, 35 = normal, 50-85 = tight).',
    '',
    `ASSET CATALOG (use only these assetId values): ${catalog}`,
    '',
    'RULES:',
    '- Reproduce the SPATIAL ARRANGEMENT faithfully: relative positions, distances at real-world scale, facing directions, and who/what is where in the frame.',
    '- People seated get pose "sit" AND a chair (or couch/stool) placed under them; the chair is a separate entity.',
    '- Label the important subjects with short uppercase names (e.g. "MAN", "WOMAN", "HERO") and distinct labelColors; leave label as "" for set dressing. scale is 1 unless something is clearly over/undersized.',
    '- Pick the closest catalog asset for anything in frame; use env.* kits for the setting when one fits; use prim.* boxes for objects with no close match. Include significant set dressing (tables, lamps, candles→use prim.cylinder small scale) but do not exceed ~25 entities.',
    '- Place the CAMERA so a render from it reproduces the reference framing: subject sizes in frame, camera height, and lens feel (a compressed/flat perspective means a long lens far away; wide distortion means a short lens up close).',
    '- lighting: choose the closest preset. notes: 1-2 sentences telling the filmmaker what you staged and any compromises.'
  ].join('\n')
}

/** Extract a representative frame from a video via ffmpeg. */
async function extractFrame(videoPath: string): Promise<string> {
  const { app } = await import('electron')
  const dir = join(app.getPath('temp'), 'blockout-frames')
  await mkdir(dir, { recursive: true })
  const out = join(dir, `frame-${Date.now()}.jpg`)
  const ffmpegPath = await resolveFfmpeg()
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-y', '-ss', '1', '-i', videoPath, '-frames:v', '1', '-q:v', '3', out], {
      windowsHide: true
    })
    child.stderr?.resume()
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('FFmpeg could not extract a frame from the reference video. Check that the file is readable and uses a supported codec.'))
    })
    child.once('error', (error) => {
      reject(new Error(`Could not analyze the reference video: ${friendlyFfmpegError(error)}`))
    })
  })
  return out
}

/**
 * GUI apps do not necessarily inherit shell environment variables. Fallback:
 * a key file in Blockout's platform config directory. Returning undefined
 * lets the SDK try its own chain (env var when launched from a terminal,
 * or an `ant auth login` profile, which IS file-based and works from Finder).
 */
async function resolveApiKey(): Promise<string | undefined> {
  if (process.env.ANTHROPIC_API_KEY) return undefined // SDK reads it itself
  try {
    const key = (await readFile(resolveConfigPath('anthropic-api-key'), 'utf-8')).trim()
    return key || undefined
  } catch {
    return undefined
  }
}

const AUTH_HELP =
  'Claude API authentication failed. Either: (1) run `ant auth login` in a terminal, ' +
  `(2) save your key to ${resolveConfigPath('anthropic-api-key')}, or ` +
  '(3) launch Blockout from a terminal with ANTHROPIC_API_KEY set.'

export async function analyzeReference(filePath: string): Promise<AnalyzeResult> {
  let imagePath = filePath
  let extractedFrame: string | null = null
  try {
    const ext = extname(filePath).toLowerCase()
    if (VIDEO_EXTS.has(ext)) {
      extractedFrame = await extractFrame(filePath)
      imagePath = extractedFrame
    }
    const mediaType = MEDIA_TYPES[extname(imagePath).toLowerCase()]
    if (!mediaType) return { ok: false, error: `Unsupported file type: ${ext}` }

    const bytes = await readFile(imagePath)
    if (bytes.byteLength > 20 * 1024 * 1024) {
      return { ok: false, error: 'Image is larger than 20MB — please use a smaller reference.' }
    }
    const data = bytes.toString('base64')

    const client = new Anthropic({ apiKey: await resolveApiKey() })
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: buildSystemPrompt(),
      output_config: { format: { type: 'json_schema', schema: LAYOUT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType as 'image/jpeg', data }
            },
            {
              type: 'text',
              text: 'Reconstruct this reference as a Blockout scene layout. Match the staging and camera framing.'
            }
          ]
        }
      ]
    })

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'The model declined to analyze this image.' }
    }
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') {
      return { ok: false, error: 'No layout returned — try a clearer reference image.' }
    }
    const layout = JSON.parse(text.text) as AnalyzedLayout
    if (!Array.isArray(layout.entities) || layout.entities.length === 0) {
      return { ok: false, error: 'The model found nothing stageable in this reference.' }
    }
    return { ok: true, layout }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: AUTH_HELP }
    }
    // SDK throws a plain Error before any request when no credential resolves.
    if (e instanceof Error && /apiKey|api key|ANTHROPIC_API_KEY/i.test(e.message)) {
      return { ok: false, error: AUTH_HELP }
    }
    if (e instanceof Anthropic.APIError) {
      return { ok: false, error: `Claude API error: ${e.message}` }
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    if (extractedFrame) {
      try {
        await rm(extractedFrame)
      } catch {}
    }
  }
}
