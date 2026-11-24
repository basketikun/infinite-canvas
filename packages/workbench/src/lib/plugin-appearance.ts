import type { PluginAppearance } from "@infinite-canvas/plugin-sdk";

export function appearanceVariables(p: PluginAppearance): Record<string, string> {
    const variables: Record<string, string> = {
        background: p.background, foreground: p.text, card: p.panel, "card-foreground": p.text,
        popover: p.panel, "popover-foreground": p.text, primary: p.accent, "primary-foreground": p.accentText,
        "workbench-elevated-panel": p.panel, "workbench-elevated-text": p.text,
        secondary: p.surface, "secondary-foreground": p.text, muted: p.surface, "muted-foreground": p.muted,
        accent: p.surface, "accent-foreground": p.text, border: p.border, input: p.border, ring: p.accent,
        sidebar: p.panel, "sidebar-foreground": p.text, "sidebar-primary": p.accent,
        "sidebar-primary-foreground": p.accentText, "sidebar-accent": p.surface,
        "sidebar-accent-foreground": p.text, "sidebar-border": p.border, "sidebar-ring": p.accent,
        "canvas-canvas-background": p.background, "canvas-canvas-dot": p.border, "canvas-canvas-line": p.border,
        "canvas-canvas-selectionStroke": p.accent, "canvas-canvas-selectionFill": `color-mix(in srgb, ${p.accent} 12%, transparent)`,
        "canvas-node-label": p.muted, "canvas-node-fill": p.surface, "canvas-node-panel": p.panel,
        "canvas-node-stroke": p.border, "canvas-node-activeStroke": p.accent, "canvas-node-placeholder": p.muted,
        "canvas-node-text": p.text, "canvas-node-muted": p.muted, "canvas-node-faint": p.muted,
        "canvas-toolbar-panel": p.panel, "canvas-toolbar-border": p.border, "canvas-toolbar-item": p.text,
        "canvas-toolbar-itemHover": p.surface, "canvas-toolbar-activeBg": p.surface, "canvas-toolbar-activeText": p.text,
    };
    for (const [section, colors] of Object.entries(p.canvasTheme ?? {})) {
        for (const [token, value] of Object.entries(colors)) variables[`canvas-${section}-${token}`] = value;
    }
    for (const family of ["stone", "neutral", "zinc", "gray", "slate"]) {
        const light = [p.panel, p.background, p.surface, p.border, p.muted, p.muted, p.muted, p.text, p.text, p.text, p.text];
        const palette = p.mode === "dark" ? light.toReversed() : light;
        [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].forEach((step, i) => { variables[`color-${family}-${step}`] = palette[i]; });
    }
    return variables;
}
