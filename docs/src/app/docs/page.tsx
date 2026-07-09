import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { Markdown } from 'fumadocs-core/content/md';
import { getTableOfContents } from 'fumadocs-core/content/toc';
import { remarkHeading } from 'fumadocs-core/mdx-plugins';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';

const title = 'Cozy Tv 文档';
const description = '功能说明、操作手册、部署方式与开发文档';

async function readDocsIndex() {
  return readFile(join(process.cwd(), 'index.md'), 'utf8');
}

export default async function Page() {
  const content = await readDocsIndex();
  const toc = getTableOfContents(content);

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <Markdown components={getMDXComponents()} remarkPlugins={[remarkHeading]}>
          {content}
        </Markdown>
      </DocsBody>
    </DocsPage>
  );
}

export function generateMetadata(): Metadata {
  return {
    title,
    description,
  };
}
