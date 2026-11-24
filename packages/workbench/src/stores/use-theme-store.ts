import type { PluginAppearance } from "@infinite-canvas/plugin-sdk";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    baseTheme: ThemeName;
    theme: ThemeName;
    appearance: PluginAppearance | null;
    selection: string | null;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            baseTheme: "dark",
            theme: "dark",
            appearance: null,
            selection: null,
            setTheme: (baseTheme) => set({ baseTheme, selection: null }),
        }),
        { name: "infinite-canvas-v1:theme_store", version: 1, partialize: ({ baseTheme, selection }) => ({ baseTheme, selection }) },
    ),
);
