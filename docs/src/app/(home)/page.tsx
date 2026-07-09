import Link from 'next/link';
import { ArrowUpRight, BookOpen, Rocket } from 'lucide-react';
import { appName } from '@/lib/shared';

const placeholderUrl = '#';

const previewImages = [
  {
    src: 'https://i.ibb.co/TDFvGWDT/image.png',
    title: '画布编排',
  },
  {
    src: 'https://i.ibb.co/zVwJq3YS/image.png',
    title: '图片生成',
  },
  {
    src: 'https://i.ibb.co/PvY3qhhK/image.png',
    title: '参考图编辑',
  },
  {
    src: 'https://i.ibb.co/7D04LwN/image.png',
    title: '节点工作流',
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-8 md:px-10 md:pt-14">
      <section className="grid min-h-[520px] items-center gap-10 border-b border-zinc-200 pb-12 dark:border-zinc-800 lg:grid-cols-[0.88fr_1.12fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            开源 AI 图片创作工作台
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">文档中心</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">
            面向图片创作的 Cozy Tv，把画布编排、AI 生成、参考图编辑、提示词库和素材沉淀放在同一个工作流里。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/docs/overview/quick-start"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <BookOpen className="size-4" />
              快速开始
            </Link>
            <a
              href={placeholderUrl}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              <img src="/github.svg" alt="" className="size-4" />
              GitHub 待配置
            </a>
            <a
              href={placeholderUrl}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 px-5 py-3 text-sm font-medium text-zinc-900 transition hover:border-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
            >
              在线体验待配置
              <ArrowUpRight className="size-4" />
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl lg:w-[108%] lg:max-w-none">
          <img
            src={previewImages[3].src}
            alt="Cozy Tv 效果图"
            className="aspect-[16/10] w-full rounded-xl object-cover"
          />
        </div>
      </section>

      <section className="mt-14">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
              效果展示
            </h2>
          </div>
          <Link
            href="/docs/overview/features"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
          >
            功能介绍
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {previewImages.map((item) => (
            <img
              key={item.src}
              src={item.src}
              alt={`${item.title}效果图`}
              loading="lazy"
              decoding="async"
              className="aspect-[16/10] w-full rounded-2xl object-cover"
            />
          ))}
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-4xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          开发贡献者
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          感谢所有为本项目做出贡献的开发者
        </p>
        <div className="mt-7 flex justify-center">
          <a
            href={placeholderUrl}
            className="inline-flex max-w-full"
          >
            <span className="rounded-full border border-dashed border-zinc-300 px-5 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">贡献者入口待配置</span>
          </a>
        </div>
      </section>

      <section className="mx-auto mt-16 w-full max-w-5xl text-center">
        <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
          Star History
        </h2>
        <div className="mt-7 flex justify-center">
          <div className="w-full max-w-4xl rounded-2xl border border-dashed border-zinc-300 py-12 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">Star History 待配置</div>
        </div>
      </section>
    </main>
  );
}
