import { describe, it, expect } from 'vitest';
import { DefaultErrorHandler, ProviderError } from '../../src/index.js';

const provErr = (msg: string, status: number) =>
  new ProviderError(msg, status, false, 'test');

describe('DefaultErrorHandler.classify', () => {
  const eh = new DefaultErrorHandler();

  it('classifies 429 as rate_limit (retryable)', () => {
    expect(eh.classify(provErr('rate limited', 429))).toEqual({
      kind: 'rate_limit',
      retryable: true,
    });
  });

  it('classifies 529 as overloaded (retryable)', () => {
    expect(eh.classify(provErr('overloaded', 529))).toEqual({
      kind: 'overloaded',
      retryable: true,
    });
  });

  it('classifies 500 as server (retryable)', () => {
    const c = eh.classify(provErr('boom', 500));
    expect(c.kind).toBe('server');
    expect(c.retryable).toBe(true);
  });

  it('classifies 413 as context_overflow (not retryable)', () => {
    expect(eh.classify(provErr('payload too large', 413))).toEqual({
      kind: 'context_overflow',
      retryable: false,
    });
  });

  it('classifies 400 with "context" in message as context_overflow', () => {
    expect(eh.classify(provErr('context length exceeded', 400)).kind).toBe(
      'context_overflow',
    );
  });

  it('classifies generic 4xx as client (not retryable)', () => {
    expect(eh.classify(provErr('bad', 404))).toEqual({
      kind: 'client',
      retryable: false,
    });
  });

  it('classifies AbortError as abort', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(eh.classify(err)).toEqual({ kind: 'abort', retryable: false });
  });

  it('classifies fetch failures as network', () => {
    expect(eh.classify(new Error('fetch failed: ECONNRESET'))).toEqual({
      kind: 'network',
      retryable: true,
    });
  });

  it('classifies unknown errors', () => {
    expect(eh.classify(new Error('?'))).toEqual({ kind: 'unknown', retryable: false });
  });

  it('recover returns null by default', async () => {
    const res = await eh.recover(new Error('x'), {} as never);
    expect(res).toBeNull();
  });
});
