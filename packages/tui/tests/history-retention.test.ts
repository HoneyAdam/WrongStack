import type { Message } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { buildRestoredEntries, createInitialState } from '../src/app-initial-state.js';
import type { HistoryEntry } from '../src/components/history/types.js';
import { retainTuiHistory, TUI_HISTORY_MAX_ENTRIES } from '../src/history-retention.js';

function infoEntries(count: number, startId = 1): HistoryEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    kind: 'info' as const,
    text: `entry-${startId + index}`,
  }));
}

describe('bounded TUI display history', () => {
  it('returns the same array while it is within budget', () => {
    const entries = infoEntries(3);
    expect(retainTuiHistory(entries)).toBe(entries);
  });

  it('preserves the banner and newest entries and replaces the old prefix with a marker', () => {
    const banner: HistoryEntry = {
      id: 0,
      kind: 'banner',
      version: '1.0.0',
      provider: 'test',
      model: 'test',
      cwd: '/project',
    };
    const entries = [banner, ...infoEntries(TUI_HISTORY_MAX_ENTRIES + 50)];

    const retained = retainTuiHistory(entries);

    expect(retained).toHaveLength(TUI_HISTORY_MAX_ENTRIES + 2);
    expect(retained[0]).toBe(banner);
    expect(retained[1]).toMatchObject({
      kind: 'info',
      text: '… 50 earlier TUI entries omitted (full session remains on disk).',
    });
    expect(retained[2]).toMatchObject({ text: 'entry-51' });
    expect(retained.at(-1)).toMatchObject({ text: `entry-${TUI_HISTORY_MAX_ENTRIES + 50}` });
  });

  it('accumulates omission counts as a live managed history keeps growing', () => {
    const first = retainTuiHistory(infoEntries(4), { maxEntries: 2, maxBytes: 10_000 });
    const next = retainTuiHistory([...first, { id: 5, kind: 'info', text: 'entry-5' }], {
      maxEntries: 2,
      maxBytes: 10_000,
    });

    expect(next[0]).toMatchObject({
      text: '… 3 earlier TUI entries omitted (full session remains on disk).',
    });
    expect(next.slice(1).map((entry) => entry.id)).toEqual([4, 5]);
  });

  it('also enforces a byte budget without dropping the newest entry', () => {
    const entries: HistoryEntry[] = [
      { id: 1, kind: 'assistant', text: 'a'.repeat(80) },
      { id: 2, kind: 'assistant', text: 'b'.repeat(80) },
      { id: 3, kind: 'assistant', text: 'c'.repeat(80) },
    ];

    const retained = retainTuiHistory(entries, { maxEntries: 10, maxBytes: 100 });

    expect(retained[0]).toMatchObject({ kind: 'info' });
    expect(retained.at(-1)).toBe(entries[2]);
    expect(retained).toHaveLength(2);
  });

  it('hydrates only the recent tail of a long resumed session', () => {
    const messages = Array.from({ length: TUI_HISTORY_MAX_ENTRIES + 25 }, (_, index) => ({
      role: 'user' as const,
      content: `message-${index + 1}`,
    })) as Message[];

    const restored = buildRestoredEntries(messages);

    expect(restored).toHaveLength(TUI_HISTORY_MAX_ENTRIES + 1);
    expect(restored[0]).toMatchObject({
      text: '… 25 earlier TUI entries omitted (full session remains on disk).',
    });
    expect(restored.at(-1)).toMatchObject({ text: `message-${TUI_HISTORY_MAX_ENTRIES + 25}` });

    const state = createInitialState({
      banner: false,
      model: 'test-model',
      cwd: '/project',
      restoredEntries: restored,
      enhanceEnabled: false,
    });
    expect(state.nextId).toBe(TUI_HISTORY_MAX_ENTRIES + 26);
  });
});
