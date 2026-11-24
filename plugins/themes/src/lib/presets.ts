import type { PluginAppearance } from "@infinite-canvas/plugin-sdk";

export const presets: PluginAppearance[] = [
    { id: "themes:default-light", name: "默认亮色", description: "工作台原始亮色外观", useDefaultColors: true, mode: "light", background: "#f4f2ed", panel: "#fbfaf7", surface: "#e7e5df", text: "#292524", muted: "#78716c", border: "#d6d3ca", accent: "#171717", accentText: "#ffffff" },
    { id: "themes:default-dark", name: "默认暗色", description: "工作台原始暗色外观", useDefaultColors: true, mode: "dark", background: "#181715", panel: "#1f1d1a", surface: "#292524", text: "#f5f5f4", muted: "#a8a29e", border: "#44403c", accent: "#fafafa", accentText: "#171717" },
    // 配色种子参考 Jiqize 的 PR #294，按当前插件语义色结构整理。
    { id: "themes:catppuccin-latte", name: "Catppuccin Latte", description: "柔和奶白与明快蓝色", mode: "light", background: "#eff1f5", panel: "#e9ebef", surface: "#dfe1e7", text: "#4c4f69", muted: "#8d90a1", border: "#ced1d9", accent: "#1e66f5", accentText: "#ffffff" },
    { id: "themes:catppuccin-mocha", name: "Catppuccin Mocha", description: "柔和粉彩与深色基底", mode: "dark", background: "#1e1e2e", panel: "#252535", surface: "#303044", text: "#cdd6f4", muted: "#878da6", border: "#414359", accent: "#89b4fa", accentText: "#1e1e2e" },
    { id: "themes:tokyo-night", name: "Tokyo Night", description: "都市夜色与清透蓝光", mode: "dark", background: "#1a1b26", panel: "#21222e", surface: "#2b2d3b", text: "#c0caf5", muted: "#7e849f", border: "#3b3e4f", accent: "#7aa2f7", accentText: "#1a1b26" },
    { id: "themes:nord", name: "Nord", description: "冷灰蓝调与北境微光", mode: "dark", background: "#2e3440", panel: "#353b47", surface: "#3f4551", text: "#d8dee9", muted: "#949aa5", border: "#505662", accent: "#88c0d0", accentText: "#2e3440" },
    { id: "themes:gruvbox-dark", name: "Gruvbox Dark", description: "复古暖灰与琥珀色彩", mode: "dark", background: "#282828", panel: "#302f2e", surface: "#3c3a36", text: "#ebdbb2", muted: "#9d9380", border: "#4f4c44", accent: "#fabd2f", accentText: "#282828" },
    { id: "themes:dracula", name: "Dracula", description: "经典暗夜与鲜明紫调", mode: "dark", background: "#282a36", panel: "#30323e", surface: "#3d3f49", text: "#f8f8f2", muted: "#a5a6a7", border: "#52535c", accent: "#bd93f9", accentText: "#282a36" },
    { id: "themes:rose-pine", name: "Rosé Pine", description: "松林夜色与朦胧玫瑰", mode: "dark", background: "#191724", panel: "#211f2c", surface: "#2d2b39", text: "#e0def4", muted: "#908ea1", border: "#414050", accent: "#c4a7e7", accentText: "#191724" },
    { id: "themes:rose-pine-dawn", name: "Rosé Pine Dawn", description: "晨光暖白与轻柔紫色", mode: "light", background: "#faf4ed", panel: "#f3eee8", surface: "#eae4e1", text: "#575279", muted: "#9893a7", border: "#d9d4d6", accent: "#907aa9", accentText: "#ffffff" },
    { id: "themes:solarized-light", name: "Solarized Light", description: "日光纸色与克制青蓝", mode: "light", background: "#fdf6e3", panel: "#f6f0df", surface: "#ece8d8", text: "#586e75", muted: "#9aa49f", border: "#dce2cd", accent: "#268bd2", accentText: "#ffffff" },
    { id: "themes:github-light", name: "GitHub Light", description: "纯净白底与熟悉的蓝色", mode: "light", background: "#ffffff", panel: "#f6f8fa", surface: "#e9ecef", text: "#1f2328", muted: "#797b7e", border: "#d1d3d4", accent: "#0969da", accentText: "#ffffff" },
];
