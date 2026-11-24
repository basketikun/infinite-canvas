import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Markdown } from 'fumadocs-core/content/md';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { remarkHeading } from 'fumadocs-core/mdx-plugins';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';

export default async function Page() {
  const content = await readFile(join(process.cwd(), '../..', 'CHANGELOG.md'), 'utf8');
  const toc = getTableOfContents(content);

  return (
    <DocsPage toc={toc} tableOfContent={{ style: 'clerk' }}>
      <DocsTitle>更新日志</DocsTitle>
      <DocsDescription>项目版本变更记录</DocsDescription>
      <DocsBody>
        <Markdown components={getMDXComponents()} remarkPlugins={[remarkHeading]}>
          {content}
        </Markdown>
      </DocsBody>
    </DocsPage>
  );
}

export const metadata: Metadata = {
  title: '更新日志',
  description: '项目版本变更记录',
};
