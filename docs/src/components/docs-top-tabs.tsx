'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { localizePath, type Locale } from '@/lib/i18n';

const tabs = [
  { title: { en: 'Overview', 'zh-CN': '项目介绍' }, href: '/docs/overview/quick-start', prefix: '/docs/overview' },
  { title: { en: 'Canvas Guide', 'zh-CN': '操作手册' }, href: '/docs/canvas/canvas-node-manual', prefix: '/docs/canvas' },
  { title: { en: 'Development', 'zh-CN': '开发文档' }, href: '/docs/development/local-development', prefix: '/docs/development' },
  { title: { en: 'Progress', 'zh-CN': '项目进度' }, href: '/docs/progress/changelog', prefix: '/docs/progress' },
  { title: { en: 'Business', 'zh-CN': '商务合作' }, href: '/docs/business/business', prefix: '/docs/business' },
  { title: { en: 'Support', 'zh-CN': '赞助支持' }, href: '/docs/support/sponsor', prefix: '/docs/support' },
];

export function DocsTopTabs() {
  const pathname = usePathname();
  const { lang } = useParams<{ lang: Locale }>();

  return (
    <nav className="sticky top-0 z-30 hidden h-12 self-start overflow-x-auto border-b bg-fd-background/95 px-6 pt-3 backdrop-blur [grid-area:main] md:flex xl:px-8">
      <div className="flex flex-row items-end gap-6">
        {tabs.map((tab) => {
          const href = localizePath(lang, tab.href);
          const prefix = localizePath(lang, tab.prefix);
          const active = pathname === href || pathname.startsWith(`${prefix}/`);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'inline-flex border-b-2 border-transparent pb-1.5 text-sm font-medium text-nowrap text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground',
                active && 'border-fd-primary text-fd-primary',
              )}
            >
              {tab.title[lang]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
