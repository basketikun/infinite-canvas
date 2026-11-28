import { defineCommand } from "@infinite-canvas/plugin-sdk";
import { voxelEditInput, voxelEditOutput } from "../lib/voxel-edit";

export const editVoxel = defineCommand({
    id: "director-desk:edit-voxel", scope: "project", input: voxelEditInput, output: voxelEditOutput,
});
