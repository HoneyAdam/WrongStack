import { describe, expect, it } from 'vitest';
import { buildSecurityCommand } from '../src/slash-commands/security.js';

function makeOptions() {
  return {
    cwd: 'C:/private/project',
    projectRoot: 'C:/private/project',
  } as never;
}

describe('/security command contract', () => {
  it('exposes inspect-category deep help and argument hints', async () => {
    const command = buildSecurityCommand(makeOptions());
    expect(command.name).toBe('security');
    expect(command.category).toBe('Inspect');
    expect(command.argsHint).toContain('--json');
    expect(command.help).toContain('Usage: /security');

    const result = await command.run('help', undefined);
    expect(result?.message).toContain('audit-deps');
    expect(result?.metadata?.['security']).toMatchObject({ action: 'help' });
  });

  it('returns stable structured help when --json is the only argument', async () => {
    const result = await buildSecurityCommand(makeOptions()).run('--json', undefined);
    expect(JSON.parse(result!.message!)).toEqual({
      ok: true,
      action: 'help',
      subcommands: ['scan', 'audit', 'audit-deps', 'report', 'redact-test', 'help'],
    });
  });

  it('routes scan to the real backend and reports missing provider without exposing project path', async () => {
    const result = await buildSecurityCommand(makeOptions()).run('scan --json', undefined);
    const payload = JSON.parse(result!.message!);
    expect(payload).toMatchObject({
      ok: false,
      action: 'scan',
      error: { code: 'security_command_failed' },
    });
    expect(payload.error.message).toContain('requires an active LLM provider');
    expect(result!.message).not.toContain('C:/private/project');
    expect(result!.metadata?.['security']).toEqual(payload);
  });

  it('returns redaction field names and counts without synthetic secret values', async () => {
    const result = await buildSecurityCommand(makeOptions()).run('redact-test --json', undefined);
    const payload = JSON.parse(result!.message!);
    expect(payload).toMatchObject({ ok: true, action: 'redact-test' });
    expect(payload.redactedCount).toBeGreaterThanOrEqual(3);
    expect(payload.redactedFields).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\$\./)]),
    );
    expect(result!.message).not.toContain('sk-1234567890');
    expect(result!.message).not.toContain('p4ssw0rd');
  });

  it('returns a stable structured error for unknown subcommands', async () => {
    const result = await buildSecurityCommand(makeOptions()).run('nope --json', undefined);
    expect(JSON.parse(result!.message!)).toMatchObject({
      ok: false,
      action: 'nope',
      error: { code: 'unknown_subcommand' },
    });
  });
});
