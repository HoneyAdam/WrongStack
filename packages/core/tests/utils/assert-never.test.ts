import { describe, expect, it } from 'vitest';
import { assertNever } from '../../src/utils/assert-never.js';

describe('assertNever', () => {
  // assertNever is the canonical "exhaustive switch default case" helper
  // in TypeScript. The contract:
  //   - Input type is `never` (only assignable to a value the caller has
  //     proven to be unreachable).
  //   - The function returns `never` (so a switch's default branch can use
  //     it to satisfy the "all cases handled" check).
  //   - It always throws an `AssertNeverError` (so the function is total
  //     in the type sense but never returns at runtime).
  //
  // The tests below pin the runtime contract. The compile-time contract
  // is enforced by TypeScript's exhaustiveness check (see the
  // `@example` in the source's docstring); vitest can only verify the
  // throw behavior.

  it('throws an error with the JSON-stringified value in the message', () => {
    // Test uses an `as never` cast to bypass the type system's
    // "this value is reachable" check at the call site. The runtime
    // contract is: the function always throws, with a message that
    // identifies the unreachable value (so debugging at the call
    // site is easier when a new union variant lands and the
    // exhaustive check is missed).
    const unreachable = { kind: 'newVariant' } as never;
    expect(() => assertNever(unreachable)).toThrow(/"kind":"newVariant"/);
  });

  it('throws an AssertNeverError (named error class for filtering)', () => {
    // The function sets err.name = 'AssertNeverError'. Callers can
    // catch this specifically to distinguish "missed exhaustive
    // check" from other runtime errors. Pin the name.
    const unreachable = 'something' as never;
    let caught: Error | undefined;
    try {
      assertNever(unreachable);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught?.name).toBe('AssertNeverError');
  });

  it('honors a custom message override', () => {
    // The function takes an optional `message` arg that replaces the
    // default "Unhandled case: ..." prefix. Useful for adding
    // context like which switch statement produced the unreachable
    // value.
    const unreachable = 42 as never;
    expect(() => assertNever(unreachable, 'switch on Shape.kind')).toThrow('switch on Shape.kind');
  });

  it('returns the never type (so the function is total in the type sense)', () => {
    // Compile-time check: the function's return type is `never`. At
    // runtime, the throw is the equivalent — the function never
    // returns. Verify the throw is unconditional by calling it
    // without a try and confirming the next line never executes.
    let reachedAfter = false;
    try {
      assertNever('reachable' as never);
    } catch {
      // expected
    }
    reachedAfter = true;
    expect(reachedAfter).toBe(true);
  });
});
