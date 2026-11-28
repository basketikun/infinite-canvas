import { create } from "zustand";
import type { Object3D } from "three";
import type { SparseVoxelGrid } from "../../../lib/voxelize-mesh";

type Point = [number, number, number];
export type VoxelBrush = "paint" | "add" | "erase";
type Pick = { id: string; cell: Point };
export const useVoxelTools = create<{ brush: VoxelBrush | null; color: string; pick: Pick | null }>(() => ({
  brush: null, color: "#e57549", pick: null,
}));
export const voxelSources = new Map<string, Object3D>();

export function writeVoxel(grid: SparseVoxelGrid, cell: Point, color: string | null): SparseVoxelGrid {
  const key = cell.join(",");
  if (color === null ? !Object.hasOwn(grid.cells, key) : grid.cells[key] === color) return grid;
  const offset = cell.map((coordinate) => Math.max(0, -coordinate)) as Point;
  const dimensions = grid.dimensions.map((size, axis) => Math.max(size, cell[axis] + 1) + offset[axis]) as Point;
  const origin = grid.origin.map((coordinate, axis) => coordinate - offset[axis] * grid.voxelSize) as Point;
  const cells: Record<string, string> = {};
  if (offset.some(Boolean)) {
    for (const [oldKey, value] of Object.entries(grid.cells)) {
      const coordinates = oldKey.split(",").map((coordinate, axis) => Number(coordinate) + offset[axis]);
      cells[coordinates.join(",")] = value;
    }
  } else Object.assign(cells, grid.cells);
  if (color === null) delete cells[key];
  else cells[cell.map((coordinate, axis) => coordinate + offset[axis]).join(",")] = color;
  return { ...grid, dimensions, origin, cells };
}
