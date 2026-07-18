import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Director } from '../../src/coordination/director.js';
import { makeKanbanQueueTool } from '../../src/coordination/director-tools.js';

// ---------------------------------------------------------------------------
// Regression tests for the kanban_queue lease-fencing contract.
//
// These lock the fixes for the 2026-07-18 fleet-review High findings:
//  1. Reassignment during spawn/queueing: the dispatch-time running-state
//     write is fenced with expectedLeaseId; when ownership was lost the tool
//     must terminate the orphan subagent and report a conflict instead of a
//     successful dispatch.
//  2. Short-lease expiry: effectiveLeaseTtlMs = max(leaseTtlMs,
//     heartbeatIntervalMs * 2) so a lease always survives at least two
//     heartbeats, and the worker prompt receives the computed values.
//  3. Queue delay: the dispatch write renews heartbeatAt/leaseExpiresAt from
//     the actual dispatch moment (not claim time) under the claim lease fence.
//  4. Supervisor renewal: with awaitCompletion, the heartbeat timer renews the
//     lease with the atomic expectedLeaseId fence while workers run (covers
//     coordinator queue delay and auto-extended timeouts).
//  5. Worker prompt: instructs expectedLeaseId on mark_assignment (running &
//     terminal) and heartbeat_assignment calls.
// ---------------------------------------------------------------------------

const claimReadyTaskMock = vi.fn();
const updateTaskAssignmentMock = vi.fn();
const heartbeatTaskAssignmentMock = vi.fn();
const listReadyTasksMock = vi.fn();

vi.mock('@wrongstack/kanban', () => ({
  claimReadyTask: (...a: unknown[]) => claimReadyTaskMock(...a),
  updateTaskAssignment: (...a: unknown[]) => updateTaskAssignmentMock(...a),
  heartbeatTaskAssignment: (...a: unknown[]) => heartbeatTaskAssignmentMock(...a),
  listReadyTasks: (...a: unknown[]) => listReadyTasksMock(...a),
  describeKanbanBoundary: () => 'unrestricted',
}));

vi.mock('../../src/coordination/dispatcher.js', () => ({
  dispatchAgent: vi.fn(),
}));

interface MutableAssignment {
  status: string;
  leaseId?: string;
  claimedAt?: string;
  heartbeatAt?: string;
  leaseExpiresAt?: string;
}

function makeClaim(taskId = 'task-1', assignment?: MutableAssignment) {
  return {
    board: { id: 'board-1', title: 'Board', tasks: [], columns: [] },
    task: {
      id: taskId,
      title: 'Do the thing',
      status: 'in_progress',
      priority: 'high',
      columnId: 'running',
      ...(assignment ? { assignment } : {}),
    },
  };
}

type MockDirector = Record<string, ReturnType<typeof vi.fn>>;
let director: MockDirector;
const asDir = () => director as never as Director;
const ctx = { projectRoot: 'D:/tmp/proj' } as never;

beforeEach(() => {
  vi.useRealTimers();
  claimReadyTaskMock.mockReset();
  updateTaskAssignmentMock.mockReset();
  heartbeatTaskAssignmentMock.mockReset();
  listReadyTasksMock.mockReset();
  director = {
    spawn: vi.fn(async () => 'sub-1'),
    assign: vi.fn(async () => 'run-1'),
    terminate: vi.fn(async () => {}),
    awaitTasks: vi.fn(async () => []),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('kanban_queue lease fencing', () => {
  it('reassignment during queueing: terminates orphan subagent and reports conflict when the dispatch fence fails', async () => {
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    // The dispatch-time running-state write returns null: ownership was lost
    // while spawn()/assign() were in flight (recover_stale reassigned it).
    updateTaskAssignmentMock.mockResolvedValue(null);

    const tool = makeKanbanQueueTool(asDir());
    const res = (await tool.execute({ taskId: 'task-1' }, ctx, {} as never)) as {
      dispatched?: unknown[];
      errors?: Array<{ taskId?: string; error: string }>;
    };

    // The orphan worker must not run the reassigned task in parallel.
    expect(director.terminate).toHaveBeenCalledWith('sub-1');
    // No successful dispatch may be reported.
    expect(res.dispatched ?? []).toHaveLength(0);
    // A lease-lost conflict must be surfaced for this task.
    const err = (res.errors ?? []).find((entry) => entry.taskId === 'task-1');
    expect(err).toBeDefined();
    expect(err?.error ?? '').toMatch(/lease/i);
    // The fence itself: the dispatch write must carry the EXACT lease id
    // seeded at claim time (the one advertised to the worker in the prompt),
    // not merely any syntactically valid token.
    const assignArg = director.assign.mock.calls[0]?.[0] as { description: string } | undefined;
    const seededLeaseId = assignArg?.description.match(/leaseId: ([0-9a-f-]{36})/)?.[1];
    expect(seededLeaseId).toBeDefined();
    const dispatchWrite = updateTaskAssignmentMock.mock.calls.find(
      (call) => (call[3] as { status?: string })?.status === 'running',
    );
    expect(dispatchWrite).toBeDefined();
    expect((dispatchWrite?.[4] as { expectedLeaseId?: string })?.expectedLeaseId).toBe(
      seededLeaseId,
    );
  });

  it('short lease: effectiveLeaseTtlMs is clamped to 2x heartbeat interval and the prompt receives computed values', async () => {
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });

    const tool = makeKanbanQueueTool(asDir());
    // Schema-minimum lease (1s) with no explicit heartbeat interval. The
    // 5s heartbeat floor would exceed the raw TTL, so the effective TTL must
    // be raised to 2x the heartbeat interval (10s) — never the raw 1s.
    await tool.execute({ taskId: 'task-1', leaseTtlMs: 1000 }, ctx, {} as never);

    expect(director.assign).toHaveBeenCalledTimes(1);
    const spec = director.assign.mock.calls[0]?.[0] as { description: string };
    // Prompt must advertise the computed (post-clamp) values, not the raw ones.
    expect(spec.description).toContain('expected heartbeatIntervalMs: 5000');
    expect(spec.description).toContain('expected leaseTtlMs: 10000');
    expect(spec.description).not.toContain('expected leaseTtlMs: 1000\n');
  });

  it('queue delay: the dispatch write renews heartbeatAt and leaseExpiresAt from the dispatch moment under the claim lease fence', async () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-07-18T12:00:00.000Z');
    vi.setSystemTime(t0);
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    // Simulate a slow coordinator queue: spawn stalls for 2 minutes of fake
    // time before the dispatch write happens.
    const queueDelayMs = 2 * 60 * 1000;
    director.spawn = vi.fn(async () => {
      vi.setSystemTime(new Date(t0.getTime() + queueDelayMs));
      return 'sub-1';
    });

    const tool = makeKanbanQueueTool(asDir());
    await tool.execute({ taskId: 'task-1', leaseTtlMs: 5 * 60 * 1000 }, ctx, {} as never);

    const dispatchWrite = updateTaskAssignmentMock.mock.calls.find(
      (call) => (call[3] as { status?: string })?.status === 'running',
    );
    expect(dispatchWrite).toBeDefined();
    const patch = dispatchWrite?.[3] as { heartbeatAt: string; leaseExpiresAt: string };
    const dispatchedAtMs = t0.getTime() + queueDelayMs;
    // heartbeatAt must be stamped at the dispatch moment, not claim time —
    // otherwise the supervisor sees a half-elapsed lease immediately.
    expect(Date.parse(patch.heartbeatAt)).toBe(dispatchedAtMs);
    // leaseExpiresAt must give a full effective lease window from dispatch.
    expect(Date.parse(patch.leaseExpiresAt)).toBe(dispatchedAtMs + 5 * 60 * 1000);
    // And the renewal is fenced by the claim lease so a reassigned task is
    // never overwritten.
    expect((dispatchWrite?.[4] as { expectedLeaseId?: string })?.expectedLeaseId).toEqual(
      expect.any(String),
    );
  });

  it('awaitCompletion: supervisor heartbeat renews the lease with the expectedLeaseId fence while workers run', async () => {
    vi.useFakeTimers();
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    heartbeatTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    // Worker stays busy past several heartbeat intervals (covers coordinator
    // queue delay and auto-extended timeouts equally: the supervisor renews
    // as long as the run has not settled).
    let settleAwait: (value: unknown[]) => void = () => {};
    director.awaitTasks = vi.fn(() => new Promise<unknown[]>((resolve) => (settleAwait = resolve)));

    const tool = makeKanbanQueueTool(asDir());
    const heartbeatIntervalMs = 10_000;
    const execPromise = tool.execute(
      {
        taskId: 'task-1',
        awaitCompletion: true,
        leaseTtlMs: 60_000,
        heartbeatIntervalMs,
      },
      ctx,
      {} as never,
    );
    // Let claim -> spawn -> assign -> dispatch write settle.
    await vi.advanceTimersByTimeAsync(0);
    // Two heartbeat intervals elapse while the worker is still running.
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 2 + 50);

    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of heartbeatTaskAssignmentMock.mock.calls) {
      const patch = call[3] as { expectedLeaseId?: string; leaseExpiresAt?: string };
      // Every renewal must be ownership-fenced and extend the lease.
      expect(patch.expectedLeaseId).toEqual(expect.any(String));
      expect(patch.leaseExpiresAt).toEqual(expect.any(String));
    }

    // Settle the awaited run: heartbeats stop and the terminal write is fenced.
    settleAwait([{ taskId: 'run-1', subagentId: 'sub-1', status: 'success', result: 'done' }]);
    await vi.advanceTimersByTimeAsync(0);
    await execPromise;
    const heartbeatsAtSettle = heartbeatTaskAssignmentMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3);
    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBe(heartbeatsAtSettle);
    const terminalWrite = updateTaskAssignmentMock.mock.calls.find(
      (call) => (call[3] as { status?: string })?.status === 'completed',
    );
    expect(terminalWrite).toBeDefined();
    expect((terminalWrite?.[4] as { expectedLeaseId?: string })?.expectedLeaseId).toEqual(
      expect.any(String),
    );
  });

  it('worker prompt instructs the lease token on all three lifecycle calls', async () => {
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });

    const tool = makeKanbanQueueTool(asDir());
    await tool.execute({ taskId: 'task-1' }, ctx, {} as never);

    const spec = director.assign.mock.calls[0]?.[0] as { description: string };
    const prompt = spec.description;
    // The concrete lease id appears in the prompt's lease contract...
    const leaseIdMatch = prompt.match(/leaseId: ([0-9a-f-]{36})/);
    expect(leaseIdMatch).not.toBeNull();
    const leaseId = leaseIdMatch?.[1] ?? '';
    // ...and the same id is instructed as expectedLeaseId on every lifecycle
    // call the worker is told to make.
    const fenceMentions = prompt.match(new RegExp(`expectedLeaseId "${leaseId}"`, 'g'));
    expect(fenceMentions?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(prompt).toContain('heartbeat_assignment');
    expect(prompt).toMatch(/mark_assignment[\s\S]*?"running"[\s\S]*?expectedLeaseId/);
    expect(prompt).toMatch(/"completed" or "failed"[\s\S]*?expectedLeaseId/);
  });
});
