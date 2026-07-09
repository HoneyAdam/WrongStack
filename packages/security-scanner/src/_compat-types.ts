/**
 * Local type definitions for types originally from @wrongstack/core.
 * Kept here as internal compat shims so this package doesn't need deep
 * imports into @wrongstack/core internals that aren't part of the public API.
 */

import type { ProviderError, Context, Response } from '@wrongstack/core';

/** Matches Node.js ECONN* errors and fetch failure messages. */
export const NETWORK_ERR_RE = /ECONN|ETIMEDOUT|ETIME|ENOTFOUND|EAI_AGAIN|fetch failed/i;

export interface RetryPolicy {
  shouldRetry(err: ProviderError | Error, attempt: number): boolean;
  delayMs(attempt: number, err?: ProviderError | Error): number;
  maxAttempts(err: ProviderError | Error): number;
}

/** Minimal shape matching @wrongstack/core's ErrorHandler interface. */
export interface ErrorHandler {
  recover(err: unknown, ctx: Context): Promise<RecoveryDecision | null>;
  classify(err: unknown): {
    kind:
      | 'rate_limit'
      | 'overloaded'
      | 'server'
      | 'client'
      | 'network'
      | 'abort'
      | 'context_overflow'
      | 'unknown';
    retryable: boolean;
  };
}

export type RecoveryDecision =
  | { action: 'retry'; reason: string; model?: string | undefined }
  | { action: 'continue'; response: Response; reason?: string | undefined }
  | { action: 'fail'; reason: string; error?: unknown | undefined };
