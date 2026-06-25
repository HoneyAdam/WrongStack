import { describe, expect, it, vi } from 'vitest';
import { SddParallelRun } from '../../src/sdd/sdd-parallel-run.js';
import { TaskTracker } from '../../src/sdd/task-tracker.js';
import { EventBus } from '../../src/kernel/events.js';
import type { Agent } from '../../src/core/agent.js';
import type { TaskGraph, TaskNode, TaskStore } from '../../src/types/task-graph.js';
import type { TaskResult } from '../../src/types/multi-agent.js';

function makeFakeStore(): TaskStore {
  const graphs = new Map<string, TaskGraph>();
  return {
    async saveGraph(graph: TaskGraph) {
      graphs.set(graph.id, { ...graph, nodes: new Map(graph.nodes), edges: [...graph.edges], rootNodes: [...graph.rootNodes] });
    },
    async loadGraph(id: string) {
      const g = graphs.get(id);
      return g ? { ...g, nodes: new Map(g.nodes), edges: [...g.edges], rootNodes: [...g.rootNodes] } : null;
    },
    async listGraphs() {
      return Array.from(graphs.values()).map((g) => ({ id: g.id, title: g.title, updatedAt: g.updatedAt }));
    },
    async deleteGraph(id: string) {
      graphs.delete(id);
    },
  };
}

function fakeAgent(): Agent {
  return { events: new EventBus(), run: vi.fn() } as never as Agent;
}

async function makeHarness(overrides: Record<string, unknown> = {}) {
  const tracker = new TaskTracker({ store: makeFakeStore() });
  const graph = await tracker.createGraph('spec-1', 'Parallel Graph');
  const t1 = tracker.addNode({ title: 'T1', description: 'do one', type: 'feature', priority: 'high', status: 'pending' } as never);
  const t2 = tracker.addNode({ title: 'T2', description: 'do two', type: 'chore', priority: 'medium', status: 'pending' } as never);
  const run = new SddParallelRun({ tracker, graph, agent: fakeAgent(), projectRoot: '/proj', ...overrides });
  return { run, tracker, graph, t1, t2 };
}

const okResult = (taskId: string): TaskResult => ({ subagentId: 's', taskId, status: 'success', iterations: 1, toolCalls: 1, durationMs: 1 });
const failResult = (taskId: string, error?: TaskResult['error']): TaskResult => ({
  subagentId: 's', taskId, status: 'failed', error, iterations: 1, toolCalls: 0, durationMs: 1,
});

function fakeCoordinator(over: Partial<Record<string, unknown>> = {}) {
  return {
    spawn: vi.fn(async (c: { id: string }) => ({ subagentId: c.id })),
    assign: vi.fn(async () => {}),
    awaitTasks: vi.fn(async (ids: string[]) => ids.map(okResult)),
    stopAll: vi.fn(),
    ...over,
  };
}

describe('SddParallelRun — constructor clamps', () => {
  it('clamps parallel slots and retries into range', async () => {
    const big = await makeHarness({ parallelSlots: 100, maxRetries: -5 });
    expect((big.run as never as { slots: number }).slots).toBe(16);
    expect((big.run as never as { maxRetries: number }).maxRetries).toBe(0);
    const small = await makeHarness({ parallelSlots: 0 });
    expect((small.run as never as { slots: number }).slots).toBe(1);
  });
});

describe('SddParallelRun.executeWave', () => {
  it('spawns, assigns, awaits and marks every task completed on success', async () => {
    const { run, tracker, t1, t2 } = await makeHarness();
    const coord = fakeCoordinator();
    (run as never as { coordinator: unknown }).coordinator = coord;
    const wave = await run.executeWave({ wave: 0, tasks: [t1, t2], deadlocked: false, allDone: false } as never);
    expect(wave.successCount).toBe(2);
    expect(wave.failCount).toBe(0);
    expect(coord.spawn).toHaveBeenCalledTimes(2);
    expect(coord.assign).toHaveBeenCalledTimes(2);
    expect(tracker.getAllNodes({ status: ['completed'] })).toHaveLength(2);
  });

  it('re-queues a failed task for retry while retries remain', async () => {
    const { run, tracker, t1 } = await makeHarness({ maxRetries: 2 });
    const coord = fakeCoordinator({
      awaitTasks: vi.fn(async (ids: string[]) => ids.map((id) => failResult(id, { kind: 'unknown', message: 'boom', retryable: true }))),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;
    await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    // retry path → t1 re-marked pending (not failed), and the retry counter advances
    const t1After = tracker.getAllNodes().find((n) => n.id === t1.id);
    expect(t1After?.status).toBe('pending');
    expect(tracker.getAllNodes({ status: ['failed'] })).toHaveLength(0);
    expect((run as never as { retryMap: Map<string, number> }).retryMap.get(t1.id)).toBe(1);
  });

  it('marks a task failed once retries are exhausted, formatting the error', async () => {
    const { run, tracker, t1 } = await makeHarness({ maxRetries: 0 });
    const coord = fakeCoordinator({
      awaitTasks: vi.fn(async (ids: string[]) => ids.map((id) => failResult(id, { kind: 'timeout', message: 'too slow', retryable: false }))),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;
    await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    expect(tracker.getAllNodes({ status: ['failed'] })).toHaveLength(1);
  });

  it('handles a failure result with only a message and one with no error object', async () => {
    const { run, tracker } = await makeHarness({ maxRetries: 0 });
    const nodes = tracker.getAllNodes();
    const coord = fakeCoordinator({
      awaitTasks: vi.fn(async (ids: string[]) => [
        failResult(ids[0]!, { kind: undefined as never, message: 'just a message', retryable: false }),
        failResult(ids[1]!, undefined),
      ]),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;
    const wave = await run.executeWave({ wave: 0, tasks: nodes, deadlocked: false, allDone: false } as never);
    expect(wave.failCount).toBe(2);
  });

  it('throws when a subagent spawn returns no id', async () => {
    const { run, t1 } = await makeHarness();
    (run as never as { coordinator: unknown }).coordinator = fakeCoordinator({
      spawn: vi.fn(async () => ({ subagentId: '' })),
    });
    await expect(run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never)).rejects.toThrow(/spawns failed/);
  });

  it('synthesizes failed results when awaitTasks throws', async () => {
    const { run, tracker, t1 } = await makeHarness({ maxRetries: 0 });
    (run as never as { coordinator: unknown }).coordinator = fakeCoordinator({
      awaitTasks: vi.fn(async () => { throw new Error('await exploded'); }),
    });
    const wave = await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    expect(wave.failCount).toBe(1);
    expect(tracker.getAllNodes({ status: ['failed'] })).toHaveLength(1);
  });

  it('throws when no coordinator has been built', async () => {
    const { run, t1 } = await makeHarness();
    (run as never as { coordinator: unknown }).coordinator = null;
    await expect(run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never)).rejects.toThrow(/requires a coordinator/);
  });
});

describe('SddParallelRun — task budget guard', () => {
  it('spawns with an idle reaper and NO hard wall-clock cap by default', async () => {
    const { run, t1 } = await makeHarness();
    const configs: Array<Record<string, unknown>> = [];
    const coord = fakeCoordinator({
      spawn: vi.fn(async (c: Record<string, unknown>) => {
        configs.push(c);
        return { subagentId: c.id as string };
      }),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;
    await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    // Default guard is the idle reaper (resets on activity), not a 5-min wall cap
    // that hard-kills a productive task with budget_timeout.
    expect(configs[0]?.idleTimeoutMs).toBe(600_000);
    expect(configs[0]?.timeoutMs).toBeUndefined();
  });

  it('passes a hard wall-clock cap through only when taskTimeoutMs is opted in', async () => {
    const { run, t1 } = await makeHarness({ taskTimeoutMs: 120_000, taskIdleTimeoutMs: 90_000 });
    const configs: Array<Record<string, unknown>> = [];
    const coord = fakeCoordinator({
      spawn: vi.fn(async (c: Record<string, unknown>) => {
        configs.push(c);
        return { subagentId: c.id as string };
      }),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;
    await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    expect(configs[0]?.timeoutMs).toBe(120_000);
    expect(configs[0]?.idleTimeoutMs).toBe(90_000);
  });
});

/** Spy executeOne so the real continuous scheduler drives a real tracker/graph. */
function stubExecuteOne(
  run: SddParallelRun,
  tracker: TaskTracker,
  fn?: (task: TaskNode) => void | Promise<void>,
) {
  vi.spyOn(run as never as { buildCoordinator: () => void }, 'buildCoordinator').mockImplementation(() => {});
  return vi.spyOn(run, 'executeOne').mockImplementation(async (task: TaskNode) => {
    await fn?.(task);
    tracker.updateNodeStatus(task.id, 'completed');
    return { taskId: task.id, success: true };
  });
}

describe('SddParallelRun.run (continuous scheduler)', () => {
  it('runs every ready task until the graph settles', async () => {
    const { run, tracker } = await makeHarness();
    const exec = stubExecuteOne(run, tracker);
    const result = await run.run();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(result.totalCompleted).toBe(2);
    expect(result.deadlocked).toBe(false);
    expect(result.totalWaves).toBeGreaterThanOrEqual(1);
  });

  it('respects dependencies — a dependent only starts after its blocker completes', async () => {
    const { run, tracker, t1, t2 } = await makeHarness();
    tracker.addDependency(t1.id, t2.id); // t2 depends on t1
    const order: string[] = [];
    stubExecuteOne(run, tracker, (task) => {
      order.push(task.id);
    });
    await run.run();
    expect(order).toEqual([t1.id, t2.id]);
  });

  it('runs independent tasks in parallel (both in flight at once)', async () => {
    const { run, tracker } = await makeHarness(); // t1, t2 — no edge
    let inFlight = 0;
    let maxInFlight = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    stubExecuteOne(run, tracker, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight >= 2) release();
      await gate;
      inFlight--;
    });
    await run.run();
    expect(maxInFlight).toBe(2);
  });

  it('reports deadlock when an incomplete task is blocked and nothing is runnable', async () => {
    const { run, tracker, t1, t2 } = await makeHarness();
    tracker.addDependency(t1.id, t2.id); // t2 depends on t1
    tracker.updateNodeStatus(t1.id, 'blocked'); // t1 not runnable, not terminal
    const exec = stubExecuteOne(run, tracker);
    const result = await run.run();
    expect(exec).not.toHaveBeenCalled();
    expect(result.deadlocked).toBe(true);
  });

  it('stops promptly when stop() is called from onProgress', async () => {
    let stopRef!: SddParallelRun;
    const onProgress = vi.fn(() => stopRef.stop());
    const { run, tracker } = await makeHarness({ onProgress });
    stopRef = run;
    stubExecuteOne(run, tracker);
    const result = await run.run();
    expect(result.stopRequested).toBe(true);
    expect(onProgress).toHaveBeenCalled();
  });

  it('emits progress via onProgress with the expected shape', async () => {
    const onProgress = vi.fn();
    const { run, tracker } = await makeHarness({ onProgress });
    stubExecuteOne(run, tracker);
    await run.run();
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ total: expect.any(Number), percent: expect.any(Number) }),
    );
  });
});

describe('SddParallelRun — coordinator + helpers', () => {
  it('buildCoordinator wires a real coordinator and the default factory returns the main agent', async () => {
    const { run } = await makeHarness();
    (run as never as { buildCoordinator: () => void }).buildCoordinator();
    expect((run as never as { coordinator: unknown }).coordinator).not.toBeNull();
    const factory = (run as never as { defaultFactory: () => (c: unknown) => Promise<unknown> }).defaultFactory();
    const made = await factory({ id: 'x', name: 'x', role: 'executor' });
    expect(made).toHaveProperty('agent');
    expect(made).toHaveProperty('events');
  });

  it('uses an injected subagentFactory when provided', async () => {
    const subagentFactory = vi.fn(async () => ({ agent: fakeAgent(), events: new EventBus() }));
    const { run } = await makeHarness({ subagentFactory });
    (run as never as { buildCoordinator: () => void }).buildCoordinator();
    expect((run as never as { coordinator: unknown }).coordinator).not.toBeNull();
  });

  it('stop() flags the run and stops the coordinator', async () => {
    const { run } = await makeHarness();
    const stopAll = vi.fn();
    (run as never as { coordinator: unknown }).coordinator = { stopAll };
    run.stop();
    expect((run as never as { stopRequested: boolean }).stopRequested).toBe(true);
    expect(stopAll).toHaveBeenCalled();
  });
});

function fakeWorktrees() {
  const calls: string[] = [];
  const wm = {
    async allocate(ownerId: string, o: { slugHint?: string; ownerLabel?: string } = {}) {
      calls.push(`allocate:${ownerId}`);
      return {
        id: ownerId,
        ownerId,
        ownerLabel: o.ownerLabel ?? ownerId,
        slug: o.slugHint ?? ownerId,
        dir: `/wt/${ownerId}`,
        branch: `wstack/sdd/${ownerId}`,
        baseBranch: 'main',
        status: 'active',
        createdAt: 0,
        updatedAt: 0,
        insertions: 0,
        deletions: 0,
        files: 0,
      };
    },
    async commitAll(h: { ownerId: string }) {
      calls.push(`commit:${h.ownerId}`);
      return { committed: true };
    },
    async merge(h: { ownerId: string }) {
      calls.push(`merge:${h.ownerId}`);
      return { ok: true, conflictFiles: [] };
    },
    async release(h: { ownerId: string }, o: { keep?: boolean } = {}) {
      calls.push(`release:${h.ownerId}:${o.keep ? 'keep' : 'remove'}`);
    },
    list: () => [],
  };
  return { wm: wm as never, calls };
}

describe('SddParallelRun — Layer 2: worktree isolation', () => {
  it('allocates a worktree per task, spawns into it, and squash-merges on success', async () => {
    const wt = fakeWorktrees();
    const { run, tracker, t1, t2 } = await makeHarness({ worktrees: wt.wm });
    const spawnConfigs: Array<{ id: string; cwd?: string }> = [];
    const coord = fakeCoordinator({
      spawn: vi.fn(async (c: { id: string; cwd?: string }) => {
        spawnConfigs.push(c);
        return { subagentId: c.id };
      }),
    });
    (run as never as { coordinator: unknown }).coordinator = coord;

    await run.executeWave({ wave: 0, tasks: [t1, t2], deadlocked: false, allDone: false } as never);

    // One worktree allocated per task, each spawn pointed at its worktree dir.
    expect(wt.calls).toContain(`allocate:sdd-${t1.id}`);
    expect(wt.calls).toContain(`allocate:sdd-${t2.id}`);
    expect(spawnConfigs.every((c) => c.cwd?.startsWith('/wt/sdd-'))).toBe(true);
    // Success → commit + merge + remove.
    expect(wt.calls).toContain(`merge:sdd-${t1.id}`);
    expect(wt.calls).toContain(`release:sdd-${t1.id}:remove`);
    // Branch surfaced on the node metadata for the board.
    expect((tracker.getNode(t1.id)?.metadata as { worktreeBranch?: string })?.worktreeBranch).toBe(
      `wstack/sdd/sdd-${t1.id}`,
    );
  });

  it('keeps a failed task worktree for review (no merge)', async () => {
    const wt = fakeWorktrees();
    const { run, t1 } = await makeHarness({ worktrees: wt.wm, maxRetries: 0 });
    const coord = fakeCoordinator({ awaitTasks: vi.fn(async (ids: string[]) => ids.map((id) => failResult(id))) });
    (run as never as { coordinator: unknown }).coordinator = coord;
    await run.executeWave({ wave: 0, tasks: [t1], deadlocked: false, allDone: false } as never);
    expect(wt.calls).toContain(`release:sdd-${t1.id}:keep`);
    expect(wt.calls.some((c) => c.startsWith(`merge:sdd-${t1.id}`))).toBe(false);
  });
});

describe('SddParallelRun — Layer 2: robustness', () => {
  it('resetOrphans returns interrupted in_progress tasks to pending', async () => {
    const { tracker, t1 } = await makeHarness();
    tracker.updateNodeStatus(t1.id, 'in_progress');
    const n = SddParallelRun.resetOrphans(tracker);
    expect(n).toBe(1);
    expect(tracker.getNode(t1.id)?.status).toBe('pending');
  });

  it('recoverFailedBlockers requeues a failed task that blocks a dependent', async () => {
    const { run, tracker, t1, t2 } = await makeHarness();
    tracker.addEdge(t1.id, t2.id, 'depends_on'); // t1 blocks t2
    tracker.updateNodeStatus(t1.id, 'failed');
    tracker.updateNodeStatus(t2.id, 'blocked');
    const recovered = (run as never as { recoverFailedBlockers: () => boolean }).recoverFailedBlockers();
    expect(recovered).toBe(true);
    expect(tracker.getNode(t1.id)?.status).toBe('pending');
  });

  it('restoreRetryMap rehydrates retry counts from node metadata (resume)', async () => {
    const { run, tracker, t1 } = await makeHarness();
    const node = tracker.getNode(t1.id)!;
    node.metadata = { retries: 2 };
    (run as never as { restoreRetryMap: () => void }).restoreRetryMap();
    expect((run as never as { retryMap: Map<string, number> }).retryMap.get(t1.id)).toBe(2);
  });

  it('the dispatch backstop guarantees termination when a task never settles', async () => {
    const { run, tracker } = await makeHarness({ maxTotalWaves: 3, maxRetries: 100 });
    vi.spyOn(run as never as { buildCoordinator: () => void }, 'buildCoordinator').mockImplementation(() => {});
    // Re-queues itself forever — only the dispatch backstop can end the run.
    vi.spyOn(run, 'executeOne').mockImplementation(async (task: TaskNode) => {
      tracker.updateNodeStatus(task.id, 'pending');
      return { taskId: task.id, success: false };
    });
    const result = await run.run();
    expect(result.totalCompleted).toBe(0);
    expect(result.totalWaves).toBeLessThanOrEqual(3); // bounded, not infinite
  });
});

describe('SddParallelRun — task controls (model / cancel / delete)', () => {
  it('setTaskModel + setTaskFallbacks patch node metadata for the next dispatch', async () => {
    const { run, tracker, t1 } = await makeHarness();
    expect(run.setTaskModel(t1.id, 'claude-opus-4-8', 'anthropic')).toBe(true);
    expect(run.setTaskFallbacks(t1.id, ['anthropic/claude-haiku-4-5'])).toBe(true);
    const m = tracker.getNode(t1.id)!.metadata!;
    expect(m.model).toBe('claude-opus-4-8');
    expect(m.provider).toBe('anthropic');
    expect(m.fallbackModels).toEqual(['anthropic/claude-haiku-4-5']);
  });

  it('setTaskModel returns false for an unknown task', async () => {
    const { run } = await makeHarness();
    expect(run.setTaskModel('nope', 'x')).toBe(false);
  });

  it('cancelTask marks a not-running task terminal-cancelled', async () => {
    const { run, tracker, t1 } = await makeHarness();
    expect(await run.cancelTask(t1.id)).toBe(true);
    const n = tracker.getNode(t1.id)!;
    expect(n.status).toBe('failed');
    expect(n.metadata?.cancelled).toBe(true);
  });

  it('cancelTask aborts the live subagent of a running task', async () => {
    const { run, tracker, t1 } = await makeHarness();
    const stop = vi.fn(async () => {});
    (run as never as { coordinator: unknown }).coordinator = { stop };
    (run as never as { taskSubagents: Map<string, string> }).taskSubagents.set(t1.id, 'sub-1');
    expect(await run.cancelTask(t1.id)).toBe(true);
    expect(stop).toHaveBeenCalledWith('sub-1');
    expect(tracker.getNode(t1.id)?.metadata?.cancelled).toBe(true);
  });

  it('cancelTask returns false for an unknown task', async () => {
    const { run } = await makeHarness();
    expect(await run.cancelTask('nope')).toBe(false);
  });

  it('retryTask clears the cancel marker and re-queues to pending', async () => {
    const { run, tracker, t1 } = await makeHarness();
    await run.cancelTask(t1.id);
    expect(run.retryTask(t1.id)).toBe(true);
    const n = tracker.getNode(t1.id)!;
    expect(n.status).toBe('pending');
    expect(n.metadata?.cancelled).toBeFalsy();
  });

  it('deleteTask removes a pending task and unblocks its dependents', async () => {
    const { run, tracker, t1, t2 } = await makeHarness();
    tracker.addDependency(t1.id, t2.id); // t2 depends on t1
    expect(tracker.canStart(t2.id)).toBe(false);
    expect(run.deleteTask(t1.id)).toBe(true);
    expect(tracker.getNode(t1.id)).toBeUndefined();
    expect(tracker.getBlockers(t2.id)).toEqual([]);
    expect(tracker.canStart(t2.id)).toBe(true); // blocker gone → runnable
  });

  it('deleteTask refuses a running task', async () => {
    const { run, tracker, t1 } = await makeHarness();
    tracker.updateNodeStatus(t1.id, 'in_progress');
    expect(run.deleteTask(t1.id)).toBe(false);
    expect(tracker.getNode(t1.id)).toBeTruthy();
  });
});
