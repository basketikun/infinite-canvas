import { Group, ImageIcon, List, Music2, Type, Video } from "lucide-react";
import type { CanvasNodeDefinition, PluginMenuItem } from "@infinite-canvas/plugin-sdk";
import { menus, nodeCreate } from "@infinite-canvas/plugin-sdk/builtin";
import { CanvasNodeType, type Position } from "@infinite-canvas/shared/canvas/schema/canvas";
import { PluginError } from "@infinite-canvas/shared/plugins";
import { builtinPlugin } from "@workbench/lib/plugins/registry";
import { getNodeDefinition, getNodePluginId, listNodeDefinitions } from "./node-registry";
import type { CanvasSession } from "./canvas-session";

export function registerCanvasCreationMenus(session: CanvasSession, getCanvasCenter: () => Position) {
    return builtinPlugin.extensions.contribute(menus, {
        id: "builtin:canvas-create",
        value: {
            id: "builtin:canvas-create",
            locations: ["canvas.create", "canvas.connectionCreate", "canvas.toolbar", "canvas.extensions"],
            transform: ({ ctx, canvas, target, items }) => {
                if (session.signal.aborted || canvas.projectId !== session.projectId) return items;
                let choices: Pick<CanvasNodeDefinition, "type" | "title" | "description" | "icon" | "showInCreateMenu">[];
                if (target.location === "canvas.connectionCreate") choices = [
                    { type: CanvasNodeType.Text, icon: <List />, title: "文本生成", description: "脚本、广告词、品牌文案" },
                    { type: CanvasNodeType.Image, icon: <ImageIcon />, title: "图片生成", description: "海报、插画、产品图" },
                    { type: CanvasNodeType.Video, icon: <Video />, title: "视频生成", description: "短片、动态广告、动画" },
                    { type: CanvasNodeType.Audio, icon: <Music2 />, title: "音频生成", description: "配音、音乐、音效" },
                ];
                else if (target.location === "canvas.toolbar") choices = [
                    { type: CanvasNodeType.Text, title: "文本", icon: <Type /> },
                    { type: CanvasNodeType.Image, title: "图片", icon: <ImageIcon /> },
                    { type: CanvasNodeType.Video, title: "视频", icon: <Video /> },
                    { type: CanvasNodeType.Audio, title: "音频", icon: <Music2 /> },
                    { type: CanvasNodeType.Group, title: "组", icon: <Group /> },
                ];
                else if (target.location === "canvas.create") choices = listNodeDefinitions().filter((definition) => (getNodePluginId(definition.type) !== "builtin") === Boolean(target.extensions));
                else if (target.location === "canvas.extensions") choices = listNodeDefinitions().filter((definition) => getNodePluginId(definition.type) !== "builtin");
                else return items;
                const position = target.location === "canvas.create" || target.location === "canvas.connectionCreate" ? { ...target.position } : null;
                const connection = target.location === "canvas.connectionCreate" ? { nodeId: target.nodeId, handleType: target.handleType } : undefined;
                const actions: PluginMenuItem[] = choices.flatMap((choice) => {
                    const definition = getNodeDefinition(choice.type);
                    if (!definition) return [];
                    return [{
                        id: `create:${choice.type}`, type: "action", title: choice.title, icon: choice.icon, description: choice.description, hidden: choice.showInCreateMenu === false,
                        run: () => {
                            if (getNodeDefinition(choice.type) !== definition) throw new PluginError("PLUGIN_INACTIVE");
                            return ctx.commands.execute(nodeCreate, { type: choice.type, position: position === null ? { ...getCanvasCenter() } : { ...position }, connection }, { scope: canvas.scope });
                        },
                    }];
                });
                if (target.location !== "canvas.toolbar") return [...actions, ...items];
                const index = items.findIndex((item) => item.id === "builtin:create:separator") + 1;
                return [...items.slice(0, index), ...actions, ...items.slice(index)];
            },
        },
    });
}
