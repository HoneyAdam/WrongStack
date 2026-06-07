/** Assert a value is neither null nor undefined. Throws if it is.
 *  Browser-safe mirror of `@wrongstack/core`'s `expectDefined` — kept
 *  local so browser bundles don't pull in the Node-only core barrel. */
export function expectDefined<T>(value: T | null | undefined, label?: string): T {
  if (value === null || value === undefined) {
    throw new Error(label ? `Expected ${label} to be defined` : 'Expected value to be defined');
  }
  return value;
}
