import type { CanvasPlugin } from "./types";

/**
 * 为插件贡献提供类型推导，运行时不改变声明。
 */
export function definePlugin(plugin: CanvasPlugin): CanvasPlugin {
    return plugin;
}
