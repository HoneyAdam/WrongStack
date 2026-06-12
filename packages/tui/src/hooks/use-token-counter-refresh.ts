import type { CacheStats, EventBus, TokenCounter, Usage } from '@wrongstack/core';
import { useEffect, useState } from 'react';

export interface TokenRefreshData {
  usage: Usage;
  cost: { input: number; output: number; total: number; currency: 'USD' };
  cacheStats: CacheStats;
}

/**
 * Subscribes to `token.accounted` events and forces a re-render so StatusBar
 * always shows fresh token/cost data without waiting for the slow polling
 * interval that would otherwise gate them.
 *
 * Without this hook, the StatusBar reads from a mutable `tokenCounter`
 * object on each render, but React only re-renders when state/props change.
 * The tokenCounter is mutated by `account()` calls that arrive asynchronously
 * from provider responses, causing stale data for up to 10 seconds.
 */
export function useTokenCounterRefresh(
  tokenCounter: TokenCounter | undefined,
  events: EventBus | undefined,
): TokenRefreshData | undefined {
  const [data, setData] = useState<TokenRefreshData | undefined>(() =>
    tokenCounter
      ? {
          usage: tokenCounter.total(),
          cost: tokenCounter.estimateCost(),
          cacheStats: tokenCounter.cacheStats(),
        }
      : undefined,
  );

  useEffect(() => {
    if (!tokenCounter || !events) return;

    const off = events.on('token.accounted', () => {
      setData({
        usage: tokenCounter.total(),
        cost: tokenCounter.estimateCost(),
        cacheStats: tokenCounter.cacheStats(),
      });
    });

    return off;
  }, [tokenCounter, events]);

  return data;
}
