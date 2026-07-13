import type { SddLifecycleResult } from '@wrongstack/sdd';

type SddLifecycleOperation = 'cleanup_worktrees' | 'rollback' | 'destroy';

/**
 * Normalize an SDD lifecycle outcome into a chat entry. Accepts the live
 * `SddRunControl` return shapes (a bare worktree count from `cleanupWorktrees`,
 * the `{ ok, reverted, reason }` from `rollback`) and the host's uniform
 * `SddLifecycleResult` so the c / z / x keys read identically either way.
 */
export function sddLifecycleEntry(
  op: SddLifecycleOperation,
  result:
    | number
    | { ok: boolean; reverted: number; reason?: string | undefined }
    | SddLifecycleResult,
): { kind: 'info' | 'warn'; text: string } {
  // Live cleanupWorktrees() → bare count.
  if (typeof result === 'number') {
    return {
      kind: result > 0 ? 'info' : 'warn',
      text:
        result > 0
          ? `Cleaned ${result} SDD worktree${result === 1 ? '' : 's'}.`
          : 'No SDD worktrees to clean (stop the run first if it is live).',
    };
  }
  // Live rollback() → { ok, reverted, reason } (no `op` field).
  if (!('op' in result)) {
    return {
      kind: result.ok ? 'info' : 'warn',
      text: result.ok
        ? result.reverted > 0
          ? `Rolled back ${result.reverted} run commit${result.reverted === 1 ? '' : 's'} (revert commits added).`
          : 'Nothing to roll back.'
        : `Rollback failed: ${result.reason ?? 'unknown error'}`,
    };
  }
  // Host SddLifecycleResult.
  if (!result.ok) {
    const label = op === 'cleanup_worktrees' ? 'Clean' : op === 'rollback' ? 'Rollback' : 'Destroy';
    return { kind: 'warn', text: `${label} failed: ${result.reason ?? 'unknown error'}` };
  }
  if (op === 'cleanup_worktrees') {
    const removed = result.removed ?? 0;
    return {
      kind: removed > 0 ? 'info' : 'warn',
      text:
        removed > 0
          ? `Cleaned ${removed} SDD worktree${removed === 1 ? '' : 's'}.`
          : 'No SDD worktrees to clean.',
    };
  }
  if (op === 'rollback') {
    const reverted = result.reverted ?? 0;
    return {
      kind: 'info',
      text:
        reverted > 0
          ? `Rolled back ${reverted} run commit${reverted === 1 ? '' : 's'}.`
          : 'Nothing to roll back.',
    };
  }
  // destroy
  const parts = [
    `${result.removed ?? 0} worktree${(result.removed ?? 0) === 1 ? '' : 's'} removed`,
    result.deleted?.length ? `deleted ${result.deleted.join(', ')}` : '',
    (result.reverted ?? 0) > 0
      ? `${result.reverted} commit${result.reverted === 1 ? '' : 's'} reverted`
      : '',
  ].filter(Boolean);
  return {
    kind: 'info',
    text: `SDD project destroyed — ${parts.join(' · ')}.${result.reason ? ` (${result.reason})` : ''}`,
  };
}
