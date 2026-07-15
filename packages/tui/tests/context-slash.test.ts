import { describe, expect, it } from 'vitest';
import type { GitInfo } from '../src/git-info.js';
import {
  createContextSlashCommand,
  renderContext,
  renderContextWindowExpanded,
  type ContextSlashDeps,
} from '../src/context-slash.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

    it('renders moderate-pressure view (🟡) at 78%', () => {
      const out = renderContextWindowExpanded(deps({
        getLeader: () => leader({
          ctxPct: 0.78,
          ctxTokens: 780_000,
          ctxMaxTokens: 1_000_000,
        }),
      }));
      expect(out).toContain('78.0%');
      expect(out).toContain('🟡');
      expect(out).toContain('WARNING');
      // Should show source breakdown
      expect(out).toContain('History');
      expect(out).toContain('System');
      expect(out).toContain('MCP');
      // Should show threshold markers
      expect(out).toContain('soft');
      expect(out).toContain('hard');
      // Should show compaction section
      expect(out).toContain('Compaction');
      expect(out).toContain('hybrid');
      // Should show token metrics
      expect(out).toContain('Token Metrics');
      expect(out).toContain('220,000');
      // Should show status
      expect(out).toContain('Status');
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
