import type { PluginSettings } from "@infinite-canvas/plugin-sdk";
import { ColorEditor } from "../pages/color-editor";
import { WorkspaceEditor } from "../pages/workspace-editor";

export const colors: PluginSettings = { id: "themes:colors", title: "自定义配色", Content: ColorEditor };
export const navigationSettings: PluginSettings = { id: "themes:navigation-settings", title: "导航入口", Content: WorkspaceEditor };
