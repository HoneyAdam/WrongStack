import { describe, expect, it } from 'vitest';
import { renderMarkdownReport, reportHeaderLine } from '../src/report/markdown.js';
import type { HarnessFingerprint } from '../src/types.js';

const FP: HarnessFingerprint = {
  cliVersion: '0.260.0',
  toolNames: ['read', 'write', 'bash'],
  maxIterations: 40,
  yolo: false,
  subsetId: 'polyglot-10',
  hash: 'abc123def456',
};

const opus = { label: 'opus-4.8', provider: 'anthropic', model: 'claude-opus-4-8' };

describe('renderMarkdownReport — conditionalPct edge cases', () => {
  it('shows dash for trace-eval cells with undefined rates', () => {
    // When traceEval is present but the conditional rate is undefined
    // (eligible=0 → rate=undefined), conditionalPct returns '—'
    const md = renderMarkdownReport({
      suite: 'local',
      finishedAt: 'now',
      fingerprint: FP,
      cells: [
        {
          cell: opus,
          taskCount: 2,
          gradedCount: 2,
          passRate: 0.5,
          editApplyRate: 0.9,
          avgCostUsd: 0.1,
          avgTokensIn: 100,
          avgTokensOut: 50,
          p50Iterations: 5,
          p50ElapsedMs: 500,
          timeoutRate: 0,
          totalRateLimitRetries: 0,
          traceEval: {
            retrieval: { eligible: 2, passed: 1, rate: 0.5 },
            recallGivenRetrieval: { eligible: 0, passed: 0, rate: undefined },
            editApplicationGivenRecall: { eligible: 0, passed: 0, rate: undefined },
          },
        },
      ],
    });
    // For recall and edit-application columns, rate is undefined → dash
    const lines = md.split('\n');
    // Find the data row: has 'opus-4.8' and follows the header
    const dataLine = lines.find((l) => l.includes('opus-4.8'));
    expect(dataLine).toBeDefined();
    // Should contain dashes for undefined-rate columns
    expect(md).toContain('—');
  });

  it('shows dash for all conditional columns when traceEval.retrieval is undefined', () => {
    const md = renderMarkdownReport({
      suite: 'local',
      finishedAt: 'now',
      fingerprint: FP,
      cells: [
        {
          cell: opus,
          taskCount: 1,
          gradedCount: 1,
          passRate: 1,
          editApplyRate: 1,
          avgCostUsd: 0.01,
          avgTokensIn: 10,
          avgTokensOut: 5,
          p50Iterations: 1,
          p50ElapsedMs: 100,
          timeoutRate: 0,
          totalRateLimitRetries: 0,
          traceEval: {
            retrieval: { eligible: 0, passed: 0, rate: undefined },
            recallGivenRetrieval: { eligible: 0, passed: 0, rate: undefined },
            editApplicationGivenRecall: { eligible: 0, passed: 0, rate: undefined },
          },
        },
      ],
    });
    expect(md).toContain('—');
  });

  it('includes trace-eval columns when any cell has traceEval', () => {
    const md = renderMarkdownReport({
      suite: 'local',
      finishedAt: 'now',
      fingerprint: FP,
      cells: [
        {
          cell: opus,
          taskCount: 1,
          gradedCount: 1,
          passRate: 1,
          editApplyRate: 1,
          avgCostUsd: 0.01,
          avgTokensIn: 10,
          avgTokensOut: 5,
          p50Iterations: 1,
          p50ElapsedMs: 100,
          timeoutRate: 0,
          totalRateLimitRetries: 0,
          traceEval: {
            retrieval: { eligible: 1, passed: 1, rate: 1 },
            recallGivenRetrieval: { eligible: 1, passed: 1, rate: 1 },
            editApplicationGivenRecall: { eligible: 1, passed: 1, rate: 1 },
          },
        },
      ],
    });
    expect(md).toContain('Recall (given retrieval)');
    expect(md).toContain('Edit application (given recall)');
  });

  it('shows the trace-eval footnote when traceEval is present', () => {
    const md = renderMarkdownReport({
      suite: 'local',
      finishedAt: 'now',
      fingerprint: FP,
      cells: [
        {
          cell: opus,
          taskCount: 1,
          gradedCount: 1,
          passRate: 1,
          editApplyRate: 1,
          avgCostUsd: 0.01,
          avgTokensIn: 10,
          avgTokensOut: 5,
          p50Iterations: 1,
          p50ElapsedMs: 100,
          timeoutRate: 0,
          totalRateLimitRetries: 0,
          traceEval: {
            retrieval: { eligible: 1, passed: 1, rate: 1 },
            recallGivenRetrieval: { eligible: 1, passed: 1, rate: 1 },
            editApplicationGivenRecall: { eligible: 1, passed: 1, rate: 1 },
          },
        },
      ],
    });
    expect(md).toContain('causal funnel');
  });

  it('reportHeaderLine returns a tagged label', () => {
    expect(reportHeaderLine(FP)).toMatch(/fp:abc123/);
  });
});
