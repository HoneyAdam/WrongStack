import { describe, expect, it } from 'vitest';
import {
  type DelegateCompletedLike,
  fmtDuration,
  formatDelegateCompleted,
} from '../../src/format.js';

const base: DelegateCompletedLike = {
  target: 'bug-hunter',
  task: 'audit src/parser.ts for null derefs',
  ok: true,
  status: 'success',
  summary: '[bug-hunter] done in 3m (4 iter, 37 tools) — fixed 2 null derefs',
  durationMs: 180_000,
  iterations: 4,
  toolCalls: 37,
  costUsd: 0.082,
  subagentId: 'bug-hunter-abcd1234',
};

describe('fmtDuration', () => {
  it('renders seconds, minutes, and hours', () => {
    expect(fmtDuration(5_000)).toBe('5s');
    expect(fmtDuration(180_000)).toBe('3m');
    expect(fmtDuration(5_400_000)).toBe('1.5h');
  });
});

describe('formatDelegateCompleted', () => {
  it('produces a humanized multi-line message (not JSON)', () => {
    const msg = formatDelegateCompleted(base);
    expect(msg).not.toMatch(/[{}]/); // no raw JSON braces
    expect(msg).toContain('✅ Delegate → bug-hunter · success');
    expect(msg).toContain('fixed 2 null derefs');
    expect(msg).toContain('4 iter');
    expect(msg).toContain('37 tools');
    expect(msg).toContain('💲0.0820');
  });

  it('marks failures with ❌ and the failure status', () => {
    const msg = formatDelegateCompleted({
      ...base,
      ok: false,
      status: 'host_timeout',
      summary: '[bug-hunter] timed out — no result within 30s',
    });
    expect(msg).toContain('❌ Delegate → bug-hunter · host_timeout');
  });

  it('omits the cost stat when cost is missing or zero', () => {
    const msg = formatDelegateCompleted({ ...base, costUsd: 0 });
    expect(msg).not.toContain('💲');
    const msg2 = formatDelegateCompleted({ ...base, costUsd: undefined });
    expect(msg2).not.toContain('💲');
  });

  it('falls back to the task when there is no summary', () => {
    const msg = formatDelegateCompleted({ ...base, ok: false, summary: '' });
    expect(msg).toContain('(no summary)');
    expect(msg).toContain('audit src/parser.ts');
  });
});
