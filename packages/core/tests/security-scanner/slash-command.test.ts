import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const orchestratorMocks = vi.hoisted(() => ({
  run: vi.fn(),
}));

vi.mock('../../src/security-scanner/orchestrator.js', () => ({
  defaultOrchestrator: { run: orchestratorMocks.run },
}));

import { createSecuritySlashCommand } from '../../src/security-scanner/slash-command.js';

let prevCwd: string;
let tmp: string;

beforeEach(async () => {
  orchestratorMocks.run.mockReset();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-slash-'));
  prevCwd = process.cwd();
  process.chdir(tmp);
});

afterEach(async () => {
  process.chdir(prevCwd);
  await fs.rm(tmp, { recursive: true, force: true });
});

function fakeCtx(overrides: Record<string, unknown> = {}) {
  return {
    projectRoot: tmp,
    cwd: tmp,
    provider: { complete: () => ({}) } as never,
    model: 'opus',
    ...overrides,
  } as never;
}

function withoutProvider() {
  return { projectRoot: tmp, cwd: tmp } as never;
}

describe('createSecuritySlashCommand', () => {
  it('exposes slash command metadata', () => {
    const cmd = createSecuritySlashCommand();
    expect(cmd.name).toBe('security');
    expect(cmd.argsHint).toBeDefined();
    expect(cmd.help).toBeDefined();
  });

  it('default (no subcommand) shows help message', async () => {
    const cmd = createSecuritySlashCommand();
    const res = await cmd.run('', fakeCtx());
    expect(res?.message).toContain('/security — Security Scanner');
    expect(res?.message).toContain('scan');
    expect(res?.message).toContain('audit');
  });

  it('unknown subcommand also shows help message', async () => {
    const cmd = createSecuritySlashCommand();
    const res = await cmd.run('frobulate', fakeCtx());
    expect(res?.message).toContain('/security — Security Scanner');
  });

  // ── /security scan ─────────────────────────────────────────────────────────

  describe('scan', () => {
    it('errors without provider configured', async () => {
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('scan', withoutProvider());
      expect(res?.message).toContain('requires an active LLM provider');
    });

    it('uses synthesizedReport when orchestrator provides one', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: {
          summary: { critical: 1, high: 0, medium: 0, low: 0, total: 1 },
          scannedFiles: 10,
          scanDurationMs: 100,
        },
        detectionResult: { detectedStacks: [{ stack: 'typescript' }] },
        synthesizedReport: '# Custom Report\nFancy content',
        reportPath: '/tmp/report.md',
      });
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toContain('# Custom Report');
      expect(res?.metadata?.reportPath).toBe('/tmp/report.md');
    });

    it('falls back to built-in summary when no synthesizedReport', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: {
          summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
          scannedFiles: 5,
          scanDurationMs: 200,
        },
        detectionResult: { detectedStacks: [{ stack: 'python' }] },
        synthesizedReport: null,
        reportPath: '/tmp/r.md',
      });
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toContain('No issues found');
      expect(res?.message).toContain('python');
    });

    it('parses --depth and --format flags', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, scannedFiles: 0, scanDurationMs: 0 },
        detectionResult: { detectedStacks: [] },
        synthesizedReport: 'x',
        reportPath: '',
      });
      const cmd = createSecuritySlashCommand();
      await cmd.run('scan --depth deep --format html', fakeCtx());
      expect(orchestratorMocks.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scanOptions: expect.objectContaining({ depth: 'deep' }),
          reportOptions: { format: 'html' },
        }),
      );
    });

    it('uses default depth/format when not specified', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, scannedFiles: 0, scanDurationMs: 0 },
        detectionResult: { detectedStacks: [] },
        synthesizedReport: 'x',
        reportPath: '',
      });
      const cmd = createSecuritySlashCommand();
      await cmd.run('scan', fakeCtx());
      expect(orchestratorMocks.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          scanOptions: expect.objectContaining({ depth: 'standard' }),
          reportOptions: { format: 'markdown' },
        }),
      );
    });

    it('catches orchestrator errors', async () => {
      orchestratorMocks.run.mockRejectedValue(new Error('boom'));
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('scan', fakeCtx());
      expect(res?.message).toContain('Scan failed');
      expect(res?.message).toContain('boom');
    });
  });

  // ── /security audit ────────────────────────────────────────────────────────

  describe('audit', () => {
    it('errors without provider configured', async () => {
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('audit', withoutProvider());
      expect(res?.message).toContain('requires an active LLM provider');
    });

    it('uses synthesizedReport when available', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 2, high: 1, medium: 0, low: 0 } },
        detectionResult: { detectedStacks: [{ stack: 'go' }] },
        synthesizedReport: '# Audit',
        reportPath: '/p',
      });
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('# Audit');
    });

    it('falls back to built-in audit summary with no issues', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 0, high: 0, medium: 0, low: 0 } },
        detectionResult: { detectedStacks: [{ stack: 'rust' }] },
        synthesizedReport: null,
        reportPath: '/p',
      });
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('No known vulnerabilities');
    });

    it('falls back to built-in audit summary with issues found', async () => {
      orchestratorMocks.run.mockResolvedValue({
        scanResult: { summary: { critical: 1, high: 2, medium: 5, low: 10 } },
        detectionResult: { detectedStacks: [{ stack: 'node' }] },
        synthesizedReport: null,
        reportPath: '/p',
      });
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('3 vulnerabilities need attention');
    });

    it('catches orchestrator errors', async () => {
      orchestratorMocks.run.mockRejectedValue('plain');
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('audit', fakeCtx());
      expect(res?.message).toContain('Audit failed');
    });
  });

  // ── /security report ───────────────────────────────────────────────────────

  describe('report', () => {
    it('lists no reports when directory missing', async () => {
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('report', fakeCtx());
      expect(res?.message).toContain('No security reports');
    });

    it('lists existing reports sorted newest first', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '# Old');
      await fs.writeFile(path.join(dir, 'security-report-2026-05-22.md'), '# Recent');
      await fs.writeFile(path.join(dir, 'unrelated.txt'), 'skip');
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('report', fakeCtx());
      expect(res?.message).toContain('Available Security Reports');
      expect(res?.message).toContain('2026-05-22');
      expect(res?.message).toContain('2026-01-01');
      expect(res?.message).not.toContain('unrelated');
    });

    it('shows the Nth report when ID is a numeric index', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '# Old content');
      await fs.writeFile(path.join(dir, 'security-report-2026-05-22.md'), '# Recent content');
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('report 1', fakeCtx());
      expect(res?.message).toContain('# Recent content');
    });

    it('finds a report by date substring', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), '# Jan');
      await fs.writeFile(path.join(dir, 'security-report-2026-05-22.md'), '# May');
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('report 2026-01', fakeCtx());
      expect(res?.message).toContain('# Jan');
    });

    it('reports not-found for unknown ID', async () => {
      const dir = path.join(tmp, 'security-reports');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'security-report-2026-01-01.md'), 'x');
      const cmd = createSecuritySlashCommand();
      const res = await cmd.run('report 9999-99-99', fakeCtx());
      expect(res?.message).toContain('not found');
    });
  });
});
