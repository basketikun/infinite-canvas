import "./styles/index.css";
import { useEffect } from "react";
import { Check, PanelLeftClose, PanelLeftOpen, Save, X } from "lucide-react";
import { DirectorDeskShell } from "./app/layout/DirectorDeskShell";
import { DirectorCanvas } from "./editor/canvas/DirectorCanvas";
import { holdAutosave, saveAndClose, useStatus, retrySave } from "./editor/io/session";
import { useMotionClock } from "./editor/store/motionPlayback";
import { useDirectorStore } from "./editor/store/directorStore";

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const status = useStatus();
  const viewMode = useDirectorStore((state) => state.viewMode);
  const setViewMode = useDirectorStore((state) => state.setViewMode);

  const drawing = useMotionClock(state => state.drawingId !== null);
  const collapsed = useDirectorStore(state => state.viewportPanelsCollapsed);
  const togglePanels = useDirectorStore(state => state.toggleViewportPanelsCollapsed);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (useMotionClock.getState().drawingId !== null) {
        if (event.key === "Escape") {
          event.preventDefault();
          useMotionClock.setState({ drawingId: null });
        }
        return;
      }
      if (isEditableShortcutTarget(event.target)) return;
      if (event.key === "Escape") { event.preventDefault(); void saveAndClose(); return; }
      if (!event.metaKey && !event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        useDirectorStore.getState().copySelectedObjects();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        useDirectorStore.getState().pasteClipboardObjects();
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useDirectorStore.getState().undo();
      }
    }

    const press = () => holdAutosave(true);
    const release = () => holdAutosave(false);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <h1 className="top-bar-title">3D 导演台</h1>
          <button type="button" className="top-bar-action-button panel-toggle" aria-controls="director-scene director-properties" aria-expanded={!collapsed} aria-label={collapsed ? "显示侧栏" : "隐藏侧栏"} title={collapsed ? "显示侧栏" : "隐藏侧栏"} onClick={togglePanels}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}{collapsed && <span>展开侧栏</span>}
          </button>
        </div>
        <div className="top-bar-center">
          <div className="mode-toggle ui-segmented" role="group" aria-label="视角切换">
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "director" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "director"}
              type="button"
              disabled={drawing}
              onClick={() => setViewMode("director")}
            >
              导演视角
            </button>
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "camera" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "camera"}
              type="button"
              disabled={drawing}
              onClick={() => setViewMode("camera")}
            >
              机位视角
            </button>
          </div>
        </div>
        <div className="top-bar-actions">
          <button type="button" className="save-action" aria-label="保存场景" title="保存场景" onClick={() => void retrySave()}>
            {status === "已保存" ? <Check size={15} /> : <Save size={15} />}<span>{status === "已保存" ? "已保存" : "保存"}</span>
          </button>
          <button className="top-bar-action-button" type="button" aria-label="关闭导演台" title="关闭导演台" onClick={() => void saveAndClose()}><X size={18} /></button>
        </div>
      </header>
      <DirectorDeskShell>
        <DirectorCanvas />
        <div className="viewport-notice" role="status">{status !== "已保存" && status}</div>
      </DirectorDeskShell>
    </div>
  );
}
