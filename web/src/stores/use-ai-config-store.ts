import { create } from "zustand";
import { persist } from "zustand/middleware";

import { CONFIG_STORE_KEY, CONFIG_STORE_VERSION, defaultConfig, type AiConfig } from "@/lib/ai-config";

type AiConfigStore = {
  config: AiConfig;
  updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
};

export const useAiConfigStore = create<AiConfigStore>()(
  persist(
    (set) => ({
      config: defaultConfig,
      updateConfig: (key, value) =>
        set((state) => ({
          config: {
            ...state.config,
            [key]: value,
          },
        })),
    }),
    {
      name: CONFIG_STORE_KEY,
      version: CONFIG_STORE_VERSION,
      migrate: () => ({ config: defaultConfig }),
      merge: (persisted, current) => {
        const persistedConfig = (persisted as Partial<AiConfigStore>).config || {};
        return { ...current, config: { ...defaultConfig, ...persistedConfig } };
      },
    },
  ),
);
