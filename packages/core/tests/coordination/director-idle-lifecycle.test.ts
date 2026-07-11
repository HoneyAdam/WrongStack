import { afterEach, describe, expect, it, vi } from 'vitest';
import { Director } from '../../src/coordination/director.js';
import type {
  SubagentRunContext,
  SubagentRunOutcome,
  TaskSpec,
} from '../../src/types/multi-agent.js';

function makeDirector(opts: {
  idleMs?: number;
  retireOnComplete?: boolean;
  runner?: (task: TaskSpec, ctx: SubagentRunContext) => Promise<SubagentRunOutcome>;
}): Director {
  return new Director({
    config: {
      coordinatorId: 'idle-lifecycle-test',
      doneCondition: { type: 'all_tasks_done' },
      maxConcurrent: 1,
    },
    subagentIdleTimeoutMs: opts.idleMs,
    retireSubagentOnTaskComplete: opts.retireOnComplete,
    runner:
      opts.runner ??
      (async () => ({ result: 'final answer', iterations: 1, toolCalls: 0 })),
  });
}

afterEach(() => vi.useRealTimers());

describe('Director subagent idle lifecycle', () => {
  it('removes a spawned subagent after the configured idle timeout', async () => {
    vi.useFakeTimers();
    const director = makeDirector({ idleMs: 50 });
    const removed: string[] = [];
    const off = director.fleet.filter('subagent.removed', (event) => {
      removed.push(event.subagentId);
    });

    await director.spawn({ id: 'idle-worker', name: 'Idle worker' });
    await vi.advanceTimersByTimeAsync(49);
    expect(director.status().subagents.some((a) => a.id === 'idle-worker')).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(director.status().subagents.some((a) => a.id === 'idle-worker')).toBe(false);
    expect(removed).toEqual(['idle-worker']);

    off();
    await director.shutdown();
  });

  it('retires a subagent immediately after its final task result is delivered', async () => {
    vi.useFakeTimers();
    const director = makeDirector({ idleMs: 60_000, retireOnComplete: true });
    await director.spawn({ id: 'one-shot', name: 'One shot' });
    await director.assign({ id: 'task-1', description: 'finish', subagentId: 'one-shot' });

    const [result] = await director.awaitTasks(['task-1']);
    expect(result?.result).toBe('final answer');
    expect(director.status().subagents.some((a) => a.id === 'one-shot')).toBe(true);

    await vi.advanceTimersByTimeAsync(0);
    expect(director.status().subagents.some((a) => a.id === 'one-shot')).toBe(false);
    expect(director.completedResults().map((r) => r.taskId)).toContain('task-1');

    await director.shutdown();
  });

  it('lets queued work reuse the worker before retiring it', async () => {
    vi.useFakeTimers();
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const director = makeDirector({
      idleMs: 60_000,
      retireOnComplete: true,
      runner: async (task) => {
        if (task.id === 'task-1') await firstGate;
        return { result: task.id, iterations: 1, toolCalls: 0 };
      },
    });
    await director.spawn({ id: 'reused-worker', name: 'Reusable' });
    await director.assign({ id: 'task-1', description: 'first', subagentId: 'reused-worker' });
    await director.assign({ id: 'task-2', description: 'second', subagentId: 'reused-worker' });

    releaseFirst();
    const results = await director.awaitTasks(['task-1', 'task-2']);
    expect(results.map((r) => r.result)).toEqual(['task-1', 'task-2']);

    await vi.advanceTimersByTimeAsync(0);
    expect(director.status().subagents.some((a) => a.id === 'reused-worker')).toBe(false);
    await director.shutdown();
  });
});
