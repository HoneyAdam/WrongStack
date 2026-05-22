import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Agent } from '../core/agent.js';
import type { TodoItem } from '../core/context.js';
import type { Compactor } from '../types/compactor.js';
import {
  appendJournal,
  loadGoal,
  saveGoal,
  goalFilePath,
  type GoalFile,
  type JournalEntry,
} from '../storage/goal-store.js';

const execFileP = promisify(execFile);

/**
 * Sense-decide-execute-reflect loop on top of a long-running Goal.
 *
 * Each iteration:
 *   1. Sense   — read goal, pending todos, `git status --porcelain`.
 *   2. Decide  — pick a source (todo / git / brainstorm) and a task.
 *   3. Execute — single agent.run with a directive prompt.
 *   4. Reflect — append a journal entry, persist state to disk.
 *
 * The loop runs forever until `stop()` is called externally (REPL SIGINT
 * handler, /autonomy stop). No internal time/cost cap by design — the
 * user wants "sittin sene". Failures are logged and the loop continues
 * with a different source on the next tick.
 */

export interface EternalAutonomyOptions {
  agent: Agent;
  projectRoot: string;
  /**
   * Per-iteration agent timeout. Defaults to 5 minutes. A single hung
   * provider call should not freeze the whole eternal loop.
   */
  iterationTimeoutMs?: number;
  /**
   * Minimum sleep between iterations. Defaults to 1 s — enough for
   * SIGINT handlers to fire mid-loop without pegging a core when the
   * provider is being rate-limited.
   */
  cycleGapMs?: number;
  /**
   * Maximum consecutive failures before the source rotation forces a
   * brainstorm cycle. Default 3. Acts as a soft-recovery, not a stop.
   */
  failureBudget?: number;
  /** Side-channel notifications (logging, UI updates). */
  onIteration?: (entry: JournalEntry) => void;
  onError?: (err: Error, iteration: number) => void;
  /**
   * Optional injected git status reader — production code uses git, tests
   * stub this out so they don't shell out.
   */
  gitStatusReader?: () => Promise<string>;
  /**
   * Optional clock — tests stub for deterministic timestamps.
   */
  now?: () => Date;
  /**
   * Optional compactor. When provided, the engine runs compaction every
   * `compactEveryNIterations` iterations to keep the agent's message
   * history under control during multi-day eternal loops. Without
   * compaction, an infinite loop will eventually overflow the provider's
   * context window and start failing.
   */
  compactor?: Compactor;
  /** How many iterations between compaction calls. Default 25. */
  compactEveryNIterations?: number;
  /**
   * Aggressive compaction threshold. When ctx token usage exceeds this
   * fraction of `maxContextTokens`, compaction runs in aggressive mode
   * regardless of the iteration cadence. 0.85 by default.
   */
  aggressiveCompactRatio?: number;
  /**
   * Model's max context window in tokens. When set, the engine watches
   * `currentRequestTokens()` against this and triggers aggressive compact
   * before the next iteration would overflow. Omit to disable threshold
   * checks (iteration cadence still applies).
   */
  maxContextTokens?: number;
}

export type EternalEngineState = 'idle' | 'running' | 'stopped';

interface DecidedAction {
  source: JournalEntry['source'];
  task: string;
  directive: string;
}

export class EternalAutonomyEngine {
  private state: EternalEngineState = 'idle';
  private stopRequested = false;
  private consecutiveFailures = 0;
  private currentCtrl: AbortController | null = null;
  private iterationsSinceCompact = 0;
  private readonly goalPath: string;

  constructor(private readonly opts: EternalAutonomyOptions) {
    this.goalPath = goalFilePath(opts.projectRoot);
  }

  /** Current engine state — readable for UIs. */
  get currentState(): EternalEngineState {
    return this.state;
  }

  /** Synchronously request stop. Resolves once the running iteration aborts. */
  stop(): void {
    this.stopRequested = true;
    this.currentCtrl?.abort();
    // Best-effort: flip the persisted state so the next startup banner
    // doesn't report a phantom "running" engine. Fire-and-forget — if it
    // races with an in-flight iteration's write, the journal write wins
    // (engineState is metadata, not durable correctness).
    void this.persistEngineState('stopped').catch(() => {});
    this.state = 'stopped';
  }

  /**
   * Mark the engine as 'running' on disk + reset stop state so a new
   * batch of `runOneIteration()` calls can proceed. Called by the REPL
   * when the user invokes `/autonomy eternal`. Idempotent.
   */
  async prime(): Promise<void> {
    this.stopRequested = false;
    this.state = 'running';
    await this.persistEngineState('running').catch(() => {});
  }

  /**
   * Main loop. Returns when stop() is called or the goal file is removed.
   * Does NOT throw — every iteration is wrapped to keep the loop alive.
   */
  async run(): Promise<void> {
    this.state = 'running';
    await this.persistEngineState('running');

    try {
      while (!this.stopRequested) {
        let iterationOk = false;
        try {
          iterationOk = await this.runOneIteration();
        } catch (err) {
          this.consecutiveFailures++;
          this.opts.onError?.(err instanceof Error ? err : new Error(String(err)), this.consecutiveFailures);
          await this.appendFailure('engine error', err instanceof Error ? err.message : String(err));
        }

        if (iterationOk) {
          this.consecutiveFailures = 0;
        }

        if (this.stopRequested) break;

        // Brief gap so SIGINT can land between iterations even if the
        // agent is bouncing back results fast.
        await sleep(this.opts.cycleGapMs ?? 1000);
      }
    } finally {
      this.state = 'stopped';
      await this.persistEngineState('stopped').catch(() => {});
    }
  }

  /**
   * Execute a single sense-decide-execute-reflect cycle.
   * Returns true on success, false on handled failure / no-op.
   *
   * Exposed publicly so the REPL can pace iterations from its main loop
   * — running the engine and the REPL as a single sequential consumer of
   * `agent.run()` avoids race conditions on the shared Context.
   */
  async runOneIteration(): Promise<boolean> {
    const goal = await loadGoal(this.goalPath);
    if (!goal) {
      // Goal file disappeared — treat as a graceful stop. The user may
      // have run `/goal clear` mid-loop.
      this.stopRequested = true;
      return false;
    }

    const action = await this.decide(goal);
    if (!action) {
      // No work surfaced from any source. Sleep longer and retry.
      await sleep(5_000);
      return false;
    }

    const ctrl = new AbortController();
    this.currentCtrl = ctrl;
    const timer = setTimeout(
      () => ctrl.abort(),
      this.opts.iterationTimeoutMs ?? 5 * 60_000,
    );
    let status: JournalEntry['status'] = 'success';
    let note: string | undefined;

    // Snapshot usage before so the iteration delta can be journaled.
    // Token counter is optional in mock/test contexts — guard accordingly.
    const tc = this.opts.agent.ctx?.tokenCounter;
    const beforeUsage = tc?.total?.();
    const beforeCost = tc?.estimateCost?.().total;

    try {
      const result = await this.opts.agent.run(
        [{ type: 'text' as const, text: action.directive }],
        { signal: ctrl.signal },
      );

      if (result.status === 'aborted') {
        status = 'aborted';
        note = 'stopped by user';
      } else if (result.status === 'failed') {
        status = 'failure';
        note = result.error?.describe?.() ?? 'agent run failed';
      } else if (result.status === 'max_iterations') {
        status = 'failure';
        note = `max iterations (${result.iterations})`;
      } else {
        status = 'success';
        const tail = (result.finalText ?? '').slice(0, 240).replace(/\s+/g, ' ').trim();
        if (tail) note = tail;
      }
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
      status = isAbort ? 'aborted' : 'failure';
      note = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      this.currentCtrl = null;
    }

    // Capture per-iteration usage delta. Cost is always non-negative;
    // if the counter wraps or resets mid-iteration we clamp to 0 so the
    // journal never shows negative spend.
    const afterUsage = tc?.total?.();
    const afterCost = tc?.estimateCost?.().total;
    const tokens =
      beforeUsage && afterUsage
        ? {
            input: Math.max(0, afterUsage.input - beforeUsage.input),
            output: Math.max(0, afterUsage.output - beforeUsage.output),
          }
        : undefined;
    const costUsd =
      typeof beforeCost === 'number' && typeof afterCost === 'number'
        ? Math.max(0, afterCost - beforeCost)
        : undefined;

    await this.appendIterationEntry({
      source: action.source,
      task: action.task,
      status,
      note,
      tokens,
      costUsd,
    });
    // Re-read the goal so we can emit the real iteration counter rather
    // than the previous placeholder. If the goal was unlinked mid-flight
    // (graceful stop via /goal clear) the iteration index is still
    // useful — fall back to the in-memory consecutiveFailures-derived
    // approximation only as a last resort.
    let iterationIndex = 0;
    try {
      const reloaded = await loadGoal(this.goalPath);
      iterationIndex = reloaded?.iterations ?? 0;
    } catch {
      // best-effort
    }
    this.opts.onIteration?.({
      at: (this.opts.now?.() ?? new Date()).toISOString(),
      iteration: iterationIndex,
      source: action.source,
      task: action.task,
      status,
      note,
      tokens,
      costUsd,
    });

    if (status === 'failure') {
      this.consecutiveFailures++;
      return false;
    }
    if (status === 'aborted') {
      // External stop or timeout — propagate. Don't count as failure.
      if (this.stopRequested) return false;
      // Timeout, not stop — count as failure.
      this.consecutiveFailures++;
      return false;
    }
    // Compaction runs only on successful iterations — there's no point
    // compacting after a failed/aborted iteration that didn't add much to
    // the message history.
    this.iterationsSinceCompact++;
    await this.maybeCompact().catch((err) => {
      // Don't let compaction failure kill the loop; surface via onError.
      this.opts.onError?.(
        err instanceof Error ? err : new Error(String(err)),
        this.consecutiveFailures,
      );
    });
    return true;
  }

  /**
   * Run compaction when either trigger fires:
   *   - We've done >= compactEveryNIterations since the last compact.
   *   - Current request tokens exceed aggressiveCompactRatio * maxContext.
   *
   * The second check uses *aggressive* mode to free more headroom; the
   * cadence check uses non-aggressive (cheaper).
   */
  private async maybeCompact(): Promise<void> {
    const compactor = this.opts.compactor;
    if (!compactor) return;
    const ctx = this.opts.agent.ctx;
    if (!ctx) return;

    const cadence = this.opts.compactEveryNIterations ?? 25;
    const threshold = this.opts.aggressiveCompactRatio ?? 0.85;
    const maxCtx = this.opts.maxContextTokens;

    let aggressive = false;
    let shouldRun = false;

    if (this.iterationsSinceCompact >= cadence) {
      shouldRun = true;
    }

    if (maxCtx && maxCtx > 0) {
      const used = ctx.tokenCounter?.currentRequestTokens?.();
      if (used) {
        const total = used.input + used.cacheRead;
        if (total / maxCtx >= threshold) {
          shouldRun = true;
          aggressive = true;
        }
      }
    }

    if (!shouldRun) return;

    const report = await compactor.compact(ctx, { aggressive });
    this.iterationsSinceCompact = 0;
    // Journal the compaction event so users see it in /goal journal.
    const saved = report.before - report.after;
    await this.appendIterationEntry({
      source: 'manual',
      task: `compaction (${aggressive ? 'aggressive' : 'cadence'})`,
      status: 'success',
      note: `saved ~${saved} tokens (${report.before}→${report.after})`,
    });
  }

  /**
   * Hybrid idea source.
   *   1. Pending todos on the agent's context.
   *   2. Dirty git working tree → propose a "review and finish this" task.
   *   3. Otherwise: brainstorm via the LLM against the goal.
   *
   * After failureBudget consecutive failures, force brainstorm so the
   * engine doesn't loop on the same broken todo or stuck git state.
   */
  private async decide(goal: GoalFile): Promise<DecidedAction | null> {
    const forceBrainstorm = this.consecutiveFailures >= (this.opts.failureBudget ?? 3);

    if (!forceBrainstorm) {
      const todo = this.pickPendingTodo();
      if (todo) {
        return {
          source: 'todo',
          task: todo.content,
          directive: this.buildDirective(goal, 'todo', todo.content),
        };
      }

      const gitTask = await this.pickGitTask();
      if (gitTask) {
        return {
          source: 'git',
          task: gitTask,
          directive: this.buildDirective(goal, 'git', gitTask),
        };
      }
    }

    const brainstormed = await this.brainstormTask(goal);
    if (!brainstormed) return null;
    return {
      source: 'brainstorm',
      task: brainstormed,
      directive: this.buildDirective(goal, 'brainstorm', brainstormed),
    };
  }

  private pickPendingTodo(): TodoItem | null {
    const todos = this.opts.agent.ctx.todos;
    if (!Array.isArray(todos)) return null;
    return todos.find((t) => t.status === 'pending') ?? null;
  }

  private async pickGitTask(): Promise<string | null> {
    let out: string;
    try {
      out = await (this.opts.gitStatusReader?.() ?? this.readGitStatus());
    } catch {
      return null;
    }
    const dirty = out.trim();
    if (!dirty) return null;
    // Surface a concise prompt — the agent will look at the diff itself.
    const lines = dirty.split('\n').slice(0, 8);
    const preview = lines.join(', ');
    return `Inspect the dirty working tree and either finish the in-progress work or revert it. Files: ${preview}`;
  }

  private async readGitStatus(): Promise<string> {
    const { stdout } = await execFileP('git', ['status', '--porcelain'], {
      cwd: this.opts.projectRoot,
      timeout: 5_000,
    });
    return stdout;
  }

  private async brainstormTask(goal: GoalFile): Promise<string | null> {
    const lastFew = goal.journal
      .slice(-5)
      .map((e) => `  - [${e.status}] ${e.task}`)
      .join('\n');
    const directive = [
      'You are deciding the next action in an autonomous loop pursuing a long-running goal.',
      '',
      `Goal: ${goal.goal}`,
      '',
      lastFew ? `Recent iterations:\n${lastFew}` : 'No prior iterations yet.',
      '',
      'Output ONE concrete, immediately-actionable task that advances the goal.',
      'Constraints:',
      '- One sentence, imperative form, under 200 chars.',
      '- No preamble, no explanation, no markdown — just the task line.',
      '- If recent iterations show repeated failures on the same target, pivot.',
      '- If the goal appears fully accomplished, output exactly: DONE',
    ].join('\n');

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const result = await this.opts.agent.run(
          [{ type: 'text' as const, text: directive }],
          { signal: ctrl.signal, maxIterations: 1 },
        );
        if (result.status !== 'done') return null;
        const text = (result.finalText ?? '').trim();
        if (!text || text === 'DONE') return null;
        // Take the first non-empty line and clip to 240 chars.
        const firstLine = text.split('\n').find((l) => l.trim().length > 0)?.trim();
        if (!firstLine) return null;
        return firstLine.slice(0, 240);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }

  private buildDirective(goal: GoalFile, source: JournalEntry['source'], task: string): string {
    return [
      '[ETERNAL AUTONOMY — iteration directive]',
      '',
      `Goal: ${goal.goal}`,
      `Source: ${source}`,
      `Task: ${task}`,
      '',
      'Execute this task end-to-end using the tools available to you. Make the',
      'changes, run tests if relevant, and commit / push as appropriate. Do not',
      'ask for confirmation — YOLO mode is active. When the task is done, stop;',
      'the loop will pick the next action.',
    ].join('\n');
  }

  private async appendIterationEntry(entry: Omit<JournalEntry, 'iteration' | 'at'>): Promise<void> {
    const current = await loadGoal(this.goalPath);
    if (!current) {
      // Goal was cleared mid-iteration; nothing to write to.
      return;
    }
    const updated = appendJournal(current, entry);
    await saveGoal(this.goalPath, updated);
  }

  private async appendFailure(task: string, note: string): Promise<void> {
    await this.appendIterationEntry({ source: 'manual', task, status: 'failure', note });
  }

  private async persistEngineState(state: GoalFile['engineState']): Promise<void> {
    const current = await loadGoal(this.goalPath);
    if (!current) return;
    if (current.engineState === state) return;
    await saveGoal(this.goalPath, { ...current, engineState: state });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
