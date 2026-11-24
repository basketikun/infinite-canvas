import { source } from '@/lib/source';
import { createDocsSearchTokenizer } from '@/lib/search-tokenizer';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  components: {
    tokenizer: createDocsSearchTokenizer(),
  },
});
