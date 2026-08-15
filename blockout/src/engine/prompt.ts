/**
 * Prompt generation, v5: a SHORT, paste-ready prompt. The reference video
 * carries all the choreography — the prompt's job is only to say "use this
 * strictly as a motion reference" (character blocking + camera move/tracking),
 * name the subjects and setting in one breath, and get out of the user's way
 * so they can add their own style and world on top. No mark-by-mark
 * choreography, no timing tables — that detail lives in the video itself
 * (and in metadata.json for tools that want it).
 */

import { assetSpec } from './assets'
import type { GeneratorProfile } from './profiles'
import type { LightingPresetId, Scene, Shot } from './types'

const LIGHTING_WORDS: Record<LightingPresetId, string> = {
  day: 'soft daylight',
  goldenHour: 'warm golden-hour light',
  night: 'night, cool moonlit ambience',
  interiorWarm: 'warm interior lighting',
  interiorCool: 'cool interior lighting',
  club: 'dark nightclub with colored moving lights',
  middaySky: 'bright midday sky, clear blue atmosphere',
  goldenHourSky: 'golden-hour sky, low warm sun',
  blueHourSky: 'blue-hour twilight sky, deep dusk tones'
}

export function generatePrompt(scene: Scene, shot: Shot, profile: GeneratorProfile): string {
  const lines: string[] = []
  const marks = [...shot.camera.marks].sort((a, b) => a.time - b.time)
  const lens = Math.round(marks[0]?.focalLength ?? 35)

  // One short look line.
  lines.push(
    `Cinematic shot, ${lens}mm lens, ${shot.aspect}, ${LIGHTING_WORDS[scene.environment.lighting]}.`
  )

  // Subjects in one breath — names/labels only, no movement narration (the
  // reference video shows the movement).
  const take = scene.blocking.find((b) => b.id === shot.blockingTakeId) ?? scene.blocking[0]
  const notable = scene.entities.filter((e) => {
    const cat = assetSpec(e.assetId).category
    const moves = take?.tracks.some((tr) => tr.entityId === e.id && tr.marks.length > 0)
    return (
      moves || e.label || cat === 'people' || cat === 'vehicles' || cat === 'animals'
    )
  })
  if (notable.length > 0) {
    const names = notable.map((e) => {
      const noun = assetSpec(e.assetId).promptNoun
      return e.label ? `${noun} ("${e.label.text}")` : noun
    })
    lines.push(`Subjects: ${[...new Set(names)].join(', ')}.`)
  }

  const envEntities = scene.entities.filter((e) => assetSpec(e.assetId).category === 'environment')
  if (envEntities.length > 0) {
    const envWords = [...new Set(envEntities.map((e) => assetSpec(e.assetId).promptNoun))]
    lines.push(`Setting: ${envWords.join(', ')}.`)
  }

  // The core instruction. Video-reference generators get the simple
  // motion-reference directive; image-only profiles keep their own clause.
  if (profile.refModes.includes('referenceVideo')) {
    lines.push(
      'Use the attached video strictly as a motion reference: match the character blocking and movement, and the camera blocking, movement, and tracking, exactly as shown. The grey figures are placeholders — replace them with the real subjects and world while keeping every move the same.'
    )
  } else {
    lines.push(profile.adherenceClause)
  }

  return lines.join('\n\n')
}
