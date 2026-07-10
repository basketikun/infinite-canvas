import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, setRuntimeLocale, type AppLocale } from "@/i18n";

type LocaleStore = {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
};

export const useLocaleStore = create<LocaleStore>()(
    persist(
        (set) => ({
            locale: DEFAULT_LOCALE,
            setLocale: (locale) => {
                setRuntimeLocale(locale);
                localStorage.setItem(LOCALE_STORAGE_KEY, locale);
                set({ locale });
            },
        }),
        {
            name: LOCALE_STORAGE_KEY,
            onRehydrateStorage: () => (state) => {
                if (state?.locale) {
                    setRuntimeLocale(state.locale);
                }
            },
        },
    ),
);
