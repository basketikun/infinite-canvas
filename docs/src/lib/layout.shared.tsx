import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName } from './shared';
import { ArrowUpRight } from 'lucide-react';

const placeholderUrl = '#';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo.png" alt={appName} className="h-6 w-6 rounded-sm object-contain" />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        text: '文档导航',
        url: '/docs/overview/quick-start',
        on: 'nav',
      },
      {
        text: (
          <span className="inline-flex items-center gap-1.5">
            <span>在线体验待配置</span>
            <ArrowUpRight className="size-4" />
          </span>
        ),
        url: placeholderUrl,
        on: 'nav',
      },
      {
        type: 'icon',
        text: 'GitHub',
        label: 'GitHub 待配置',
        url: placeholderUrl,
        on: 'menu',
        icon: <img src="/github.svg" alt="" className="size-4" />,
      },
      {
        type: 'icon',
        text: 'QQ',
        label: 'QQ 待配置',
        url: placeholderUrl,
        on: 'menu',
        icon: <img src="/qq.svg" alt="" className="size-4" />,
      },
    ],
  };
}
