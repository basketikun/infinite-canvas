import { useEffect, useRef, useState, type ReactNode } from "react";
import { Layers, SlidersHorizontal } from "lucide-react";
import { ObjectTreePanel } from "../../editor/panels/ObjectTreePanel";
import { RightPanel } from "../../editor/panels/RightPanel";
import { useMotionClock } from "../../editor/store/motionPlayback";
import { useDirectorStore } from "../../editor/store/directorStore";

export function DirectorDeskShell({ children }: { children: ReactNode }) {
  const viewportPanelsCollapsed = useDirectorStore((state) => state.viewportPanelsCollapsed);

  const drawing = useMotionClock(state => state.drawingId !== null);
  const [drawer, setDrawer] = useState<"scene" | "properties" | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  function closeDrawer() {
    setDrawer(null);
    opener.current?.focus();
  }
  useEffect(() => {
    if (!drawer || drawing) return;
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeDrawer();
    }
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [drawer, drawing]);

  return (
    <div
      data-drawer={drawing ? null : drawer}
      className={`director-shell director-shell-fullbleed${viewportPanelsCollapsed ? " is-sidebars-collapsed" : ""}`}
    >
      {!drawing && <div className="drawer-controls">
        {([{ id: "scene", title: "场景", Icon: Layers }, { id: "properties", title: "属性", Icon: SlidersHorizontal }] as const).map(({ id, title, Icon }) => (
          <button key={id} type="button" aria-expanded={drawer === id} aria-controls={`director-${id}`} onClick={event => {
            opener.current = event.currentTarget;
            setDrawer(current => current === id ? null : id);
          }}><Icon size={15} />{title}</button>
        ))}
      </div>}
      {!drawing && drawer && <button type="button" className="drawer-backdrop" aria-label="收起侧栏" onClick={closeDrawer} />}
      <section className="viewport-column" aria-label="3D视口">
        {children}
      </section>
      <aside
        id="director-scene" className="left-sidebar director-sidebar"
        aria-label="场景"
      >
        <ObjectTreePanel />
      </aside>
      <aside
        id="director-properties" className="right-sidebar director-sidebar"
        aria-label="属性"
      >
        <RightPanel />
      </aside>
    </div>
  );
}
