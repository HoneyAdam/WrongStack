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
  | 'namespace'
  | 'object'   // JSON root object
  | 'literal' // scalar value in JSON/YAML
  | 'schema'  // JSON Schema $ref/$schema entry
  // Rust-specific
  | 'struct'
  | 'trait'
  | 'impl'
  | 'static'
  | 'mod';

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

/** Extracted symbols and cross-references for one file. */
export interface FileSymbols {
  file: string;
  lang: SymbolLang;
  symbols: Symbol[];
  refs?: Ref[] | undefined;   // cross-references extracted from this file (optional for back-compat)
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
  /** Original LSP SymbolKind number if the result was filtered by an LSP kind. */
  lspKind?: number | undefined;
}

/** Result of a full reindex. */
export interface IndexResult {
  filesIndexed: number;
  symbolsIndexed: number;
  langStats: Record<SymbolLang, number>;
  durationMs: number;
  errors: string[];
}

// ─── Cross-reference types ───────────────────────────────────────────────────

/** What kind of reference this is. */
export type CallType = 'call' | 'type_ref' | 'inherit' | 'implement' | 'import';

/** A cross-reference between two symbols (who references whom). */
export interface Ref {
  id?: number | undefined;
  fromId: number;     // symbol that makes the reference
  toName: string;      // resolved name of the referenced symbol
  toId?: number | undefined;       // resolved target symbol id (filled after index resolution)
  callType: CallType;  // kind of reference
  line: number;        // source line where the reference occurs
}

// ─── Schema version ───────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 1;
