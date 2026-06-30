/**
 * Helpers for comparing and counting shell-hook configurations.
 * Used by the hot-reload path: the `ConfigStore` watcher fires on every
 * `configStore.update` call (model, log level, anything), so we need a
 * cheap predicate to decide whether `config.hooks` actually changed before
 * re-running `replaceShellHooks`.
 *
 * Pure functions — no I/O, no logger, no side effects. Safe to import
 * from anywhere.
 */
import type { HookEvent, ShellHook } from '../types/hooks.js';

/**
 * Compare two `config.hooks` maps. Returns true when they describe the
 * same set of entries (same events, same order, same command/matcher/
 * timeoutMs triples). Both arguments may be undefined — the absence of
 * `hooks` is a valid state.
 *
 * Comparison is shallow per entry: `ShellHook` fields are all primitives,
 * so `===` per field is correct. Object-identity per entry is **not**
 * required because `configStore.update` may rebuild the maps from JSON.
 */
export function shellHooksEqual(
  a: Partial<Record<HookEvent, ShellHook[]>> | undefined,
  b: Partial<Record<HookEvent, ShellHook[]>> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const event = k as HookEvent;
    const aList = a[event];
    const bList = b[event];
    if (aList === bList) continue;
    if (!aList || !bList) return false;
    if (aList.length !== bList.length) return false;
    for (let i = 0; i < aList.length; i++) {
      const x = aList[i];
      const y = bList[i];
      if (!x || !y) return !x && !y;
      if (x.command !== y.command) return false;
      if ((x.matcher ?? '*') !== (y.matcher ?? '*')) return false;
      if ((x.timeoutMs ?? undefined) !== (y.timeoutMs ?? undefined)) return false;
    }
  }
  return true;
}

/** Count the total number of shell-hook entries across all events. */
export function countShellHooks(
  hooks: Partial<Record<HookEvent, ShellHook[]>> | undefined,
): number {
  if (!hooks) return 0;
  let n = 0;
  for (const list of Object.values(hooks)) {
    if (list) n += list.length;
  }
  return n;
}