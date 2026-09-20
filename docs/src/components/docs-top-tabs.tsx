'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { localizePath, type Locale } from '@/lib/i18n';
import { SidebarTabsDropdown } from 'fumadocs-ui/components/sidebar/tabs/dropdown';
import type { LayoutTab } from 'fumadocs-ui/layouts/shared';
import { BookOpen, Code2, Handshake, HeartHandshake, ListChecks, MousePointer2, type LucideIcon } from 'lucide-react';

type DocsSection = {
  title: Record<Locale, string>;
  description: Record<Locale, string>;
  href: string;
  prefix: string;
  pages: readonly string[];
  icon: LucideIcon;
};

const tabs: DocsSection[] = [
  { title: { en: 'Overview', 'zh-CN': '项目介绍' }, description: { en: 'Start here and explore features', 'zh-CN': '快速开始与功能介绍' }, href: '/docs/overview/quick-start', prefix: '/docs/overview', pages: ['quick-start', 'codex-app-plugin', 'features', 'render', 'docker'], icon: BookOpen },
  { title: { en: 'Canvas Guide', 'zh-CN': '操作手册' }, description: { en: 'Canvas nodes and shortcuts', 'zh-CN': '画布节点与快捷键' }, href: '/docs/canvas/canvas-node-manual', prefix: '/docs/canvas', pages: ['canvas-node-manual', 'canvas-shortcuts'], icon: MousePointer2 },
  { title: { en: 'Development', 'zh-CN': '开发文档' }, description: { en: 'Local development and internals', 'zh-CN': '本地开发与内部结构' }, href: '/docs/development/local-development', prefix: '/docs/development', pages: ['local-development', 'local-codex-canvas', 'canvas-data-structure'], icon: Code2 },
  { title: { en: 'Progress', 'zh-CN': '项目进度' }, description: { en: 'Changelog, plans, and testing', 'zh-CN': '变更、计划与待测试项' }, href: '/docs/progress/changelog', prefix: '/docs/progress', pages: ['changelog', 'todo', 'pending-test', 'local-agent-integration-plan', 'prompt-chip-input-plan'], icon: ListChecks },
  { title: { en: 'Business', 'zh-CN': '商务合作' }, description: { en: 'Cooperation and licensing', 'zh-CN': '合作方式与开源许可' }, href: '/docs/business/business', prefix: '/docs/business', pages: ['business', 'license'], icon: Handshake },
  { title: { en: 'Support', 'zh-CN': '赞助支持' }, description: { en: 'Sponsorship and security', 'zh-CN': '赞助项目与安全说明' }, href: '/docs/support/sponsor', prefix: '/docs/support', pages: ['sponsor', 'security'], icon: HeartHandshake },
];

export function DocsSidebarTabs() {
  const { lang } = useParams<{ lang: Locale }>();
  const options: LayoutTab[] = tabs.map((tab) => {
    const Icon = tab.icon;

    return {
      title: tab.title[lang],
      description: tab.description[lang],
      url: localizePath(lang, tab.href),
      urls: new Set(tab.pages.map((page) => localizePath(lang, `${tab.prefix}/${page}`))),
      icon: (
        <span className="flex size-full items-center justify-center rounded-md bg-fd-primary/10 text-fd-primary">
          <Icon className="size-4" />
        </span>
      ),
    };
  });

  return <SidebarTabsDropdown className="md:hidden" options={options} />;
}

export function DocsTopTabs() {
  const pathname = usePathname();
  const { lang } = useParams<{ lang: Locale }>();

  return (
    <nav aria-label={lang === 'zh-CN' ? '文档分类' : 'Documentation sections'} className="sticky top-0 z-30 hidden h-12 self-start overflow-x-auto border-b bg-fd-background/95 px-6 pt-3 backdrop-blur [grid-area:main] md:flex xl:px-8">
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
