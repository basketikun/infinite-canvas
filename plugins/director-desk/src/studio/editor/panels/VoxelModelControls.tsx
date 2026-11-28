import { useState } from "react";
import { VOXEL_RESOLUTIONS, voxelizeMesh } from "../../../lib/voxelize-mesh";
import type { DirectorObject } from "../schema/directorProject";
import { useMotionClock } from "../store/motionPlayback";
import { useDirectorStore } from "../store/directorStore";
import { useVoxelTools, voxelSources } from "../runtime/voxelTools";

export function VoxelModelControls({ object }: { object: DirectorObject }) {
  const [resolution, setResolution] = useState(32);
  const [mode, setMode] = useState<"shell" | "solid">("shell");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const color = useVoxelTools((state) => state.color);
  const pick = useVoxelTools((state) => state.pick?.id === object.id ? state.pick : null);
  const previewing = useMotionClock((state) => state.time !== null);
  const editable = object.visible && !object.locked && !previewing;
  if (!object.assetRefId && !object.geometryType && !object.voxel) return null;

  async function convert() {
    if (!editable || busy) return;
    setBusy(true);
    setError("");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const source = voxelSources.get(object.id);
      if (!source || !source.children.length) throw new Error("模型尚未加载，请稍后重试。");
      const grid = voxelizeMesh(source, { resolution, mode });
      useDirectorStore.getState().updateObjectVoxel(object.id, (current) => ({ ...current, voxel: grid, showVoxelSource: false }));
      useVoxelTools.setState({ brush: null, pick: null });
    } catch (error) {
      setError(error instanceof Error ? error.message : "体素化失败。");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="体素模型" style={{ display: "grid", gap: 8 }}>
    {!object.voxel || object.showVoxelSource ? <>
      <label>分辨率 <select value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
        {VOXEL_RESOLUTIONS.map((size) => <option key={size}>{size}</option>)}
      </select></label>
      <label>填充 <select value={mode} onChange={(event) => setMode(event.target.value === "solid" ? "solid" : "shell")}>
        <option value="shell">表面壳</option><option value="solid">实心</option>
      </select></label>
      <button className="ui-button" type="button" disabled={!editable || busy} onClick={() => void convert()}>
        {busy ? "正在体素化…" : object.voxel ? "重新体素化" : "原位体素化"}
      </button>
    </> : null}
    {object.voxel ? <button className="ui-button" type="button" disabled={!editable || busy} onClick={() => {
      useVoxelTools.setState({ brush: null, pick: null });
      useDirectorStore.getState().updateObjectVoxel(object.id, (current) => ({ ...current, showVoxelSource: !current.showVoxelSource }));
    }}>{object.showVoxelSource ? "显示体素模型" : "查看源模型"}</button> : null}
    {object.voxel && !object.showVoxelSource ? <label className="inspector-field">
      <span className="inspector-field-label">笔刷颜色</span>
      <input type="color" className="inspector-color-swatch" value={color} onChange={(event) => useVoxelTools.setState({ color: event.target.value })} />
    </label> : null}
    {pick ? <output aria-label="体素坐标">{pick.cell.join(", ")}</output> : null}
    {error ? <div role="alert">{error}</div> : null}
  </section>;
}
