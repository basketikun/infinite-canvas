import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Markdown } from 'fumadocs-core/content/md';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { remarkHeading } from 'fumadocs-core/mdx-plugins';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';

const messages = {
  en: {
    title: 'DSH FreeCanvas Documentation',
    description: 'DSH plugin usage, features, canvas guides, development, project use, and support',
    index: 'index.md',
  },
  'zh-CN': {
    title: 'DSH FreeCanvas 文档',
    description: 'DSH 插件使用、功能说明、操作手册、开发文档、项目使用与支持',
    index: 'index.zh-CN.md',
  },
};

async function readDocsIndex(locale: keyof typeof messages) {
  return readFile(join(process.cwd(), messages[locale].index), 'utf8');
}

export default async function Page({ params }: PageProps<'/[lang]/docs'>) {
  const { lang } = await params;
  const locale = lang as keyof typeof messages;
  const content = await readDocsIndex(locale);
  const text = messages[locale];
  const toc = getTableOfContents(content);

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{text.title}</DocsTitle>
      <DocsDescription>{text.description}</DocsDescription>
      <DocsBody>
        <Markdown components={getMDXComponents()} remarkPlugins={[remarkHeading]}>
          {content}
        </Markdown>
      </DocsBody>
    </DocsPage>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]/docs'>): Promise<Metadata> {
  const { lang } = await params;
  const text = messages[lang as keyof typeof messages];

  return {
    title: text.title,
    description: text.description,
  };
}
