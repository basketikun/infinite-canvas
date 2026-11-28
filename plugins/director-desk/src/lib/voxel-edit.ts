import { z } from "zod";

const integer = z.number().int().safe();
const point = z.tuple([integer, integer, integer]);
export const voxelEditInput = z.object({
    sceneId: z.string().min(1), objectId: z.string().min(1), cell: point,
    operation: z.enum(["paint", "add", "delete"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
}).strict().refine(({ operation, color }) => operation === "delete" ? color === undefined : color !== undefined, {
    message: "着色和添加需要 RGB 颜色，删除不接受颜色。", path: ["color"],
});
export const voxelEditOutput = z.object({ sceneId: z.string(), objectId: z.string(), cell: point, changed: z.boolean() }).strict();
export type VoxelEditInput = z.infer<typeof voxelEditInput>;
export type VoxelEditOutput = z.infer<typeof voxelEditOutput>;
