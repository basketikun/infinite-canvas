import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { createTranslator, getHtmlLang, setRuntimeLocale, type AppLocale, type TranslateFn } from "@/i18n";
import { useLocaleStore } from "@/stores/use-locale-store";

type LocaleContextValue = {
    locale: AppLocale;
    setLocale: (locale: AppLocale) => void;
    t: TranslateFn;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function LocaleProvider({ children }: { children: ReactNode }) {
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);

    useEffect(() => {
        setRuntimeLocale(locale);
        document.documentElement.lang = getHtmlLang(locale);
    }, [locale]);

    const t = useMemo(() => createTranslator(locale), [locale]);

    const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
    const context = useContext(LocaleContext);
    if (!context) {
        throw new Error("useTranslation must be used within LocaleProvider");
    }
    return context;
}
