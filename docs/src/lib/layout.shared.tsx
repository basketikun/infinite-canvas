import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appNames, gitConfig } from './shared';
import { ArrowUpRight } from 'lucide-react';
import { i18n } from './i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const qqUrl = 'https://qm.qq.com/q/DFnKzZ807u';

export const translations = i18n.translations().extend(uiTranslations()).add('ui', {
  en: {
    displayName: 'English',
  },
  'zh-CN': {
    displayName: '简体中文',
    search: '搜索文档',
    searchNoResult: '没有找到结果',
    searchOpen: '打开搜索',
    searchClose: '关闭搜索',
    toc: '本页目录',
    tocNoHeadings: '本页没有标题',
    tocInline: '本页内容',
    chooseLanguage: '选择语言',
    nextPage: '下一页',
    previousPage: '上一页',
    chooseTheme: '选择主题',
    themeToggle: '切换主题',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    codeBlockCopy: '复制代码',
    codeBlockCopied: '已复制',
    menuToggle: '切换菜单',
    pageActionsCopyMarkdown: '复制 Markdown',
    pageActionsOpen: '打开',
    pageActionsOpenGitHub: '在 GitHub 中打开',
    pageActionsViewMarkdown: '查看 Markdown',
    sidebarOpen: '打开侧边栏',
    sidebarCollapse: '收起侧边栏',
    notFoundTitle: '页面不存在',
    notFoundDescription: '你访问的页面不存在。',
    notFoundLink: '返回首页',
  },
});

export function baseOptions(locale: string): BaseLayoutProps {
  const chinese = locale === 'zh-CN';
  const appName = appNames[locale as keyof typeof appNames];

  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <img src="/logo.svg" alt={appName} className="h-6 w-6" />
          <span>{appName}</span>
        </span>
      ),
    },
    links: [
      {
        text: chinese ? '文档导航' : 'Documentation',
        url: `${chinese ? '/zh-CN' : ''}/docs/overview/quick-start`,
        on: 'nav',
      },
      {
        text: (
          <span className="inline-flex items-center gap-1.5">
            <span>{chinese ? '在线体验' : 'Live Demo'}</span>
            <ArrowUpRight className="size-4" />
          </span>
        ),
        url: 'https://canvas.best/',
        external: true,
        on: 'nav',
      },
      {
        type: 'icon',
        text: 'GitHub',
        label: 'GitHub',
        url: githubUrl,
        external: true,
        on: 'menu',
        icon: <img src="/github.svg" alt="" className="size-4" />,
      },
      {
        type: 'icon',
        text: 'QQ',
        label: 'QQ',
        url: qqUrl,
        external: true,
        on: 'menu',
        icon: <img src="/qq.svg" alt="" className="size-4" />,
      },
    ],
  };
}
