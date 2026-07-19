import type { ContextBreakdown, ContextWindowPolicy } from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import type { GitInfo } from '../src/git-info.js';
import {
  createContextSlashCommand,
  renderContext,
  renderContextWindowExpanded,
  type ContextSlashDeps,
} from '../src/context-slash.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Realistic per-category breakdown fixture (≈780k of a 1M window). */
function mkBreakdown(): ContextBreakdown {
  return {
    system: {
      total: 40_000,
      bySource: {
        identity: 30_000,
        'tool-usage': 6_000,
        environment: 2_000,
        skills: 2_000,
        mode: 0,
        plan: 0,
        'leader-after-task': 0,
        contributor: 0,
        ledger: 0,
        nextsteps: 0,
        other: 0,
      },
    },
    tools: { total: 20_000, builtin: 15_000, mcp: 5_000, count: 30, mcpByServer: { gmail: 5_000 } },
    history: { total: 700_000, text: 500_000, toolResults: 200_000, messageCount: 40 },
    volatile: { ledger: 10_000, nextsteps: 10_000, total: 20_000 },
    total: 780_000,
    effectiveMaxContext: 1_000_000,
    usedPct: 0.78,
  };
}

/** Minimal frugal-mode policy (warn 45% / soft 60% / hard 75%). */
function mkPolicy(): ContextWindowPolicy {
  return {
    id: 'frugal',
    name: 'Frugal',
    thresholds: { warn: 0.45, soft: 0.6, hard: 0.75 },
    preserveK: 6,
    eliseThreshold: 700,
  } as ContextWindowPolicy;
}

function deps(overrides?: Partial<ContextSlashDeps>): ContextSlashDeps {
  const defaultDeps: ContextSlashDeps = {
    cwd: '/home/user/project',
    getProvider: () => 'anthropic',
    getModel: () => 'claude-sonnet-4',
    getModeLabel: () => 'teach',
    getGitInfo: () => null,
    getFleet: () => ({ total: 0, running: 0, entries: [] }),
    getLeader: () => ({
      iterations: 12,
      toolCalls: 38,
      startedAt: Date.now() - 3600_000,
      status: 'idle',
      currentTool: undefined,
      ctxPct: undefined,
      ctxTokens: undefined,
      ctxMaxTokens: undefined,
    }),
    getUptime: () => '1h 0m',
    terminalWidth: 80,
    ...overrides,
  };
  return defaultDeps;
}

function leader(overrides?: Partial<ReturnType<ContextSlashDeps['getLeader']>>) {
  return {
    iterations: 12,
    toolCalls: 38,
    startedAt: Date.now() - 3600_000,
    status: 'idle' as const,
    currentTool: undefined,
    ctxPct: undefined,
    ctxTokens: undefined,
    ctxMaxTokens: undefined,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('/context slash command', () => {
  describe('createContextSlashCommand', () => {
    it('returns a command with the correct name', () => {
      const cmd = createContextSlashCommand(deps());
      expect(cmd.name).toBe('context');
    });

    it('run() returns a message without throwing', async () => {
      const cmd = createContextSlashCommand(deps());
      const result = await cmd.run('');
      expect(result).toBeDefined();
      expect((result as { message: string }).message).toBeTruthy();
    });
  });

  describe('renderContext', () => {
    it('renders session info in the full dashboard', () => {
      const out = renderContext(deps(), null);
      expect(out).toContain('Context Dashboard');
      expect(out).toContain('anthropic');
      expect(out).toContain('claude-sonnet-4');
      expect(out).toContain('teach');
      expect(out).toContain('/home/user/project');
    });

    it('includes environment section', () => {
      const out = renderContext(deps(), null);
      expect(out).toContain('Environment');
      expect(out).toContain(process.platform);
    });

    it('includes working tree section when git info is present', () => {
      const gitInfo: GitInfo = { branch: 'main', added: 42, deleted: 7, untracked: 3 };
      const out = renderContext(deps({ getGitInfo: () => gitInfo }), null);
      expect(out).toContain('Working Tree');
      expect(out).toContain('main');
      expect(out).toContain('+42');
    });

    it('includes fleet section when agents are present', () => {
      const out = renderContext(deps({
        getFleet: () => ({
          total: 2,
          running: 2,
          entries: [
            { name: 'worker-1', status: 'running', currentTool: 'grep', ctxPct: 0.45 },
            { name: 'worker-2', status: 'running', currentTool: 'read', ctxPct: 0.62 },
          ],
        }),
      }), null);
      expect(out).toContain('Fleet');
      expect(out).toContain('worker-1');
      expect(out).toContain('worker-2');
    });

    it('shows only the on-demand eligible pool, not the full storage inventory', () => {
      const out = renderContext(deps(), {
        total: 5_465,
        byKind: { fact: 1 },
        edges: 2_346,
        byStatus: { active: 1, stale: 0, archived: 0, deleted: 5_464 },
      });

      expect(out).toContain('on-demand tool-result retrieval');
      expect(out).toContain('Eligible pool:** 1 active');
      expect(out).toContain('No memory dump is in the prompt');
      expect(out).not.toContain('5464 deleted');
      expect(out).not.toContain('2346 graph edges');
      expect(out).not.toContain('`fact`: 2289');
    });
  });

  describe('renderContextWindowExpanded', () => {
    it('shows placeholder when no context data', () => {
      const out = renderContextWindowExpanded(deps());
      expect(out).toContain('data not available');
      expect(out).not.toContain('████');
    });

    it('renders low-pressure view (🟢) at 20%', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({
          ctxPct: 0.20,
          ctxTokens: 200_000,
          ctxMaxTokens: 1_000_000,
        }),
      }));
      expect(out).toContain('🟢');
      expect(out).toContain('200,000');
      expect(out).toContain('1,000,000');
      expect(out).toContain('HEALTHY');
      expect(out).toContain('Context Telemetry');
    });

    it('renders moderate-pressure view (🟡) at 78% with a real breakdown', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({
          ctxPct: 0.78,
          ctxTokens: 780_000,
          ctxMaxTokens: 1_000_000,
          cacheStats: { readTokens: 400_000, writeTokens: 40_000, hitRatio: 0.62, savedUsd: 1.08 },
        }),
        getBreakdown: () => mkBreakdown(),
      }));
      expect(out).toContain('78.0%');
      expect(out).toContain('🟡');
      expect(out).toContain('WARNING');
      // Real per-category breakdown (measured, not the old fixed percentages)
      expect(out).toContain('History');
      expect(out).toContain('System');
      expect(out).toContain('MCP');
      expect(out).toContain('Measured from the assembled request');
      expect(out).toContain('700,000'); // history.total from the fixture
      expect(out).toContain('heaviest static: identity 30,000');
      // Should show threshold markers
      expect(out).toContain('soft');
      expect(out).toContain('hard');
      // Compaction box shows real policy params, not a fabricated strategy line
      expect(out).toContain('Compaction');
      expect(out).toContain('Thresholds');
      expect(out).not.toContain('Est. recovery');
      // Should show token metrics + the real cache-hit line
      expect(out).toContain('Token Metrics');
      expect(out).toContain('220,000');
      expect(out).toContain('Cache hit');
      expect(out).toContain('62.0%');
      expect(out).toContain('saved ~$1.08');
      // Should show status
      expect(out).toContain('Status');
    });

    it('falls back to an honest total (no fake split) when no breakdown is available', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({ ctxPct: 0.5, ctxTokens: 500_000, ctxMaxTokens: 1_000_000 }),
        // getBreakdown omitted
      }));
      expect(out).toContain('Per-category breakdown appears once a request is assembled');
      expect(out).toContain('TOTAL');
      // Must NOT invent per-source rows without real data
      expect(out).not.toContain('Measured from the assembled request');
    });

    it('positions threshold markers from the active policy, not hardcoded 60/85/95', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({ ctxPct: 0.5, ctxTokens: 500_000, ctxMaxTokens: 1_000_000 }),
        getPolicy: () => mkPolicy(),
      }));
      // Frugal thresholds: warn 45% / soft 60% / hard 75%
      expect(out).toContain('warn⏤45%');
      expect(out).toContain('soft⏤60%');
      expect(out).toContain('hard⏤75%');
      expect(out).toContain('frugal (Frugal)');
    });

    it('renders high-pressure view (🔴) at 95%', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({
          ctxPct: 0.95,
          ctxTokens: 950_000,
          ctxMaxTokens: 1_000_000,
        }),
      }));
      expect(out).toContain('95.0%');
      expect(out).toContain('🔴');
      expect(out).toContain('CRITICAL');
    });

    it('includes per-agent breakdown when fleet entries have ctxPct', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({ ctxPct: 0.78, ctxTokens: 780_000, ctxMaxTokens: 1_000_000 }),
        getFleet: () => ({
          total: 2,
          running: 2,
          entries: [
            { name: 'reviewer', status: 'running', currentTool: 'read', ctxPct: 0.45 },
            { name: 'scanner', status: 'running', currentTool: 'grep', ctxPct: 0.62 },
          ],
        }),
      }));
      expect(out).toContain('Per-Agent');
      expect(out).toContain('reviewer');
      expect(out).toContain('scanner');
      expect(out).toContain('45%');
      expect(out).toContain('62%');
    });

    it('renders rounded-corner boxes', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({ ctxPct: 0.50, ctxTokens: 500_000, ctxMaxTokens: 1_000_000 }),
      }));
      // Box top-left corners
      expect(out).toContain('╭');
      // Box bottom-left corners
      expect(out).toContain('╰');
    });
  });
});
