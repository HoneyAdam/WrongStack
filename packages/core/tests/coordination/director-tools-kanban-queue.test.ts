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
const getBoardMock = vi.fn();

vi.mock('@wrongstack/kanban', () => ({
  claimReadyTask: (...a: unknown[]) => claimReadyTaskMock(...a),
  updateTaskAssignment: (...a: unknown[]) => updateTaskAssignmentMock(...a),
  heartbeatTaskAssignment: (...a: unknown[]) => heartbeatTaskAssignmentMock(...a),
  listReadyTasks: (...a: unknown[]) => listReadyTasksMock(...a),
  getBoard: (...a: unknown[]) => getBoardMock(...a),
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

type MockDirector = {
  spawn: ReturnType<typeof vi.fn>;
  assign: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  awaitTasks: ReturnType<typeof vi.fn>;
  fleet?: { subscribe: ReturnType<typeof vi.fn> };
};
let director: MockDirector;
let fleetHandlers: Map<string, Set<(event: unknown) => void>>;
const emitFleet = (subagentId: string, event: Record<string, unknown>): void => {
  for (const handler of fleetHandlers.get(subagentId) ?? []) handler(event);
};
const asDir = () => director as never as Director;
const ctx = { projectRoot: 'D:/tmp/proj' } as never;

beforeEach(() => {
  vi.useRealTimers();
  claimReadyTaskMock.mockReset();
  updateTaskAssignmentMock.mockReset();
  heartbeatTaskAssignmentMock.mockReset();
  listReadyTasksMock.mockReset();
  // getBoard is called unconditionally by the awaitCompletion heartbeat
  // revoke check (introduced when the runHeartbeat loop started calling
  // renewAndRevokeLease → getBoard per tick). A stale mock return from a
  // prior test would silently redirect the revocation branch and cause
  // unrelated awaitCompletion/fire-and-forget tests to flake.
  getBoardMock.mockReset();
  // Default: empty board. The revocation guard sees `liveLeaseId ===
  // undefined` and skips the revocation — heartbeat proceeds normally.
  // Tests that need a specific assignment state set their own
  // `mockResolvedValueOnce` after this baseline.
  getBoardMock.mockResolvedValue({ id: 'board-1', tasks: [] });
  fleetHandlers = new Map();
  director = {
    spawn: vi.fn(async () => 'sub-1'),
    assign: vi.fn(async (task: { id: string }) => task.id),
    terminate: vi.fn(async () => {}),
    awaitTasks: vi.fn(async () => []),
    fleet: {
      subscribe: vi.fn((subagentId: string, handler: (event: unknown) => void) => {
        const set = fleetHandlers.get(subagentId) ?? new Set();
        set.add(handler);
        fleetHandlers.set(subagentId, set);
        return () => {
          set.delete(handler);
        };
      }),
    } as never,
  };
});
afterEach(() => {
  // Tear down any detached renewal supervisors started by successful
  // fire-and-forget dispatches: emitting a terminal event to every
  // registered fleet handler disposes the subscription and clears the
  // renewal interval, so no timer survives into later tests. unref() only
  // stops the timer from keeping Node alive — it does NOT stop it firing
  // while a later test runs.
  for (const [subagentId, handlers] of fleetHandlers) {
    for (const handler of [...handlers]) {
      handler({ type: 'subagent.stopped', subagentId });
    }
  }
  fleetHandlers.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('kanban_queue lease fencing', () => {
  it('reassignment during queueing: terminates orphan subagent and reports conflict when the dispatch fence fails', async () => {
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    // The pre-dispatch running-state write returns null: ownership was lost
    // while spawn() was in flight (recover_stale reassigned it).
    updateTaskAssignmentMock.mockResolvedValue(null);

    const tool = makeKanbanQueueTool(asDir());
    const res = (await tool.execute({ taskId: 'task-1' }, ctx, {} as never)) as {
      dispatched?: unknown[];
      errors?: Array<{ taskId?: string; error: string }>;
    };

    // Director.assign() is the coordinator hand-off that can start the runner.
    // A failed fence must be observed before that boundary, so the orphan can
    // never begin executing the reassigned task.
    expect(director.assign).not.toHaveBeenCalled();
    expect(director.terminate).toHaveBeenCalledWith('sub-1');
    // No successful dispatch may be reported.
    expect(res.dispatched ?? []).toHaveLength(0);
    // A lease-lost conflict must be surfaced for this task.
    const err = (res.errors ?? []).find((entry) => entry.taskId === 'task-1');
    expect(err).toBeDefined();
    expect(err?.error ?? '').toMatch(/lease/i);
    // The claim operation is the authoritative source of the acquired token.
    // The dispatch fence must use that exact value, not merely any string (or
    // a token copied between two downstream consumers).
    const claimedLeaseId = (claimReadyTaskMock.mock.calls[0]?.[1] as { leaseId?: string })?.leaseId;
    expect(claimedLeaseId).toBeDefined();
    const dispatchWrite = updateTaskAssignmentMock.mock.calls.find(
      (call) => (call[3] as { status?: string })?.status === 'running',
    );
    expect(dispatchWrite).toBeDefined();
    expect((dispatchWrite?.[4] as { expectedLeaseId?: string })?.expectedLeaseId).toBe(
      claimedLeaseId,
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
    // Let claim -> spawn -> fenced dispatch write -> assign settle.
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
    const assignArgForSettle = director.assign.mock.calls[0]?.[0] as { id: string } | undefined;
    const assignedTaskId = assignArgForSettle?.id ?? '';
    settleAwait([
      { taskId: assignedTaskId, subagentId: 'sub-1', status: 'success', result: 'done' },
    ]);
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

  it('awaitCompletion: never overlaps slow heartbeat batches', async () => {
    vi.useFakeTimers();
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    const heartbeatResolvers: Array<() => void> = [];
    heartbeatTaskAssignmentMock.mockImplementation(
      () => new Promise((resolve) => heartbeatResolvers.push(() => resolve({ id: 'board-1' }))),
    );
    let settleAwait: (value: unknown[]) => void = () => {};
    director.awaitTasks = vi.fn(() => new Promise<unknown[]>((resolve) => (settleAwait = resolve)));

    const heartbeatIntervalMs = 10_000;
    const tool = makeKanbanQueueTool(asDir());
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
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3 + 50);
    expect(heartbeatTaskAssignmentMock).toHaveBeenCalledTimes(1);

    heartbeatResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs + 50);
    expect(heartbeatTaskAssignmentMock).toHaveBeenCalledTimes(2);

    const assignedTaskId = (director.assign.mock.calls[0]?.[0] as { id?: string })?.id ?? '';
    settleAwait([
      { taskId: assignedTaskId, subagentId: 'sub-1', status: 'success', result: 'done' },
    ]);
    heartbeatResolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    await execPromise;
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
    const claimedLeaseId = (claimReadyTaskMock.mock.calls[0]?.[1] as { leaseId?: string })?.leaseId;
    expect(leaseId).toBe(claimedLeaseId);
    // ...and the same id is instructed as expectedLeaseId on every lifecycle
    // call the worker is told to make.
    const fenceMentions = prompt.match(new RegExp(`expectedLeaseId "${leaseId}"`, 'g'));
    expect(fenceMentions?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(prompt).toContain('heartbeat_assignment');
    expect(prompt).toMatch(/mark_assignment[\s\S]*?"running"[\s\S]*?expectedLeaseId/);
    expect(prompt).toMatch(/"completed" or "failed"[\s\S]*?expectedLeaseId/);
  });

  it('fire-and-forget dispatch: host-side renewal keeps the lease alive until the terminal fleet event', async () => {
    vi.useFakeTimers();
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    heartbeatTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });

    const tool = makeKanbanQueueTool(asDir());
    const heartbeatIntervalMs = 10_000;
    // No awaitCompletion: the tool returns immediately after dispatch, so
    // lease renewal must come from the detached host-side supervisor.
    const res = (await tool.execute(
      { taskId: 'task-1', leaseTtlMs: 60_000, heartbeatIntervalMs },
      ctx,
      {} as never,
    )) as { dispatched: Array<{ subagentId: string; runTaskId: string }> };
    expect(res.dispatched).toHaveLength(1);
    // The renewal supervisor subscribed to the worker's fleet events.
    expect(director.fleet?.subscribe).toHaveBeenCalledWith('sub-1', expect.any(Function));

    // While the worker runs (e.g. through auto-extended timeouts), the lease
    // is renewed on every interval, fenced with the claim-time lease id.
    const claimedLeaseId = (claimReadyTaskMock.mock.calls[0]?.[1] as { leaseId?: string })?.leaseId;
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3 + 50);
    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of heartbeatTaskAssignmentMock.mock.calls) {
      const patch = call[3] as { expectedLeaseId?: string; leaseExpiresAt?: string };
      expect(patch.expectedLeaseId).toBe(claimedLeaseId);
      expect(patch.leaseExpiresAt).toEqual(expect.any(String));
    }

    // Terminal fleet event stops the renewal: no further heartbeats.
    const runTaskId = res.dispatched[0]?.runTaskId ?? '';
    emitFleet('sub-1', { type: 'subagent.completed', taskId: runTaskId, subagentId: 'sub-1' });
    const heartbeatsAtTerminal = heartbeatTaskAssignmentMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3);
    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBe(heartbeatsAtTerminal);
  });

  it('fire-and-forget: detects lease revocation and terminates stale subagent', async () => {
    vi.useFakeTimers();
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    heartbeatTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    // Simulate recover_stale reclaiming the task: the board shows a
    // different leaseId (or a new assignment with a new leaseId).
    const newLeaseId = '00000000-0000-4000-8000-000000000999';
    getBoardMock.mockResolvedValue({
      id: 'board-1',
      tasks: [{ id: 'task-1', assignment: { leaseId: newLeaseId } }],
    });

    const tool = makeKanbanQueueTool(asDir());
    const heartbeatIntervalMs = 10_000;
    const res = (await tool.execute(
      { taskId: 'task-1', leaseTtlMs: 60_000, heartbeatIntervalMs },
      ctx,
      {} as never,
    )) as { dispatched: Array<{ subagentId: string }> };
    expect(res.dispatched).toHaveLength(1);

    // First heartbeat tick: the watchdog reads the board, detects the
    // lease mismatch, and terminates the stale subagent.
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs + 50);
    expect(director.terminate).toHaveBeenCalledWith('sub-1');
    // The revocation check fires BEFORE the heartbeat renewal, so no
    // heartbeat was sent for this stale subagent.
    expect(heartbeatTaskAssignmentMock).not.toHaveBeenCalled();

    // After termination the disposers are cleaned up. Subsequent timer
    // ticks skip the stale subagent entirely — no wasted getBoard calls
    // and no heartbeats.
    const heartbeatsAfterRevoke = heartbeatTaskAssignmentMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3);
    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBe(heartbeatsAfterRevoke);
  });

  it('awaitCompletion: detects lease revocation and terminates stale subagent mid-flight', async () => {
    vi.useFakeTimers();
    claimReadyTaskMock.mockResolvedValueOnce(makeClaim());
    updateTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    heartbeatTaskAssignmentMock.mockResolvedValue({ id: 'board-1' });
    // recover_stale reclaimed the task and assigned a new leaseId.
    const newLeaseId = '00000000-0000-4000-8000-000000000999';
    getBoardMock.mockResolvedValue({
      id: 'board-1',
      tasks: [{ id: 'task-1', assignment: { leaseId: newLeaseId } }],
    });

    let settleAwait: (value: unknown[]) => void = () => {};
    director.awaitTasks = vi.fn(() => new Promise<unknown[]>((resolve) => (settleAwait = resolve)));

    const heartbeatIntervalMs = 10_000;
    const tool = makeKanbanQueueTool(asDir());
    const execPromise = tool.execute(
      { taskId: 'task-1', awaitCompletion: true, leaseTtlMs: 60_000, heartbeatIntervalMs },
      ctx,
      {} as never,
    );
    await vi.advanceTimersByTimeAsync(0);

    // The heartbeat detects the lease revocation and terminates the
    // stale subagent. The awaitTasks below will pick up the stopped result.
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs + 50);
    expect(director.terminate).toHaveBeenCalledWith('sub-1');

    // After termination the taskId is removed from runTaskIds, so no
    // further heartbeats are sent for this stale subagent.
    const heartbeatsAfterRevoke = heartbeatTaskAssignmentMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(heartbeatIntervalMs * 3);
    expect(heartbeatTaskAssignmentMock.mock.calls.length).toBe(heartbeatsAfterRevoke);

    // Settle the awaited run: the stopped result lands in awaitTasks.
    const assignedTaskId = (director.assign.mock.calls[0]?.[0] as { id?: string })?.id ?? '';
    settleAwait([
      { taskId: assignedTaskId, subagentId: 'sub-1', status: 'stopped', error: 'terminated' },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    const result = (await execPromise) as {
      results?: Array<{ taskId: string; status: string }>;
      resultFailures?: Array<{ taskId: string; error: string }>;
    };

    // The terminal write is fenced with expectedLeaseId so it becomes a
    // no-op against the successor's state. The result is surfaced to the
    // caller as a failure so they know the task was not completed.
    const terminalWrite = updateTaskAssignmentMock.mock.calls.find(
      (call) => (call[3] as { status?: string })?.status === 'failed',
    );
    expect(terminalWrite).toBeDefined();
    expect((terminalWrite?.[4] as { expectedLeaseId?: string })?.expectedLeaseId).toEqual(
      expect.any(String),
    );
    expect(result.resultFailures ?? []).toHaveLength(1);
  });
});
