import { defineI18n } from 'fumadocs-core/i18n';

export type Locale = 'en' | 'zh-CN';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'zh-CN'],
  parser: 'dot',
  hideLocale: 'default-locale',
  fallbackLanguage: null,
});

export function localizePath(locale: string, path: string) {
  return locale === i18n.defaultLanguage ? path : `/${locale}${path}`;
}
