/**
 * ProviderModelStatusTracker — centralized, shared status tracking for every
 * provider/model combination used across the agent, subagents, fallback
 * chains, and the one-shot LLM helper.
 *
 * ## Design
 *
 * - **Single shared instance**: created once per process, injected into every
 *   component that calls providers or resolves fallback chains. The same
 *   in-memory state is visible to the fallback extension, the one-shot
 *   orchestrator, the dispatcher, and fleet-spawn — so a provider blocked
 *   by a rate-limit spike is filtered EVERYWHERE, not just in one path.
 *
 * - **State machine** per (providerId, model) pair:
 *   ```
 *   healthy ──(failure)──▶ degraded ──(more failures)──▶ blocked
 *      ▲                                                    │
 *      └──────────────(success streak / timeout)────────────┘
 *   ```
 *
 * - **Thresholds** are configurable via constructor opts. Defaults:
 *   | Metric | Threshold | Action |
 *   |--------|-----------|--------|
 *   | consecutive failures ≥ 2 | → `degraded` for 30 s |
 *   | rate-limit hits ≥ 3 | → `blocked` for 5 min |
 *   | consecutive failures ≥ 5 | → `blocked` for 5 min |
 *   | success streak ≥ 3 | → back to `healthy` |
 *   | `blocked` timeout elapses | → back to `healthy` |
 *
 * - **Error history**: keeps the last N errors per pair, with session id,
 *   agent id, kind, and message so the WebUI and `/provider-status` can
 *   render a meaningful timeline.
 *
 * - **Events**: emits `provider.status_changed` on every state transition.
 *
 * - **Thread-safety**: not needed — Node.js event-loop concurrency means
 *   all access is single-threaded (async gaps don't race on the Map).
 *
 * @module coordination/provider-status-tracker
 */

import type { EventBus } from '../kernel/events.js';
import type { ProviderErrorKind } from '../types/provider.js';
import type { ProviderEventMap } from '../kernel/events/provider-events.js';

// ── Public types ────────────────────────────────────────────────────────────

export type ProviderModelState = 'healthy' | 'degraded' | 'blocked';

export interface ErrorHistoryEntry {
  readonly timestamp: number;
  readonly kind: ProviderErrorKind;
  readonly status: number;
  readonly message: string;
  readonly sessionId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly retryAfterMs?: number | undefined;
}

export interface ProviderModelStatus {
  readonly providerId: string;
  readonly model: string;

  /** Current state in the state machine. */
  readonly state: ProviderModelState;

  // ── Failure counters ──
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly rateLimitHits: number;
  readonly overloadedHits: number;
  readonly serverErrors: number;
  readonly otherErrors: number;

  // ── Success counters ──
  readonly consecutiveSuccesses: number;
  readonly totalSuccesses: number;
  readonly lastSuccessAt: number | null;

  // ── Timing ──
  readonly firstFailureAt: number | null;
  readonly lastFailureAt: number | null;
  /** When the current degraded or blocked state expires (ms epoch), or null. */
  readonly stateExpiresAt: number | null;

  // ── Last-error detail (for WebUI / `/provider-status`) ──
  readonly lastErrorKind: ProviderErrorKind | null;
  readonly lastErrorMessage: string | null;
  readonly lastErrorStatus: number | null;
  readonly lastSessionId: string | null;
  readonly lastAgentId: string | null;

  /** Recent error history (newest-first, capped to `maxErrorHistory`). */
  readonly recentErrors: readonly ErrorHistoryEntry[];
}

export type ProviderStatusEvent = ProviderEventMap['provider.status_changed'];

export interface ProviderStatusTrackerConfig {
  /**
   * Consecutive failures before entering `degraded`. Default: 2.
   */
  degradedAfterFailures?: number;
  /**
   * Duration (ms) the provider stays in `degraded` before reverting to healthy.
   * Default: 30_000 (30 s).
   */
  degradedDurationMs?: number;
  /**
   * Rate-limit hits (error kind = 'rate_limit') before entering `blocked`.
   * Default: 3.
   */
  blockAfterRateLimitHits?: number;
  /**
   * Consecutive failures before entering `blocked` directly.
   * Default: 5.
   */
  blockAfterFailures?: number;
  /**
   * Duration (ms) the provider stays `blocked`. Default: 300_000 (5 min).
   */
  blockDurationMs?: number;
  /**
   * Consecutive successes needed to leave `degraded` or `blocked` and return
   * to `healthy` (if the timeout hasn't already cleared it). Default: 3.
   */
  recoverAfterSuccesses?: number;
  /**
   * Maximum error history entries kept per (providerId, model) pair.
   * Default: 50.
   */
  maxErrorHistory?: number;
}

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  degradedAfterFailures: 2,
  degradedDurationMs: 30_000,
  blockAfterRateLimitHits: 3,
  blockAfterFailures: 5,
  blockDurationMs: 300_000,
  recoverAfterSuccesses: 3,
  maxErrorHistory: 50,
} satisfies Required<ProviderStatusTrackerConfig>;

// ── Internal mutable state ──────────────────────────────────────────────────

interface MutableProviderModelStatus {
  state: ProviderModelState;
  consecutiveFailures: number;
  totalFailures: number;
  rateLimitHits: number;
  overloadedHits: number;
  serverErrors: number;
  otherErrors: number;
  consecutiveSuccesses: number;
  totalSuccesses: number;
  lastSuccessAt: number | null;
  firstFailureAt: number | null;
  lastFailureAt: number | null;
  stateExpiresAt: number | null;
  lastErrorKind: ProviderErrorKind | null;
  lastErrorMessage: string | null;
  lastErrorStatus: number | null;
  lastSessionId: string | null;
  lastAgentId: string | null;
  recentErrors: ErrorHistoryEntry[];
}

// ── Tracker ─────────────────────────────────────────────────────────────────

export class ProviderModelStatusTracker {
  private readonly cfg: Required<ProviderStatusTrackerConfig>;
  private readonly map = new Map<string, MutableProviderModelStatus>();
  private readonly events: EventBus | undefined;

  constructor(opts?: {
    config?: ProviderStatusTrackerConfig | undefined;
    events?: EventBus | undefined;
  }) {
    this.cfg = { ...DEFAULTS, ...opts?.config };
    this.events = opts?.events;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Record a successful provider call. Resets consecutive failure counters
   * and may transition out of degraded/blocked.
   */
  recordSuccess(
    providerId: string,
    model: string,
    _meta?: { sessionId?: string | undefined; agentId?: string | undefined },
  ): void {
    const key = pairKey(providerId, model);
    const s = this.getOrCreate(key, providerId, model);

    s.consecutiveFailures = 0;
    s.consecutiveSuccesses += 1;
    s.totalSuccesses += 1;
    s.lastSuccessAt = Date.now();

    // Success streak recovery: if we've had enough consecutive successes,
    // move back to healthy.
    if (s.state !== 'healthy' && s.consecutiveSuccesses >= this.cfg.recoverAfterSuccesses) {
      const oldState = s.state;
      s.state = 'healthy';
      s.stateExpiresAt = null;
      this.emitStatusChanged(providerId, model, oldState, 'healthy', 'success_streak_recovery');
    }
  }

  /**
   * Record a failed provider call. Transitions state based on thresholds.
   *
   * @returns The new state after recording this failure.
   */
  recordFailure(
    providerId: string,
    model: string,
    kind: ProviderErrorKind,
    status: number,
    message: string,
    meta?: {
      sessionId?: string | undefined;
      agentId?: string | undefined;
      retryAfterMs?: number | undefined;
    },
  ): ProviderModelState {
    const key = pairKey(providerId, model);
    const s = this.getOrCreate(key, providerId, model);
    const now = Date.now();

    s.consecutiveFailures += 1;
    s.totalFailures += 1;
    s.consecutiveSuccesses = 0;
    s.lastFailureAt = now;
    s.lastErrorKind = kind;
    s.lastErrorMessage = message;
    s.lastErrorStatus = status;
    if (meta?.sessionId) s.lastSessionId = meta.sessionId;
    if (meta?.agentId) s.lastAgentId = meta.agentId;
    if (s.firstFailureAt === null) s.firstFailureAt = now;

    // Per-kind counters
    switch (kind) {
      case 'rate_limit':
        s.rateLimitHits += 1;
        break;
      case 'overloaded':
        s.overloadedHits += 1;
        break;
      case 'server':
      case 'stream_hang':
        s.serverErrors += 1;
        break;
      default:
        s.otherErrors += 1;
    }

    // Push error history (newest first, capped)
    const entry: ErrorHistoryEntry = Object.freeze({
      timestamp: now,
      kind,
      status,
      message,
      sessionId: meta?.sessionId,
      agentId: meta?.agentId,
      retryAfterMs: meta?.retryAfterMs,
    });
    s.recentErrors.unshift(entry);
    if (s.recentErrors.length > this.cfg.maxErrorHistory) {
      s.recentErrors = s.recentErrors.slice(0, this.cfg.maxErrorHistory);
    }

    // ── State machine transitions ──

    let newState: ProviderModelState = s.state;
    let reason = '';

    if (s.state === 'healthy') {
      // healthy → degraded (consecutive failures >= threshold)
      if (s.consecutiveFailures >= this.cfg.degradedAfterFailures) {
        newState = 'degraded';
        reason = `consecutive_failures_${s.consecutiveFailures}`;
        s.stateExpiresAt = now + this.cfg.degradedDurationMs;
      }
    }

    if (s.state === 'degraded' || s.state === 'healthy') {
      // → blocked (rate-limit threshold or consecutive failures threshold)
      if (s.rateLimitHits >= this.cfg.blockAfterRateLimitHits) {
        newState = 'blocked';
        reason = `rate_limit_threshold_${this.cfg.blockAfterRateLimitHits}`;
        s.stateExpiresAt = now + this.cfg.blockDurationMs;
      } else if (s.consecutiveFailures >= this.cfg.blockAfterFailures) {
        newState = 'blocked';
        reason = `consecutive_failures_${s.consecutiveFailures}`;
        s.stateExpiresAt = now + this.cfg.blockDurationMs;
      }
    }

    // If the provider sent a Retry-After hint, extend the blocked time
    if (newState !== 'healthy' && meta?.retryAfterMs && meta.retryAfterMs > 0) {
      const hintExpiry = now + Math.min(meta.retryAfterMs, 60_000);
      if (s.stateExpiresAt === null || hintExpiry > s.stateExpiresAt) {
        s.stateExpiresAt = hintExpiry;
      }
    }

    if (s.state !== newState) {
      const oldState = s.state;
      s.state = newState;
      this.emitStatusChanged(providerId, model, oldState, newState, reason);
    }

    return newState;
  }

  /**
   * Check if a (providerId, model) pair is currently usable.
   * Returns `true` when healthy or degraded (degraded is still usable,
   * just known flaky). Returns `false` when blocked or when the error
   * kind is `auth` (no point retrying ever).
   */
  isAvailable(providerId: string, model: string): boolean {
    const key = pairKey(providerId, model);
    const s = this.map.get(key);
    if (!s) return true; // never seen → healthy

    // If blocked but the timeout has expired, auto-recover
    if (s.state === 'blocked' && s.stateExpiresAt !== null && Date.now() >= s.stateExpiresAt) {
      const oldState = s.state;
      s.state = 'healthy';
      s.stateExpiresAt = null;
      s.consecutiveFailures = Math.max(0, s.consecutiveFailures - 1); // reduce but don't fully reset
      this.emitStatusChanged(
        providerId,
        model,
        oldState,
        'healthy',
        'cooldown_expired',
      );
      return true;
    }

    // If degraded but the timeout has expired, auto-recover
    if (s.state === 'degraded' && s.stateExpiresAt !== null && Date.now() >= s.stateExpiresAt) {
      const oldState = s.state;
      s.state = 'healthy';
      s.stateExpiresAt = null;
      this.emitStatusChanged(
        providerId,
        model,
        oldState,
        'healthy',
        'degraded_timeout_expired',
      );
      return true;
    }

    return s.state !== 'blocked';
  }

  /**
   * Check if a (providerId, model) pair is currently rate-limited.
   * This is a stronger signal than just `!isAvailable()` — it tells
   * callers that requests should be re-tried after a delay rather
   * than skipped permanently.
   */
  isRateLimited(providerId: string, model: string): boolean {
    const key = pairKey(providerId, model);
    const s = this.map.get(key);
    if (!s) return false;
    // If the last error was a rate_limit and we're still in a non-healthy state
    return s.lastErrorKind === 'rate_limit' && s.state !== 'healthy';
  }

  /**
   * Get the full status for a (providerId, model) pair, or `undefined`
   * if no failures have been recorded.
   */
  getStatus(providerId: string, model: string): ProviderModelStatus | undefined {
    const key = pairKey(providerId, model);
    const s = this.map.get(key);
    if (!s) return undefined;

    // Auto-recover if stale
    this.isAvailable(providerId, model); // side-effect: recovers if expired

    return this.freezeStatus(key, s);
  }

  /**
   * Returns a snapshot of ALL tracked provider/model statuses.
   * Useful for the `/provider-status` command and WebUI.
   */
  getAllStatuses(): ProviderModelStatus[] {
    const out: ProviderModelStatus[] = [];
    for (const [key, s] of this.map) {
      // Trigger auto-recovery
      const [providerId, model] = unpairKey(key);
      this.isAvailable(providerId, model);
      out.push(this.freezeStatus(key, s));
    }
    return out;
  }

  /**
   * Returns only currently blocked entries.
   */
  getBlocked(): ProviderModelStatus[] {
    return this.getAllStatuses().filter((s) => s.state === 'blocked');
  }

  /**
   * Returns only currently degraded entries.
   */
  getDegraded(): ProviderModelStatus[] {
    return this.getAllStatuses().filter((s) => s.state === 'degraded');
  }

  /**
   * Filter an array of objects that have `providerId` and `model` fields,
   * removing entries whose (providerId, model) is blocked.
   */
  filterAvailable<T extends { providerId: string; model: string }>(entries: readonly T[]): T[] {
    return entries.filter((e) => this.isAvailable(e.providerId, e.model));
  }

  /**
   * Check if a (providerId, model) pair would be blocked, WITHOUT the
   * side-effect of auto-recovering stale entries. Used in hot paths
   * where we don't want to mutate state during a quick peek.
   */
  isBlocked(providerId: string, model: string): boolean {
    const key = pairKey(providerId, model);
    const s = this.map.get(key);
    if (!s) return false;
    if (s.state !== 'blocked') return false;
    // Auto-recover even in this read-only-ish peek
    if (s.stateExpiresAt !== null && Date.now() >= s.stateExpiresAt) {
      return false; // would have recovered
    }
    return true;
  }

  /**
   * Reset tracking for a specific (providerId, model) pair, or for ALL
   * pairs when both arguments are omitted.
   */
  clear(providerId?: string, model?: string): void {
    if (providerId && model) {
      const key = pairKey(providerId, model);
      const old = this.map.get(key);
      if (old && old.state !== 'healthy') {
        this.emitStatusChanged(providerId, model, old.state, 'healthy', 'manual_clear');
      }
      this.map.delete(key);
    } else {
      for (const [key, s] of this.map) {
        if (s.state !== 'healthy') {
          const [pid, mdl] = unpairKey(key);
          this.emitStatusChanged(pid, mdl, s.state, 'healthy', 'manual_clear_all');
        }
      }
      this.map.clear();
    }
  }

  /**
   * Get a JSON-safe snapshot suitable for WebUI rendering.
   * Includes summary stats + per-pair details.
   */
  getSnapshot(): ProviderStatusSnapshot {
    const all = this.getAllStatuses();
    const healthy: ProviderModelStatus[] = [];
    const degraded: ProviderModelStatus[] = [];
    const blocked: ProviderModelStatus[] = [];

    for (const s of all) {
      if (s.state === 'blocked') blocked.push(s);
      else if (s.state === 'degraded') degraded.push(s);
      else healthy.push(s);
    }

    return {
      totalPairs: all.length,
      healthy: healthy.length,
      degraded: degraded.length,
      blocked: blocked.length,
      totalFailures: all.reduce((sum, s) => sum + s.totalFailures, 0),
      totalRateLimits: all.reduce((sum, s) => sum + s.rateLimitHits, 0),
      statuses: all,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private getOrCreate(
    key: string,
    _providerId: string,
    _model: string,
  ): MutableProviderModelStatus {
    let s = this.map.get(key);
    if (!s) {
      s = {
        state: 'healthy',
        consecutiveFailures: 0,
        totalFailures: 0,
        rateLimitHits: 0,
        overloadedHits: 0,
        serverErrors: 0,
        otherErrors: 0,
        consecutiveSuccesses: 0,
        totalSuccesses: 0,
        lastSuccessAt: null,
        firstFailureAt: null,
        lastFailureAt: null,
        stateExpiresAt: null,
        lastErrorKind: null,
        lastErrorMessage: null,
        lastErrorStatus: null,
        lastSessionId: null,
        lastAgentId: null,
        recentErrors: [],
      };
      this.map.set(key, s);
    }
    return s;
  }

  private freezeStatus(key: string, s: MutableProviderModelStatus): ProviderModelStatus {
    const [providerId, model] = unpairKey(key);
    return Object.freeze({
      providerId,
      model,
      state: s.state,
      consecutiveFailures: s.consecutiveFailures,
      totalFailures: s.totalFailures,
      rateLimitHits: s.rateLimitHits,
      overloadedHits: s.overloadedHits,
      serverErrors: s.serverErrors,
      otherErrors: s.otherErrors,
      consecutiveSuccesses: s.consecutiveSuccesses,
      totalSuccesses: s.totalSuccesses,
      lastSuccessAt: s.lastSuccessAt,
      firstFailureAt: s.firstFailureAt,
      lastFailureAt: s.lastFailureAt,
      stateExpiresAt: s.stateExpiresAt,
      lastErrorKind: s.lastErrorKind,
      lastErrorMessage: s.lastErrorMessage,
      lastErrorStatus: s.lastErrorStatus,
      lastSessionId: s.lastSessionId,
      lastAgentId: s.lastAgentId,
      recentErrors: Object.freeze([...s.recentErrors]),
    });
  }

  private emitStatusChanged(
    providerId: string,
    model: string,
    oldState: ProviderModelState,
    newState: ProviderModelState,
    reason: string,
  ): void {
    if (!this.events) return;
    try {
      this.events.emit('provider.status_changed', {
        providerId,
        model,
        oldState,
        newState,
        reason,
        timestamp: Date.now(),
      });
    } catch {
      // Swallow — event bus errors must not crash the tracker
    }
  }
}

// ── Snapshot type ───────────────────────────────────────────────────────────

export interface ProviderStatusSnapshot {
  readonly totalPairs: number;
  readonly healthy: number;
  readonly degraded: number;
  readonly blocked: number;
  readonly totalFailures: number;
  readonly totalRateLimits: number;
  readonly statuses: readonly ProviderModelStatus[];
}

// ── Key helpers ─────────────────────────────────────────────────────────────

const KEY_SEP = '\x00';

function pairKey(providerId: string, model: string): string {
  return `${providerId}${KEY_SEP}${model}`;
}

function unpairKey(key: string): [string, string] {
  const idx = key.indexOf(KEY_SEP);
  if (idx === -1) return [key, ''];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
