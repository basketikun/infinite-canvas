'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';

const chineseText = {
  search: '搜索文档',
  searchNoResult: '没有找到结果',
  searchOpen: '打开搜索',
  searchClose: '关闭搜索',
  toc: '本页目录',
  tocNoHeadings: '本页没有标题',
  tocInline: '本页内容',
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
  lastUpdate: '最后更新',
  editOnGithub: '在 GitHub 中编辑',
  accordionCopyAnchor: '复制链接',
  headingCopyAnchor: '复制链接',
  bannerClose: '关闭通知',
  pageActionsOpenScira: '在 Scira 中打开',
  pageActionsOpenChatGPT: '在 ChatGPT 中打开',
  pageActionsOpenClaude: '在 Claude 中打开',
  pageActionsOpenCursor: '在 Cursor 中打开',
  pageActionsOpenInLLMPrompt: '阅读 {url}，我想就其中的内容提问。',
  typeTableProp: '属性',
  typeTableType: '类型',
  typeTableDefault: '默认值',
  typeTableParameters: '参数',
  typeTableReturns: '返回值',
};

export function Provider({ children }: { children: ReactNode }) {
  return <RootProvider i18n={{ translations: chineseText }} search={{ SearchDialog }}>{children}</RootProvider>;
}
