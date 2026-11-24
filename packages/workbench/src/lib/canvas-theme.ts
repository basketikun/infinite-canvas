export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "var(--canvas-canvas-background, #f4f2ed)",
            dot: "var(--canvas-canvas-dot, rgba(68,64,60,.28))",
            line: "var(--canvas-canvas-line, rgba(68,64,60,.12))",
            selectionStroke: "var(--canvas-canvas-selectionStroke, #1c1917)",
            selectionFill: "var(--canvas-canvas-selectionFill, rgba(28,25,23,.06))",
        },
        node: {
            label: "var(--canvas-node-label, #57534e)",
            fill: "var(--canvas-node-fill, #e7e5df)",
            panel: "var(--canvas-node-panel, #fbfaf7)",
            stroke: "var(--canvas-node-stroke, #d6d3ca)",
            activeStroke: "var(--canvas-node-activeStroke, #1c1917)",
            placeholder: "var(--canvas-node-placeholder, #8a8479)",
            text: "var(--canvas-node-text, #292524)",
            muted: "var(--canvas-node-muted, #78716c)",
            faint: "var(--canvas-node-faint, #a8a29e)",
        },
        toolbar: {
            panel: "var(--canvas-toolbar-panel, rgba(251,250,247,.96))",
            border: "var(--canvas-toolbar-border, #d6d3ca)",
            item: "var(--canvas-toolbar-item, #57534e)",
            itemHover: "var(--canvas-toolbar-itemHover, #e7e5df)",
            activeBg: "var(--canvas-toolbar-activeBg, #e7e5df)",
            activeText: "var(--canvas-toolbar-activeText, #292524)",
        },
    },
    dark: {
        canvas: {
            background: "var(--canvas-canvas-background, #181715)",
            dot: "var(--canvas-canvas-dot, rgba(245,245,244,.24))",
            line: "var(--canvas-canvas-line, rgba(245,245,244,.10))",
            selectionStroke: "var(--canvas-canvas-selectionStroke, #fafaf9)",
            selectionFill: "var(--canvas-canvas-selectionFill, rgba(250,250,249,.10))",
        },
        node: {
            label: "var(--canvas-node-label, #d6d3d1)",
            fill: "var(--canvas-node-fill, #292524)",
            panel: "var(--canvas-node-panel, #1f1d1a)",
            stroke: "var(--canvas-node-stroke, #44403c)",
            activeStroke: "var(--canvas-node-activeStroke, #fafaf9)",
            placeholder: "var(--canvas-node-placeholder, #a8a29e)",
            text: "var(--canvas-node-text, #f5f5f4)",
            muted: "var(--canvas-node-muted, #d6d3d1)",
            faint: "var(--canvas-node-faint, #78716c)",
        },
        toolbar: {
            panel: "var(--canvas-toolbar-panel, rgba(31,29,26,.96))",
            border: "var(--canvas-toolbar-border, #44403c)",
            item: "var(--canvas-toolbar-item, #d6d3d1)",
            itemHover: "var(--canvas-toolbar-itemHover, #292524)",
            activeBg: "var(--canvas-toolbar-activeBg, #3a3631)",
            activeText: "var(--canvas-toolbar-activeText, #f5f5f4)",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
