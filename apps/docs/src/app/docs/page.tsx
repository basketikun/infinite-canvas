import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Markdown } from 'fumadocs-core/content/md';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { remarkHeading } from 'fumadocs-core/mdx-plugins';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';

export default async function Page() {
  const content = await readFile(join(process.cwd(), 'index.md'), 'utf8');
  const toc = getTableOfContents(content);

  return (
    <DocsPage toc={toc} tableOfContent={{ style: 'clerk' }}>
      <DocsTitle>无限画布文档</DocsTitle>
      <DocsDescription>功能说明、操作手册、部署方式、开发文档、商务合作与赞助支持</DocsDescription>
      <DocsBody>
        <Markdown components={getMDXComponents()} remarkPlugins={[remarkHeading]}>
          {content}
        </Markdown>
      </DocsBody>
    </DocsPage>
  );
}

export const metadata: Metadata = {
  title: '无限画布文档',
  description: '功能说明、操作手册、部署方式、开发文档、商务合作与赞助支持',
};
