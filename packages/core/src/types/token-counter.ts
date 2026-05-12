import type { Usage } from './provider.js';

export interface CacheStats {
  /** Tokens served from cache (cheaper). */
  readTokens: number;
  /** Tokens written into the cache (more expensive than input on first hit). */
  writeTokens: number;
  /** Hit ratio: cacheRead / (cacheRead + input). 0 when nothing cached. */
  hitRatio: number;
}

export interface TokenCounter {
  account(usage: Usage, model?: string): void;
  total(): Usage;
  estimateCost(): { input: number; output: number; total: number; currency: 'USD' };
  cacheStats(): CacheStats;
  reset(): void;
}
