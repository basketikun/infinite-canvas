import Link from 'next/link';
import { ArrowUpRight, BookOpen, Rocket } from 'lucide-react';
import { appNames, gitConfig } from '@/lib/shared';
import { localizePath, type Locale } from '@/lib/i18n';
import type { Metadata } from 'next';

const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
const demoUrl = 'https://canvas.best/';
const starHistoryUrl = `https://www.star-history.com/?repos=${gitConfig.user}%2F${gitConfig.repo}&type=date`;
const starHistoryChart = `https://api.star-history.com/chart?repos=${gitConfig.user}/${gitConfig.repo}&type=date&transparent=true`;
const darkStarHistoryChart = `${starHistoryChart}&theme=dark`;

const previewImages = [
  {
    src: 'https://i.ibb.co/TDFvGWDT/image.png',
    title: { en: 'Canvas composition', 'zh-CN': '画布编排' },
  },
  {
    src: 'https://i.ibb.co/zVwJq3YS/image.png',
    title: { en: 'Image generation', 'zh-CN': '图片生成' },
  },
  {
    src: 'https://i.ibb.co/PvY3qhhK/image.png',
    title: { en: 'Reference editing', 'zh-CN': '参考图编辑' },
  },
  {
    src: 'https://i.ibb.co/7D04LwN/image.png',
    title: { en: 'Node workflow', 'zh-CN': '节点工作流' },
  },
];

const messages = {
  en: {
    eyebrow: 'Open-source AI image creation workspace',
    center: 'Documentation',
    description: 'An infinite canvas for image creation that brings canvas composition, AI generation, reference editing, and reusable assets into one workflow.',
    quickStart: 'Quick Start',
    demo: 'Live Demo',
    gallery: 'Gallery',
    features: 'Explore Features',
    previewAlt: 'Infinite Canvas preview',
    contributors: 'Contributors',
    contributorsDescription: 'Thank you to everyone who has contributed to this project',
    contributorsAlt: 'Contributor avatars',
  },
  'zh-CN': {
    eyebrow: '开源 AI 图片创作工作台',
    center: '文档中心',
    description: '面向图片创作的无限画布，把画布编排、AI 生成、参考图编辑和素材沉淀放在同一个工作流里。',
    quickStart: '快速开始',
    demo: '在线体验',
    gallery: '效果展示',
    features: '功能介绍',
    previewAlt: '无限画布效果图',
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
            <a
              href={demoUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              {text.demo}
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl lg:w-[108%] lg:max-w-none">
          <img
            src={previewImages[3].src}
            alt={text.previewAlt}
            className="aspect-[16/10] w-full rounded-xl object-cover"
          />
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
          {previewImages.map((item) => (
            <img
              key={item.src}
              src={item.src}
              alt={item.title[locale]}
              loading="lazy"
              decoding="async"
              className="aspect-[16/10] w-full rounded-2xl object-cover"
            />
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
