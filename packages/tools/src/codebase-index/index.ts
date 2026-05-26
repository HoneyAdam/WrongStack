/**
 * @wrongstack/tools – Codebase Index
 *
 * Three tools for building and querying a symbol index:
 *
 *   `codebase-index`  — run the indexer (full or incremental)
 *   `codebase-search` — BM25-ranked symbol search
 *   `codebase-stats`  — index health and statistics
 *
 * Storage: `{projectRoot}/.codebase-index/index.db` (gitignored)
 * Parser:  TypeScript Compiler API (ts-morph-free, uses `typescript` directly)
 * Ranking: Okapi BM25 with k1=1.5, b=0.75
 */

export { codebaseIndexTool } from './codebase-index-tool.js';
export { codebaseSearchTool } from './codebase-search-tool.js';
export { codebaseStatsTool } from './codebase-stats-tool.js';

// Re-export shared types
export type {
  Symbol,
  SymbolKind,
  SymbolLang,
  FileSymbols,
  FileMeta,
  IndexStats,
  IndexResult,
  SearchResult,
} from './schema.js';
export { SCHEMA_VERSION } from './schema.js';