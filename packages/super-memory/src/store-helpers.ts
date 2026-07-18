/**
 * Pure helper functions extracted from store.ts for reuse by SqliteSuperMemoryStore.
 * These functions have no side effects and no dependency on the store instance.
 */

import type {
  MemoryAnchor,
  MemoryAudienceSelector,
  RememberSuperMemoryInput,
  SuperMemory,
  SuperMemoryScope,
  SuperMemoryKind,
} from './types.js';
import { normalizeProjectPath, normalizeSlashes } from './paths.js';

const MAX_MEMORY_TEXT_CHARS = 20_000;
const MAX_MEMORY_METADATA_ITEMS = 128;

const VALID_SCOPES = new Set<SuperMemoryScope>(['project', 'user', 'session', 'file', 'symbol']);
const VALID_KINDS = new Set<SuperMemoryKind>([
  'fact', 'decision', 'convention', 'preference',
  'warning', 'anti_pattern', 'workflow', 'bug_root_cause', 'file_note',
  'symbol_note', 'command_note', 'summary',
  'memory_review',
]);
const VALID_ANCHOR_TYPES = new Set<MemoryAnchor['type']>([
  'file', 'directory', 'symbol', 'package', 'command', 'test', 'git',
]);

const AUDIENCE_KEYS = ['roles', 'taskTypes', 'modes'] as const;

export function normalizeText(text: string): string {  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical tokenizer for retrieval scoring across BOTH the stores and the
 * injection middlewares — do not fork it. Invariants:
 * - NFKC + lowercase: strings differing only in unicode form/case tokenize alike.
 * - Unicode letters/numbers plus `_`, `.`, `-` are token characters, so
 *   identifiers like `edge-case`, `snake_case`, and `foo.bar` stay whole.
 * - Terms shorter than 3 characters are dropped: scoring does substring
 *   matching (`haystack.includes(term)`), where 1–2 char terms ("in", "go")
 *   match nearly every text and produce pure noise.
 * - Output is deduplicated; scoring operates on sets.
 */
export function tokenize(text: string): string[] {
  return [...new Set(
    text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}_.-]+/u).filter((term) => term.length >= 3),
  )];
}

export function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
}

export function normalizeAnchors(projectRoot: string, anchors: MemoryAnchor[]): MemoryAnchor[] {
  return dedupeAnchors(anchors.map((anchor) => ({
    ...anchor,
    path: anchor.path ? normalizeProjectPath(projectRoot, anchor.path) : undefined,
    symbol: anchor.symbol?.trim() || undefined,
    command: anchor.command?.trim().replace(/\s+/g, ' ') || undefined,
  })));
}

export function normalizeAudience(value: MemoryAudienceSelector | undefined): MemoryAudienceSelector | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Super Memory audience must be an object.');
  }
  const normalized: MemoryAudienceSelector = {};
  for (const key of AUDIENCE_KEYS) {
    const values = value[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
      throw new Error(`Super Memory audience.${key} must be an array of strings.`);
    }
    if (values.length > MAX_MEMORY_METADATA_ITEMS) {
      throw new Error(`Super Memory audience.${key} exceeds ${MAX_MEMORY_METADATA_ITEMS} items.`);
    }
    const items = [...new Set(values.map(normalizeSelectorValue).filter(Boolean))];
    if (items.some((item) => item.length > 256)) {
      throw new Error(`Super Memory audience.${key} values must be no longer than 256 characters.`);
    }
    if (items.length > 0) normalized[key] = items;
  }
  return AUDIENCE_KEYS.some((key) => normalized[key]?.length) ? normalized : undefined;
}

export function normalizeSources(sources: SuperMemory['sources']): SuperMemory['sources'] {
  return dedupeSources(sources.map((source) => ({
    ...source,
    path: source.path ? normalizeSlashes(source.path.trim()) : undefined,
    command: source.command?.trim().replace(/\s+/g, ' ') || undefined,
  })));
}

export function validateRememberInput(input: RememberSuperMemoryInput): void {
  if (typeof input.text !== 'string') throw new Error('Super Memory text must be a string.');
  if (input.text.length > MAX_MEMORY_TEXT_CHARS) {
    throw new Error(`Super Memory text exceeds ${MAX_MEMORY_TEXT_CHARS} characters.`);
  }
  for (const [name, values] of [
    ['tags', input.tags],
    ['anchors', input.anchors],
    ['sources', input.sources],
    ['supersedes', input.supersedes],
    ['contradicts', input.contradicts],
  ] as const) {
    if (values && values.length > MAX_MEMORY_METADATA_ITEMS) {
      throw new Error(`Super Memory ${name} exceeds ${MAX_MEMORY_METADATA_ITEMS} items.`);
    }
  }
  if (input.tags?.some((tag) => typeof tag !== 'string' || tag.length > 256)) {
    throw new Error('Super Memory tags must be strings no longer than 256 characters.');
  }
  if (input.scope && !VALID_SCOPES.has(input.scope)) throw new Error('Invalid Super Memory scope.');
  if (input.kind && !VALID_KINDS.has(input.kind)) throw new Error('Invalid Super Memory kind.');
  normalizeAudience(input.audience);
  for (const anchor of input.anchors ?? []) {
    if (!anchor || !VALID_ANCHOR_TYPES.has(anchor.type)) throw new Error('Invalid Super Memory anchor type.');
    if (anchor.type === 'command') {
      if (!anchor.command?.trim()) throw new Error('Command memory anchors require a command.');
    } else if (!anchor.path?.trim()) {
      throw new Error(`${anchor.type} memory anchors require a path.`);
    }
    if (anchor.type === 'symbol' && !anchor.symbol?.trim()) {
      throw new Error('Symbol memory anchors require a symbol.');
    }
    // Per-type caps: paths can be deep absolute paths (Windows `C:\...`,
    // node_modules chains), commands can be long shell one-liners. A flat 256
    // rejects legitimate input — the stored form is relativized/short anyway.
    if (
      (anchor.path?.length ?? 0) > 4_096 ||
      (anchor.symbol?.length ?? 0) > 1_024 ||
      (anchor.command?.length ?? 0) > 8_192
    ) {
      throw new Error(
        'Super Memory anchor strings are too long (path ≤ 4096, symbol ≤ 1024, command ≤ 8192 characters).',
      );
    }
  }
  for (const source of input.sources ?? []) {
    if (!source || !['user', 'session', 'tool_result', 'file', 'git', 'command'].includes(source.type)) {
      throw new Error('Invalid Super Memory source type.');
    }
  }
}

// ─── Private dedup helpers ──────────────────────────────────────────────

function dedupeAnchors(anchors: MemoryAnchor[]): MemoryAnchor[] {
  return dedupeByKey(anchors, (anchor) => JSON.stringify([
    anchor.type, anchor.path ?? null, anchor.symbol ?? null,
    anchor.command ?? null, anchor.contentHash ?? null,
    anchor.gitBlobHash ?? null, anchor.lineStart ?? null, anchor.lineEnd ?? null,
  ]));
}

function dedupeSources(sources: SuperMemory['sources']): SuperMemory['sources'] {
  return dedupeByKey(sources, (source) => JSON.stringify([
    source.type, source.sessionId ?? null, source.toolUseId ?? null,
    source.path ?? null, source.command ?? null, source.excerptHash ?? null,
  ]));
}

function dedupeByKey<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeSelectorValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

// ─── Secret-detection guard (shared by JSONL and SQLite stores) ─────

/**
 * Check whether `text` looks like a secret or credential.
 * Used by both SuperMemoryStore and SqliteSuperMemoryStore to reject
 * unsafe candidate proposals before they reach the ReviewQueue.
 */
export function looksLikeSecret(text: string): boolean {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}/i,
    /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
    /\b(?:sk-(?:proj-|svcacct-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{16,}\b/i,
    /\bAKIA[0-9A-Z]{16}\b/,
  ].some((pattern) => pattern.test(text));
}

/**
 * Recursively collect every string value from a nested object/array.
 * Walks arrays and object values so every user-supplied field (text,
 * tags, anchors, sources, etc.) can be checked for unsafe content.
 */
export function collectStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) collectStringValues(item, out);
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectStringValues(item, out);
  }
  return out;
}
