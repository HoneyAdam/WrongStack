import { bench, describe } from 'vitest';

/**
 * V0-A: harness smoke test. Two tiny benches that always pass — their job
 * is to verify `pnpm bench` discovers `*.bench.ts` files and that the
 * `vitest bench` reporter produces JSON output. Real perf coverage lives
 * in the V0-B bench suite.
 */
describe('bench harness smoke', () => {
  bench('Array.from(1..1000) sum', () => {
    let total = 0;
    for (let i = 1; i <= 1000; i++) total += i;
    return total;
  });

  bench('Map roundtrip (100 keys)', () => {
    const m = new Map<number, number>();
    for (let i = 0; i < 100; i++) m.set(i, i * 2);
    let s = 0;
    for (const v of m.values()) s += v;
    return s;
  });
});
