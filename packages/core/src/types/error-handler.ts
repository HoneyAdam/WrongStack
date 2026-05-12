import type { Response } from './provider.js';
import type { Context } from '../core/context.js';

export interface ErrorHandler {
  recover(err: unknown, ctx: Context): Promise<Response | null>;
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
