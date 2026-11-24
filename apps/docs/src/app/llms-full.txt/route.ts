import { getLLMText, source } from '@/lib/source';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const revalidate = false;

export async function GET() {
  const docsIndex = await readFile(join(process.cwd(), 'index.md'), 'utf8');
  const scan = source.getPages().map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response([docsIndex, ...scanned].join('\n\n'));
}
