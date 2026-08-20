import { DocPageContent, getDocPageMetadata } from '@/lib/doc-page';
import { source } from '@/lib/source';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function Page(props: PageProps<'/[lang]/docs/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  return <DocPageContent page={page} />;
}

export async function generateMetadata(props: PageProps<'/[lang]/docs/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug, params.lang);
  if (!page) notFound();

  return getDocPageMetadata(page);
}

export function generateStaticParams() {
  return source.generateParams();
}
