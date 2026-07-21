/**
 * Process-liveness probing.
 *
 * This predicate was copy-pasted across six subsystems (session registry, HQ
 * auth store, director state, fleet notifier, recovery lock, mailbox lock)
 * with four different semantics. The dangerous variant was `catch { return
 * false }`: on POSIX, `process.kill(pid, 0)` throws EPERM when the process
 * EXISTS but belongs to another user (or runs elevated), so a bare catch
 * reports a live process as dead. Callers then "reclaim" resources that are
 * still owned — the director-state lock would be stolen from a running
 * director, and live sessions were pruned from the registry.
 *
 * Everything that asks "is this pid alive?" must go through here.
 */

/**
 * True iff `pid` names a live process.
 *
 * POSIX: `process.kill(pid, 0)` succeeds for our own processes, throws EPERM
 *   for processes we may not signal (alive, just not ours), and throws ESRCH
 *   once the pid is gone.
 * Windows (Node 22+): the same call succeeds when the process exists and
 *   throws otherwise.
 *
 * Deliberately fails CLOSED on an unrecognized error code — reporting "dead"
 * for an unknown failure is the conservative answer for the pruning callers,
 * which is why lock owners that must not be displaced (see
 * `single-instance-mailbox`) layer a second, platform-specific check on top.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    /* v8 ignore next -- platform/permission-specific: EPERM means alive but owned by another user */
    if (code === 'EPERM') return true;
    return false;
  }
}
