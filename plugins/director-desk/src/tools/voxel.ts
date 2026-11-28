import type { PluginAgentTool } from "@infinite-canvas/plugin-sdk";
import { editVoxel } from "../api/voxel-edit";

export const editVoxelTool: PluginAgentTool = {
    command: editVoxel,
    description: "编辑已打开导演台中的体素对象。使用对象的整数网格坐标，paint 着色已有体素，add 向空位置添加体素，delete 删除已有体素。添加可向边界外扩一格。着色和添加需要十六进制 RGB 颜色。修改会保存并可撤销。可先读取镜头目标取得场景和对象 ID。",
};
