import { getLLMText, getPageMarkdownUrl, source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(req: Request, { params }: RouteContext<'/llms.mdx/docs/[[...slug]]'>) {
  const { slug } = await params;
  const locale = new URL(req.url).searchParams.get('locale') ?? 'en';
  // remove the appended "content.md"
  const page = source.getPage(slug?.slice(0, -1), locale);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return source.getPages('en').map((page) => ({
    slug: getPageMarkdownUrl(page).segments,
  }));
}
