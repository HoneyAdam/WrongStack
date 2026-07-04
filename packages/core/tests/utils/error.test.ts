import { describe, expect, it } from 'vitest';
import { toErrorMessage } from '../../src/utils/error.js';

describe('toErrorMessage', () => {
  // toErrorMessage is the canonical "error → human string" conversion
  // used in 40+ files across the codebase (CLI exit paths, WS
  // error responses, agent retry warnings, etc.). The contract is
  // intentionally minimal: pull .message out of Error, otherwise
  // coerce to String. The tests below pin the four cases that
  // matter for callers.

  it('returns the .message of an Error instance', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('preserves empty Error.message as an empty string', () => {
    // Defensive: the function does not collapse "" to anything
    // else. Callers that want to display "unknown error" must do
    // that wrapping themselves.
    expect(toErrorMessage(new Error(''))).toBe('');
  });

  it('preserves the .message of a subclass of Error', () => {
    class CustomError extends Error {
      constructor(
        message: string,
        public readonly code: string,
      ) {
        super(message);
        this.name = 'CustomError';
      }
    }
    expect(toErrorMessage(new CustomError('something failed', 'E_THING'))).toBe('something failed');
  });

  it('coerces a non-Error value to its String form', () => {
    // Strings, numbers, objects, null, undefined — anything non-Error
    // is funneled through String(). The tests below pin a representative
    // sample; the contract is "any non-Error → String(value)".
    expect(toErrorMessage('plain string')).toBe('plain string');
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });

  it('coerces an object via String() (not JSON.stringify)', () => {
    // Important: the function uses String(err), not JSON.stringify(err).
    // The two differ for objects without a custom toString — e.g.
    // String({a:1}) is "[object Object]" but JSON.stringify would
    // give "{\"a\":1}". Callers wanting the JSON form must opt in
    // explicitly. Pin this so a future refactor to JSON.stringify
    // would be a deliberate breaking change.
    expect(toErrorMessage({ a: 1 })).toBe('[object Object]');
  });
});
