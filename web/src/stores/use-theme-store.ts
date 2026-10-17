import { create } from "zustand";
import { persist } from "zustand/middleware";

import { findTheme, getThemeMode, type ThemePreset } from "@/lib/theme-presets";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    // 当前主题的明暗，供 dark 类名、antd 算法等明暗判断使用。
    theme: ThemeName;
    themeId: string;
    customThemes: ThemePreset[];
    // 明暗切换按钮使用：切到对应的默认主题。
    setTheme: (theme: ThemeName) => void;
    setThemeId: (id: string) => void;
    addCustomTheme: (preset: ThemePreset) => void;
    removeCustomTheme: (id: string) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set, get) => ({
            theme: "dark",
            themeId: "dark",
            customThemes: [],
            setTheme: (theme) => set({ theme, themeId: theme }),
            setThemeId: (id) => {
                const preset = findTheme(id, get().customThemes);
                set({ themeId: preset.id, theme: getThemeMode(preset) });
            },
            addCustomTheme: (preset) => set((state) => ({ customThemes: [...state.customThemes, preset] })),
            removeCustomTheme: (id) =>
                set((state) => ({
                    customThemes: state.customThemes.filter((item) => item.id !== id),
                    ...(state.themeId === id ? { themeId: state.theme } : {}),
                })),
        }),
        { name: "infinite-canvas:theme_store" },
    ),
);

export function useActiveTheme() {
    return useThemeStore((state) => findTheme(state.themeId, state.customThemes));
}
