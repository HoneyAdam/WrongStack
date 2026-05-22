import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const orchestratorMocks = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('@wrongstack/core', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    defaultOrchestrator: { run: orchestratorMocks.run },
  };
});

import { buildSecurityCommand } from '../src/slash-commands/security.js';

let tmp: string;
let prevCwd: string;

beforeEach(async () => {
  orchestratorMocks.run.mockReset();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-cli-'));
  prevCwd = process.cwd();
  process.chdir(tmp);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

function fakeOpts(overrides: Record<string, unknown> = {}) {
  return {
    llmProvider: { complete: vi.fn() } as never,
    llmModel: 'opus',
    projectRoot: tmp,
    ...overrides,
  } as never;
}

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    projectRoot: tmp,
    provider: { complete: vi.fn() } as never,
    model: 'opus',
    ...overrides,
  } as never;
}

describe('buildSecurityCommand', () => {
  it('default shows help', async () => {
    const cmd = buildSecurityCommand(fakeOpts());
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('Security Scanner');
  });

  it('unknown subcommand also shows help', async () => {
    const cmd = buildSecurityCommand(fakeOpts());
    const res = await cmd.run('frobulate', fakeCtx());
    expect(res?.message).toContain('Security Scanner');
  });

  // ── scan ────────────────────────────────────────────────────────────────────

  describe('scan', () => {
    it('falls back to opts.projectRoot when ctx.projectRoot empty', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, scannedFiles: 0, scanDurationMs: 0 },
        detectionResult: { detectedStacks: [] },
        synthesizedReport: 'OK',
        reportPath: '/r.md',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      await cmd.run('scan', fakeCtx({ projectRoot: '' }));
      expect(orchestratorMocks.run).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expect.anything() }),
        expect.objectContaining({ projectRoot: tmp }),
      );
    });

    it('errors without LLM provider', async () => {
      const cmd = buildSecurityCommand(
        fakeOpts({ llmProvider: undefined }),
      );
      const res = await cmd.run('scan', fakeCtx({ provider: undefined }));
      expect(res?.message).toContain('requires an active LLM provider');
    });

    it('uses ctx.provider when opts.llmProvider missing', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, scannedFiles: 0, scanDurationMs: 0 },
        detectionResult: { detectedStacks: [] },
        synthesizedReport: 'X',
        reportPath: '/r',
      });
      const cmd = buildSecurityCommand(fakeOpts({ llmProvider: undefined }));
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toBe('X');
    });

    it('synthesizedReport takes precedence', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { total: 3, critical: 1, high: 2, medium: 0, low: 0 }, scannedFiles: 5, scanDurationMs: 100 },
        detectionResult: { detectedStacks: [{ stack: 'go' }] },
        synthesizedReport: '## Custom\nfine',
        reportPath: '/p.md',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('scan --depth deep', fakeCtx());
      expect(res?.message).toContain('## Custom');
    });

    it('built-in template runs when synthesizedReport empty', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, scannedFiles: 0, scanDurationMs: 0 },
        detectionResult: { detectedStacks: [{ stack: 'typescript' }] },
        synthesizedReport: null,
        reportPath: '/r.md',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toContain('No issues found');
      expect(res?.message).toContain('typescript');
    });

    it('catches errors', async () => {
      orchestratorMocks.run.mockRejectedValue(new Error('crash'));
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toContain('Scan failed');
    });
  });

  // ── audit ───────────────────────────────────────────────────────────────────

  describe('audit', () => {
    it('errors without provider', async () => {
      const cmd = buildSecurityCommand(fakeOpts({ llmProvider: undefined }));
      const res = await cmd.run('audit', fakeCtx({ provider: undefined }));
      expect(res?.message).toContain('requires an active LLM provider');
    });

    it('uses synthesized audit report', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
        detectionResult: { detectedStacks: [{ stack: 'rust' }] },
        synthesizedReport: '# Done',
        reportPath: '/p',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('# Done');
    });

    it('falls back to built-in summary on clean', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
        detectionResult: { detectedStacks: [{ stack: 'js' }] },
        synthesizedReport: '',
        reportPath: '/p',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('No known vulnerabilities');
    });

    it('falls back to built-in summary with issues', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 2, high: 1, medium: 0, low: 0 } },
        detectionResult: { detectedStacks: [{ stack: 'js' }] },
        synthesizedReport: '',
        reportPath: '/p',
      });
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('3 vulnerabilities');
    });

    it('catches errors', async () => {
      orchestratorMocks.run.mockRejectedValue('plain');
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('Audit failed');
    });
  });

  // ── report ──────────────────────────────────────────────────────────────────

  describe('report', () => {
    it('shows "no reports" message when directory missing', async () => {
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('report', fakeCtx());
      expect(res?.message).toContain('No security reports');
    });

    it('lists reports in newest-first order', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-15.md'), '');
      await fs.writeFile(path.join(dir, 'security-report-2026-05-01.md'), '');
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('report', fakeCtx());
      expect(res?.message).toMatch(/2026-05-01[\s\S]+2026-01-15/);
    });

    it('finds report by numeric index', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '# A');
      await fs.writeFile(path.join(dir, 'security-report-2026-05-22.md'), '# B');
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('report 1', fakeCtx());
      expect(res?.message).toContain('# B');
    });

    it('finds report by date substring', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '# Jan');
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('report 2026-01', fakeCtx());
      expect(res?.message).toContain('# Jan');
    });

    it('reports not found for unknown', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '');
      const cmd = buildSecurityCommand(fakeOpts());
      const res = await cmd.run('report 9999', fakeCtx());
      expect(res?.message).toContain('not found');
    });
  });
});
