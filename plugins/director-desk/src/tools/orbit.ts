import { defineCommand } from "@infinite-canvas/plugin-sdk";
import type { PluginAgentTool } from "@infinite-canvas/plugin-sdk";
import { z } from "zod";
import { applySceneLayout, sceneTargets } from "../api/camera-layouts";
import { orbitParameters } from "../layouts/orbit";

export const targetsTool: PluginAgentTool = { command: sceneTargets, readOnly: true, description: "列出当前导演台场景中可用于镜头对焦的对象 ID 和名称。" };

export const orbitTool: PluginAgentTool = {
    description: "在当前导演台场景为指定对象添加环绕镜头。先读取镜头目标取得场景和对象 ID。",
    command: defineCommand({ ...applySceneLayout, input: z.object({
        sceneId: z.string(), layoutId: z.literal("director-desk:orbit"), parameters: orbitParameters,
    }).strict() }),
};
