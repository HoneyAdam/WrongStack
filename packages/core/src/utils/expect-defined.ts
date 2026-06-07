/** Assert a value is neither null nor undefined. Throws if it is.
 *  Useful after optional chaining and indexed access when the
 *  control flow guarantees the value exists but TypeScript can't
 *  prove it (e.g. after a check on a related field). */
export function expectDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
}
