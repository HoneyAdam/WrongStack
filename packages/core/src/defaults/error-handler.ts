import { ProviderError } from '../types/provider.js';
import type { ErrorHandler } from '../types/error-handler.js';
import type { Response } from '../types/provider.js';
import type { Context } from '../core/context.js';

export class DefaultErrorHandler implements ErrorHandler {
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
  } {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { kind: 'abort', retryable: false };
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return { kind: 'abort', retryable: false };
    }
    if (err instanceof ProviderError) {
      if (err.status === 429) return { kind: 'rate_limit', retryable: true };
      if (err.status === 529) return { kind: 'overloaded', retryable: true };
      if (err.status >= 500) return { kind: 'server', retryable: true };
      if (err.status === 413 || /context|too long|tokens/i.test(err.message)) {
        return { kind: 'context_overflow', retryable: false };
      }
      if (err.status >= 400) return { kind: 'client', retryable: false };
    }
    if (err instanceof Error && /ECONN|ETIMEDOUT|ETIME|ENOTFOUND|fetch failed/i.test(err.message)) {
      return { kind: 'network', retryable: true };
    }
    return { kind: 'unknown', retryable: false };
  }

  async recover(_err: unknown, _ctx: Context): Promise<Response | null> {
    return null;
  }
}
