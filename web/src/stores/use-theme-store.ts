import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { sharedPreferenceStorage } from "@/lib/shared-storage";

export type ThemeName = "light" | "dark";

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>()(
    persist(
        (set) => ({
            theme: "dark",
            setTheme: (theme) => set({ theme }),
        }),
        { name: "infinite-canvas:theme_store", storage: createJSONStorage(() => sharedPreferenceStorage) },
    ),
);
