import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { DocsTopTabs } from '@/components/docs-top-tabs';

export default async function Layout({ params, children }: LayoutProps<'/[lang]/docs'>) {
  const { lang } = await params;

  return (
    <DocsLayout {...baseOptions(lang)} tree={source.getPageTree(lang)} tabs={false}>
      <DocsTopTabs />
      {children}
    </DocsLayout>
  );
}
