import { describe, expect, it } from 'vitest';
import { compactionHistoryEntry } from '../src/hooks/use-subagent-events.js';

function event(before: number, after: number, sessionId = 'leader') {
  return {
    sessionId,
    level: 'warn' as const,
    report: { before, after },
  };
}

describe('compactionHistoryEntry', () => {
  it('ignores compactions emitted by subagent sessions', () => {
    expect(compactionHistoryEntry(event(500_000, 400_000, 'subagent'), 'leader')).toBeNull();
  });

  it('hides zero and negligible reductions from chat history', () => {
    expect(compactionHistoryEntry(event(459_607, 459_607), 'leader')).toBeNull();
    expect(compactionHistoryEntry(event(459_607, 459_253), 'leader')).toBeNull();
  });

  it('renders meaningful leader compaction as info rather than WARN', () => {
    expect(compactionHistoryEntry(event(459_607, 400_000), 'leader')).toEqual({
      kind: 'info',
      text: '⚡ compact: 459607 → 400000 tokens (−59607) [warn]',
    });
  });

  it('keeps genuine context growth visible as a warning', () => {
    expect(compactionHistoryEntry(event(400_000, 410_000), 'leader')).toEqual({
      kind: 'warn',
      text: '⚠️ compact: context grew by 10000 tokens [warn]',
    });
  });
});
