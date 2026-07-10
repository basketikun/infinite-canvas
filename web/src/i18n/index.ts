import { en, type TranslationDictionary } from "./locales/en";
import { zh } from "./locales/zh";

export type AppLocale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "infinite-canvas:locale";
export const DEFAULT_LOCALE: AppLocale = "zh";

export const locales: Record<AppLocale, TranslationDictionary> = { en, zh };

type NestedKeyOf<T> = T extends string
    ? never
    : {
          [K in keyof T & string]: T[K] extends string ? K : `${K}.${NestedKeyOf<T[K]>}`;
      }[keyof T & string];

export type TranslationKey = NestedKeyOf<TranslationDictionary>;

function getNestedValue(dictionary: TranslationDictionary, key: string): string | undefined {
    const parts = key.split(".");
    let current: unknown = dictionary;

    for (const part of parts) {
        if (typeof current !== "object" || current === null || !(part in current)) {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return typeof current === "string" ? current : undefined;
}

export function createTranslator(locale: AppLocale) {
    const dictionary = locales[locale];

    return (key: TranslationKey, params?: Record<string, string | number>): string => {
        let value = getNestedValue(dictionary, key);
        if (value === undefined) {
            value = getNestedValue(locales.en, key);
        }
        if (value === undefined) {
            return key;
        }

        if (!params) {
            return value;
        }

        return Object.entries(params).reduce(
            (result, [paramKey, paramValue]) => result.replaceAll(`{{${paramKey}}}`, String(paramValue)),
            value,
        );
    };
}

export type TranslateFn = ReturnType<typeof createTranslator>;

export function readStoredLocale(): AppLocale | null {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh") {
        return stored;
    }
    return null;
}

export function resolveInitialLocale(): AppLocale {
    return readStoredLocale() ?? DEFAULT_LOCALE;
}

export function getIntlLocale(locale: AppLocale): string {
    return locale === "zh" ? "zh-CN" : "en-US";
}

export function getHtmlLang(locale: AppLocale): string {
    return locale === "zh" ? "zh-CN" : "en";
}

let currentLocale: AppLocale = DEFAULT_LOCALE;

export function setRuntimeLocale(locale: AppLocale) {
    currentLocale = locale;
}

export function getRuntimeLocale(): AppLocale {
    return currentLocale;
}

export function translate(key: TranslationKey, params?: Record<string, string | number>): string {
    return createTranslator(getRuntimeLocale())(key, params);
}
