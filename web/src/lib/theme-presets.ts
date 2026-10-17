import { FastColor } from "@ant-design/fast-color";
import { nanoid } from "nanoid";

import { canvasThemes, type CanvasColorTheme, type CanvasTheme } from "@/lib/canvas-theme";

// 主题只记录背景、前景、强调色三个种子色，其余颜色全部推导；Ghostty 导入的主题也落成这个结构。
export type ThemePreset = { id: string; name: string; background: string; foreground: string; accent: string };

export const builtinThemes: ThemePreset[] = [
    { id: "light", name: "Default Light", background: "#f4f2ed", foreground: "#292524", accent: "#171717" },
    { id: "dark", name: "Default Dark", background: "#181715", foreground: "#f5f5f4", accent: "#fafafa" },
    { id: "catppuccin-latte", name: "Catppuccin Latte", background: "#eff1f5", foreground: "#4c4f69", accent: "#1e66f5" },
    { id: "catppuccin-mocha", name: "Catppuccin Mocha", background: "#1e1e2e", foreground: "#cdd6f4", accent: "#89b4fa" },
    { id: "tokyo-night", name: "Tokyo Night", background: "#1a1b26", foreground: "#c0caf5", accent: "#7aa2f7" },
    { id: "nord", name: "Nord", background: "#2e3440", foreground: "#d8dee9", accent: "#88c0d0" },
    { id: "gruvbox-dark", name: "Gruvbox Dark", background: "#282828", foreground: "#ebdbb2", accent: "#fabd2f" },
    { id: "dracula", name: "Dracula", background: "#282a36", foreground: "#f8f8f2", accent: "#bd93f9" },
    { id: "rose-pine", name: "Rosé Pine", background: "#191724", foreground: "#e0def4", accent: "#c4a7e7" },
    { id: "rose-pine-dawn", name: "Rosé Pine Dawn", background: "#faf4ed", foreground: "#575279", accent: "#907aa9" },
    { id: "solarized-light", name: "Solarized Light", background: "#fdf6e3", foreground: "#586e75", accent: "#268bd2" },
    { id: "github-light", name: "GitHub Light", background: "#ffffff", foreground: "#1f2328", accent: "#0969da" },
];

// 默认浅色/深色直接使用项目原配色，不覆盖任何全局变量。
export function isDefaultTheme(preset: ThemePreset) {
    return preset.id === "light" || preset.id === "dark";
}

export function getThemeMode(preset: ThemePreset): CanvasColorTheme {
    return new FastColor(preset.background).isDark() ? "dark" : "light";
}

export function findTheme(id: string, customThemes: ThemePreset[]) {
    return builtinThemes.find((item) => item.id === id) || customThemes.find((item) => item.id === id) || builtinThemes[1];
}

// p 为 b 所占比例（0-1）。
function mix(a: string, b: string, p: number) {
    return new FastColor(a).mix(b, p * 100).toHexString();
}

function alpha(color: string, a: number) {
    return new FastColor(color).setA(a).toRgbString();
}

const canvasThemeCache = new Map<string, CanvasTheme>();

export function buildCanvasTheme(preset: ThemePreset): CanvasTheme {
    if (isDefaultTheme(preset)) return canvasThemes[preset.id as CanvasColorTheme];
    const key = `${preset.background}|${preset.foreground}|${preset.accent}`;
    const cached = canvasThemeCache.get(key);
    if (cached) return cached;
    const { background: bg, foreground: fg } = preset;
    const dark = getThemeMode(preset) === "dark";
    const panel = mix(bg, fg, 0.04);
    const fill = mix(bg, fg, 0.1);
    const stroke = mix(bg, fg, 0.2);
    const theme: CanvasTheme = {
        canvas: { background: bg, dot: alpha(fg, dark ? 0.24 : 0.28), line: alpha(fg, dark ? 0.1 : 0.12), selectionStroke: fg, selectionFill: alpha(fg, dark ? 0.1 : 0.06) },
        node: { label: mix(fg, bg, 0.15), fill, panel, stroke, activeStroke: fg, placeholder: mix(fg, bg, 0.4), text: fg, muted: mix(fg, bg, 0.25), faint: mix(fg, bg, 0.55) },
        toolbar: { panel: alpha(panel, 0.96), border: stroke, item: mix(fg, bg, 0.15), itemHover: fill, activeBg: mix(bg, fg, 0.16), activeText: fg },
    };
    canvasThemeCache.set(key, theme);
    return theme;
}

// Tailwind 灰阶各档的 OKLCH 亮度，用来把灰阶重新映射到主题的背景与前景之间。
const GRAY_STEPS: [number, number][] = [
    [50, 0.985],
    [100, 0.97],
    [200, 0.923],
    [300, 0.869],
    [400, 0.709],
    [500, 0.553],
    [600, 0.444],
    [700, 0.374],
    [800, 0.268],
    [900, 0.216],
    [950, 0.147],
];
const GRAY_FAMILIES = ["stone", "neutral", "zinc", "gray", "slate"];

// 生成写到 <html> 上的 CSS 变量：覆盖 Tailwind 灰阶、黑白和 shadcn 语义色，页面里写死的灰色类名随主题变化。
export function buildThemeCssVars(preset: ThemePreset): Record<string, string> {
    if (isDefaultTheme(preset)) return {};
    const { background: bg, foreground: fg, accent } = preset;
    const dark = getThemeMode(preset) === "dark";
    const lightEnd = dark ? fg : bg;
    const darkEnd = dark ? bg : fg;
    const vars: Record<string, string> = {
        "--color-white": dark ? mix(fg, "#ffffff", 0.5) : mix(bg, "#ffffff", 0.6),
        "--color-black": mix(darkEnd, "#000000", 0.4),
    };
    GRAY_STEPS.forEach(([step, lightness]) => {
        const color = mix(lightEnd, darkEnd, (0.985 - lightness) / 0.838);
        GRAY_FAMILIES.forEach((family) => (vars[`--color-${family}-${step}`] = color));
    });
    const panel = mix(bg, fg, 0.04);
    const fill = mix(bg, fg, 0.1);
    const border = mix(bg, fg, 0.15);
    const ring = mix(fg, bg, 0.5);
    Object.assign(vars, {
        "--background": bg,
        "--foreground": fg,
        "--card": panel,
        "--card-foreground": fg,
        "--popover": panel,
        "--popover-foreground": fg,
        "--primary": fg,
        "--primary-foreground": bg,
        "--secondary": fill,
        "--secondary-foreground": fg,
        "--muted": fill,
        "--muted-foreground": mix(fg, bg, 0.4),
        "--accent": fill,
        "--accent-foreground": fg,
        "--border": border,
        "--input": border,
        "--ring": ring,
        "--sidebar": panel,
        "--sidebar-foreground": fg,
        "--sidebar-primary": accent,
        "--sidebar-primary-foreground": bg,
        "--sidebar-accent": fill,
        "--sidebar-accent-foreground": fg,
        "--sidebar-border": border,
        "--sidebar-ring": ring,
    });
    return vars;
}

// antd 需要真实色值，由三个种子色推导。
export function buildAntColors(preset: ThemePreset) {
    const { background: bg, foreground: fg, accent } = preset;
    return {
        primary: accent,
        primaryHover: mix(accent, fg, 0.15),
        primaryText: new FastColor(accent).isDark() ? "#ffffff" : "#111111",
        bgBase: bg,
        textBase: fg,
        containerBg: mix(bg, fg, 0.04),
        elevatedBg: mix(bg, fg, 0.06),
        border: mix(bg, fg, 0.18),
        borderSecondary: mix(bg, fg, 0.1),
        itemHoverBg: alpha(fg, 0.08),
        itemSelectedBg: alpha(fg, 0.12),
        itemSelectedHoverBg: alpha(fg, 0.16),
        itemText: fg,
        tableSelectedBg: alpha(fg, 0.06),
        tableSelectedHoverBg: alpha(fg, 0.1),
    };
}

function normalizeHex(value: string) {
    const hex = value.trim().replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : "";
}

// 解析 Ghostty 主题文件：取 background、foreground，强调色优先用 16 色里的蓝色（palette 4），其次是光标色。
export function parseGhosttyTheme(text: string, name: string): ThemePreset {
    const values: Record<string, string> = {};
    const palette: string[] = [];
    text.split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*([\w-]+)\s*=\s*(.+?)\s*$/);
        if (!match) return;
        const [, key, value] = match;
        const paletteMatch = key === "palette" ? value.match(/^(\d+)\s*=\s*(.+)$/) : null;
        if (paletteMatch) palette[Number(paletteMatch[1])] = normalizeHex(paletteMatch[2]);
        else values[key] = normalizeHex(value);
    });
    if (!values.background || !values.foreground) throw new Error("missing background or foreground");
    return { id: `custom-${nanoid(8)}`, name, background: values.background, foreground: values.foreground, accent: palette[4] || values["cursor-color"] || values.foreground };
}
