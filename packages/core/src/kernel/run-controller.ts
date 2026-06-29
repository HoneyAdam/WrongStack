import { toErrorMessage } from '../utils/error.js';
/**
 * RunController centralises abort + cleanup for a single agent run. It
 * wraps a single AbortController and exposes a registry of teardown
 * hooks that fire (LIFO, exactly once) when the run aborts OR ends
 * normally. Anyone holding the controller can:
 *
 *   - read `signal` to bail out cooperatively
 *   - call `abort(reason?)` to abort the run
 *   - call `onAbort(fn)` to register a cleanup hook
 *   - call `dispose()` when the run ends normally — this fires the
 *     hooks too, so cleanup runs regardless of outcome
 *
 * Hooks must be idempotent and synchronous-or-quick. Errors thrown
 * inside hooks are caught and surfaced through `errorSink` (or the
 * console as a last resort) so one bad hook can't block the others.
 */
export interface RunControllerOptions {
  /** Optional parent signal — abort propagates from parent → this. */
  parentSignal?: AbortSignal | undefined;
  /** Receives errors thrown by cleanup hooks. Defaults to console.warn. */
  errorSink?: (err: unknown, where: string) => void;
}

export class RunController {
  private readonly ctrl = new AbortController();
  private readonly hooks: Array<() => void | Promise<void>> = [];
  private disposed = false;
  private hooksDrained = false;
  private readonly errorSink: (err: unknown, where: string) => void;

  constructor(opts: RunControllerOptions = {}) {
    this.errorSink =
      opts.errorSink ??
      ((err, where) => {
        console.warn(JSON.stringify({
          level: 'warn',
          event: 'run.cleanup_hook_failed',
          where,
          message: toErrorMessage(err),
          timestamp: new Date().toISOString(),
        }));
      });
    if (opts.parentSignal) {
      const parent = opts.parentSignal;
      if (parent.aborted) {
        this.ctrl.abort(parent.reason);
      } else {
        const onParentAbort = () => this.ctrl.abort(parent.reason);
        parent.addEventListener('abort', onParentAbort, { once: true });
        // When this run finishes normally, stop listening on the parent.
        this.onAbort(() => parent.removeEventListener('abort', onParentAbort));
      }
    }
    this.ctrl.signal.addEventListener(
      'abort',
      () => {
        void this.runHooks();
      },
      { once: true },
    );
  }

  get signal(): AbortSignal {
    return this.ctrl.signal;
  }

  get aborted(): boolean {
    return this.ctrl.signal.aborted;
  }

  abort(reason?: unknown): void {
    if (this.ctrl.signal.aborted) return;
    this.ctrl.abort(reason);
  }

  /**
   * Register a teardown hook. Returns an unsubscribe function so callers
   * can opt out before the hook fires (e.g. when a tool finishes cleanly
   * before abort happens).
   *
   * If the controller has already drained its hooks (a prior abort() or
   * dispose() ran), the new hook is fired immediately on a best-effort
   * basis — otherwise a hook registered after teardown would be silently
   * dropped and the resource it cleans up would leak. The returned
   * unsubscribe is a no-op in that case (the hook has already run). Errors
   * from the immediate run are routed through `errorSink` like any other
   * cleanup failure.
   */
  onAbort(fn: () => void | Promise<void>): () => void {
    if (this.hooksDrained) {
      void (async () => {
        try {
          await fn();
        } catch (err) {
          this.errorSink(err, 'RunController.onAbort(post-drain)');
        }
      })();
      return () => {};
    }
    this.hooks.push(fn);
    return () => {
      const idx = this.hooks.indexOf(fn);
      if (idx !== -1) this.hooks.splice(idx, 1);
    };
  }

  /**
   * Fire cleanup hooks and tear down listeners — called when the run
   * ends *normally* so cleanup happens regardless of outcome. Subsequent
   * aborts become no-ops.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.runHooks();
  }

  private async runHooks(): Promise<void> {
    if (this.hooksDrained) return;
    this.hooksDrained = true;
    // Snapshot + clear so hooks added during cleanup don't re-fire.
    const snapshot = this.hooks.splice(0, this.hooks.length).reverse();
    for (const hook of snapshot) {
      try {
        await hook();
      } catch (err) {
        this.errorSink(err, 'RunController.dispose');
      }
    }
  }
}
