import { describe, expect, it } from 'vitest';
import { computeUsageCost, getCostRates } from '../../src/server/usage-cost.js';

/**
 * Cost math used by `session.start` (rates) and `stats.get` (dollar figure).
 * The per-1M-token scaling and the `?? 0` fallbacks are exactly the kind of
 * thing that silently produces a plausible-but-wrong number, so pin them.
 */

describe('getCostRates', () => {
  it('reads input/output/cache_read into normalized rates', () => {
    expect(getCostRates({ cost: { input: 3, output: 15, cache_read: 0.3 } })).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0.3,
    });
  });

  it('defaults every field to 0 for unpriced / missing models', () => {
    const zero = { input: 0, output: 0, cacheRead: 0 };
    expect(getCostRates({ cost: {} })).toEqual(zero);
    expect(getCostRates({})).toEqual(zero);
    expect(getCostRates(null)).toEqual(zero);
    expect(getCostRates(undefined)).toEqual(zero);
  });

  it('fills only the present fields, zeroing the rest', () => {
    expect(getCostRates({ cost: { input: 2 } })).toEqual({ input: 2, output: 0, cacheRead: 0 });
  });
});

describe('computeUsageCost', () => {
  const rates = { input: 3, output: 15, cacheRead: 0.3 };

  it('scales by per-1M-token rates', () => {
    // 1M input @ $3 + 1M output @ $15 = $18
    expect(computeUsageCost({ input: 1_000_000, output: 1_000_000 }, rates)).toBeCloseTo(18, 9);
  });

  it('includes cache-read tokens', () => {
    // 2M cache-read @ $0.3 = $0.6
    expect(computeUsageCost({ input: 0, output: 0, cacheRead: 2_000_000 }, rates)).toBeCloseTo(
      0.6,
      9,
    );
  });

  it('treats missing cacheRead as zero', () => {
    expect(computeUsageCost({ input: 500_000, output: 0 }, rates)).toBeCloseTo(1.5, 9);
  });

  it('returns 0 for an unpriced plan (all rates 0)', () => {
    expect(
      computeUsageCost(
        { input: 9_999, output: 9_999, cacheRead: 9_999 },
        { input: 0, output: 0, cacheRead: 0 },
      ),
    ).toBe(0);
  });
});
