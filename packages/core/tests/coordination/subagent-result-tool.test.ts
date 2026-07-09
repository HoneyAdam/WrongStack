import { describe, expect, it } from 'vitest';
import {
  formatSubagentStructuredReport,
  makeSubagentResultTool,
  readSubagentStructuredReport,
  SUBAGENT_STRUCTURED_REPORT_META_KEY,
} from '../../src/coordination/subagent-result-tool.js';

const validReport = {
  summary: 'Found and fixed the race.',
  findings: ['The check and write were not atomic.'],
  files_examined: ['src/store.ts', 'tests/store.test.ts'],
  confidence: 0.95,
  suggested_next_steps: ['Monitor contention in production.'],
};

describe('submit_result tool', () => {
  it('stores a normalized structured report in task-local Context metadata', async () => {
    const ctx = { meta: {} as Record<string, unknown> };
    const result = await makeSubagentResultTool().execute(validReport, ctx as never, {} as never);

    expect(result).toMatchObject({ ok: true, findings: 1, filesExamined: 2 });
    expect(ctx.meta[SUBAGENT_STRUCTURED_REPORT_META_KEY]).toEqual(validReport);
    expect(readSubagentStructuredReport(ctx)).toEqual(validReport);
  });

  it('rejects malformed or out-of-range reports even when called directly', async () => {
    const ctx = { meta: {} as Record<string, unknown> };
    const result = await makeSubagentResultTool().execute(
      { ...validReport, confidence: 2 },
      ctx as never,
      {} as never,
    );

    expect(result).toMatchObject({ ok: false });
    expect(ctx.meta).toEqual({});
  });

  it('rejects an oversized report instead of polluting the parent context', async () => {
    const ctx = { meta: {} as Record<string, unknown> };
    const result = await makeSubagentResultTool().execute(
      { ...validReport, findings: Array.from({ length: 17 }, (_, i) => `finding ${i}`) },
      ctx as never,
      {} as never,
    );

    expect(result).toMatchObject({ ok: false });
    expect(ctx.meta).toEqual({});
  });

  it('renders a stable compact handoff for roll-up and mailbox surfaces', () => {
    const text = formatSubagentStructuredReport(validReport);
    expect(text).toContain('Findings:\n- The check and write were not atomic.');
    expect(text).toContain('Files examined: src/store.ts, tests/store.test.ts');
    expect(text).toContain('Confidence: 0.95');
  });
});
