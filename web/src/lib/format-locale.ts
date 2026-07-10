import { getIntlLocale, type AppLocale } from "@/i18n";

export function formatLocaleDateTime(value: string | number | Date, locale: AppLocale, options?: Intl.DateTimeFormatOptions) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString(getIntlLocale(locale), options);
}

export function formatLocaleDate(value: string | number | Date, locale: AppLocale, options?: Intl.DateTimeFormatOptions) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString(getIntlLocale(locale), options);
}
