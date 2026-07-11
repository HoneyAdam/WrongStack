/**
 * Tests for context-overflow-diagnostic.ts — hint message for context overflows.
 */
import { describe, expect, it } from 'vitest';
import { contextOverflowHint } from '../src/context-overflow-diagnostic.js';

describe('contextOverflowHint', () => {
  it('returns hint when code is PROVIDER_CONTEXT_OVERFLOW', () => {
    const err = {
      code: 'PROVIDER_CONTEXT_OVERFLOW' as const,
      message: 'too many tokens',
      describe: () => 'Provider context overflow',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeTruthy();
    expect(hint).toContain('context window');
  });

  it('returns hint when code is AGENT_CONTEXT_OVERFLOW', () => {
    const err = {
      code: 'AGENT_CONTEXT_OVERFLOW' as const,
      message: 'context limit reached',
      describe: () => 'Agent context overflow',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeTruthy();
    expect(hint).toContain('context window');
  });

  it('returns hint when message mentions context window', () => {
    const err = {
      code: 'PROVIDER_ERROR' as const,
      message: 'context window limit exceeded',
      describe: () => '',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeTruthy();
    expect(hint).toContain('context window');
  });

  it('returns hint when describe() contains context tokens', () => {
    const err = {
      code: 'PROVIDER_ERROR' as const,
      message: 'error',
      describe: () => 'too many tokens for the context window',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeTruthy();
    expect(hint).toContain('context window');
  });

  it('returns hint when message exceeds context', () => {
    const err = {
      code: 'PROVIDER_ERROR' as const,
      message: 'exceeds the context limit',
      describe: () => '',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeTruthy();
  });

  it('returns null for unrelated error codes and messages', () => {
    const err = {
      code: 'PROVIDER_RATE_LIMITED' as const,
      message: 'rate limited',
      describe: () => 'Please slow down',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeNull();
  });

  it('returns null for empty message and describe', () => {
    const err = {
      code: 'UNKNOWN' as const,
      message: '',
      describe: () => '',
    };
    const hint = contextOverflowHint(err as never);
    expect(hint).toBeNull();
  });
});
