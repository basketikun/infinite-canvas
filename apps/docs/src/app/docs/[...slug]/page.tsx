import { DocPageContent, getDocPageMetadata } from '@/lib/doc-page';
import { source } from '@/lib/source';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export default async function Page(props: PageProps<'/docs/[...slug]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return <DocPageContent page={page} />;
}

export async function generateMetadata(props: PageProps<'/docs/[...slug]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return getDocPageMetadata(page);
}

export function generateStaticParams() {
  return source.generateParams();
}
