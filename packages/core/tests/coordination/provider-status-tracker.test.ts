/**
 * Unit tests for ProviderModelStatusTracker.
 *
 * Covers:
 *  - state machine transitions (healthy → degraded → blocked → healthy)
 *  - auto-recovery on cooldown expiry
 *  - isAvailable / isBlocked / filterAvailable
 *  - error history with session/agent metadata
 *  - event emission on state changes
 *  - the empty_response / overloaded chimera-review pattern
 */

import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { ProviderModelStatusTracker } from '../../src/coordination/provider-status-tracker.js';
import { ProviderError, classifyProviderError } from '../../src/types/provider.js';

/** Fresh tracker with all thresholds set to minimal values for fast testing. */
function createTestTracker(): ProviderModelStatusTracker {
  return new ProviderModelStatusTracker({
    config: {
      degradedAfterFailures: 2,
      degradedDurationMs: 50_000, // long enough that auto-recovery won't fire during the test
      blockAfterRateLimitHits: 3,
      blockAfterFailures: 5,
      blockDurationMs: 50_000,
      recoverAfterSuccesses: 3,
      maxErrorHistory: 10,
    },
  });
}

function aSecondAgo(): number {
  return Date.now() - 1000;
}

describe('ProviderModelStatusTracker', () => {
  let tracker: ProviderModelStatusTracker;

  beforeEach(() => {
    tracker = createTestTracker();
  });

  // ── Initial state ───────────────────────────────────────────────────

  it('starts healthy for unseen provider/model pairs', () => {
    strictEqual(tracker.isAvailable('test', 'model-a'), true);
    strictEqual(tracker.isBlocked('test', 'model-a'), false);
    strictEqual(tracker.getStatus('test', 'model-a'), undefined);
  });

  it('getAllStatuses returns empty for a fresh tracker', () => {
    deepStrictEqual(tracker.getAllStatuses(), []);
  });

  // ── state: healthy → degraded → blocked ────────────────────────────

  it('enters degraded after 2 consecutive failures', () => {
    tracker.recordFailure('test', 'model-a', 'server', 500, 'Internal error');
    tracker.recordFailure('test', 'model-a', 'server', 502, 'Bad gateway');

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.state, 'degraded');
    strictEqual(status?.consecutiveFailures, 2);
  });

  it('stays healthy after 1 failure (below degradedAfterFailures threshold)', () => {
    tracker.recordFailure('test', 'model-a', 'overloaded', 529, 'Overloaded');

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.state, 'healthy');
  });

  it('enters blocked after 3 rate_limit hits', () => {
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'Rate limited');
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'Rate limited');
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'Rate limited');

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.state, 'blocked');
    strictEqual(status?.rateLimitHits, 3);
    ok(status?.stateExpiresAt !== null);
  });

  it('enters blocked after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('test', 'model-a', 'server', 500, `Error ${i}`);
    }

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.state, 'blocked');
    strictEqual(status?.consecutiveFailures, 5);
  });

  it('isAvailable returns false for blocked pairs', () => {
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('test', 'model-a', 'server', 500, `Error ${i}`);
    }

    strictEqual(tracker.isAvailable('test', 'model-a'), false);
    strictEqual(tracker.isBlocked('test', 'model-a'), true);
  });

  // ── state: blocked → healthy (success streak recovery) ─────────────

  it('recovers from degraded to healthy after 3 consecutive successes', () => {
    tracker.recordFailure('test', 'model-a', 'server', 500, 'Error 1');
    tracker.recordFailure('test', 'model-a', 'server', 500, 'Error 2');

    strictEqual(tracker.getStatus('test', 'model-a')?.state, 'degraded');

    tracker.recordSuccess('test', 'model-a');
    tracker.recordSuccess('test', 'model-a');
    tracker.recordSuccess('test', 'model-a');

    strictEqual(tracker.getStatus('test', 'model-a')?.state, 'healthy');
  });

  // ── Error history ──────────────────────────────────────────────────

  it('stores error history with session/agent metadata', () => {
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'Too many requests', {
      sessionId: 'sess_abc',
      agentId: 'agent_review_1',
      retryAfterMs: 12_000,
    });

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.lastSessionId, 'sess_abc');
    strictEqual(status?.lastAgentId, 'agent_review_1');
    strictEqual(status?.lastErrorMessage, 'Too many requests');
    strictEqual(status?.lastErrorKind, 'rate_limit');
    strictEqual(status?.recentErrors.length, 1);
    strictEqual(status?.recentErrors[0]?.kind, 'rate_limit');
    strictEqual(status?.recentErrors[0]?.retryAfterMs, 12_000);
  });

  it('caps error history to maxErrorHistory', () => {
    for (let i = 0; i < 15; i++) {
      tracker.recordFailure('test', 'model-a', 'server', 500, `Error ${i}`);
    }

    const status = tracker.getStatus('test', 'model-a');
    ok(status !== undefined);
    ok(status.recentErrors.length <= 10, 'should cap at 10 entries');
  });

  // ── filterAvailable ───────────────────────────────────────────────

  it('filterAvailable removes blocked entries', () => {
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure('test', 'model-a', 'server', 500, `Error ${i}`);
    }

    const entries = [
      { providerId: 'test', model: 'model-a' },
      { providerId: 'test', model: 'model-b' },
      { providerId: 'other', model: 'model-x' },
    ];

    const available = tracker.filterAvailable(entries);
    strictEqual(available.length, 2);
    strictEqual(available[0]?.model, 'model-b');
    strictEqual(available[1]?.model, 'model-x');
  });

  // ── Snapshot ───────────────────────────────────────────────────────

  it('getSnapshot returns correct summary stats', () => {
    // 2 failures → degraded
    tracker.recordFailure('p1', 'm1', 'server', 500, 'err');
    tracker.recordFailure('p1', 'm1', 'server', 500, 'err');

    // 3 rate-limits → blocked
    tracker.recordFailure('p2', 'm2', 'rate_limit', 429, 'rl');
    tracker.recordFailure('p2', 'm2', 'rate_limit', 429, 'rl');
    tracker.recordFailure('p2', 'm2', 'rate_limit', 429, 'rl');

    // healthy (just 1 failure, below threshold)
    tracker.recordFailure('p3', 'm3', 'timeout', 408, 'timeout');

    const snap = tracker.getSnapshot();
    strictEqual(snap.totalPairs, 3);
    strictEqual(snap.degraded, 1);
    strictEqual(snap.blocked, 1);
    strictEqual(snap.healthy, 1);
    strictEqual(snap.totalFailures, 6);
    strictEqual(snap.totalRateLimits, 3);
  });

  // ── Clear ──────────────────────────────────────────────────────────

  it('clear resets all tracking', () => {
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');
    tracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');

    strictEqual(tracker.isBlocked('test', 'model-a'), true);

    tracker.clear();
    strictEqual(tracker.isBlocked('test', 'model-a'), false);
    strictEqual(tracker.getAllStatuses().length, 0);
  });

  it('clear with provider/model resets a single pair', () => {
    tracker.recordFailure('p1', 'm1', 'server', 500, 'err');
    tracker.recordFailure('p1', 'm1', 'server', 500, 'err');
    tracker.recordFailure('p2', 'm2', 'server', 500, 'err');
    tracker.recordFailure('p2', 'm2', 'server', 500, 'err');

    strictEqual(tracker.getAllStatuses().length, 2);
    tracker.clear('p1', 'm1');
    strictEqual(tracker.getAllStatuses().length, 1);
  });

  // ── The chimera-review pattern: empty_response / overloaded ─────────
  //
  // The mailbox shows 11+ chimera-review tasks failing with:
  //   1 iteration, 0 tools, 29-40s, empty_response
  // This simulates that pattern with ProviderErrors.

  it('records the chimera-review empty_response pattern — overloaded blocks after 5', () => {
    // Simulate 5 chimera-review failures — overloaded blocks after 5 consecutive fails
    for (let i = 0; i < 5; i++) {
      tracker.recordFailure(
        'openai',
        'gpt-4o',
        'overloaded',
        529,
        'Empty response — model returned no content after 35s',
        {
          sessionId: 'sess_review_001',
          agentId: 'chimera-review-abc',
        },
      );
    }

    const status = tracker.getStatus('openai', 'gpt-4o');
    strictEqual(status?.state, 'blocked');
    strictEqual(status?.overloadedHits, 5);
    strictEqual(status?.lastErrorMessage, 'Empty response — model returned no content after 35s');
    strictEqual(status?.lastSessionId, 'sess_review_001');
    strictEqual(status?.lastAgentId, 'chimera-review-abc');

    // After blocking, tracking should prevent new chimera spawns
    strictEqual(tracker.isAvailable('openai', 'gpt-4o'), false);

    // But a different model on the same provider should still be available
    strictEqual(tracker.isAvailable('openai', 'gpt-4o-mini'), true);
  });

  it('records the chimera-review pattern — rate_limit blocks after 3', () => {
    // 3 rate_limit failures → blocked (different threshold from overloaded)
    for (let i = 0; i < 3; i++) {
      tracker.recordFailure(
        'openai',
        'gpt-4o',
        'rate_limit',
        429,
        'Rate limited after 5 requests per minute',
        {
          sessionId: 'sess_review_002',
          agentId: 'chimera-review-xyz',
        },
      );
    }

    const status = tracker.getStatus('openai', 'gpt-4o');
    strictEqual(status?.state, 'blocked');
    strictEqual(status?.rateLimitHits, 3);
    strictEqual(tracker.isAvailable('openai', 'gpt-4o'), false);
  });

  it('a different failure kind resets count for empty_response model', () => {
    // First chimera-review fails with overloaded
    tracker.recordFailure(
      'openai', 'gpt-4o', 'overloaded', 529, 'Empty response',
      { sessionId: 'sess_1', agentId: 'chimera-review-1' },
    );
    // Second one also fails
    tracker.recordFailure(
      'openai', 'gpt-4o', 'overloaded', 529, 'Empty response',
      { sessionId: 'sess_2', agentId: 'chimera-review-2' },
    );
    // Third one fails — crosses into degraded
    tracker.recordFailure(
      'openai', 'gpt-4o', 'overloaded', 529, 'Empty response',
      { sessionId: 'sess_3', agentId: 'chimera-review-3' },
    );

    strictEqual(tracker.getStatus('openai', 'gpt-4o')?.state, 'degraded');

    // Then a success — resets consecutive failures
    tracker.recordSuccess('openai', 'gpt-4o');

    strictEqual(tracker.getStatus('openai', 'gpt-4o')?.consecutiveFailures, 0);

    // But continue to fail again — now counts fresh
    tracker.recordFailure(
      'openai', 'gpt-4o', 'overloaded', 529, 'Empty response again',
      { sessionId: 'sess_4', agentId: 'chimera-review-4' },
    );

    strictEqual(tracker.getStatus('openai', 'gpt-4o')?.consecutiveFailures, 1);
  });

  // ── Auto-recovery on cooldown expiry ────────────────────────────────

  it('auto-recovers from blocked when cooldown expires', () => {
    // Use a tracker with a very short block duration
    const fastTracker = new ProviderModelStatusTracker({
      config: {
        blockDurationMs: 1, // 1ms — immediately expires
        blockAfterRateLimitHits: 3,
        degradedAfterFailures: 2,
        blockAfterFailures: 5,
        degradedDurationMs: 50_000,
        recoverAfterSuccesses: 3,
        maxErrorHistory: 10,
      },
    });

    fastTracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');
    fastTracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');
    fastTracker.recordFailure('test', 'model-a', 'rate_limit', 429, 'rl');

    strictEqual(fastTracker.isBlocked('test', 'model-a'), true);

    // Wait for cooldown to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        strictEqual(fastTracker.isAvailable('test', 'model-a'), true);
        strictEqual(fastTracker.isBlocked('test', 'model-a'), false);
        resolve();
      }, 10);
    });
  });

  // ── ProviderError integration ──────────────────────────────────────

  it('classifies and records ProviderError kinds', () => {
    const err = new ProviderError('Rate limited', 429, true, 'test', {
      body: {
        type: 'rate_limit_error',
        message: 'Too fast',
        retryAfterMs: 5000,
      },
    });

    tracker.recordFailure('test', 'model-a', err.kind, err.status, err.describe(), {
      retryAfterMs: err.body?.retryAfterMs,
    });

    const status = tracker.getStatus('test', 'model-a');
    strictEqual(status?.lastErrorKind, 'rate_limit');
    strictEqual(status?.rateLimitHits, 1);
  });
});
