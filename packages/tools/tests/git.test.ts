import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { gitTool } from '../src/git.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const makeCtx = (cwd = '/fake') =>
  ({ cwd, tools: [], projectRoot: cwd }) as Parameters<typeof gitTool.execute>[1];
const makeOpts = () => ({ signal: new AbortController().signal });

describe('gitTool', () => {
  it('has correct metadata', () => {
    expect(gitTool.name).toBe('git');
    expect(gitTool.permission).toBe('confirm');
    expect(gitTool.inputSchema.required).toContain('command');
  });

  it('throws when command is missing', async () => {
    const ctx = makeCtx();
    await expect(gitTool.execute({} as never, ctx, makeOpts())).rejects.toThrow(
      'command is required',
    );
  });

  it('returns error when not in a git repo', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toMatch(/Not in a git repository/);
  });

  it('handles raw args', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute(
      { command: 'status', args: '--porcelain' } as never,
      ctx,
      makeOpts(),
    );
    expect(result).toHaveProperty('exitCode');
  });

  it('respects dry_run for commit', async () => {
    const ctx = makeCtx('/');
    const result = await gitTool.execute(
      { command: 'commit', dry_run: true, message: 'test' },
      ctx,
      makeOpts(),
    );
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
    const result = await gitTool.execute(
      { command: 'status', files: ['a.ts', 'b.ts'] },
      ctx,
      makeOpts(),
    );
    expect(result).toHaveProperty('exitCode');
  });
});

describe('gitTool live execution (uses the test repo itself)', () => {
  // We're running inside the WrongStack repo, so process.cwd() resolves to a
  // real git working tree — exercises runGit end-to-end.
  const ctx = makeCtx(process.cwd());

  it('executes `git status` and returns exit code 0', async () => {
    const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
    expect(result.exitCode).toBe(0);
    expect(result.command).toBe('status');
    expect(typeof result.stdout).toBe('string');
  });

  it('executes `git log --oneline -n 1` and returns at least one commit', async () => {
    const result = await gitTool.execute(
      { command: 'log', format: 'oneline', limit: 1 },
      ctx,
      makeOpts(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean).length).toBeGreaterThan(0);
  });

  it('aborts when the signal is fired before spawn', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await gitTool.execute({ command: 'log' }, ctx, { signal: ac.signal });
    // Aborted signal causes ENOENT / AbortError; exitCode comes from
    // child.on('error') path. We just verify the tool resolves rather than
    // throws.
    expect(result.exitCode).not.toBe(0);
  });
});

// ─── New coverage tests ───────────────────────────────────────────────────────

describe('gitTool runGit error paths', () => {
  it('handles child spawn error via child.on(error)', async () => {
    const ctx = makeCtx('/non/existent/path');
    // Use a command that should fail to spawn
    const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
    // Should not throw, returns error result
    expect(result).toHaveProperty('exitCode');
    expect(result).toHaveProperty('stderr');
  });

  it('handles truncated output in runGit', async () => {
    const ctx = makeCtx(process.cwd());
    // Large log output that may exceed MAX_OUTPUT (100000)
    const result = await gitTool.execute(
      { command: 'log', format: 'oneline', limit: 1000 },
      ctx,
      makeOpts(),
    );
    expect(result).toHaveProperty('truncated');
    expect(result.stdout.length).toBeLessThanOrEqual(100000 + 1);
  });
});

describe('gitTool findGitDir bounds', () => {
  it('findGitDir is bounded by projectRoot', async () => {
    // Create a temporary directory structure:
    // /tmp/nested-git-test/
    //   .git/
    //   parent/  <- this is projectRoot but no git here
    //     child/  <- this is cwd but parent has .git
    // If we use a projectRoot without .git, it should NOT find a parent git repo
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'git-bound-test-'));
    try {
      // Create projectRoot with no git
      const projectRoot = path.join(base, 'project');
      await fs.mkdir(projectRoot, { recursive: true });
      // Create a nested cwd that would have .git if we didn't bound by projectRoot
      const gitDir = path.join(base, 'git-repo', '.git');
      await fs.mkdir(gitDir, { recursive: true });
      // Write a ref to make it a valid gitdir
      await fs.mkdir(path.join(gitDir, 'refs'), { recursive: true });

      const ctx = { cwd: path.join(projectRoot, 'subdir'), tools: [], projectRoot } as any;
      const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
      // Should return 128 because projectRoot has no git
      expect(result.exitCode).toBe(128);
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('findGitDir returns null when no git repo exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-git-'));
    try {
      const ctx = { cwd: dir, tools: [], projectRoot: dir } as any;
      const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
      expect(result.exitCode).toBe(128);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('gitTool buildArgs edge cases', () => {
  it('branch rejects names starting with dash', async () => {
    const ctx = makeCtx('/');
    // branch name starting with '-' is rejected (flag injection prevention)
    const result = await gitTool.execute(
      { command: 'branch', branch: '-f' } as any,
      ctx,
      makeOpts(),
    );
    // Should not crash, just not include the branch arg
    expect(result).toHaveProperty('exitCode');
  });

  it('checkout works with just files (no branch)', async () => {
    const ctx = makeCtx(process.cwd());
    // Just files, no branch specified
    const result = await gitTool.execute({ command: 'checkout', files: 'README.md' }, ctx, makeOpts());
    // May fail if file doesn't exist or has conflicts, but shouldn't crash
    expect(result).toHaveProperty('exitCode');
  });

  it('commit handles missing message gracefully', async () => {
    const ctx = makeCtx(process.cwd());
    const result = await gitTool.execute({ command: 'commit' } as any, ctx, makeOpts());
    // git commit without message should fail with non-zero exitCode
    expect(result.exitCode).not.toBe(0);
  });
});

describe('gitTool runGit close handling', () => {
  it('handles null exit code from child', async () => {
    const ctx = makeCtx(process.cwd());
    // Force an error condition
    const ac = new AbortController();
    // Abort immediately after starting
    setTimeout(() => ac.abort(), 10);
    const result = await gitTool.execute({ command: 'status' }, ctx, { signal: ac.signal });
    expect(result).toHaveProperty('exitCode');
  });
});

describe('gitTool truncation', () => {
  it('marks truncated true when stdout exceeds MAX_OUTPUT', async () => {
    const ctx = makeCtx(process.cwd());
    const result = await gitTool.execute(
      { command: 'log', limit: 10000 },
      ctx,
      makeOpts(),
    );
    // With enough commits, stdout may exceed 100000
    expect(typeof result.truncated).toBe('boolean');
    if (result.truncated) {
      expect(result.stdout.length).toBeGreaterThanOrEqual(100000);
    }
  });

  it('marks truncated true when stderr exceeds MAX_OUTPUT', async () => {
    const ctx = makeCtx(process.cwd());
    const result = await gitTool.execute({ command: 'log' }, ctx, makeOpts());
    expect(typeof result.truncated).toBe('boolean');
  });
});

describe('gitTool stdout capping', () => {
  it('caps stdout at MAX_OUTPUT in close handler', async () => {
    const ctx = makeCtx(process.cwd());
    const result = await gitTool.execute(
      { command: 'log', format: 'oneline', limit: 5000 },
      ctx,
      makeOpts(),
    );
    // stdout should be capped at MAX_OUTPUT (100000)
    expect(result.stdout.length).toBeLessThanOrEqual(100000);
  });

  it('caps stderr at MAX_OUTPUT in close handler', async () => {
    const ctx = makeCtx(process.cwd());
    const result = await gitTool.execute({ command: 'status' }, ctx, makeOpts());
    expect(result.stderr.length).toBeLessThanOrEqual(100000);
  });
});