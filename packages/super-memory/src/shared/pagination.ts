/**
 * Shared pagination helpers for Super Memory list/query operations.
 *
 * Both the legacy JSONL-backed store and the SQLite-backed
 * `SqliteSuperMemoryStore` independently duplicated the cursor encoding,
 * page-limit clamping, status normalisation, and sort-comparator logic.
 * This module consolidates those pure functions and constants so every
 * backend shares the same paging contract.
 */

import type { SuperMemory, SuperMemoryStatus } from '../types.js';

// ─── Constants ──────────────────────────────────────────────────────────

/** Statuses eligible for automatic injection into context. */
export const CONTEXT_STATUSES: SuperMemoryStatus[] = ['active'];

/** All known lifecycle statuses. */
export const VALID_MEMORY_STATUSES = new Set<SuperMemoryStatus>([
  'active',
  'stale',
  'superseded',
  'contradicted',
  'archived',
  'deleted',
]);

/** Statuses shown by default in paginated listings (everything except soft-delete trail). */
export const DEFAULT_PAGE_STATUSES: SuperMemoryStatus[] = [
  'active',
  'stale',
  'superseded',
  'contradicted',
  'archived',
];

/** Hard page-size cap — a single page never exceeds this. */
export const MAX_PAGE_LIMIT = 500;

/** Default page size when the caller omits `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;

/**
 * Default non-page result cap (for `retrieveForPath`, `searchSuper`, etc.).
 */
export const DEFAULT_LIST_LIMIT = 20;

// ─── Cursor types and helpers ───────────────────────────────────────────

export interface PageCursor {
  updatedAt: string;
  id: string;
}

/**
 * Encode the last item of a page into an opaque base64url cursor token.
 */
export function encodePageCursor(args: { updatedAt: string; id: string }): string {
  const raw = JSON.stringify({ u: args.updatedAt, i: args.id } satisfies { u: string; i: string });
  return Buffer.from(raw, 'utf8').toString('base64url');
}

/** Decode an opaque cursor token; returns undefined for missing/malformed input. */
export function decodePageCursor(cursor: string | undefined): PageCursor | undefined {
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof parsed.u === 'string' && typeof parsed.i === 'string') {
      return { updatedAt: parsed.u, id: parsed.i } satisfies PageCursor;
    }
  } catch {
    // Malformed cursor → treat as first page.
  }
  return undefined;
}

// ─── Clamping & normalisation ───────────────────────────────────────────

/**
 * Clamp a requested page size into [1, MAX_PAGE_LIMIT],
 * defaulting to DEFAULT_PAGE_LIMIT. */
export function clampPageLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.floor(limit)));
}

/**
 * Resolve the set of allowed statuses for a page request.
 * When `statuses` is missing / empty the default (all except `deleted`) is used.
 */
export function normalizeListStatuses(
  statuses: SuperMemoryStatus[] | undefined,
  validStatuses: ReadonlySet<SuperMemoryStatus> = VALID_MEMORY_STATUSES,
): Set<SuperMemoryStatus> {
  const list =
    statuses && statuses.length > 0
      ? statuses.filter((s) => validStatuses.has(s))
      : DEFAULT_PAGE_STATUSES;
  return new Set(list.length > 0 ? list : DEFAULT_PAGE_STATUSES);
}

/**
 * Bound a non-pagination limit: clamp into [0, max] with a fallback default.
 * Used by `retrieveForPath`, `searchSuper`, etc.
 */
export function boundedLimit(
  limit: number | undefined,
  defaultLimit: number,
  maxLimit: number,
): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return defaultLimit;
  return Math.max(0, Math.min(maxLimit, Math.floor(limit)));
}

// ─── Sorting ────────────────────────────────────────────────────────────

/** Sort comparator: `updatedAt DESC, id DESC` (id is the stable tie-breaker). */
export function compareByUpdatedDesc(a: SuperMemory, b: SuperMemory): number {
  const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
  return byUpdated !== 0 ? byUpdated : b.id.localeCompare(a.id);
}
