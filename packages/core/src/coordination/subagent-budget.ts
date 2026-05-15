import type { Usage } from '../types/provider.js';

export type BudgetKind = 'tool_calls' | 'iterations' | 'tokens' | 'timeout' | 'cost';

export class BudgetExceededError extends Error {
  readonly kind: BudgetKind;
  readonly limit: number;
  readonly observed: number;

  constructor(kind: BudgetKind, limit: number, observed: number) {
    super(`Budget exceeded: ${kind} (limit=${limit}, observed=${observed})`);
    this.name = 'BudgetExceededError';
    this.kind = kind;
    this.limit = limit;
    this.observed = observed;
  }
}

export interface BudgetLimits {
  maxIterations?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  /** Estimated USD cost ceiling. */
  maxCostUsd?: number;
  /** Wall-clock timeout from start() to checkTimeout(). */
  timeoutMs?: number;
}

export interface BudgetUsage {
  iterations: number;
  toolCalls: number;
  tokens: { input: number; output: number; total: number };
  costUsd: number;
  elapsedMs: number;
}

/**
 * Per-subagent budget enforcement. Each subagent gets its own instance so a
 * runaway agent can't drain the cost ceiling of its siblings. All record/check
 * methods are O(1) and safe to call from hot paths.
 *
 * Behavior: `record*` methods throw `BudgetExceededError` synchronously the
 * moment a limit is crossed. The caller (runner/coordinator) catches this and
 * marks the task as 'failed' with the budget kind, so the operator can see
 * exactly which ceiling tripped.
 *
 * Timeout note: `checkTimeout()` is a cooperative guard called by the
 * runner on each iteration loop. The coordinator additionally enforces a
 * hard wall-clock deadline via `Promise.race` in `executeWithTimeout`.
 * Both mechanisms throw `BudgetExceededError` ('timeout') — the runner's
 * check is best-effort (catches cases where the runner loop doesn't call it)
 * and the coordinator's race is the authoritative cutoff. The two are
 * intentionally independent; they converge on the same error type so
 * `runDispatched` handles both identically.
 */
export class SubagentBudget {
  readonly limits: Readonly<BudgetLimits>;
  private iterations = 0;
  private toolCalls = 0;
  private tokenInput = 0;
  private tokenOutput = 0;
  private costUsd = 0;
  private startTime: number | null = null;

  constructor(limits: BudgetLimits = {}) {
    this.limits = Object.freeze({ ...limits });
  }

  start(): void {
    this.startTime = Date.now();
  }

  recordIteration(): void {
    this.iterations++;
    if (this.limits.maxIterations !== undefined && this.iterations > this.limits.maxIterations) {
      throw new BudgetExceededError('iterations', this.limits.maxIterations, this.iterations);
    }
  }

  recordToolCall(): void {
    this.toolCalls++;
    if (this.limits.maxToolCalls !== undefined && this.toolCalls > this.limits.maxToolCalls) {
      throw new BudgetExceededError('tool_calls', this.limits.maxToolCalls, this.toolCalls);
    }
  }

  recordUsage(usage: Usage, costUsd = 0): void {
    this.tokenInput += usage.input;
    this.tokenOutput += usage.output;
    this.costUsd += costUsd;

    const totalTokens = this.tokenInput + this.tokenOutput;
    if (this.limits.maxTokens !== undefined && totalTokens > this.limits.maxTokens) {
      throw new BudgetExceededError('tokens', this.limits.maxTokens, totalTokens);
    }
    if (this.limits.maxCostUsd !== undefined && this.costUsd > this.limits.maxCostUsd) {
      throw new BudgetExceededError('cost', this.limits.maxCostUsd, this.costUsd);
    }
  }

  /**
   * Throws if the wall-clock budget is exhausted. Call this from the iteration
   * loop so a hung tool can't keep a subagent running past its deadline.
   */
  checkTimeout(): void {
    if (this.startTime === null || this.limits.timeoutMs === undefined) return;
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.limits.timeoutMs) {
      throw new BudgetExceededError('timeout', this.limits.timeoutMs, elapsed);
    }
  }

  /** Returns true if a timeout has occurred without throwing. Useful for races. */
  isTimedOut(): boolean {
    if (this.startTime === null || this.limits.timeoutMs === undefined) return false;
    return Date.now() - this.startTime > this.limits.timeoutMs;
  }

  usage(): BudgetUsage {
    return {
      iterations: this.iterations,
      toolCalls: this.toolCalls,
      tokens: {
        input: this.tokenInput,
        output: this.tokenOutput,
        total: this.tokenInput + this.tokenOutput,
      },
      costUsd: this.costUsd,
      elapsedMs: this.startTime === null ? 0 : Date.now() - this.startTime,
    };
  }
}
