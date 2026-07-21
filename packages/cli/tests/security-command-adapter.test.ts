import { describe, expect, it, vi } from 'vitest';
import { createCliSecurityCommand } from '../src/wiring/security-command.js';

describe('CLI security command adapter', () => {
  it('forwards the active host provider and scan options to the package command', async () => {
    const provider = { complete: vi.fn() } as never;
    const run = vi.fn().mockResolvedValue({
      message: 'scan complete',
      metadata: { reportPath: 'security-reports/report.md' },
    });
    const command = createCliSecurityCommand(
      {
        cwd: 'C:/repo',
        projectRoot: 'C:/repo',
        llmProvider: provider,
        llmModel: 'secure-model',
      },
      { run },
    );

    const result = await command.run('scan --depth deep --format json --json');

    expect(run).toHaveBeenCalledWith(
      'scan --depth deep --format json',
      expect.objectContaining({
        cwd: 'C:/repo',
        projectRoot: 'C:/repo',
        provider,
        model: 'secure-model',
      }),
    );
    expect(JSON.parse(result!.message!)).toMatchObject({
      ok: true,
      action: 'scan',
      reportPath: 'security-reports/report.md',
    });
  });
});
