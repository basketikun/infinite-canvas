import { describe, expect, it } from 'vitest'
import {
  createProject,
  createScene,
  createEntity,
  serializeProject,
  parseProject,
  validateProject
} from '@engine/schema'
import { generatePrompt } from '@engine/prompt'
import { getProfile, BUILTIN_PROFILES } from '@engine/profiles'
import { createActorMark, createCameraMark } from '@engine/schema'

describe('schema round-trip', () => {
  it('serialize → parse reproduces the document exactly', () => {
    const doc = createProject('Roundtrip')
    const scene = doc.scenes[0]!
    const man = createEntity('person.man', 'Man', { x: 1, y: 0, z: -2 })
    man.label = { text: 'HERO', color: '#e5484d' }
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [createActorMark({ x: 1, y: 0, z: -2 }, 0), createActorMark({ x: 4, y: 0, z: -8 }, 3, 'run')]
    })
    scene.shots[0]!.camera.marks.push(createCameraMark({ x: 5, y: 1.6, z: 2 }, 0, 0.3, -0.05, 50))

    const json = serializeProject(doc)
    const { doc: parsed, issues } = parseProject(json)
    expect(issues).toEqual([])
    expect(parsed).toEqual(doc)
  })

  it('serialization is byte-stable regardless of key insertion order', () => {
    const doc = createProject('Stable')
    const a = serializeProject(doc)
    // Shuffle top-level keys by rebuilding the object in a different order.
    const shuffled = JSON.parse(JSON.stringify({ scenes: doc.scenes, version: doc.version, settings: doc.settings, name: doc.name, id: doc.id }))
    const b = serializeProject(shuffled)
    expect(a).toBe(b)
  })

  it('rejects invalid JSON and wrong versions', () => {
    expect(parseProject('not json').doc).toBeNull()
    expect(parseProject('{"version": 99, "name": "x", "scenes": []}').doc).toBeNull()
  })

  it('migrates scans: missing → [], malformed refs dropped, defaults filled', () => {
    const doc = createProject('Scans')
    const json = JSON.parse(serializeProject(doc)) as Record<string, unknown>
    const scene = (json.scenes as Record<string, unknown>[])[0]!
    // A v1 document has no scans key at all.
    delete scene.scans
    const v1 = parseProject(JSON.stringify(json))
    expect(v1.doc?.scenes[0]?.scans).toEqual([])

    // Malformed entries are dropped; partial entries get safe defaults.
    scene.scans = [
      null,
      42,
      { id: 'scan_x' }, // no file → dropped
      { file: 'scans/loft.splat', position: { x: 1 } } // partial → defaults
    ]
    const v2 = parseProject(JSON.stringify(json))
    const scans = v2.doc?.scenes[0]?.scans
    expect(scans).toHaveLength(1)
    expect(scans?.[0]).toMatchObject({
      file: 'scans/loft.splat',
      position: { x: 1, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
      visible: true
    })
  })

  it('flags a shot referencing a missing blocking take', () => {
    const doc = createProject('Bad')
    doc.scenes[0]!.shots[0]!.blockingTakeId = 'take_missing'
    const issues = validateProject(JSON.parse(serializeProject(doc)))
    expect(issues.some((i) => i.message.includes('blocking take'))).toBe(true)
  })

  it('new scenes come with a master take and one shot', () => {
    const scene = createScene(3)
    expect(scene.blocking.length).toBe(1)
    expect(scene.shots.length).toBe(1)
    expect(scene.shots[0]!.name).toBe('3A')
    expect(scene.shots[0]!.blockingTakeId).toBe(scene.blocking[0]!.id)
  })
})

describe('prompt generation', () => {
  function promptFixture() {
    const doc = createProject('Prompt')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    man.label = { text: 'THIEF', color: '#e5484d' }
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [
        createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk'),
        createActorMark({ x: 0, y: 0, z: -8 }, 3, 'run')
      ]
    })
    shot.camera.marks.push(
      createCameraMark({ x: 4, y: 1.6, z: 4 }, 0, 0, 0, 35),
      createCameraMark({ x: 4, y: 1.6, z: -4 }, 5, 0, 0, 85)
    )
    return { scene, shot }
  }

  it('v5: short prompt with lens, label, and the motion-reference directive', () => {
    const { scene, shot } = promptFixture()
    const profile = getProfile('seedance-2')
    const prompt = generatePrompt(scene, shot, profile)
    expect(prompt).toContain('35mm')
    expect(prompt).toContain('THIEF')
    expect(prompt).toContain('strictly as a motion reference')
    // No choreography dump — the reference video carries the detail.
    expect(prompt).not.toContain('3s')
    expect(prompt.toLowerCase()).not.toContain('zooms in')
    expect(prompt.length).toBeLessThan(600)
  })

  it('every builtin profile produces a non-empty prompt', () => {
    const { scene, shot } = promptFixture()
    for (const p of BUILTIN_PROFILES) {
      const prompt = generatePrompt(scene, shot, p)
      expect(prompt.length).toBeGreaterThan(100)
    }
  })

  it('unknown profile ids fall back to the first builtin', () => {
    expect(getProfile('nope').id).toBe(BUILTIN_PROFILES[0]!.id)
  })
})
