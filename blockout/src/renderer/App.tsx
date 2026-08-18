// Modified for cross-platform Windows support in 2026; see MODIFICATIONS.md.
/**
 * App shell: welcome screen, titlebar with the three-mode switch, the
 * Stage/Shoot/Deliver layouts, global keyboard map, and autosave.
 */

import { useCallback, useEffect } from 'react'
import { useStore, currentProjectJson } from './store'
import { Viewport } from './viewport/Viewport'
import { Library } from './panels/Library'
import { Inspector } from './panels/Inspector'
import { ProjectRail } from './panels/ProjectRail'
import { ReferenceDock } from './panels/ReferenceDock'
import { Timeline } from './panels/Timeline'
import { DeliverPanel } from './panels/DeliverPanel'
import { Toasts } from './panels/Toasts'
import { HelpOverlay, BlockingCoach } from './panels/Help'
import logoUrl from './assets/logo.png'
import { DISTRIBUTION } from '../shared/distribution'
import { renderStillPngForTest } from './export/exporter'
import { useBlockoutI18n } from './i18n'

const PLATFORM_CLASS = `platform-${window.blockout.platform.platform}`
const EMBED_PROTOCOL = 'infinite-canvas-director-v1'
const IS_EMBEDDED = window.parent !== window

function parentOrigin(): string {
  try {
    return document.referrer ? new URL(document.referrer).origin : '*'
  } catch {
    return '*'
  }
}

async function closeEmbeddedWorkspace(): Promise<void> {
  if (!IS_EMBEDDED) return
  try {
    const png = await renderStillPngForTest(useStore.getState().time, 320, 180)
    window.blockout.notifyThumbnail(png)
  } catch (error) {
    console.warn('[blockout-web] thumbnail capture before close failed', error)
  }
  window.parent.postMessage({ protocol: EMBED_PROTOCOL, type: 'CLOSE' }, parentOrigin())
}

function EmbeddedBackButton(): JSX.Element | null {
  const { t } = useBlockoutI18n()
  if (!IS_EMBEDDED) return null
  return (
    <button
      className="btn small embedded-back titlebar-action"
      onClick={() => void closeEmbeddedWorkspace()}
      aria-label={t('app.back')}
    >
      ← {t('app.back')}
    </button>
  )
}

function CreditLink({ url, children }: { url: string; children: string }): JSX.Element {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        void window.blockout.openExternal(url)
      }}
      style={{ color: 'var(--accent)', textDecoration: 'none', cursor: 'pointer' }}
      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
    >
      {children}
    </a>
  )
}

export function Credits({ compact = false }: { compact?: boolean }): JSX.Element {
  const { locale } = useBlockoutI18n()
  return (
    <div
      style={{
        color: 'var(--text-faint)',
        fontSize: compact ? 10 : 12,
        textAlign: 'center',
        lineHeight: 1.6,
        padding: compact ? '10px 12px' : 0
      }}
    >
      {locale === 'zh-CN' ? '由 Sam Wasserman 创建' : 'Created by Sam Wasserman'}
      {compact ? <br /> : ' · '}
      <CreditLink url="https://wassermanproductions.com">wassermanproductions.com</CreditLink>
      {' · '}
      <CreditLink url="https://wasserman.ai">wasserman.ai</CreditLink>
      {!compact && (
        <>
          <br />
          {locale === 'zh-CN' ? '基于 Apache-2.0 开源——使用或派生时请保留此署名。' : 'Open source under Apache-2.0 — keep this credit when using or forking.'}
          {DISTRIBUTION.maintainerCredit && (
            <>
              <br />
              {DISTRIBUTION.maintainerCredit}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Welcome(): JSX.Element {
  const { t } = useBlockoutI18n()
  const newProject = useStore((s) => s.newProject)
  const loadFromJson = useStore((s) => s.loadFromJson)
  const toast = useStore((s) => s.toast)

  const onNew = useCallback(async () => {
    const project = await window.blockout.newProjectDialog()
    if (!project) return
    const { folder, name } = project
    newProject(folder, name)
    const json = currentProjectJson()
    if (json) await window.blockout.saveProject(folder, json)
  }, [newProject])

  const onOpen = useCallback(async () => {
    const folder = await window.blockout.openProjectDialog()
    if (!folder) return
    const { json, backupJson, backupNewer } = await window.blockout.loadProject(folder)
    if (!json && !backupJson) {
      toast(t('welcome.noProject'), 'error')
      return
    }
    // A meaningfully-newer autosave means the app died with unsaved work —
    // restore it (undo history is fresh either way; ⌘S makes it permanent).
    if (backupNewer && backupJson && loadFromJson(folder, backupJson)) {
      toast('已从自动保存备份恢复未保存内容——点击“保存”以保留。', 'success')
      return
    }
    if (json && loadFromJson(folder, json)) return
    if (backupJson && loadFromJson(folder, backupJson)) {
      toast('已从自动保存备份恢复。', 'success')
    }
  }, [loadFromJson, toast])

  return (
    <div className="welcome">
      <img
        src={logoUrl}
        alt="Blockout"
        style={{ width: 260, height: 260, objectFit: 'contain', borderRadius: 16, marginBottom: -8 }}
      />
      <p>
        {t('welcome.description')}
      </p>
      <div className="actions">
        <button className="btn primary" onClick={onNew}>
          {t('welcome.newProject')}
        </button>
        <button className="btn" onClick={onOpen}>
          {t('welcome.openProject')}
        </button>
        <button className="btn" onClick={() => useStore.getState().setHelpOpen(true)}>
          {t('welcome.tutorial')}
        </button>
      </div>
      <Credits />
    </div>
  )
}

function useAutosave(): void {
  // Depend on WHETHER a doc is open, not on the doc object — every mutation
  // replaces the doc, and re-arming a 60s timer on each edit means autosave
  // never fires for anyone actively working (the exact crash window it
  // exists to cover). The tick reads the latest doc from the store.
  const hasDoc = useStore((s) => s.doc !== null)
  const folder = useStore((s) => s.projectFolder)

  useEffect(() => {
    if (!hasDoc || !folder) return
    const interval = setInterval(() => {
      const json = currentProjectJson()
      if (json) void window.blockout.saveBackup(folder, json)
    }, 60_000)
    return () => clearInterval(interval)
  }, [hasDoc, folder])
}

function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState()
      if (!s.doc) return
      const inField =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement
      if (inField) return

      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        s.undo()
      } else if (meta && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        s.redo()
      } else if (meta && e.key === 's') {
        e.preventDefault()
        const json = currentProjectJson()
        if (json && s.projectFolder) {
          void window.blockout.saveProject(s.projectFolder, json).then(() => s.markSaved())
        }
      } else if (e.key === ' ') {
        e.preventDefault()
        s.setPlaying(!s.playing)
      } else if (e.key === 'm' || e.key === 'M') {
        if (s.mode === 'shoot' && s.selection) s.setDroppingMarks(!s.droppingMarks)
      } else if (e.key === 'c' || e.key === 'C') {
        // Toggle everywhere except Deliver (which is always the shot view) —
        // being stuck in look-through with no exit was a real trap.
        if (s.mode !== 'deliver') s.setLookThrough(!s.lookThrough)
      } else if (e.key === '?') {
        s.setHelpOpen(!s.helpOpen)
      } else if (e.key === 'Escape') {
        if (s.helpOpen) {
          s.setHelpOpen(false)
          return
        }
        s.setPlacingAsset(null)
        s.setPlacingSequence(null)
        s.setPlacingChoreography(null)
        s.setDroppingMarks(false)
        s.setSelection(null)
      } else if (e.key >= '1' && e.key <= '9') {
        // Jump to camera mark N.
        const shot = s.shot()
        const idx = Number(e.key) - 1
        const mark = shot ? [...shot.camera.marks].sort((a, b) => a.time - b.time)[idx] : undefined
        if (mark) s.setTime(mark.time)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function App(): JSX.Element {
  const { t } = useBlockoutI18n()
  const doc = useStore((s) => s.doc)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const dirty = useStore((s) => s.dirty)
  const markSaved = useStore((s) => s.markSaved)
  const folder = useStore((s) => s.projectFolder)

  useAutosave()
  useKeyboard()

  const onSave = useCallback(async () => {
    const json = currentProjectJson()
    if (json && folder) {
      await window.blockout.saveProject(folder, json)
      markSaved()
    }
  }, [folder, markSaved])

  if (!doc) {
    return (
      <div className={`app ${PLATFORM_CLASS}${IS_EMBEDDED ? ' embedded' : ''}`}>
        <div className="titlebar">
          <span className="app-name">BLOCKOUT</span>
          <EmbeddedBackButton />
        </div>
        <Welcome />
        <Toasts />
        <HelpOverlay />
      </div>
    )
  }

  return (
    <div className={`app ${PLATFORM_CLASS}${IS_EMBEDDED ? ' embedded' : ''}`}>
      <div className="titlebar titlebar-workspace">
        <div className="titlebar-project" title={doc.name}>
          <EmbeddedBackButton />
          <span className="titlebar-project-mark" aria-hidden="true" />
          <span className="titlebar-project-copy">
            <span className="titlebar-project-kicker">DIRECTOR</span>
            <span className="titlebar-project-name">{doc.name}</span>
          </span>
          {dirty ? <span className="titlebar-dirty">未保存</span> : null}
        </div>
        <nav className="mode-switch" aria-label="工作模式">
          <button className={mode === 'stage' ? 'active' : ''} onClick={() => setMode('stage')}>
            <span className="mode-switch-icon" aria-hidden="true">✦</span>
            {t('mode.stage')}
          </button>
          <button className={mode === 'shoot' ? 'active' : ''} onClick={() => setMode('shoot')}>
            <span className="mode-switch-icon" aria-hidden="true">◉</span>
            {t('mode.shoot')}
          </button>
          <button className={mode === 'deliver' ? 'active' : ''} onClick={() => setMode('deliver')}>
            <span className="mode-switch-icon" aria-hidden="true">↗</span>
            {t('mode.deliver')}
          </button>
        </nav>
        <div className="titlebar-actions">
          <button className="btn small titlebar-action titlebar-save" onClick={onSave}>
            <span className="titlebar-action-icon" aria-hidden="true">✓</span>
            {t('app.save')}
          </button>
          <button
            className="btn small titlebar-action"
            title={t('app.helpTitle')}
            onClick={() => useStore.getState().setHelpOpen(true)}
          >
            <span className="titlebar-action-icon" aria-hidden="true">?</span>
            {t('app.help')}
          </button>
        </div>
      </div>

      {mode === 'deliver' ? (
        <div className="deliver-layout">
          <div className="deliver-preview">
            <Viewport />
          </div>
          <DeliverPanel />
        </div>
      ) : (
        <div className="main">
          <div className="panel">
            <ReferenceDock />
            <ProjectRail />
            {mode === 'stage' && <Library />}
            <Credits compact />
          </div>
          <div className="center-column">
            <div className="viewport-wrap">
              <Viewport />
            </div>
            {mode === 'shoot' && <Timeline />}
          </div>
          <div className="panel right">
            <Inspector />
          </div>
        </div>
      )}
      <Toasts />
      <HelpOverlay />
      <BlockingCoach />
    </div>
  )
}
