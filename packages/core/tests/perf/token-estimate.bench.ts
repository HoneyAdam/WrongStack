import { bench, describe } from 'vitest';
import {
  estimateTextTokens,
  estimateToolInputTokens,
  estimateToolResultTokens,
} from '../../src/utils/token-estimate.js';

/**
 * V0-B: token estimation runs on every message during context-window checks.
 * Regressions here multiply across iterations. Sizes chosen to cover the
 * realistic range: a one-line response, a typical tool result, and a worst-
 * case dumped file.
 */

const ONE_LINE = 'hello world how are you doing today?';
const TEN_KB = 'lorem ipsum '.repeat(900); // ~10.8 KB
const HUNDRED_KB = 'lorem ipsum '.repeat(9000);
const ONE_MB = 'lorem ipsum '.repeat(90_000);

const smallToolInput = { query: 'find the bug', filter: { lang: 'ts' } };
const largeToolInput = {
  files: Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`),
  options: { recursive: true, depth: 5, exclude: ['node_modules', 'dist'] },
};

describe('estimateTextTokens', () => {
  bench('one-line (≈40 chars)', () => {
    estimateTextTokens(ONE_LINE);
  });
  bench('10 KB', () => {
    estimateTextTokens(TEN_KB);
  });
  bench('100 KB', () => {
    estimateTextTokens(HUNDRED_KB);
  });
  bench('1 MB', () => {
    estimateTextTokens(ONE_MB);
  });
});

describe('estimateToolInputTokens', () => {
  // Note: this function memoizes on the input object — clone per call so the
  // cache doesn't dominate the second iteration.
  bench('small input (cold)', () => {
    estimateToolInputTokens({ ...smallToolInput });
  });
  bench('large input (cold)', () => {
    estimateToolInputTokens({ ...largeToolInput });
  });
  bench('small input (warm cache)', () => {
    estimateToolInputTokens(smallToolInput);
  });
});

describe('estimateToolResultTokens', () => {
  bench('string result, 10 KB', () => {
    estimateToolResultTokens(TEN_KB);
  });
  bench('object result, 200 entries', () => {
    estimateToolResultTokens({ matches: Array.from({ length: 200 }, (_, i) => `m${i}`) });
  });
});
