/**
 * Scenes & Shots tree at the top of the left panel. Add / rename / duplicate /
 * delete scenes and shots. Only the current scene expands to show its shots.
 */

import { useState } from 'react'
import type { Scene, Shot } from '@engine/types'
import { newId } from '@engine/ids'
import { useStore } from '../store'

/** Deep-clone a shot with fresh ids for the shot and every camera mark. */
function cloneShot(shot: Shot, name: string): Shot {
  const copy = structuredClone(shot)
  copy.id = newId('shot')
  copy.name = name
  for (const mark of copy.camera.marks) mark.id = newId('cmark')
  return copy
}

interface RenameState {
  kind: 'scene' | 'shot'
  id: string
  value: string
}

export function ProjectRail(): JSX.Element {
  const doc = useStore((s) => s.doc)
  const sceneId = useStore((s) => s.sceneId)
  const shotId = useStore((s) => s.shotId)
  const selectScene = useStore((s) => s.selectScene)
  const selectShot = useStore((s) => s.selectShot)
  const addSceneAfter = useStore((s) => s.addSceneAfter)
  const addShotToScene = useStore((s) => s.addShotToScene)
  const mutate = useStore((s) => s.mutate)
  const toast = useStore((s) => s.toast)
  const saveDraftOfShot = useStore((s) => s.saveDraftOfShot)
  const promoteDraft = useStore((s) => s.promoteDraft)
  const deleteDraft = useStore((s) => s.deleteDraft)

  const [rename, setRename] = useState<RenameState | null>(null)

  if (!doc) return <div className="panel-section" />

  const commitRename = (): void => {
    if (!rename) return
    const { kind, id, value } = rename
    const text = value.trim()
    if (text) {
      mutate('rename', (d) => {
        for (const scene of d.scenes) {
          if (kind === 'scene' && scene.id === id) {
            scene.name = text
            return
          }
          if (kind === 'shot') {
            const shot = scene.shots.find((sh) => sh.id === id)
            if (shot) {
              shot.name = text
              return
            }
          }
        }
      })
    }
    setRename(null)
  }

  const deleteScene = (scene: Scene): void => {
    if (doc.scenes.length <= 1) {
      toast('A project needs at least one scene.', 'error')
      return
    }
    const wasCurrent = scene.id === sceneId
    const nextSceneId = doc.scenes.find((s) => s.id !== scene.id)?.id ?? null
    mutate('delete scene', (d) => {
      d.scenes = d.scenes.filter((s) => s.id !== scene.id)
    })
    if (wasCurrent && nextSceneId) selectScene(nextSceneId)
  }

  const duplicateShot = (scene: Scene, shot: Shot): void => {
    const letter = String.fromCharCode(65 + (scene.shots.length % 26))
    const name = `${scene.number}${letter}`
    const copy = cloneShot(shot, name)
    mutate('duplicate shot', (d) => {
      const target = d.scenes.find((s) => s.id === scene.id)
      if (!target) return
      const idx = target.shots.findIndex((s) => s.id === shot.id)
      target.shots.splice(idx + 1, 0, copy)
    })
    selectShot(copy.id)
  }

  const deleteShot = (scene: Scene, shot: Shot): void => {
    if (scene.shots.length <= 1) {
      toast('A scene needs at least one shot.', 'error')
      return
    }
    const wasCurrent = shot.id === shotId
    const remainingId = scene.shots.find((s) => s.id !== shot.id)?.id ?? null
    mutate('delete shot', (d) => {
      const target = d.scenes.find((s) => s.id === scene.id)
      if (!target) return
      target.shots = target.shots.filter((s) => s.id !== shot.id)
      // A deleted shot takes its draft versions with it.
      target.drafts = target.drafts?.filter((dr) => dr.draftOf !== shot.id)
    })
    if (wasCurrent && remainingId) selectShot(remainingId)
  }

  return (
    <div className="panel-section">
      <div className="rail-header">
        <div className="panel-title" style={{ marginBottom: 0 }}>
          Scenes &amp; Shots
        </div>
        <button className="btn small" onClick={() => addSceneAfter()}>
          + Scene
        </button>
      </div>

      {doc.scenes.map((scene) => {
        const isCurrentScene = scene.id === sceneId
        const renamingScene =
          rename?.kind === 'scene' && rename.id === scene.id ? rename : null
        return (
          <div className="rail-scene" key={scene.id}>
            <div
              className={`rail-scene-header${isCurrentScene ? ' active' : ''}`}
              onClick={() => selectScene(scene.id)}
              onDoubleClick={() =>
                setRename({ kind: 'scene', id: scene.id, value: scene.name })
              }
            >
              {renamingScene ? (
                <input
                  type="text"
                  autoFocus
                  value={renamingScene.value}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setRename({ kind: 'scene', id: scene.id, value: e.target.value })
                  }
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    else if (e.key === 'Escape') setRename(null)
                  }}
                />
              ) : (
                <>
                  <span className="rail-label">
                    Scene {scene.number} — {scene.name}
                  </span>
                  <span className="rail-actions">
                    <button
                      className="rail-btn"
                      title="Add shot"
                      onClick={(e) => {
                        e.stopPropagation()
                        addShotToScene(scene.id)
                      }}
                    >
                      +
                    </button>
                    <button
                      className="rail-btn"
                      title="Delete scene"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteScene(scene)
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </div>

            {isCurrentScene &&
              scene.shots.map((shot) => {
                const isCurrentShot = shot.id === shotId
                const renamingShot =
                  rename?.kind === 'shot' && rename.id === shot.id ? rename : null
                const drafts = (scene.drafts ?? []).filter((d) => d.draftOf === shot.id)
                return (
                  <div key={shot.id}>
                    <div
                      className={`rail-shot${isCurrentShot ? ' active' : ''}`}
                      onClick={() => selectShot(shot.id)}
                      onDoubleClick={() =>
                        setRename({ kind: 'shot', id: shot.id, value: shot.name })
                      }
                    >
                      {renamingShot ? (
                        <input
                          type="text"
                          autoFocus
                          value={renamingShot.value}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            setRename({ kind: 'shot', id: shot.id, value: e.target.value })
                          }
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            else if (e.key === 'Escape') setRename(null)
                          }}
                        />
                      ) : (
                        <>
                          <span className="rail-label">{shot.name}</span>
                          <span className="rail-dur">{Math.round(shot.duration)}s</span>
                          <span className="rail-actions">
                            {isCurrentShot && (
                              <button
                                className="rail-btn"
                                title="Save current shot as a draft"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  saveDraftOfShot()
                                }}
                              >
                                + Draft
                              </button>
                            )}
                            <button
                              className="rail-btn"
                              title="Duplicate shot"
                              onClick={(e) => {
                                e.stopPropagation()
                                duplicateShot(scene, shot)
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              className="rail-btn"
                              title="Delete shot"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteShot(scene, shot)
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        </>
                      )}
                    </div>

                    {drafts.map((draft) => {
                      const isCurrentDraft = draft.id === shotId
                      return (
                        <div
                          className={`rail-shot rail-draft${isCurrentDraft ? ' active' : ''}`}
                          key={draft.id}
                          onClick={() => selectShot(draft.id)}
                        >
                          <span className="rail-label">└ {draft.name}</span>
                          <span className="rail-actions">
                            <button
                              className="rail-btn"
                              title="Make this the shot"
                              onClick={(e) => {
                                e.stopPropagation()
                                promoteDraft(draft.id)
                              }}
                            >
                              ▲
                            </button>
                            <button
                              className="rail-btn"
                              title="Delete draft"
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteDraft(draft.id)
                              }}
                            >
                              ✕
                            </button>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
