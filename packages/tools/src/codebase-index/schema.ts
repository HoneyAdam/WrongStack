// ─── Symbol kind taxonomy ───────────────────────────────────────────────────────

/** Language a symbol belongs to. */
export type SymbolLang = 'ts' | 'js' | 'tsx' | 'jsx' | 'go' | 'py' | 'rs' | 'json' | 'yaml';

/** What kind of symbol this is. */
export type SymbolKind =
  | 'class'
  | 'interface'
  | 'enum'
  | 'type'
  | 'function'
  | 'method'
  | 'var'
  | 'const'
  | 'let'
  | 'property'
  | 'parameter'
  | 'namespace';

/** A single indexed code symbol. */
export interface Symbol {
  id: number;
  lang: SymbolLang;
  kind: SymbolKind;
  name: string;
  file: string;       // absolute path
  line: number;        // 1-based
  col: number;         // 0-based
  signature: string;   // e.g. "function foo(a: string): Promise<void>"
  docComment: string;  // JSDoc / docstring first line
  scope: string;       // e.g. "MyClass.method" or module-level ""
  text: string;       // concatenated searchable text: name + signature + docComment
}

/** Extracted symbols for one file. */
export interface FileSymbols {
  file: string;
  lang: SymbolLang;
  symbols: Symbol[];
  mtimeMs: number;
}

/** Source file metadata tracked for incremental indexing. */
export interface FileMeta {
  file: string;
  lang: SymbolLang;
  mtimeMs: number;
  symbolCount: number;
  lastIndexed: number; // unix ms
}

/** Statistics about the index. */
export interface IndexStats {
  totalSymbols: number;
  totalFiles: number;
  byLang: Record<SymbolLang, number>;
  byKind: Record<SymbolKind, number>;
  indexPath: string;
  lastIndexed: number | null;
  sizeBytes: number;
  version: number;
}

/** Result of a search query. */
export interface SearchResult {
  id: number;
  name: string;
  kind: SymbolKind;
  lang: SymbolLang;
  file: string;
  line: number;
  col: number;
  signature: string;
  docComment: string;
  score: number;
  snippet: string;
}

/** Result of a full reindex. */
export interface IndexResult {
  filesIndexed: number;
  symbolsIndexed: number;
  langStats: Record<SymbolLang, number>;
  durationMs: number;
  errors: string[];
}

// ─── Schema version ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;