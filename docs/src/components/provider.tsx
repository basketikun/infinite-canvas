'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { type ReactNode } from 'react';
import { translations } from '@/lib/layout.shared';
import { i18n, localizePath } from '@/lib/i18n';

function changeLocale(locale: string) {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (i18n.languages.some((language) => language === segments[0])) segments.shift();
  const path = segments.length ? `/${segments.join('/')}` : '/';
  window.location.assign(`${localizePath(locale, path)}${window.location.search}${window.location.hash}`);
}

export function Provider({ locale, children }: { locale: string; children: ReactNode }) {
  return <RootProvider i18n={{ ...i18nProvider(translations, locale), onLocaleChange: changeLocale }} search={{ SearchDialog }}>{children}</RootProvider>;
}
