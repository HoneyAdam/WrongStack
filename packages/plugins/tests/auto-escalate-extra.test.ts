/**
 * Additional tests for auto-escalate plugin -- covering error paths.
 * Tests: errorText with non-serializable objects, invalid regex patterns.
 */
import { describe, expect, it } from 'vitest';
import { errorText, isRetryable } from '../src/auto-escalate/index.js';

describe('errorText', () => {
  it('handles Error instances', () => {
    expect(errorText(new Error('boom'))).toContain('Error: boom');
  });

  it('handles string errors', () => {
    expect(errorText('just a string')).toBe('just a string');
  });

  it('handles serializable objects', () => {
    expect(errorText({ code: 42 })).toBe('{"code":42}');
  });

  it('handles non-serializable objects (circular)', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = errorText(obj);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

describe('isRetryable', () => {
  it('matches retryable patterns', () => {
    expect(isRetryable('timeout error', [/timeout/i])).toBe(true);
  });

  it('does not match non-retryable patterns', () => {
    expect(isRetryable('success', [/timeout/i])).toBe(false);
  });

  it('returns false for empty patterns array', () => {
    expect(isRetryable('anything', [])).toBe(false);
  });
});
