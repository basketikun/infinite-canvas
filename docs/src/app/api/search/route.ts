import { source } from '@/lib/source';
import { createDocsSearchTokenizer } from '@/lib/search-tokenizer';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    en: {
      language: 'english',
    },
    'zh-CN': {
      components: {
        tokenizer: createDocsSearchTokenizer(),
      },
    },
  },
});
