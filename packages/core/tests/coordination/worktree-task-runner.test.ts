import { describe, expect, it, vi } from 'vitest';
import {
  resolveSubagentWorktreeDecision,
  subagentNeedsWorktree,
  WorktreeIntegrationError,
  wrapSubagentRunnerWithWorktrees,
} from '../../src/coordination/worktree-task-runner.js';
import type {
  SubagentRunContext,
  SubagentRunOutcome,
  TaskSpec,
} from '../../src/types/multi-agent.js';
import type { RunResult } from '../../src/worktree/worktree-manager.js';
import { WorktreeManager } from '../../src/worktree/worktree-manager.js';

function stubRunner(
  script: (args: string[]) => RunResult = () => ({ code: 0, stdout: '', stderr: '' }),
) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const run = async (args: string[], cwd: string): Promise<RunResult> => {
    calls.push({ args, cwd });
    return script(args);
  };
  return { calls, run };
}

function makeCtx(over: Partial<SubagentRunContext> = {}): SubagentRunContext {
  return {
    subagentId: 's1',
    config: { name: 'Executor', role: 'executor', tools: ['read', 'write'] },
    budget: {} as never,
    signal: new AbortController().signal,
    bridge: null,
    ...over,
  };
}

const task: TaskSpec = { id: 't1', description: 'change the code' };

describe('worktree task runner', () => {
  it('auto-selects worktrees for side-effectful agents but not read-only reviewers', () => {
    expect(subagentNeedsWorktree({ name: 'Executor', tools: ['read', 'write'] })).toBe(true);
    expect(
      subagentNeedsWorktree({ name: 'Reviewer', role: 'reviewer', tools: ['read', 'diff', 'git'] }),
    ).toBe(false);
    expect(resolveSubagentWorktreeDecision({ name: 'Executor', tools: ['write'] })).toBe(
      'optional',
    );
    expect(
      resolveSubagentWorktreeDecision({ name: 'Executor', tools: ['write'] }, { mode: 'required' }),
    ).toBe('required');
    expect(
      resolveSubagentWorktreeDecision({ name: 'Executor', tools: ['write'], worktree: false }),
    ).toBe('off');
  });

  it('falls back to the shared cwd when optional allocation fails', async () => {
    const { run } = stubRunner((args) => {
      if (args[0] === 'rev-parse') return { code: 0, stdout: 'main\n', stderr: '' };
      if (args[0] === 'worktree' && args[1] === 'add') {
        return { code: 1, stdout: '', stderr: 'fatal: not a repo' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    const worktrees = new WorktreeManager({ projectRoot: '/repo', run });
    const runner = vi.fn(async (_task: TaskSpec, ctx: SubagentRunContext) => {
      expect(ctx.config.cwd).toBeUndefined();
      return { result: 'ok', iterations: 1, toolCalls: 1 } satisfies SubagentRunOutcome;
    });
    const updates: string[] = [];

    const wrapped = wrapSubagentRunnerWithWorktrees({
      runner,
      worktrees,
      onUpdate: (u) => updates.push(u.status),
    });

    await expect(wrapped(task, makeCtx())).resolves.toEqual({
      result: 'ok',
      iterations: 1,
      toolCalls: 1,
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(updates).toEqual(['fallback']);
  });

  it('fails before running the task when required isolation has no manager', async () => {
    const runner = vi.fn(async () => ({ iterations: 1, toolCalls: 1 }));
    const wrapped = wrapSubagentRunnerWithWorktrees({
      runner,
      policy: { mode: 'required' },
    });

    await expect(wrapped(task, makeCtx())).rejects.toBeInstanceOf(WorktreeIntegrationError);
    expect(runner).not.toHaveBeenCalled();
  });

  it('runs in the allocated worktree, commits, squash-merges, and releases on success', async () => {
    const { calls, run } = stubRunner((args) => {
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
        return { code: 0, stdout: 'main\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return { code: 0, stdout: 'abc123\n', stderr: '' };
      }
      if (args[0] === 'diff' && args.includes('--cached')) {
        return { code: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'show') return { code: 0, stdout: '2\t0\tfile.ts\n', stderr: '' };
      if (args[0] === 'config') return { code: 0, stdout: 'User\n', stderr: '' };
      if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    const worktrees = new WorktreeManager({ projectRoot: '/repo', run });
    const runner = vi.fn(async (_task: TaskSpec, ctx: SubagentRunContext) => {
      expect(ctx.config.cwd?.replace(/\\/g, '/')).toContain('/repo/.wrongstack/worktrees/');
      return { result: 'done', iterations: 2, toolCalls: 3 };
    });
    const updates: string[] = [];
    const wrapped = wrapSubagentRunnerWithWorktrees({
      runner,
      worktrees,
      onUpdate: (u) => updates.push(u.status),
    });

    await expect(wrapped(task, makeCtx())).resolves.toEqual({
      result: 'done',
      iterations: 2,
      toolCalls: 3,
    });

    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'add')).toBe(true);
    expect(calls.some((c) => c.args[0] === 'merge' && c.args.includes('--squash'))).toBe(true);
    expect(calls.some((c) => c.args[0] === 'worktree' && c.args[1] === 'remove')).toBe(true);
    expect(updates).toEqual(['allocated', 'committed', 'merged']);
  });
});
