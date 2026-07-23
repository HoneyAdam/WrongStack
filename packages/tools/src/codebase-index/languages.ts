/**
 * Single source of truth for which files are indexable and which
 * {@link SymbolLang} they map to.
 *
 * Keep this list broad: missing a native AST parser must never mean "skip
 * the file". Unknown programming/config sources still go through the generic
 * regex extractor under their mapped lang (or `'other'`).
 */

import * as path from 'node:path';
import type { SymbolLang } from './schema.js';

/**
 * Extension → language. Keys are lowercase including the leading dot.
 * Multi-dot extensions (`.d.ts`) are handled specially in {@link detectLang}.
 */
export const EXT_TO_LANG: Readonly<Record<string, SymbolLang>> = {
  // TypeScript / JavaScript (first-class TS compiler API)
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.jsx': 'jsx',

  // First-class native/spawn parsers (+ regex fallback)
  '.go': 'go',
  '.py': 'py',
  '.pyi': 'py',
  '.pyw': 'py',
  '.rs': 'rs',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',

  // C family
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hh': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',

  // JVM / .NET
  '.java': 'java',
  '.cs': 'csharp',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.sc': 'scala',

  // Scripting
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.dart': 'dart',
  '.lua': 'lua',
  '.r': 'r',
  '.R': 'r',
  '.pl': 'other',
  '.pm': 'other',

  // Systems / functional
  '.zig': 'zig',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.hs': 'haskell',
  '.lhs': 'haskell',

  // Shell / data / docs / web
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.ps1': 'shell',
  '.sql': 'sql',
  '.md': 'md',
  '.mdx': 'md',
  '.toml': 'toml',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.proto': 'proto',
  '.graphql': 'graphql',
  '.gql': 'graphql',
};

/** Sorted unique extension list for discovery walks. */
export const INDEXABLE_EXTENSIONS: readonly string[] = Object.freeze(
  [...new Set(Object.keys(EXT_TO_LANG).map((e) => e.toLowerCase()))].sort(),
);

/** Filenames without (or with special) extensions that should still be indexed. */
const SPECIAL_FILENAMES: Readonly<Record<string, SymbolLang>> = {
  makefile: 'other',
  gnumakefile: 'other',
  dockerfile: 'other',
  'docker-compose.yml': 'yaml',
  'docker-compose.yaml': 'yaml',
  'cmakelists.txt': 'other',
  gemfile: 'ruby',
  rakefile: 'ruby',
  procfile: 'other',
  justfile: 'other',
};

/**
 * Detect {@link SymbolLang} from a file path.
 * Returns `null` only for paths we intentionally refuse to index (binary
 * assets, lockfiles handled elsewhere, plain `.txt` without special name, …).
 */
export function detectLang(file: string): SymbolLang | null {
  const base = path.basename(file);
  const lowerBase = base.toLowerCase();

  // declaration files: foo.d.ts → ts
  if (lowerBase.endsWith('.d.ts') || lowerBase.endsWith('.d.mts') || lowerBase.endsWith('.d.cts')) {
    return 'ts';
  }

  const special = SPECIAL_FILENAMES[lowerBase];
  if (special) return special;

  const ext = path.extname(base).toLowerCase();
  if (!ext) return null;
  return EXT_TO_LANG[ext] ?? null;
}

/** True when the path is eligible for the codebase index. */
export function isIndexablePath(file: string): boolean {
  return detectLang(file) !== null;
}
