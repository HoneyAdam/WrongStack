/**
 * `codebase-search` tool — search the symbol index with BM25 ranking.
 *
 * Usage: codebase-search({
 *   query: string,        // search terms
 *   kind?: string,       // class|function|interface|method|const|...
 *   lang?: string,       // ts|tsx|js|jsx|go|py|rs
 *   file?: string,       // filter to a specific file path (substring match)
 *   limit?: number,      // max results (default 20, max 100)
 * })
 *
 * Returns: [{ name, kind, lang, file, line, signature, snippet, score }, ...]
 */

import type { Tool } from '@wrongstack/core';
import { IndexStore, codebaseIndexDirOverride } from './writer.js';
import { buildBm25Index, buildIndexableText, tokenise } from './bm25.js';
import type { SearchResult, SymbolKind, SymbolLang } from './schema.js';

export const codebaseSearchTool: Tool<CodebaseSearchInput, CodebaseSearchOutput> = {
  name: 'codebase-search',
  category: 'Project',
  description:
    'Search indexed code symbols by name, signature, or doc comment. Uses BM25 ranking for relevance.',
  usageHint:
    'Pass `query` for keyword search. Filter with `kind` (class/function/interface/etc), `lang` (ts/js/etc), `file` (substring). `limit` caps results (default 20).',
  permission: 'auto',
  mutating: false,
  timeoutMs: 10_000,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — searches symbol names, signatures, and doc comments',
      },
      kind: {
        type: 'string',
        description: 'Filter by symbol kind: class, function, interface, method, const, let, var, property, type, enum',
      },
      lang: {
        type: 'string',
        description: 'Filter by language: ts, tsx, js, jsx',
      },
      lspKind: {
        type: 'integer',
        description: 'Filter by LSP SymbolKind number (e.g. 5=Class, 12=Function, 11=Interface, 10=Enum)',
      },
      file: {
        type: 'string',
        description: 'Filter to files matching this path substring',
      },
      limit: {
        type: 'integer',
        description: 'Maximum results to return (default 20, max 100)',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['query'],
  },
  async execute(input, ctx) {
    const store = new IndexStore(ctx.projectRoot, { indexDir: codebaseIndexDirOverride(ctx) });
    try {
      const limit = Math.min(input.limit ?? 20, 100);

      // 1. Get initial candidates from SQLite (broad filter)
      const candidates = store.search(input.query, {
        kind: input.kind as SymbolKind | undefined,
        lang: input.lang as SymbolLang | undefined,
        file: input.file,
        lspKind: input.lspKind,
      });

      if (candidates.length === 0) {
        return { results: [], total: 0, query: input.query };
      }

      // 2. Build BM25 index over candidates
      // Use buildIndexableText to split camelCase names so queries like
      // "complex" match "complexOperation" (split → "complex Operation")
      const indexable = candidates.map((c) => ({
        id: c.id,
        text: buildIndexableText(c.name, c.signature, c.docComment),
      }));
      const bm25 = buildBm25Index(indexable);

      // 3. Score and rank
      const scored = bm25.score(input.query, (id) => candidates.some((c) => c.id === id));

      // 4. Sort descending by score and take top N
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit);

      const qTokens = tokenise(input.query);

      const results: SearchResult[] = top.map(({ id, score }) => {
        const c = candidates.find((c) => c.id === id)!;
        const snippet = bm25.extractSnippet(id, qTokens);
        return {
          ...c,
          score,
          snippet,
        };
      });

      return {
        results,
        total: candidates.length,
        query: input.query,
      };
    } finally {
      store.close();
    }
  },
};

// ─── Types ─────────────────────────────────────────────────────────────────────

interface CodebaseSearchInput {
  query: string;
  kind?: string;
  lang?: string;
  file?: string;
  limit?: number;
  lspKind?: number;
}

interface CodebaseSearchOutput {
  results: SearchResult[];
  total: number;  // total candidates before limit
  query: string;
}
