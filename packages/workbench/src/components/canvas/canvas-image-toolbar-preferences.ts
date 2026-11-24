import type { CanvasNodeToolbarItem } from "@infinite-canvas/plugin-sdk";

export type ImageToolbarPreferences = {
    /**
     * 按贡献 ID 保存用户选择，暂时不可用的工具仍保留选择。
     */
    visibility: Record<string, boolean>;
    /**
     * 是否在按钮旁显示文字。
     */
    showLabels: boolean;
};

export const IMAGE_TOOLBAR_PREFERENCES_KEY = "canvas-image-toolbar-preferences";

export function isImageToolbarToolVisible(tool: Pick<CanvasNodeToolbarItem, "id" | "defaultVisible">, visibility: Record<string, boolean>) {
    return visibility[tool.id] ?? (tool.defaultVisible !== false);
}
