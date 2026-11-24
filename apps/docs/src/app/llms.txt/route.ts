import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const revalidate = false;

export async function GET() {
  const docsIndex = await readFile(join(process.cwd(), 'index.md'), 'utf8');
  return new Response([docsIndex, llms(source).index()].join('\n\n'));
}
