import { getMDXComponents } from '@/components/mdx';
import { gitConfig } from '@/lib/shared';
import { getPageMarkdownUrl, source } from '@/lib/source';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { localizePath } from './i18n';

export type DocPageData = (typeof source)['$inferPage'];

export function DocPageContent({ page }: { page: DocPageData }) {
  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      tableOfContent={{ style: 'clerk' }}
      className="md:pt-20 xl:pt-24"
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/${gitConfig.docsContentDir}/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function getDocPageMetadata(page: DocPageData): Metadata {
  const path = `/docs/${page.slugs.join('/')}`;

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      languages: {
        en: localizePath('en', path),
        'zh-CN': localizePath('zh-CN', path),
      },
    },
  };
}
