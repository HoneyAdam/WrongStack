import type { HistoryEntry } from './components/history/types.js';

/**
 * Display history is a cache, not the canonical session record. Keep enough
 * recent output for useful scrolling while the complete JSONL session remains
 * available for resume/replay.
 */
export const TUI_HISTORY_MAX_ENTRIES = 400;
export const TUI_HISTORY_MAX_BYTES = 1024 * 1024;

const OMITTED_RE = /^… (\d+) earlier TUI entries omitted \(full session remains on disk\)\.$/;

function omittedCount(entry: HistoryEntry): number | null {
  if (entry.kind !== 'info') return null;
  const match = OMITTED_RE.exec(entry.text);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

function entryBytes(entry: HistoryEntry): number {
  try {
    return Buffer.byteLength(JSON.stringify(entry), 'utf8');
  } catch {
    // A non-serializable tool payload must never disable retention.
    return TUI_HISTORY_MAX_BYTES + 1;
  }
}

export interface TuiHistoryBudget {
  maxEntries?: number | undefined;
  maxBytes?: number | undefined;
}

/**
 * Retain the newest display entries within both a count and serialized-byte
 * budget. The banner is preserved separately and an omission marker replaces
 * the discarded prefix. Returns the original array when no work is needed so
 * reducer callers can bail out without scheduling another render.
 */
export function retainTuiHistory(
  entries: HistoryEntry[],
  budget: TuiHistoryBudget = {},
): HistoryEntry[] {
  const maxEntries = Math.max(1, Math.floor(budget.maxEntries ?? TUI_HISTORY_MAX_ENTRIES));
  const maxBytes = Math.max(1, Math.floor(budget.maxBytes ?? TUI_HISTORY_MAX_BYTES));
  const banner = entries.find((entry) => entry.kind === 'banner');
  let previouslyOmitted = 0;
  let markerCount = 0;
  let bannerCount = 0;
  const transcript: HistoryEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === 'banner') {
      bannerCount += 1;
      continue;
    }
    const count = omittedCount(entry);
    if (count !== null) {
      previouslyOmitted += count;
      markerCount += 1;
      continue;
    }
    transcript.push(entry);
  }

  let keepFrom = transcript.length;
  let retainedBytes = 0;
  let retainedCount = 0;
  while (keepFrom > 0 && retainedCount < maxEntries) {
    const next = transcript[keepFrom - 1];
    if (!next) break;
    const bytes = entryBytes(next);
    if (retainedCount > 0 && retainedBytes + bytes > maxBytes) break;
    retainedBytes += bytes;
    retainedCount += 1;
    keepFrom -= 1;
  }

  const newlyOmitted = keepFrom;
  if (
    newlyOmitted === 0 &&
    ((previouslyOmitted === 0 && markerCount === 0) ||
      (previouslyOmitted > 0 && markerCount === 1)) &&
    bannerCount <= 1
  ) {
    return entries;
  }

  const kept = transcript.slice(keepFrom);
  const totalOmitted = previouslyOmitted + newlyOmitted;
  const retained: HistoryEntry[] = [];
  if (banner) retained.push(banner);
  if (totalOmitted > 0) {
    retained.push({
      id: -(totalOmitted + 1),
      kind: 'info',
      text: `… ${totalOmitted} earlier TUI entries omitted (full session remains on disk).`,
    });
  }
  retained.push(...kept);
  return retained;
}
