/** Resolve a promise after `ms` milliseconds. Prefer this over raw
 *  `setTimeout` wrappers so all delay sites use a single implementation
 *  and an abortable variant can be introduced without a codebase-wide hunt. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
