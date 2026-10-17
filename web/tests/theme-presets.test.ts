import { expect, test } from "bun:test";

import { canvasThemes } from "../src/lib/canvas-theme";
import { buildCanvasTheme, buildThemeCssVars, builtinThemes, getThemeMode, parseGhosttyTheme } from "../src/lib/theme-presets";

const ghostty = `# Catppuccin Frappe
palette = 0=#51576d
palette = 4=#8caaee
background = #303446
foreground = c6d0f5
cursor-color = #f2d5cf
`;

test("parses Ghostty theme seeds", () => {
    const preset = parseGhosttyTheme(ghostty, "Frappe");
    expect(preset).toMatchObject({ name: "Frappe", background: "#303446", foreground: "#c6d0f5", accent: "#8caaee" });
    expect(preset.id.startsWith("custom-")).toBe(true);
    expect(getThemeMode(preset)).toBe("dark");
});

test("falls back to cursor color when palette 4 is missing", () => {
    expect(parseGhosttyTheme("background = #ffffff\nforeground = #000000\ncursor-color = #ff0000", "x").accent).toBe("#ff0000");
});

test("rejects themes without background or foreground", () => {
    expect(() => parseGhosttyTheme("palette = 4=#8caaee", "x")).toThrow();
});

test("default themes keep the original palette and add no css vars", () => {
    const [light, dark] = builtinThemes;
    expect(buildCanvasTheme(light)).toBe(canvasThemes.light);
    expect(buildCanvasTheme(dark)).toBe(canvasThemes.dark);
    expect(buildThemeCssVars(dark)).toEqual({});
});

test("derived themes map gray ramp between background and foreground", () => {
    const mocha = builtinThemes.find((item) => item.id === "catppuccin-mocha")!;
    const vars = buildThemeCssVars(mocha);
    expect(vars["--color-stone-50"]).toBe(mocha.foreground);
    expect(vars["--color-stone-950"]).toBe(mocha.background);
    expect(vars["--background"]).toBe(mocha.background);
    expect(buildCanvasTheme(mocha).canvas.background).toBe(mocha.background);
    // 拼接透明度后缀的地方要求 6 位十六进制
    expect(buildCanvasTheme(mocha).node.activeStroke).toMatch(/^#[0-9a-f]{6}$/);
});
