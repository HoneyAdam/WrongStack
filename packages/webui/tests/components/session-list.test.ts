import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { formatRelative, getEmptySessionIds } from '../../src/components/Sidebar/SessionList';
import type { SessionHistoryEntry } from '../../src/stores/types';

type SessionEntry = { id: string; tokenTotal: number; isCurrent: boolean };

function makeEntry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: 'sess_1',
    tokenTotal: 0,
    isCurrent: false,
    ...overrides,
  };
}

// ── getEmptySessionIds ───────────────────────────────────────────────

describe('getEmptySessionIds', () => {
  it('returns empty array when no entries', () => {
    expect(getEmptySessionIds([])).toEqual([]);
  });

  it('returns empty array when all sessions have tokens', () => {
    const entries: SessionEntry[] = [
      makeEntry({ id: 's1', tokenTotal: 100 }),
      makeEntry({ id: 's2', tokenTotal: 1 }),
    ];
    expect(getEmptySessionIds(entries)).toEqual([]);
  });

  it('returns ID when session has tokenTotal === 0', () => {
    const entries: SessionEntry[] = [
      makeEntry({ id: 'empty_1', tokenTotal: 0 }),
    ];
    expect(getEmptySessionIds(entries)).toEqual(['empty_1']);
  });

  it('returns multiple IDs for multiple empty sessions', () => {
    const entries: SessionEntry[] = [
      makeEntry({ id: 'empty_1', tokenTotal: 0 }),
      makeEntry({ id: 'active', tokenTotal: 0, isCurrent: true }),
      makeEntry({ id: 'empty_2', tokenTotal: 0 }),
      makeEntry({ id: 'non_empty', tokenTotal: 500 }),
    ];
    expect(getEmptySessionIds(entries)).toEqual(['empty_1', 'empty_2']);
  });

  it('excludes the current session even if tokenTotal === 0', () => {
    const entries: SessionEntry[] = [
      makeEntry({ id: 'active', tokenTotal: 0, isCurrent: true }),
      makeEntry({ id: 'empty', tokenTotal: 0 }),
    ];
    expect(getEmptySessionIds(entries)).toEqual(['empty']);
    expect(getEmptySessionIds(entries)).not.toContain('active');
  });

  it('mixed: non-empty non-current + empty non-current + empty current', () => {
    const entries: SessionEntry[] = [
      makeEntry({ id: 'work_done', tokenTotal: 999 }),
      makeEntry({ id: 'truly_empty', tokenTotal: 0 }),
      makeEntry({ id: 'new_session', tokenTotal: 0, isCurrent: true }),
    ];
    expect(getEmptySessionIds(entries)).toEqual(['truly_empty']);
  });
});

// ── formatRelative ───────────────────────────────────────────────────

describe('formatRelative', () => {
  // We freeze Date.now() so tests are deterministic
  const FIXED_NOW = new Date('2026-01-15T12:00:00Z').getTime();
  let getNowStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getNowStub = vi.fn(() => FIXED_NOW);
    vi.spyOn(Date, 'now').mockImplementation(getNowStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string for invalid ISO', () => {
    expect(formatRelative('not-a-date')).toBe('');
  });

  it('returns "just now" for timestamps < 1 minute ago', () => {
    const recent = new Date(FIXED_NOW - 30_000).toISOString(); // 30s ago
    expect(formatRelative(recent)).toBe('just now');
  });

  it('returns minutes ago for < 1 hour', () => {
    const fiveMinAgo = new Date(FIXED_NOW - 5 * 60_000).toISOString();
    expect(formatRelative(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago for < 1 day', () => {
    const threeHoursAgo = new Date(FIXED_NOW - 3 * 3_600_000).toISOString();
    expect(formatRelative(threeHoursAgo)).toBe('3h ago');
  });

  it('returns days ago for < 7 days', () => {
    const twoDaysAgo = new Date(FIXED_NOW - 2 * 86_400_000).toISOString();
    expect(formatRelative(twoDaysAgo)).toBe('2d ago');
  });

  it('returns locale date string for >= 7 days', () => {
    const tenDaysAgo = new Date(FIXED_NOW - 10 * 86_400_000).toISOString();
    expect(formatRelative(tenDaysAgo)).toBe(new Date(tenDaysAgo).toLocaleDateString());
  });
});
