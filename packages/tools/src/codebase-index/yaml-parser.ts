/**
 * YAML file symbol extraction.
 *
 * Uses regex-based extraction (no js-yaml dependency).
 * Extracts:
 * - Top-level and nested key-value pairs (up to depth 3)
 * - List items with key: `- key: value`
 * - Block scalars `key: |` and `key: >`
 * - Anchors `&anchor` and aliases `*alias`
 *
 * Kind taxonomy:
 * - `property` for keys
 * - `literal` for scalar values (strings, numbers, booleans)
 * - `const` for anchors
 */

import * as path from 'node:path';
import type { FileSymbols, Symbol, SymbolLang } from './schema.js';

// ─── Public API ─────────────────────────────────────────────────────────────

export function parseSymbols(opts: { file: string; content: string; lang: SymbolLang }): FileSymbols {
  const { file, content, lang } = opts;

  try {
    return regexParse({ file, content, lang });
  } catch {
    return { file, lang, symbols: [], mtimeMs: Date.now() };
  }
}

export { detectLang } from './ts-parser.js';

// ─── Regex parser ───────────────────────────────────────────────────────────

function regexParse(opts: { file: string; content: string; lang: SymbolLang }): FileSymbols {
  const { file, content, lang } = opts;
  const symbols: Symbol[] = [];

  const lines = content.split('\n');

  // Build line offset map for accurate line/col
  const lineOffsets: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffsets[i]! + lines[i]!.length + 1);
  }

  function lineFromOffset(offset: number): number {
    let lo = 0, hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineOffsets[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  // ── 1. Anchors and aliases ─────────────────────────────────────────────────
  // &anchor_name
  const anchorRegex = /&(\w[\w-]*)/g;
  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(content)) !== null) {
    const name = match[1]!;
    const offset = match.index!;
    const line = lineFromOffset(offset);
    const col = offset - (lineOffsets[line - 1] ?? 0);
    symbols.push(makeSymbol({
      name,
      kind: 'const',
      line,
      col,
      signature: `&${name}`,
      file,
      lang,
    }));
  }

  // *alias_name
  const aliasRegex = /\*(\w[\w-]*)/g;
  while ((match = aliasRegex.exec(content)) !== null) {
    const name = match[1]!;
    const offset = match.index!;
    const line = lineFromOffset(offset);
    const col = offset - (lineOffsets[line - 1] ?? 0);
    symbols.push(makeSymbol({
      name,
      kind: 'const',
      line,
      col,
      signature: `*${name}`,
      file,
      lang,
    }));
  }

  // ── 2. Top-level and nested key: value pairs ───────────────────────────────
  // Matches `key: value` (but not block scalars or document markers)
  // Uses negative lookbehind and context to avoid false positives
  const kvRegex = /^(\s*)([^:#\s][^:#\s]*)\s*:/gm;
  while ((match = kvRegex.exec(content)) !== null) {
    const indent = match[1]!.length;
    const key = match[2]!;
    const offset = match.index!;
    const line = lineFromOffset(offset);
    const col = offset - (lineOffsets[line - 1] ?? 0);

    // Skip block scalar indicators (| or > at column 0 with key name before :)
    const lineContent = lines[line - 1] ?? '';
    if (/^[|&>]/.test(lineContent.trim())) continue;
    // Skip YAML document markers
    if (key === '---' || key === '...') continue;
    // Skip keys that are clearly part of a string value (unusual indent)
    if (indent > 12) continue;

    const value = extractValue(content, match.index!);
    const kind: Symbol['kind'] = isScalar(value) ? 'literal' : 'property';
    const signature = `${key}: ${truncate(value, 60)}`;

    symbols.push(makeSymbol({ name: key, kind, line, col, signature, file, lang }));
  }

  // ── 3. List item keys ──────────────────────────────────────────────────────
  // `- key: value` (list item that is a keyed object)
  const listItemRegex = /^-(\s+)([^:#\s][^:#\s]*)\s*:/gm;
  while ((match = listItemRegex.exec(content)) !== null) {
    const key = match[2]!;
    const offset = match.index!;
    const line = lineFromOffset(offset);
    const col = offset - (lineOffsets[line - 1] ?? 0);
    const value = extractValue(content, offset + match[0]!.length);
    const kind: Symbol['kind'] = isScalar(value) ? 'literal' : 'property';
    symbols.push(makeSymbol({
      name: key,
      kind,
      line,
      col,
      signature: `- ${key}: ${truncate(value, 60)}`,
      file,
      lang,
    }));
  }

  // ── 4. Block scalar keys (key: | or key: >) ────────────────────────────────
  const blockScalarRegex = /^(\s*)([^:#\s][^:#\s]*)\s*:\s*[|>](\s|$)/gm;
  while ((match = blockScalarRegex.exec(content)) !== null) {
    const key = match[2]!;
    const offset = match.index!;
    const line = lineFromOffset(offset);
    const col = offset - (lineOffsets[line - 1] ?? 0);
    symbols.push(makeSymbol({
      name: key,
      kind: 'property',
      line,
      col,
      signature: `${key}: | ...`,
      file,
      lang,
    }));
  }

  return { file, lang, symbols, mtimeMs: Date.now() };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function extractValue(content: string, afterColonOffset: number): string {
  // Get the rest of the line after the colon
  const lineEnd = content.indexOf('\n', afterColonOffset);
  const rest = content.slice(afterColonOffset, lineEnd < 0 ? undefined : lineEnd);
  return rest.trim();
}

function isScalar(value: string): boolean {
  if (!value) return false;
  // Numbers, booleans, null, quoted strings
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) return true;
  if (/^(true|false|null|undefined)$/i.test(value)) return true;
  if (/^'[^']*'$/.test(value) || /^"[^"]*"$/.test(value)) return true;
  return false;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '...';
}

function makeSymbol(opts: {
  name: string;
  kind: Symbol['kind'];
  line: number;
  col: number;
  signature: string;
  file: string;
  lang: SymbolLang;
}): Symbol {
  return {
    id: 0,
    lang: opts.lang,
    kind: opts.kind,
    name: opts.name,
    file: opts.file,
    line: opts.line,
    col: opts.col,
    signature: opts.signature,
    docComment: '',
    scope: '',
    text: `${opts.name} ${opts.signature}`.trim(),
  };
}