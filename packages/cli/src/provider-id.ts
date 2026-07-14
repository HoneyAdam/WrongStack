/**
 * Pure helper for generating non-colliding custom provider ids.
 *
 * Shared by the `/auth` custom-provider flow (blank id → auto name) and the
 * config doctor's blank-id repair, so both surfaces name providers the same
 * way: `custom-1`, `custom-2`, … skipping any id already in the config.
 */

/**
 * Return the first `custom-N` id (N ≥ 1) not present in `existing`.
 * `existing` is any iterable of the provider ids already taken.
 */
export function nextCustomProviderId(existing: Iterable<string>): string {
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`custom-${n}`)) n++;
  return `custom-${n}`;
}
