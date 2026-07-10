'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const tabs = [
  { title: '项目介绍', href: '/docs/overview/quick-start', prefix: '/docs/overview' },
  { title: '操作手册', href: '/docs/canvas/canvas-node-manual', prefix: '/docs/canvas' },
  { title: '开发文档', href: '/docs/development/local-development', prefix: '/docs/development' },
  { title: '项目进度', href: '/docs/progress/changelog', prefix: '/docs/progress' },
  { title: '商务合作', href: '/docs/business/business', prefix: '/docs/business' },
  { title: '赞助支持', href: '/docs/support/donate', prefix: '/docs/support' },
];

export function DocsTopTabs() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-30 hidden h-12 self-start overflow-x-auto border-b bg-fd-background/95 px-6 pt-3 backdrop-blur [grid-area:main] md:flex xl:px-8">
      <div className="flex flex-row items-end gap-6">
        {tabs.map((tab) => {
          const active = tab.prefix ? pathname === tab.href || pathname.startsWith(`${tab.prefix}/`) : pathname === tab.href;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'inline-flex border-b-2 border-transparent pb-1.5 text-sm font-medium text-nowrap text-fd-muted-foreground transition-colors hover:text-fd-accent-foreground',
                active && 'border-fd-primary text-fd-primary',
              )}
            >
              {tab.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
