/**
 * Cross-reference extraction — currently a no-op for the dominant TypeScript
 * path (refs are extracted inline during the single AST walk in ts-parser.ts).
 *
 * Go and Python extraction paths were removed in 2026-07 because this codebase
 * indexes zero `.go` or `.py` files (stat: 26k+ symbols, all TS/JS/JSON/YAML).
 * The child-process spawning (`go run` / `python`) and file-caching logic that
 * previously lived here is recoverable from git history if these languages ever
 * need indexed refs again.
 */

import type { Ref, SymbolLang } from './schema.js';

export interface ExtractRefsOptions {
  file: string;
  content: string;
  lang: SymbolLang;
}

/**
 * Extract cross-references (calls, type refs, imports) from a source file.
 * Returns an empty array for every language — TS/JS refs are extracted inline
 * by ts-parser.ts during the single AST walk.
 */
export async function extractRefs(_opts: ExtractRefsOptions): Promise<Ref[]> {
  return [];
}
