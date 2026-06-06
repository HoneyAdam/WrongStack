import type { Usage } from '../types/provider.js';
import type { EventBus } from '../kernel/events.js';

export type BudgetKind = 'tool_calls' | 'iterations' | 'tokens' | 'timeout' | 'idle_timeout' | 'cost';

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
  maxIterations?: number | undefined;
  maxToolCalls?: number | undefined;
  maxTokens?: number | undefined;
  /** Estimated USD cost ceiling. */
  maxCostUsd?: number | undefined;
  /**
   * Hard wall-clock timeout measured from `start()`. Off by default — set it
   * explicitly only when a task must finish within an absolute window. For
   * the everyday "don't kill an agent that's still working" guard, prefer
   * `idleTimeoutMs`, which resets on activity.
   */
  timeoutMs?: number | undefined;
  /**
   * Idle timeout: the maximum gap (ms) between activity signals (iterations,
   * tool calls, token usage, streamed progress) before the subagent is
   * considered hung and reaped. Unlike `timeoutMs`, an actively-working
   * agent continuously resets this clock via `markActivity()`, so it never
   * trips on a long-but-productive run — only on a genuine stall.
   */
  idleTimeoutMs?: number | undefined;
}

/**
 * Controls how the budget behaves when `onThreshold` is set and a limit is hit.
 *
 * `'auto'` — emit `budget.threshold_reached` on the EventBus and wait for a
 * coordinator response (extend/stop). If no listener responds within
 * `DECISION_TIMEOUT_MS` the decision defaults to `'stop'`.
 * `'sync'` — do not emit any event; treat the threshold as a hard stop and
 * throw `BudgetExceededError` synchronously. Useful for fire-and-forget
 * subagents that have an `onThreshold` handler for logging/metrics but are
 * not wired into a coordinator.
 *
 * @default 'auto'
 */
export type BudgetNegotiationMode = 'auto' | 'sync';

export interface BudgetUsage {
  iterations: number;
  toolCalls: number;
  tokens: { input: number; output: number; total: number };
  costUsd: number;
  elapsedMs: number;
}

/**
 * Thrown by `SubagentBudget.record*` when a soft limit is hit and
 * an `onThreshold` handler is configured that wants to ask the
 * coordinator (via `budget.threshold_reached` event). The runner
 * catches this and awaits the embedded `decision` promise to get
 * the coordinator's extend/stop decision.
 *
 * Distinct from `BudgetExceededError` which is a hard stop.
 */
export class BudgetThresholdSignal extends Error {
  readonly kind: BudgetKind;
  readonly limit: number;
  readonly used: number;
  /** Resolves to 'extend' (with optional new limits) or 'stop' */
  readonly decision: Promise<BudgetThresholdDecision>;

  constructor(
    kind: BudgetKind,
    limit: number,
    used: number,
    decision: Promise<BudgetThresholdDecision>,
  ) {
    super(`Budget soft limit: ${kind} (limit=${limit}, used=${used})`);
    this.name = 'BudgetThresholdSignal';
    this.kind = kind;
    this.limit = limit;
    this.used = used;
    this.decision = decision;
  }
}

export type BudgetThresholdDecision =
  | 'stop'
  | { extend: Partial<BudgetLimits> };

/**
 * Callback invoked when a budget limit is about to be exceeded.
 * Return 'throw' for hard stop (default — throws BudgetExceededError).
 * Return 'continue' to allow one more unit and re-check next time.
 * Return a Promise to ask the coordinator via `budget.threshold_reached`
 * event (uses the same grant/deny pattern as `iteration.limit_reached`).
 */
export type BudgetThresholdHandler = (info: {
  kind: BudgetKind;
  used: number;
  limit: number;
  requestDecision: () => Promise<BudgetThresholdDecision>;
}) => 'throw' | 'continue' | Promise<BudgetThresholdDecision>;

/**
 * Per-subagent budget enforcement. Each subagent gets its own instance so a
 * runaway agent can't drain the cost ceiling of its siblings. All record/check
 * methods are O(1) and safe to call from hot paths.
 *
 * Behavior without `onThreshold`: hard stops synchronously on every limit hit.
 *
 * Behavior with `onThreshold` and `_mode === 'auto'`: emits `budget.threshold_reached`
 * on the EventBus and throws `BudgetThresholdSignal`. The coordinator's verdict
 * (extend/stop) resolves the embedded promise. If no listener responds within
 * `DECISION_TIMEOUT_MS` the decision defaults to `'stop'`.
 *
 * Behavior with `onThreshold` and `_mode === 'sync'`: throws `BudgetExceededError`
 * synchronously regardless of EventBus state or listener presence. This is useful
 * for fire-and-forget subagents that have an `onThreshold` handler for logging/metrics
 * but are not wired into a coordinator — the `'sync'` mode makes the hard-stop
 * behavior explicit and means tests can use `expect().toThrow()` even without
 * a fully-wired EventBus.
 */
export class SubagentBudget {
  readonly limits: Readonly<BudgetLimits>;
  private iterations = 0;
  private toolCalls = 0;
  private tokenInput = 0;
  private tokenOutput = 0;
  private costUsd = 0;
  private startTime: number | null = null;
  /**
   * Timestamp of the most recent activity (iteration / tool call / token
   * usage / streamed progress). Drives the idle timeout — reset by
   * `markActivity()`. Initialised to `start()` time so a never-active agent
   * still eventually trips its idle window.
   */
  private lastActivityTime: number | null = null;
  private _onThreshold: BudgetThresholdHandler | undefined;
  /**
   * Hard cap on how long `_negotiateExtension` waits for the coordinator to
   * respond before defaulting to 'stop'. Without this fallback an absent
   * or hung listener (Director not built / event filter detached mid-run)
   * leaves the budget over-limit and never enforces anything.
   */
  private static readonly DECISION_TIMEOUT_MS = 60_000;
  /**
   * Injected by the runner when wiring the budget to its EventBus.
   * Used to emit `budget.threshold_reached` events in `'auto'` mode.
   */
  _events?: EventBus | undefined;

  /**
   * Negotiation mode — controls whether a threshold hit tries to emit
   * `budget.threshold_reached` and wait for a coordinator decision, or
   * falls straight through to a synchronous hard stop.
   *
   * `'auto'` (default) — emit on the EventBus and wait; times out to 'stop'.
   * `'sync'` — throw `BudgetExceededError` immediately regardless of listeners.
   */
  private _mode: BudgetNegotiationMode;

  /**
   * Optional callback for soft-limit handling. When set, the budget will
   * invoke it rather than throw immediately. The handler decides whether to
   * throw synchronously, continue, or ask the coordinator for an extension.
   */
  get onThreshold(): BudgetThresholdHandler | undefined {
    return this._onThreshold;
  }
  set onThreshold(fn: BudgetThresholdHandler | undefined) {
    this._onThreshold = fn;
  }

  /** Returns the current negotiation mode. */
  get mode(): BudgetNegotiationMode {
    return this._mode;
  }

  constructor(limits: BudgetLimits = {}, mode: BudgetNegotiationMode = 'auto') {
    this._mode = mode;
    // NOT frozen: `negotiateExtension` patches these limits in place when the
    // coordinator grants an auto-extension. Freezing made every granted
    // extension throw `TypeError: Cannot assign to read only property` in
    // strict mode, which the runner caught as a hard stop — so extensions
    // silently became kills. The `readonly limits: Readonly<BudgetLimits>`
    // typing still blocks external mutation at compile time.
    this.limits = { ...limits };
  }

  start(): void {
    this.startTime = Date.now();
    this.lastActivityTime = this.startTime;
  }

  /**
   * Reset the idle clock. Called on any sign of forward progress —
   * iterations, tool calls, token usage, and streamed tool/text progress —
   * so a long-but-productive subagent never trips its `idleTimeoutMs`.
   */
  markActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * Milliseconds since the last activity signal. Returns 0 before `start()`
   * (nothing to measure yet). Used by the coordinator watchdog to decide
   * whether to re-arm (still active) or reap (genuinely idle).
   */
  idleMs(): number {
    const since = this.lastActivityTime ?? this.startTime;
    return since === null ? 0 : Date.now() - since;
  }

  /** Returns true if we're within 10% of any limit — useful for pre-flight checks. */
  isNearLimit(): boolean {
    const { maxIterations, maxToolCalls, maxTokens, maxCostUsd } = this.limits;
    if (maxIterations && this.iterations >= maxIterations * 0.9) return true;
    if (maxToolCalls && this.toolCalls >= maxToolCalls * 0.9) return true;
    if (maxTokens && this.tokenInput + this.tokenOutput >= maxTokens * 0.9) return true;
    if (maxCostUsd && this.costUsd >= maxCostUsd * 0.9) return true;
    return false;
  }

  /**
   * Synchronous budget check. Always throws synchronously so callers (especially
   * test event handlers using `expect().toThrow()`) get an unhandled rejection
   * when the budget is exceeded without a handler.
   *
   * Decision table:
   * - no `onThreshold` handler         → throw `BudgetExceededError` (hard stop, always)
   * - `mode === 'sync'`               → throw `BudgetExceededError` (hard stop, always)
   * - `mode === 'auto'` + no listener  → throw `BudgetExceededError` (hard stop; no one to ask)
   * - `mode === 'auto'` + listener     → throw `BudgetThresholdSignal` with async decision promise
   */
  /**
   * Collects all exceeded budget kinds into a single NOOP-free negotiation.
   * Called by recordIteration / recordToolCall / recordUsage — each may call
   * this for its own kind. The first call starts the negotiation and stores
   * the Promise in _pendingNegotiation. Subsequent calls for DIFFERENT
   * kinds (while a negotiation is in flight) are NOOPs — they don't start
   * new conversations with the coordinator. This prevents an EventBus flood
   * when multiple budget kinds are exceeded simultaneously in one iteration.
   *
   * Returns the kinds that were found to be exceeded (for logging/debugging).
   */
  private checkLimits(elapsedMs?: number): { kind: BudgetKind; used: number; limit: number }[] {
    const exceeded: { kind: BudgetKind; used: number; limit: number }[] = [];

    if (this.limits.maxIterations !== undefined && this.iterations > this.limits.maxIterations) {
      exceeded.push({ kind: 'iterations', used: this.iterations, limit: this.limits.maxIterations });
    }
    if (this.limits.maxToolCalls !== undefined && this.toolCalls > this.limits.maxToolCalls) {
      exceeded.push({ kind: 'tool_calls', used: this.toolCalls, limit: this.limits.maxToolCalls });
    }
    const totalTokens = this.tokenInput + this.tokenOutput;
    if (this.limits.maxTokens !== undefined && totalTokens > this.limits.maxTokens) {
      exceeded.push({ kind: 'tokens', used: totalTokens, limit: this.limits.maxTokens });
    }
    if (this.limits.maxCostUsd !== undefined && this.costUsd > this.limits.maxCostUsd) {
      exceeded.push({ kind: 'cost', used: this.costUsd, limit: this.limits.maxCostUsd });
    }
    // Timeout: called from checkTimeout() with elapsedMs (wall-clock) and the
    // current idle gap. Either crossing its limit trips its own kind so the
    // coordinator and auto-extend policy can distinguish them.
    // Wall-clock (`timeoutMs`) is an explicit hard cap; idle (`idleTimeoutMs`)
    // is the default guard that resets on activity. Both can be exceeded in
    // the same call — we push both entries so all violated limits are reported.
    if (elapsedMs !== undefined) {
      const idle = this.idleMs();
      if (this.limits.idleTimeoutMs !== undefined && idle > this.limits.idleTimeoutMs) {
        exceeded.push({ kind: 'idle_timeout', used: idle, limit: this.limits.idleTimeoutMs });
      }
      if (this.limits.timeoutMs !== undefined && elapsedMs > this.limits.timeoutMs) {
        exceeded.push({ kind: 'timeout', used: elapsedMs, limit: this.limits.timeoutMs });
      }
    }

    if (exceeded.length === 0) return [];

    if (!this._onThreshold) {
      // Hard stop — throw on the first exceeded kind.
      const first = exceeded[0] ?? { kind: 'iterations', limit: 0, used: 0 };
      throw new BudgetExceededError(first.kind, first.limit, first.used);
    }
    if (this._mode === 'sync') {
      // Hard stop in sync mode.
      const first = exceeded[0] ?? { kind: 'iterations', limit: 0, used: 0 };
      throw new BudgetExceededError(first.kind, first.limit, first.used);
    }
    const bus = this._events;
    if (!bus || !bus.hasListenerFor('budget.threshold_reached')) {
      const first = exceeded[0] ?? { kind: 'iterations', limit: 0, used: 0 };
      throw new BudgetExceededError(first.kind, first.limit, first.used);
    }

    // Start a negotiation for each exceeded kind that doesn't already have one.
    // The first exceeded kind throws BudgetThresholdSignal so the caller sees
    // the soft-limit event. Subsequent exceeded kinds (in the same call) start
    // their own negotiations silently — they won't throw again.
    for (const entry of exceeded) {
      if (this._pendingNegotiations.has(entry.kind)) continue; // already negotiating this kind
      const decision = this._negotiateExtension(entry.kind, exceeded);
      this._pendingNegotiations.set(entry.kind, decision);
    }

    const first = exceeded[0] ?? { kind: 'iterations', limit: 0, used: 0 };
    const decision = this._pendingNegotiations.get(first.kind);
    if (!decision) throw new Error(`No pending negotiation for ${first.kind}`);
    throw new BudgetThresholdSignal(first.kind, first.limit, first.used, decision);
  }

  /**
   * Per-kind in-flight negotiation Promises. Each budget kind can have its
   * own concurrent negotiation — e.g. iterations and timeout can both
   * be exceeded simultaneously without blocking each other. The same kind
   * cannot start two concurrent negotiations (dedup guard).
   * Cleared in `_negotiateExtension`'s `finally` block.
   */
  private _pendingNegotiations = new Map<BudgetKind, Promise<BudgetThresholdDecision>>();

  /**
   * Drive the threshold handler to a decision. Resolves with `'stop'`
   * (signal the runner to abort) or `{ extend: ... }` (limits already
   * patched in-place; the runner should not abort). Clears the
   * per-kind slot in `_pendingNegotiations` in `finally`.
   *
   * The 'continue' return from a sync handler is treated as
   * `{ extend: {} }` — keep going without patching; next overrun fires
   * a fresh signal.
   */
  private async _negotiateExtension(
    kind: BudgetKind,
    exceeded: { kind: BudgetKind; used: number; limit: number }[],
  ): Promise<BudgetThresholdDecision> {
    if (!this._onThreshold) {
      // Should never reach here — caller should have thrown already
      return 'stop';
    }
    try {
      // Use the first exceeded kind for the handler call.
      const first = exceeded[0] ?? { kind: 'iterations', limit: 0, used: 0 };
      const result = this._onThreshold({
        kind: first.kind,
        used: first.used,
        limit: first.limit,
        requestDecision: (): Promise<BudgetThresholdDecision> => {
          const bus = this._events;
          if (!bus || !bus.hasListenerFor('budget.threshold_reached')) {
            return Promise.resolve('stop');
          }
          return new Promise<BudgetThresholdDecision>((resolve) => {
            let resolved = false;
            const respond = (d: BudgetThresholdDecision) => {
              if (resolved) return;
              resolved = true;
              resolve(d);
            };
            const fallback = setTimeout(
              () => respond('stop'),
              SubagentBudget.DECISION_TIMEOUT_MS,
            );
            // Emit one event per exceeded kind so the FleetBus routes them.
            for (const { kind, used, limit } of exceeded) {
              bus.emit('budget.threshold_reached', {
                kind: kind as 'iterations' | 'tool_calls' | 'tokens' | 'cost' | 'timeout' | 'idle_timeout',
                used,
                limit,
                timeoutMs: SubagentBudget.DECISION_TIMEOUT_MS,
                extend: (extra: Partial<BudgetLimits>) => {
                  clearTimeout(fallback);
                  respond({ extend: extra });
                },
                deny: () => {
                  clearTimeout(fallback);
                  respond('stop');
                },
              });
            }
          });
        },
      });

      if (result === 'throw') return 'stop';
      if (result === 'continue') return { extend: {} };

      const decision = await result;
      if (decision === 'stop') return 'stop';

      // 'extend' — patch in-place limits BEFORE resolving so the runner's
      // continue path sees the new ceiling.
      const ext = decision.extend;
      if (ext.maxIterations !== undefined) {
        (this.limits as Record<string, unknown>).maxIterations = ext.maxIterations;
      }
      if (ext.maxToolCalls !== undefined) {
        (this.limits as Record<string, unknown>).maxToolCalls = ext.maxToolCalls;
      }
      if (ext.maxTokens !== undefined) {
        (this.limits as Record<string, unknown>).maxTokens = ext.maxTokens;
      }
      if (ext.maxCostUsd !== undefined) {
        (this.limits as Record<string, unknown>).maxCostUsd = ext.maxCostUsd;
      }
      if (ext.timeoutMs !== undefined) {
        (this.limits as Record<string, unknown>).timeoutMs = ext.timeoutMs;
      }
      if (ext.idleTimeoutMs !== undefined) {
        (this.limits as Record<string, unknown>).idleTimeoutMs = ext.idleTimeoutMs;
      }
      return decision;
    } finally {
      this._pendingNegotiations.delete(kind);
    }
  }

  recordIteration(): void {
    this.iterations++;
    this.markActivity();
    void this.checkLimits();
  }

  recordToolCall(): void {
    this.toolCalls++;
    this.markActivity();
    void this.checkLimits();
  }

  recordUsage(usage: Usage, costUsd = 0): void {
    this.tokenInput += usage.input;
    this.tokenOutput += usage.output;
    this.costUsd += costUsd;
    this.markActivity();
    void this.checkLimits();
  }

  /**
   * Wall-clock / idle budget check. Delegates to `checkLimits(elapsed)`, so
   * `timeout` and `idle_timeout` follow the SAME negotiation path as the other
   * kinds — they are NOT a special-cased hard stop. This is deliberate: a
   * heartbeat-aware policy (see `attachAutoExtend` and `CollabSession`) grants
   * a timeout extension only while the agent is making progress and denies it
   * once the agent is genuinely stuck, which is safer than an unconditional
   * hard kill of a long-but-working agent. The runner translates the resulting
   * `BudgetThresholdSignal` decision (`extend` → patch limits in place,
   * `stop` → abort) just like every other kind.
   *
   * Decision table (same as `checkLimits`):
   * - no `onThreshold` handler        → throw `BudgetExceededError` (hard stop)
   * - `mode === 'sync'`               → throw `BudgetExceededError` (hard stop)
   * - `mode === 'auto'` + no listener → throw `BudgetExceededError` (no one to ask)
   * - `mode === 'auto'` + listener    → throw `BudgetThresholdSignal` (negotiated;
   *                                     a heartbeat-aware policy may extend the timeout)
   */
  checkTimeout(): void {
    if (this.startTime === null) return;
    const { timeoutMs, idleTimeoutMs } = this.limits;
    if (timeoutMs === undefined && idleTimeoutMs === undefined) return;
    const elapsed = Date.now() - this.startTime;
    const wallTripped = timeoutMs !== undefined && elapsed > timeoutMs;
    const idleTripped = idleTimeoutMs !== undefined && this.idleMs() > idleTimeoutMs;
    if (!wallTripped && !idleTripped) return;
    void this.checkLimits(elapsed);
  }

  /** Returns true if a wall-clock or idle timeout has occurred without throwing. */
  isTimedOut(): boolean {
    if (this.startTime === null) return false;
    const { timeoutMs, idleTimeoutMs } = this.limits;
    if (timeoutMs !== undefined && Date.now() - this.startTime > timeoutMs) return true;
    if (idleTimeoutMs !== undefined && this.idleMs() > idleTimeoutMs) return true;
    return false;
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
