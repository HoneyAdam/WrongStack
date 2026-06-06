import type { DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol';
import { displayPath, uriToPath } from '../utils/uri.js';

export function formatDocumentSymbols(
  path: string,
  symbols: DocumentSymbol[] | SymbolInformation[] | null,
  cwd: string,
): string {
  if (!symbols || symbols.length === 0) return 'No symbols found.';
  const lines = [`${displayPath(path, cwd)}:`];
  for (const sym of symbols) appendSymbol(lines, sym, 1, cwd);
  return lines.join('\n');
}

export function formatWorkspaceSymbols(
  symbols: SymbolInformation[] | null,
  query: string,
  cwd: string,
  limit = 100,
): string {
  if (!symbols || symbols.length === 0) return `No symbols matching "${query}".`;
  const lines = [`${symbols.length} symbols matching "${query}":`];
  for (const sym of symbols.slice(0, limit)) {
    lines.push(
      `  ${kindName(sym.kind)} ${sym.name} ${displayPath(uriToPath(sym.location.uri), cwd)}:${sym.location.range.start.line + 1}`,
    );
  }
  if (symbols.length > limit) lines.push(`  ... truncated ${symbols.length - limit} more`);
  return lines.join('\n');
}

function appendSymbol(
  lines: string[],
  sym: DocumentSymbol | SymbolInformation,
  depth: number,
  cwd: string,
): void {
  const indent = '  '.repeat(depth);
  if ('selectionRange' in sym) {
    lines.push(
      `${indent}${kindName(sym.kind)} ${sym.name} (L${sym.selectionRange.start.line + 1})`,
    );
    for (const child of sym.children ?? []) appendSymbol(lines, child, depth + 1, cwd);
  } else {
    lines.push(
      `${indent}${kindName(sym.kind)} ${sym.name} ${displayPath(uriToPath(sym.location.uri), cwd)}:${sym.location.range.start.line + 1}`,
    );
  }
}

function kindName(kind: number): string {
  return (
    [
      'file',
      'module',
      'namespace',
      'package',
      'class',
      'method',
      'property',
      'field',
      'constructor',
      'enum',
      'interface',
      'function',
      'variable',
      'constant',
      'string',
      'number',
      'boolean',
      'array',
      'object',
      'key',
      'null',
      'enumMember',
      'struct',
      'event',
      'operator',
      'typeParameter',
    ][kind - 1] ?? 'symbol'
  );
}

// ─── Codebase LSP Search formatter ─────────────────────────────────────────────

interface CodebaseLspResult {
  name: string;
  kind: string;
  lspKind: number;
  file: string;
  line: number;
  source: 'index' | 'lsp';
  server?: string | undefined;
  score?: number | undefined;
  snippet?: string | undefined;
}

interface CodebaseLspSearchOutput {
  results: CodebaseLspResult[];
  totalIndex: number;
  totalLsp: number;
  query: string;
  usedIndex: boolean;
  usedLsp: boolean;
}

/**
 * Format `codebase-lsp-search` output for human-readable display.
 */
export function formatCodebaseLspResults(output: CodebaseLspSearchOutput, cwd: string): string {
  const { results, totalIndex, totalLsp, query, usedIndex, usedLsp } = output;

  if (results.length === 0) {
    const sources: string[] = [];
    if (usedIndex) sources.push(`index(${totalIndex})`);
    if (usedLsp) sources.push(`lsp(${totalLsp})`);
    return `No symbols matching "${query}". Searched: ${sources.join(', ') || 'none'}.`;
  }

  const lines: string[] = [];
  lines.push(`${results.length} results for "${query}" (index:${totalIndex} lsp:${totalLsp}):`);

  for (const r of results) {
    const sourceTag = r.source === 'index' ? '[index]' : `[lsp:${r.server ?? '?'}]`;
    const scoreTag = r.score !== undefined ? ` score=${r.score.toFixed(2)}` : '';
    const location = `${displayPath(r.file, cwd)}:${r.line}`;

    if (r.snippet) {
      lines.push(`  ${sourceTag} ${r.kind} ${r.name} ${location}${scoreTag}`);
      lines.push(`      ${r.snippet}`);
    } else {
      lines.push(`  ${sourceTag} ${r.kind} ${r.name} ${location}${scoreTag}`);
    }
  }

  return lines.join('\n');
}
