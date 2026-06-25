import { expectDefined } from '../utils/expect-defined.js';
/**
 * SddParallelRun
 *
 * Drives a TaskGraph through ParallelEternalEngine's infrastructure
 * (DefaultMultiAgentCoordinator + AgentSubagentRunner) but powered by
 * SddTaskDecomposer — producing dependency-aware waves instead of
 * goal-driven iterations.
 *
 * One-shot: completes when all tasks are done OR a deadlock is detected.
 * Does NOT loop — each run() call is a discrete execution.
 *
 * Usage:
 * ```
 * const run = new SddParallelRun({ tracker, graph, agent, projectRoot });
 * await run.run({ onWave });
 * // or with progress callback:
 * await run.run({ onProgress: (p) => console.log(renderProgress(p)) });
 * ```
 */

import { randomUUID } from 'node:crypto';
import type { Agent } from '../core/agent.js';
import type { SubagentConfig, TaskResult } from '../types/multi-agent.js';
import type { AgentFactory } from '../coordination/agent-subagent-runner.js';
import { makeAgentSubagentRunner, withDisabledToolFiltering } from '../coordination/agent-subagent-runner.js';
import { DefaultMultiAgentCoordinator } from '../coordination/multi-agent-coordinator.js';
import { assignNickname } from '../coordination/subagent-nicknames.js';
import type { EventBus } from '../kernel/events.js';
import type { WorktreeHandle, WorktreeManager } from '../worktree/worktree-manager.js';
import type { MultiAgentConfig } from '../types/multi-agent.js';
import type { TaskGraph, TaskNode, TaskProgress } from '../types/task-graph.js';
import type { TaskTracker } from './task-tracker.js';
import { SddError, ERROR_CODES } from '../types/errors.js';
import { SddTaskDecomposer, type TaskBatch } from './sdd-task-decomposer.js';
export interface SddParallelRunOptions {
  /** Pre-constructed TaskTracker (must already hold the graph's initial state). */
  tracker: TaskTracker;
  /** The TaskGraph produced by TaskGenerator from an approved spec. */
  graph: TaskGraph;
  /** The main agent — used as the subagent factory. */
  agent: Agent;
  /** Project root (used for coordinator id). */
  projectRoot: string;
  /** Override default parallel slots (1–16). Default: 4. */
  parallelSlots?: number | undefined;
  /** Per-task timeout in ms. Default: 300_000 (5 min). */
  taskTimeoutMs?: number | undefined;
  /** Maximum retry attempts for failed tasks. Default: 2. */
  maxRetries?: number | undefined;
  /** Override the default agent factory. */
  subagentFactory?: AgentFactory | undefined;
  /**
   * Run-level default model for worker subagents. A task's own
   * `metadata.model` (set per-task in the WebUI) takes precedence; this is the
   * fallback for every task that has no explicit assignment. Undefined → the
   * factory's own default (the leader's model).
   */
  defaultModel?: string | undefined;
  /** Run-level default provider id (same precedence rules as defaultModel). */
  defaultProvider?: string | undefined;
  /**
   * Run-level fallback model chain (entries: `model` / `provider/model`). A
   * task's `metadata.fallbackModels` overrides this. The subagent factory wires
   * these into a fallback extension so a 429/stream-hang rotates to the next.
   */
  fallbackModels?: string[] | undefined;
  /** Called after each wave completes. */
  onWave?: ((wave: WaveResult) => void) | undefined;
  /** Called with progress stats every ~2s during execution. */
  onProgress?: ((progress: SddProgress) => void) | undefined;
  /** Shared EventBus — when set, the run emits `sdd.*` live-board events. */
  events?: EventBus | undefined;
  /** Stable id correlating all events of this run (default: random). */
  runId?: string | undefined;
  /**
   * Optional git-worktree manager. When set (and the project is a git repo),
   * each task runs in its own isolated worktree and merges back into the base
   * branch after success — so parallel agents never collide on the same files.
   */
  worktrees?: WorktreeManager | undefined;
  /** Run-level backstops (prevent an autonomous run from looping forever). */
  maxTotalWaves?: number | undefined;
  maxWallClockMs?: number | undefined;
  /**
   * Deadlock auto-recovery rounds: when the graph deadlocks on failed blockers,
   * requeue those failed blockers `pending` and try again, up to N times. 0 = off.
   */
  maxRecoveryRounds?: number | undefined;
}

export interface SddProgress {
  wave: number;
  total: number;
  completed: number;
  inProgress: number;
  failed: number;
  blocked: number;
  pending: number;
  percent: number;
  deadlocked: boolean;
}

export interface WaveResult {
  wave: number;
  batch: TaskBatch;
  results: TaskResult[];
  successCount: number;
  failCount: number;
  durationMs: number;
  stopRequested: boolean;
}

/** Result of a single task's execution in the continuous scheduler. */
interface TaskOutcome {
  taskId: string;
  success: boolean;
  result?: TaskResult | undefined;
}

export interface RunResult {
  totalWaves: number;
  totalCompleted: number;
  totalFailed: number;
  totalDurationMs: number;
  deadlocked: boolean;
  stopRequested: boolean;
  finalProgress: TaskProgress;
}

export class SddParallelRun {
  private readonly slots: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private decomposer: SddTaskDecomposer;
  private coordinator: DefaultMultiAgentCoordinator | null = null;
  private stopRequested = false;
  private retryMap = new Map<string, number>();
  readonly runId: string;
  private readonly events?: EventBus | undefined;
  private readonly maxTotalWaves: number;
  private readonly maxWallClockMs?: number | undefined;
  private readonly maxRecoveryRounds: number;
  private recoveryRounds = 0;
  /** Per-run worker identities, so the board shows "who is on what". */
  private usedNicknames = new Set<string>();
  /** Per-task git worktree cwd (Layer 2 worktree isolation; empty otherwise). */
  private taskCwds = new Map<string, string>();
  /** Per-task git worktree branch, for board display. */
  private taskBranches = new Map<string, string>();
  /** Live worktree handles keyed by task id (for commit/merge/release). */
  private taskWorktrees = new Map<string, WorktreeHandle>();
  /** Live subagent id per running task — lets cancelTask() abort exactly one. */
  private taskSubagents = new Map<string, string>();
  /** Tasks the user cancelled mid-flight — skip retry, mark terminal-cancelled. */
  private cancelledTasks = new Set<string>();
  /** Monotonic dispatch counter (unique subagent ids) + dispatch-round counter. */
  private dispatchSeq = 0;
  private round = 0;

  constructor(private readonly opts: SddParallelRunOptions) {
    this.slots = Math.min(16, Math.max(1, opts.parallelSlots ?? 4));
    this.timeoutMs = opts.taskTimeoutMs ?? 300_000;
    this.maxRetries = Math.max(0, opts.maxRetries ?? 2);
    this.runId = opts.runId ?? `sdd-${randomUUID().slice(0, 8)}`;
    this.events = opts.events;
    // Backstop: even with retries + recovery the loop must terminate. Derive a
    // generous ceiling from the graph size unless the caller pins one.
    this.maxTotalWaves =
      opts.maxTotalWaves ?? opts.graph.nodes.size * (this.maxRetries + 2) + 10;
    this.maxWallClockMs = opts.maxWallClockMs;
    this.maxRecoveryRounds = Math.max(0, opts.maxRecoveryRounds ?? 0);
    this.decomposer = new SddTaskDecomposer(opts.tracker, opts.graph, { parallelSlots: this.slots });
  }

  /** Type-safe emit on the optional EventBus (no-op when unwired). */
  private emit<K extends keyof import('../kernel/events.js').EventMap>(
    event: K,
    payload: import('../kernel/events.js').EventMap[K],
  ): void {
    this.events?.emit(event, payload);
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  private paused = false;

  /** Trigger stop — causes run() to abort after the current wave. */
  stop(): void {
    this.stopRequested = true;
    this.paused = false;
    this.coordinator?.stopAll();
  }

  /** Pause: no new wave starts until resume() (the current wave finishes). */
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  isPaused(): boolean {
    return this.paused;
  }
  isRunning(): boolean {
    return !this.stopRequested && !this.decomposer.isSettled();
  }

  /** Requeue a task to `pending` so the scheduler re-runs it (clears retries + cancel marker). */
  retryTask(taskId: string): boolean {
    if (!this.opts.tracker.getNode(taskId)) return false;
    this.retryMap.delete(taskId);
    this.persistRetries(taskId, 0);
    // Clear any cancel marker so a previously-cancelled task can run again.
    this.cancelledTasks.delete(taskId);
    this.opts.tracker.patchMetadata(taskId, { cancelled: undefined });
    this.opts.tracker.updateNodeStatus(taskId, 'pending', 'manual retry');
    return true;
  }

  /** Reassign a task to a specific agent name (reflected on the board). */
  reassignTask(taskId: string, agentName: string): boolean {
    if (!this.opts.tracker.getNode(taskId)) return false;
    this.opts.tracker.updateNode(taskId, { assignee: agentName });
    return true;
  }

  /**
   * Set/override a task's worker model (and optionally provider) — applied on its
   * NEXT dispatch (a running task must be cancelled + retried to take effect). The
   * assignment lives on node metadata so it survives crash → resume.
   */
  setTaskModel(taskId: string, model: string | undefined, provider?: string | undefined): boolean {
    if (!this.opts.tracker.getNode(taskId)) return false;
    this.opts.tracker.patchMetadata(taskId, { model, ...(provider !== undefined ? { provider } : {}) });
    return true;
  }

  /** Set/override a task's fallback model chain (applied on its next dispatch). */
  setTaskFallbacks(taskId: string, fallbackModels: string[] | undefined): boolean {
    if (!this.opts.tracker.getNode(taskId)) return false;
    this.opts.tracker.patchMetadata(taskId, { fallbackModels });
    return true;
  }

  /**
   * Cancel a task. If it is currently running, abort its subagent and mark the
   * node terminally failed+cancelled (so the scheduler frees the slot and does
   * NOT retry it). If it has not started, it is simply marked cancelled. Use
   * `retryTask` to bring a cancelled task back. Returns false for an unknown task.
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const node = this.opts.tracker.getNode(taskId);
    if (!node) return false;
    this.cancelledTasks.add(taskId);
    // Terminal failed + cancel marker: failed keeps dependents un-deadlocked,
    // the marker drives the "Cancelled" board look and blocks retry/auto-redispatch.
    this.opts.tracker.patchMetadata(taskId, { cancelled: true });
    this.opts.tracker.updateNodeStatus(taskId, 'failed', 'cancelled by user');
    this.emit('sdd.task.failed', { runId: this.runId, taskId, subagentId: '', error: 'cancelled by user' });
    const subagentId = this.taskSubagents.get(taskId);
    if (subagentId && this.coordinator) {
      await this.coordinator.stop(subagentId).catch(() => {});
    }
    return true;
  }

  /**
   * Delete a not-yet-started task from the graph (pending/blocked/failed only —
   * never a running task; cancel it first). Removes the node and every edge
   * touching it; dependents lose this blocker. Returns false if missing or running.
   */
  deleteTask(taskId: string): boolean {
    const node = this.opts.tracker.getNode(taskId);
    if (!node) return false;
    if (node.status === 'in_progress' || this.taskSubagents.has(taskId)) return false;
    this.cancelledTasks.delete(taskId);
    this.retryMap.delete(taskId);
    return this.opts.tracker.removeNode(taskId);
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopRequested) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * Continuous dependency-driven execution. Unlike a wave-barrier loop (where a
   * whole batch must finish before the next starts), this fills free worker
   * slots the instant a task's dependencies are satisfied: a fast task's
   * dependent starts immediately rather than waiting for a slow sibling. Truly
   * independent tasks run in parallel; dependency chains run in order. Returns
   * the final summary when the graph settles, deadlocks, stops, or hits a backstop.
   */
  async run(): Promise<RunResult> {
    this.stopRequested = false;
    this.restoreRetryMap();
    const startTime = Date.now();
    this.round = 0;
    this.dispatchSeq = 0;
    let totalDispatched = 0;

    this.buildCoordinator();

    this.emit('sdd.run.started', {
      runId: this.runId,
      graphId: this.opts.graph.id,
      specId: this.opts.graph.specId,
      total: this.opts.graph.nodes.size,
    });

    this.recoveryRounds = 0;
    let deadlocked = false;
    // node id → in-flight executeOne promise. size = live worker count.
    const running = new Map<string, Promise<TaskOutcome>>();

    const dispatch = (task: TaskNode): void => {
      totalDispatched++;
      const tracked = (async (): Promise<TaskOutcome> => {
        try {
          return await this.executeOne(task);
        } catch (err) {
          // A dispatch-time throw must not wedge the scheduler: mark the node
          // terminally failed (frees its dependents per failed-blocker rules).
          this.opts.tracker.updateNodeStatus(task.id, 'failed', `dispatch error: ${String(err)}`);
          this.emit('sdd.task.failed', { runId: this.runId, taskId: task.id, subagentId: '', error: String(err) });
          return { taskId: task.id, success: false };
        } finally {
          running.delete(task.id);
        }
      })();
      running.set(task.id, tracked);
    };

    while (!this.stopRequested) {
      // Run-level backstops — an autonomous run must always terminate.
      if (totalDispatched >= this.maxTotalWaves) break;
      if (this.maxWallClockMs && Date.now() - startTime >= this.maxWallClockMs) break;

      await this.waitWhilePaused();
      if (this.stopRequested) break;

      // Fill free slots with ready (dependency-satisfied) tasks not already running.
      let dispatchedThisRound = 0;
      if (running.size < this.slots) {
        const ready = this.decomposer.readyNodes().filter((t) => !running.has(t.id));
        for (const task of ready) {
          if (running.size >= this.slots) break;
          dispatch(task);
          dispatchedThisRound++;
        }
      }
      if (dispatchedThisRound > 0) {
        this.emit('sdd.wave', { runId: this.runId, wave: this.round, batchSize: dispatchedThisRound });
        this.round++;
      }

      if (running.size === 0) {
        // Nothing in flight and nothing dispatched this pass.
        if (this.decomposer.isSettled()) break;
        const chains = this.computeDeadlockChains();
        if (chains.length > 0) {
          this.emit('sdd.deadlock', { runId: this.runId, chains });
          if (this.recoveryRounds < this.maxRecoveryRounds && this.recoverFailedBlockers()) {
            this.recoveryRounds++;
            continue;
          }
          deadlocked = true;
        }
        // No running, no ready, no recoverable deadlock → no further progress.
        break;
      }

      // If we still have a free slot AND a ready task, loop to dispatch it now;
      // otherwise wait for any in-flight task to settle (which may unblock more).
      const moreReadyNow =
        running.size < this.slots && this.decomposer.readyNodes().some((t) => !running.has(t.id));
      if (!moreReadyNow) {
        await Promise.race(running.values());
        this.opts.onProgress?.(this.buildProgress());
      }
    }

    // Drain any still-running tasks so the run never returns with live workers.
    if (running.size > 0) await Promise.allSettled(running.values());

    // Clean teardown on stop: interrupted tasks reset, worktrees released.
    if (this.stopRequested) await this.teardown();

    const finalProgress = this.opts.tracker.getProgress();

    this.emit('sdd.run.finished', {
      runId: this.runId,
      deadlocked,
      completed: finalProgress.completed,
      failed: finalProgress.failed,
      stopped: this.stopRequested,
    });

    return {
      totalWaves: this.round,
      totalCompleted: finalProgress.completed,
      totalFailed: finalProgress.failed,
      totalDurationMs: Date.now() - startTime,
      deadlocked,
      stopRequested: this.stopRequested,
      finalProgress,
    };
  }

  /**
   * Compute the blocking chains for a deadlock: every still-incomplete task and
   * the blockers (by node id) that are NOT completed. Failed blockers are
   * included since they're the usual deadlock cause once retries are exhausted.
   */
  private computeDeadlockChains(): Array<{ blocked: string; blockedBy: string[] }> {
    const tracker = this.opts.tracker;
    const chains: Array<{ blocked: string; blockedBy: string[] }> = [];
    for (const node of tracker.getAllNodes()) {
      if (node.status === 'completed' || node.status === 'failed') continue;
      const blockedBy = tracker
        .getBlockers(node.id)
        .filter((id) => tracker.getNode(id)?.status !== 'completed');
      if (blockedBy.length > 0) chains.push({ blocked: node.id, blockedBy });
    }
    return chains;
  }

  /** Requeue failed tasks that block an incomplete dependent. Returns true if any. */
  private recoverFailedBlockers(): boolean {
    const tracker = this.opts.tracker;
    let recovered = false;
    for (const node of tracker.getAllNodes({ status: ['failed'] })) {
      const blocksIncomplete = tracker.getDependents(node.id).some((d) => {
        const s = tracker.getNode(d)?.status;
        return s !== 'completed' && s !== 'failed';
      });
      if (blocksIncomplete) {
        this.retryMap.delete(node.id);
        this.persistRetries(node.id, 0);
        tracker.updateNodeStatus(node.id, 'pending', 'deadlock recovery');
        recovered = true;
      }
    }
    return recovered;
  }

  /** Restore per-task retry counts persisted in node metadata (resume support). */
  private restoreRetryMap(): void {
    this.retryMap.clear();
    for (const node of this.opts.tracker.getAllNodes()) {
      const r = (node.metadata as { retries?: unknown } | undefined)?.retries;
      if (typeof r === 'number' && r > 0) this.retryMap.set(node.id, r);
    }
  }

  /**
   * Reset orphaned `in_progress` tasks (no agent runs them after a crash) back
   * to `pending` so a fresh run re-executes them. Call before constructing a run
   * from a reloaded graph. Static so callers don't need a run instance.
   */
  static resetOrphans(tracker: TaskTracker): number {
    let n = 0;
    for (const node of tracker.getAllNodes({ status: ['in_progress'] })) {
      tracker.updateNodeStatus(node.id, 'pending', 'resume: orphaned in_progress');
      n++;
    }
    return n;
  }

  /** Clean teardown after a stop: reset interrupted tasks + release worktrees. */
  private async teardown(): Promise<void> {
    for (const node of this.opts.tracker.getAllNodes({ status: ['in_progress'] })) {
      this.opts.tracker.updateNodeStatus(node.id, 'pending', 'run stopped');
    }
    const wt = this.opts.worktrees;
    if (wt) {
      for (const [taskId, handle] of [...this.taskWorktrees]) {
        await wt.release(handle, { keep: true }).catch(() => {});
        this.forgetWorktree(taskId);
      }
    }
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  private buildCoordinator(): void {
    const config: MultiAgentConfig = {
      coordinatorId: `sdd-parallel-${randomUUID().slice(0, 8)}`,
      maxConcurrent: this.slots,
      doneCondition: { type: 'all_tasks_done' },
    };
    this.coordinator = new DefaultMultiAgentCoordinator(config);
    // Wrap factory with disabled tool filtering to prevent subagents from
    // using the delegate tool (or any other disabledTools in their config)
    const baseFactory = this.opts.subagentFactory ?? this.defaultFactory();
    const filteredFactory = withDisabledToolFiltering(baseFactory);
    const runner = makeAgentSubagentRunner({ factory: filteredFactory });
    this.coordinator.setRunner?.(runner);
  }

  private defaultFactory(): AgentFactory {
    return async (_config: SubagentConfig) => ({
      agent: this.opts.agent,
      events: this.opts.agent.events,
    });
  }

  /**
   * Execute a batch of tasks together. Retained as a thin wrapper over the
   * single-task primitive `executeOne` so the wave-oriented tests and any
   * batch callers keep working; the continuous scheduler in `run()` calls
   * `executeOne` directly. Throws if no coordinator is wired or a spawn fails
   * (surfaced from `executeOne`), preserving the original all-or-nothing contract.
   */
  async executeWave(batch: TaskBatch): Promise<WaveResult> {
    const waveStart = Date.now();
    const outcomes = await Promise.all(batch.tasks.map((task) => this.executeOne(task)));
    const results = outcomes.map((o) => o.result).filter((r): r is TaskResult => Boolean(r));
    const successCount = outcomes.filter((o) => o.success).length;
    const failCount = outcomes.length - successCount;
    return {
      wave: batch.wave,
      batch,
      results,
      successCount,
      failCount,
      durationMs: Date.now() - waveStart,
      stopRequested: this.stopRequested,
    };
  }

  /**
   * Execute one task end-to-end: assign a worker identity, allocate its worktree,
   * spawn + assign the subagent, await its result, then update tracker status
   * (success / retry / terminal-fail / cancelled) and resolve the worktree. This
   * is the unit the continuous scheduler dispatches into a free slot. Throws on a
   * missing coordinator or failed spawn so callers can enforce all-or-nothing.
   */
  async executeOne(task: TaskNode): Promise<TaskOutcome> {
    const taskId = task.id;

    // Worker identity (reuse a manual assignment if present), shown on the board.
    let agentName = task.assignee;
    if (!agentName) {
      const nick = assignNickname('executor', this.usedNicknames);
      this.usedNicknames.add(nick.key);
      agentName = nick.display.replace(/\s*\([^)]*\)\s*$/, '');
      this.opts.tracker.updateNode(taskId, { assignee: agentName });
    }

    this.opts.tracker.updateNodeStatus(taskId, 'in_progress');

    // Per-task git-worktree isolation: a fresh checkout off the current base
    // (which already holds every dependency's merged work).
    await this.allocateWorktrees([task]);

    if (!this.coordinator) throw new SddError({
      message: 'SDD parallel runner requires a coordinator',
      code: ERROR_CODES.SDD_INVALID_STATE,
    });
    const coordinator = this.coordinator;

    const subagentId = `sdd-d${this.dispatchSeq++}`;
    const correlationId = randomUUID();

    // Per-task model / provider / fallback resolution: the node's own assignment
    // (set per-task in the WebUI) wins, else the run-level default.
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    const model = (typeof meta.model === 'string' ? meta.model : undefined) ?? this.opts.defaultModel;
    const provider =
      (typeof meta.provider === 'string' ? meta.provider : undefined) ?? this.opts.defaultProvider;
    const fallbackModels = Array.isArray(meta.fallbackModels)
      ? (meta.fallbackModels as string[])
      : this.opts.fallbackModels;

    const spawnResult = await coordinator.spawn({
      id: subagentId,
      name: agentName ?? subagentId,
      role: 'executor',
      timeoutMs: this.timeoutMs,
      cwd: this.taskCwds.get(taskId),
      disabledTools: ['delegate'],
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      ...(fallbackModels && fallbackModels.length ? { fallbackModels } : {}),
    });
    if (!spawnResult.subagentId) {
      throw new SddError({
        message: 'One or more subagent spawns failed',
        code: ERROR_CODES.SDD_INVALID_STATE,
      });
    }
    // Record the live subagent so cancelTask() can abort exactly this task.
    this.taskSubagents.set(taskId, subagentId);

    this.emit('sdd.task.started', {
      runId: this.runId,
      taskId,
      subagentId,
      agentName: agentName ?? '',
      worktreeBranch: this.taskBranches.get(taskId),
    });

    const directivePreamble = [
      '═══ SDD PARALLEL EXECUTION ═══',
      '',
      `Graph: ${this.opts.graph.title}`,
      '',
      '── EXECUTION PROTOCOL ──',
      '• Execute the assigned SDD task end-to-end using multiple tool calls.',
      '• Mark the task [done] in the tracker when complete.',
      '• Do not ask before routine in-project tool use; if a permission gate appears, wait for that flow.',
      '• Keep output concise — summarize changes, do not transcribe files.',
    ].join('\n');

    await coordinator.assign({
      id: correlationId,
      description: [
        directivePreamble,
        '',
        `── TASK ──`,
        `[${task.priority.toUpperCase()}] ${task.title}`,
        '',
        task.description,
      ].join('\n'),
      subagentId,
      timeoutMs: this.timeoutMs,
    });

    let result: TaskResult;
    try {
      const got = await coordinator.awaitTasks([correlationId]);
      result = expectDefined(got[0]);
    } catch (err) {
      result = {
        subagentId,
        taskId: correlationId,
        status: 'failed',
        error: { kind: 'unknown', message: String(err), retryable: false },
        iterations: 0,
        toolCalls: 0,
        durationMs: 0,
      };
    }

    this.taskSubagents.delete(taskId);

    // Cancelled mid-flight: cancelTask() already marked the node terminal — don't
    // resurrect it via the retry path. Discard its worktree and report failure.
    if (this.cancelledTasks.has(taskId)) {
      await this.resolveWorktrees([task]);
      return { taskId, success: false, result };
    }

    let success = false;
    if (result.status === 'success') {
      success = true;
      this.opts.tracker.updateNodeStatus(taskId, 'completed');
      this.retryMap.delete(taskId);
      this.persistRetries(taskId, 0);
      this.emit('sdd.task.completed', {
        runId: this.runId,
        taskId,
        subagentId,
        durationMs: result.durationMs,
      });
    } else {
      const errMsg = result.error?.kind
        ? `${result.error.kind}: ${result.error.message}`
        : result.error?.message ?? 'unknown error';
      const currentRetries = this.retryMap.get(taskId) ?? 0;
      if (currentRetries < this.maxRetries) {
        this.retryMap.set(taskId, currentRetries + 1);
        this.persistRetries(taskId, currentRetries + 1);
        this.opts.tracker.updateNodeStatus(
          taskId,
          'pending',
          `Retry ${currentRetries + 1}/${this.maxRetries}: ${errMsg}`,
        );
        this.emit('sdd.task.retrying', {
          runId: this.runId,
          taskId,
          attempt: currentRetries + 1,
          maxRetries: this.maxRetries,
        });
      } else {
        this.opts.tracker.updateNodeStatus(taskId, 'failed', errMsg);
        this.emit('sdd.task.failed', { runId: this.runId, taskId, subagentId, error: errMsg });
      }
    }

    // Integrate this task's isolated worktree back into the base branch
    // (success → squash-merge; retry → discard; terminal failure → keep for review).
    await this.resolveWorktrees([task]);

    return { taskId, success, result };
  }

  /** Allocate a fresh git worktree per task in the batch (no-op without a manager). */
  private async allocateWorktrees(tasks: TaskNode[]): Promise<void> {
    const wt = this.opts.worktrees;
    if (!wt) return;
    for (const task of tasks) {
      if (this.taskWorktrees.has(task.id)) continue;
      try {
        const handle = await wt.allocate(`sdd-${task.id}`, {
          slugHint: task.title,
          ownerLabel: task.title,
        });
        if (handle.status === 'active') {
          this.taskWorktrees.set(task.id, handle);
          this.taskCwds.set(task.id, handle.dir);
          this.taskBranches.set(task.id, handle.branch);
          const node = this.opts.tracker.getNode(task.id);
          if (node) node.metadata = { ...node.metadata, worktreeBranch: handle.branch };
        }
      } catch {
        // Allocation failed → this task runs on the shared working tree.
      }
    }
  }

  /**
   * Resolve each task's worktree after its result is known. Serialized merges
   * (one at a time) keep the base branch consistent; the wave structure already
   * guarantees dependency order (a task's blockers merged in an earlier wave).
   */
  private async resolveWorktrees(tasks: TaskNode[]): Promise<void> {
    const wt = this.opts.worktrees;
    if (!wt) return;
    for (const task of tasks) {
      const handle = this.taskWorktrees.get(task.id);
      if (!handle) continue;
      const node = this.opts.tracker.getNode(task.id);
      const status = node?.status;
      const cancelled = Boolean(node?.metadata?.cancelled);
      try {
        if (cancelled) {
          // User cancelled → throw away the partial checkout, don't merge it.
          await wt.release(handle, { keep: false });
          this.forgetWorktree(task.id, { keepBranchLabel: false });
        } else if (status === 'completed') {
          await wt.commitAll(handle, `sdd(${task.title}): ${task.id}`);
          await wt.merge(handle, { squash: true });
          await wt.release(handle, { keep: false });
          this.forgetWorktree(task.id);
        } else if (status === 'failed') {
          // Keep the failed checkout on disk for inspection.
          await wt.commitAll(handle, `sdd(${task.title}) [failed]: ${task.id}`).catch(() => ({ committed: false }));
          await wt.release(handle, { keep: true });
          this.forgetWorktree(task.id);
        } else {
          // Pending again (retry) → discard so the next wave starts clean.
          await wt.release(handle, { keep: false });
          this.forgetWorktree(task.id, { keepBranchLabel: false });
        }
      } catch {
        // Merge/release hiccup must not abort the run; leave the handle parked.
        this.forgetWorktree(task.id);
      }
    }
  }

  private forgetWorktree(taskId: string, opts: { keepBranchLabel?: boolean } = {}): void {
    this.taskWorktrees.delete(taskId);
    this.taskCwds.delete(taskId);
    if (!opts.keepBranchLabel) this.taskBranches.delete(taskId);
  }

  /** Persist a task's retry count into node metadata (survives crash → resume). */
  private persistRetries(taskId: string, retries: number): void {
    const node = this.opts.tracker.getNode(taskId);
    if (node) node.metadata = { ...node.metadata, retries };
  }

  private buildProgress(): SddProgress {
    const gp = this.opts.tracker.getProgress();
    const isDeadlocked = !this.decomposer.isDone() &&
      this.decomposer.nextBatch().deadlocked;
    return {
      wave: this.decomposer.getWaveCount(),
      total: gp.total,
      completed: gp.completed,
      inProgress: gp.inProgress,
      failed: gp.failed,
      blocked: gp.blocked,
      pending: gp.pending,
      percent: gp.percentComplete,
      deadlocked: isDeadlocked,
    };
  }
}
