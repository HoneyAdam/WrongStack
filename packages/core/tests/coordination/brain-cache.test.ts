import { describe, expect, it, vi } from 'vitest';
import type { BrainArbiter, BrainDecision, BrainDecisionRequest } from '../../src/coordination/brain.js';
import {
  BrainDecisionCache,
  brainCacheKey,
  createCachingBrainArbiter,
} from '../../src/coordination/brain-cache.js';
import { markDecisionTier } from '../../src/coordination/brain-telemetry.js';
import { EventBus } from '../../src/kernel/events.js';

const req = (over: Partial<BrainDecisionRequest> = {}): BrainDecisionRequest => ({
  id: 'r1',
  source: 'director',
  question: 'Extend the budget for subagent-7?',
  risk: 'high',
  fallback: 'deny',
  ...over,
});

/** An arbiter that marks a tier and counts how often it actually ran. */
const tierArbiter = (tier: string, decision: BrainDecision) => {
  const calls = vi.fn();
  const arbiter: BrainArbiter = {
    decide: async (request) => {
      calls();
      markDecisionTier(request, tier as never);
      return decision;
    },
  };
  return { arbiter, calls };
};

describe('brainCacheKey', () => {
  it('collapses id-shaped tokens so the same question about different subjects shares an entry', () => {
    expect(brainCacheKey(req({ question: 'Extend the budget for subagent-7?' }))).toBe(
      brainCacheKey(req({ question: 'Extend the budget for subagent-42?' })),
    );
  });

  it('separates entries whose answer could legitimately differ', () => {
    const base = req();
    expect(brainCacheKey(base)).not.toBe(brainCacheKey(req({ risk: 'low' })));
    expect(brainCacheKey(base)).not.toBe(brainCacheKey(req({ fallback: 'continue' })));
    expect(brainCacheKey(base)).not.toBe(brainCacheKey(req({ source: 'goal' })));
    expect(brainCacheKey(base)).not.toBe(
      brainCacheKey(req({ options: [{ id: 'a', label: 'A' }] })),
    );
  });

  it('is insensitive to option ORDER but not to option membership', () => {
    const a = req({ options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] });
    const b = req({ options: [{ id: 'y', label: 'Y' }, { id: 'x', label: 'X' }] });
    const c = req({ options: [{ id: 'x', label: 'X' }, { id: 'z', label: 'Z' }] });
    expect(brainCacheKey(a)).toBe(brainCacheKey(b));
    expect(brainCacheKey(a)).not.toBe(brainCacheKey(c));
  });
});

describe('BrainDecisionCache', () => {
  const answer: BrainDecision = { type: 'answer', text: 'Extend it.' };

  it('is inert until enabled', () => {
    const cache = new BrainDecisionCache();
    expect(cache.set(req(), answer, 'llm')).toBe(false);
    expect(cache.get(req())).toBeUndefined();
  });

  it('stores provider-backed verdicts and replays them', () => {
    const cache = new BrainDecisionCache({ enabled: true });
    expect(cache.set(req(), answer, 'council')).toBe(true);
    expect(cache.get(req({ id: 'r2' }))).toEqual(answer);
    expect(cache.snapshot()).toMatchObject({ hits: 1, stores: 1 });
  });

  it('never caches a deterministic tier — recomputing it is already free', () => {
    const cache = new BrainDecisionCache({ enabled: true });
    for (const tier of ['rule', 'policy', 'heuristic', 'ledger-guard', 'terminal', undefined]) {
      expect(cache.set(req(), answer, tier)).toBe(false);
    }
  });

  it('never caches ask_human — it is a request for input, not a verdict', () => {
    const cache = new BrainDecisionCache({ enabled: true });
    expect(cache.set(req(), { type: 'ask_human', prompt: 'help' }, 'llm')).toBe(false);
  });

  it('expires entries on the TTL', () => {
    let now = 0;
    const cache = new BrainDecisionCache({ enabled: true, ttlMs: 1_000, now: () => now });
    cache.set(req(), answer, 'llm');

    now = 999;
    expect(cache.get(req({ id: 'r2' }))).toEqual(answer);
    now = 1_001;
    expect(cache.get(req({ id: 'r3' }))).toBeUndefined();
  });

  it('evicts the oldest entry past maxEntries', () => {
    const cache = new BrainDecisionCache({ enabled: true, maxEntries: 2 });
    cache.set(req({ question: 'q one' }), answer, 'llm');
    cache.set(req({ question: 'q two' }), answer, 'llm');
    cache.set(req({ question: 'q three' }), answer, 'llm');

    expect(cache.snapshot().size).toBe(2);
    expect(cache.get(req({ id: 'x', question: 'q one' }))).toBeUndefined();
    expect(cache.get(req({ id: 'y', question: 'q three' }))).toEqual(answer);
  });

  it('drops a cached decision the ledger later observes to have FAILED', () => {
    const events = new EventBus();
    const cache = new BrainDecisionCache({ enabled: true, events });
    cache.start();

    const request = req();
    cache.set(request, answer, 'llm');
    expect(cache.get(req({ id: 'r2' }))).toEqual(answer);

    // This is what stops the cache cementing a bad call.
    events.emit('brain.outcome', { requestId: request.id, outcome: 'failure', at: 1 });
    expect(cache.get(req({ id: 'r3' }))).toBeUndefined();
    cache.stop();
  });

  it('keeps a cached decision whose outcome was a success', () => {
    const events = new EventBus();
    const cache = new BrainDecisionCache({ enabled: true, events });
    cache.start();

    const request = req();
    cache.set(request, answer, 'llm');
    events.emit('brain.outcome', { requestId: request.id, outcome: 'success', at: 1 });
    expect(cache.get(req({ id: 'r2' }))).toEqual(answer);
    cache.stop();
  });

  it('evicts via a request id that was SERVED from the entry, not only the one that stored it', () => {
    const events = new EventBus();
    const cache = new BrainDecisionCache({ enabled: true, events });
    cache.start();

    cache.set(req({ id: 'origin' }), answer, 'llm');
    expect(cache.get(req({ id: 'served' }))).toEqual(answer);

    // The failure is observed against the REPLAYED decision's request id.
    events.emit('brain.outcome', { requestId: 'served', outcome: 'failure', at: 1 });
    expect(cache.get(req({ id: 'next' }))).toBeUndefined();
    cache.stop();
  });
});

describe('createCachingBrainArbiter', () => {
  const answer: BrainDecision = { type: 'answer', text: 'Extend it.' };

  it('skips the inner chain on a repeated question and marks the cache tier', async () => {
    const { arbiter: inner, calls } = tierArbiter('llm', answer);
    const cache = new BrainDecisionCache({ enabled: true });
    const cached = createCachingBrainArbiter({ inner, cache });

    expect(await cached.decide(req())).toEqual(answer);
    expect(calls).toHaveBeenCalledTimes(1);

    const second = req({ id: 'r2' });
    expect(await cached.decide(second)).toEqual(answer);
    // The provider tier was NOT consulted again — that is the whole point.
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('always re-runs a deterministic inner decision', async () => {
    const { arbiter: inner, calls } = tierArbiter('rule', answer);
    const cache = new BrainDecisionCache({ enabled: true });
    const cached = createCachingBrainArbiter({ inner, cache });

    await cached.decide(req());
    await cached.decide(req({ id: 'r2' }));
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it('caches a council DENY as readily as an answer', async () => {
    const deny: BrainDecision = { type: 'deny', reason: 'Council vetoes' };
    const { arbiter: inner, calls } = tierArbiter('council', deny);
    const cache = new BrainDecisionCache({ enabled: true });
    const cached = createCachingBrainArbiter({ inner, cache });

    expect(await cached.decide(req())).toEqual(deny);
    expect(await cached.decide(req({ id: 'r2' }))).toEqual(deny);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
