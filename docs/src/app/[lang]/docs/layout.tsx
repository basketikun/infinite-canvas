import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { DocsSidebarTabs, DocsTopTabs } from '@/components/docs-top-tabs';

export default async function Layout({ params, children }: LayoutProps<'/[lang]/docs'>) {
  const { lang } = await params;

  return (
    <DocsLayout {...baseOptions(lang)} tree={source.getPageTree(lang)} sidebar={{ banner: <DocsSidebarTabs key="docs-sections" /> }} tabs={false}>
      <DocsTopTabs />
      {children}
    </DocsLayout>
  );
}
