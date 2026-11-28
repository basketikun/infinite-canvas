import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { voxelSurfaceGeometry } from "../../../lib/voxelize-mesh";
import type { DirectorObject } from "../schema/directorProject";
import { useDirectorStore } from "../store/directorStore";
import { useVoxelTools, writeVoxel } from "./voxelTools";

type Point = [number, number, number];

export function NativeVoxelModel({ item, editable }: { item: DirectorObject; editable: boolean }) {
  const grid = item.voxel!;
  const geometry = useMemo(() => voxelSurfaceGeometry(grid), [grid]);
  const pick = useVoxelTools((state) => state.pick?.id === item.id ? state.pick : null);
  useEffect(() => () => geometry.dispose(), [geometry]);

  function edit(event: ThreeEvent<MouseEvent>) {
    if (!editable || event.delta > 5 || !event.face) return;
    event.stopPropagation();
    const { brush, color } = useVoxelTools.getState();
    const normal = event.face.normal;
    const position = event.object.worldToLocal(event.point.clone()).addScaledVector(normal, -grid.voxelSize * 1e-4);
    const cell = position.toArray().map((coordinate, axis) =>
      Math.max(0, Math.min(grid.dimensions[axis] - 1, Math.floor((coordinate - grid.origin[axis]) / grid.voxelSize)))) as Point;
    if (brush === "add") cell.forEach((coordinate, axis) => { cell[axis] = coordinate + Math.round(normal.getComponent(axis)); });
    useVoxelTools.setState({ pick: brush === "add" && cell.some((coordinate) => coordinate < 0) ? null : { id: item.id, cell } });
    if (!brush) return;
    useDirectorStore.getState().updateObjectVoxel(item.id, (object) => {
      if (!object.voxel || object.voxel !== grid) return object;
      const next = writeVoxel(grid, cell, brush === "erase" ? null : color);
      return next === grid ? object : { ...object, voxel: next };
    });
  }

  const size = grid.voxelSize * 1.01;
  const marker = pick?.cell.map((coordinate, axis) => grid.origin[axis] + (coordinate + 0.5) * grid.voxelSize) as Point | undefined;
  return <>
    <mesh geometry={geometry} onClick={edit}><meshStandardMaterial vertexColors roughness={0.85} /></mesh>
    {marker && editable ? <mesh position={marker} raycast={() => null} userData={{ hideFromViewportCapture: true }}>
      <boxGeometry args={[size, size, size]} />
      <meshBasicMaterial color="#ffc78b" wireframe depthTest={false} />
    </mesh> : null}
  </>;
}
