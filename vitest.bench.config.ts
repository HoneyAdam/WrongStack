import { defineConfig } from 'vitest/config';

/**
 * V0-A: separate config for `vitest bench` so the runner picks up
 * `*.bench.ts` files only when invoked explicitly. Sharing the main
 * `vitest.config.ts` would either (a) run benches during `pnpm test`,
 * skewing wall-clock measurements, or (b) require an `exclude` pattern
 * that drifts every time a new bench file lands. Keeping it separate is
 * the cheap fix.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/bench/**/*.bench.ts', 'packages/**/tests/**/*.bench.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Benches do their own warmup + iterations; the outer test timeout
    // just has to be generous enough for a slow CI worker to finish.
    testTimeout: 60_000,
    benchmark: {
      // JSON output so CI can upload as an artifact and a follow-up
      // workflow can diff against the main-branch baseline.
      outputJson: './bench-results.json',
      reporters: ['default'],
    },
  },
});
