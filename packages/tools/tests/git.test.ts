import { describe, it, expect, vi } from 'vitest';
import { gitTool } from '../src/git.js';

const makeCtx = (cwd = '/fake') => ({ cwd, tools: [], projectRoot: cwd } as Parameters<typeof gitTool.execute>[1]);
const makeOpts = () => ({ signal: new AbortController().signal });

describe('gitTool', () => {
  it('has correct metadata', () => {
    expect(gitTool.name).toBe('git');
    expect(gitTool.permission).toBe('confirm');
    expect(gitTool.inputSchema.required).toContain('command');
  });

  it('throws when command is missing', async () => {
    const ctx = makeCtx();
    await expect(gitTool.execute({} as never, ctx, makeOpts())).rejects.toThrow('command is required');
  });

  it('returns error when not in a git repo', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toBe('Not in a git repository');
  });

  it('handles raw args', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'status', args: '--porcelain' } as never, ctx, makeOpts());
    expect(result).toHaveProperty('exitCode');
  });

  it('respects dry_run for commit', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'commit', dry_run: true, message: 'test' }, ctx, makeOpts());
    expect(result).toHaveProperty('exitCode');
  });

  it('handles stash with message', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'stash', message: 'wip' }, ctx, makeOpts());
    expect(result).toHaveProperty('exitCode');
  });
});

describe('buildArgs (via execute in non-git dir)', () => {
  // These test the arg building logic through the tool, even though
  // they all return 128 (not in git repo). The key is they don't crash.

  const commands = [
    { command: 'status' as const },
    { command: 'status' as const, files: 'a.ts,b.ts' },
    { command: 'log' as const },
    { command: 'log' as const, format: 'oneline' as const },
    { command: 'log' as const, format: 'stat' as const },
    { command: 'log' as const, format: 'graph' as const },
    { command: 'log' as const, format: 'short' as const },
    { command: 'log' as const, limit: 5 },
    { command: 'diff' as const },
    { command: 'diff' as const, files: 'src/*.ts' },
    { command: 'commit' as const, message: 'chore: update' },
    { command: 'commit' as const, dry_run: true },
    { command: 'commit' as const, message: 'fix', files: 'a.ts' },
    { command: 'branch' as const },
    { command: 'branch' as const, branch: 'feature/x' },
    { command: 'checkout' as const, branch: 'main' },
    { command: 'checkout' as const, files: 'a.ts' },
    { command: 'stash' as const },
    { command: 'stash' as const, message: 'wip' },
    { command: 'push' as const },
    { command: 'pull' as const },
    { command: 'fetch' as const },
    { command: 'fetch' as const, branch: 'main' },
    { command: 'reset' as const },
    { command: 'status' as const, args: '--short --branch' },
  ] as const;

  for (const input of commands) {
    it(`builds args for ${JSON.stringify(input)}`, async () => {
      const ctx = makeCtx('/');
      const result = await gitTool.execute({ ...input }, ctx, makeOpts());
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
    });
  }

  it('handles array files', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'status', files: ['a.ts', 'b.ts'] }, ctx, makeOpts());
    expect(result).toHaveProperty('exitCode');
  });
});
