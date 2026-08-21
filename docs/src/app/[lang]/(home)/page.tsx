import Link from 'next/link';
import { ArrowUpRight, BookOpen, Rocket } from 'lucide-react';
import { appNames, gitConfig } from '@/lib/shared';
import { localizePath, type Locale } from '@/lib/i18n';
import type { Metadata } from 'next';

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const starHistoryUrl = `https://www.star-history.com/?repos=${gitConfig.user}%2F${gitConfig.repo}&type=date`;
const starHistoryChart = `https://api.star-history.com/chart?repos=${gitConfig.user}/${gitConfig.repo}&type=date&transparent=true`;
const darkStarHistoryChart = `${starHistoryChart}&theme=dark`;

const capabilityCards = [
  {
    title: { en: 'Canvas composition', 'zh-CN': '画布编排' },
    description: { en: 'Arrange images, text, media, generation settings, and reusable flows on one canvas.', 'zh-CN': '在同一画布中编排图片、文本、媒体、生成配置与可复用流程。' },
  },
  {
    title: { en: 'DSH integration', 'zh-CN': 'DSH 集成' },
    description: { en: 'Open DSH FreeCanvas from the DSH sidebar with session, split, and full-canvas layouts.', 'zh-CN': '从 DSH 侧边栏打开 DSH FreeCanvas，支持会话、分屏与全画布布局。' },
  },
  {
    title: { en: 'Local Agent', 'zh-CN': '本地 Agent' },
    description: { en: 'Connect Codex or Claude Code through the local Canvas Agent and MCP toolchain.', 'zh-CN': '通过本地 Canvas Agent 与 MCP 工具链连接 Codex 或 Claude Code。' },
  },
  {
    title: { en: 'Local-first data', 'zh-CN': '本地优先数据' },
    description: { en: 'Keep canvases, assets, generation records, and API keys in browser-local storage by default.', 'zh-CN': '画布、素材、生成记录和 API Key 默认保存在浏览器本地。' },
  },
];

const messages = {
  en: {
    eyebrow: 'Self-contained AI canvas plugin for DSH',
    center: 'Documentation',
    description: 'Install DSH FreeCanvas in DSH and use canvas composition, AI generation, reference editing, prompt libraries, reusable assets, and local agents without a separate service.',
    quickStart: 'Quick Start',
    gallery: 'Built for DSH workflows',
    features: 'Explore Features',
    capabilityLabel: 'DSH canvas workspace',
    contributors: 'Contributors',
    contributorsDescription: 'Thank you to everyone who has contributed to this project',
    contributorsAlt: 'Contributor avatars',
  },
  'zh-CN': {
    eyebrow: '直接运行在 DSH 内的 AI 无限画布插件',
    center: '文档中心',
    description: '在 DSH 中安装 DSH FreeCanvas，即可使用画布编排、AI 生成、参考图编辑、提示词库、素材管理和本地 Agent，无需单独启动服务。',
    quickStart: '快速开始',
    gallery: '面向 DSH 工作流',
    features: '功能介绍',
    capabilityLabel: 'DSH 画布工作台',
    contributors: '开发贡献者',
    contributorsDescription: '感谢所有为本项目做出贡献的开发者',
    contributorsAlt: '开发贡献者头像',
  },
};

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];
  const appName = appNames[locale];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-8 md:px-10 md:pt-14">
      <section className="grid min-h-[520px] items-center gap-10 border-b border-zinc-200 pb-12 dark:border-zinc-800 lg:grid-cols-[0.88fr_1.12fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            {text.eyebrow}
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">{text.center}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">
            {text.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={localizePath(locale, '/docs/overview/quick-start')}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <BookOpen className="size-4" />
              {text.quickStart}
            </Link>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              <img src="/github.svg" alt="" className="size-4" />
              GitHub
            </a>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-7 dark:border-zinc-800 dark:bg-zinc-950 lg:w-[108%] lg:max-w-none">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">{text.capabilityLabel}</div>
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
            {capabilityCards.map((item, index) => (
              <div key={item.title[locale]} className="min-h-28 bg-white p-5 dark:bg-zinc-900">
                <div className="text-xs text-zinc-400">0{index + 1}</div>
                <div className="mt-5 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.title[locale]}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-14">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
              {text.gallery}
            </h2>
          </div>
          <Link
            href={localizePath(locale, '/docs/overview/features')}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
          >
            {text.features}
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {capabilityCards.map((item) => (
            <article key={item.title[locale]} className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
              <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{item.title[locale]}</h3>
              <p className="mt-3 text-sm leading-7 text-zinc-600 dark:text-zinc-400">{item.description[locale]}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-4xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          {text.contributors}
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {text.contributorsDescription}
        </p>
        <div className="mt-7 flex justify-center">
          <a
            href={`${githubUrl}/graphs/contributors`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex max-w-full"
          >
            <img
              src={`https://contrib.rocks/image?repo=${gitConfig.user}/${gitConfig.repo}`}
              alt={text.contributorsAlt}
              loading="lazy"
              decoding="async"
              className="max-w-full"
            />
          </a>
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-5xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          Star History
        </h2>
        <div className="mt-7 flex justify-center">
          <a
            href={starHistoryUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="block w-full max-w-4xl"
          >
            <picture>
              <source
                media="(prefers-color-scheme: dark)"
                srcSet={darkStarHistoryChart}
              />
              <source
                media="(prefers-color-scheme: light)"
                srcSet={starHistoryChart}
              />
              <img
                src={starHistoryChart}
                alt="Star History Chart"
                loading="lazy"
                decoding="async"
                className="mx-auto w-full"
              />
            </picture>
          </a>
        </div>
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];

  return {
    title: `${appNames[locale]} ${text.center}`,
    description: text.description,
    alternates: {
      languages: {
        en: '/',
        'zh-CN': '/zh-CN',
      },
    },
  };
}
