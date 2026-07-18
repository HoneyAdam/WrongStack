/**
 * DirectorCollabController — owns the Director's active collab-debug sessions.
 *
 * Extracted from `Director` (R4): the collab cluster is self-contained — a
 * single `activeSessions` map plus spawn/cancel/alert/list operations over it,
 * using only already-shared deps (the FleetBus, the coordinator's `stop`, and
 * the logger). The Director keeps thin public delegators (`spawnCollab`,
 * `cancelCollabSession`, `onCollabAlert`, `activeCollabSessions`) so its public
 * surface is unchanged.
 */
import {
  type CollabDebugReport,
  CollabSession,
  type CollabSessionOptions,
  type DirectorAlert,
} from '../collab-debug.js';
import type { FleetBus } from '../fleet-bus.js';
import type { Logger } from '../../types/logger.js';
// Type-only import: erased at compile time, so no runtime import cycle with
// director.ts even though CollabSession takes a Director as its first arg.
import type { Director } from '../director.js';

/** Minimal slice of the coordinator the controller needs to abort collab agents. */
interface CollabAgentStopper {
  stop(subagentId: string): Promise<void>;
}

interface DirectorCollabControllerDeps {
  /** The owning Director, passed to each CollabSession. */
  director: Director;
  fleet: FleetBus;
  coordinator: CollabAgentStopper;
  logger?: Logger | undefined;
}

export class DirectorCollabController {
  /** Active collab sessions tracked by sessionId (see spawn).
   *  The tuple holds the session and its Director-registered listener unsubs.
   *  Calling the unsubs on cancel/premature-cleanup prevents listener accumulation
   *  on CollabSession (EventEmitter) across many spawn() calls. */
  private readonly activeSessions = new Map<
    string,
    { session: CollabSession; unsubs: (() => void)[] }
  >();

  constructor(private readonly deps: DirectorCollabControllerDeps) {}

  async spawn(options: CollabSessionOptions): Promise<CollabDebugReport> {
    const session = new CollabSession(this.deps.director, this.deps.fleet, {
      ...options,
      onBudgetWarning: (alert) => {
        // Delegate to the host-provided handler if set; 'ignore' by default.
        // Collab agents are excluded from the Director's
        // budget.threshold_reached handler, so the session's own wireFleetBus()
        // budget handler (progress-based timeout logic, session.cancel()) runs
        // instead of the Director's auto-extend/deny logic.
        return options.onBudgetWarning?.(alert) ?? 'ignore';
      },
    });
    // Track so cancel(sessionId) works and Director knows what's active.
    // Store explicit unsubscribe wrappers so we can detach these listeners on cancel —
    // without cleanup, repeated spawn() calls would accumulate listeners
    // on CollabSession (EventEmitter) for the Director's lifetime.
    // Note: EventEmitter.on() returns `this`, not an unsubscribe function,
    // so we create explicit wrappers that call .off() with the same handler ref.
    const doneHandler = () => this.activeSessions.delete(session.sessionId);
    const errorHandler = () => this.activeSessions.delete(session.sessionId);
    session.on('session.done', doneHandler);
    session.on('session.error', errorHandler);
    const unsubs: (() => void)[] = [
      () => session.off('session.done', doneHandler),
      () => session.off('session.error', errorHandler),
    ];
    this.activeSessions.set(session.sessionId, { session, unsubs });
    return session.start();
  }

  cancel(sessionId: string, reason = 'Director cancelled'): void {
    const entry = this.activeSessions.get(sessionId);
    if (!entry || entry.session.isCancelled()) return;
    // Unsubscribe Director listeners first so they don't fire after cancel.
    for (const unsub of entry.unsubs) unsub();
    entry.session.cancel(reason);
    // Stop each collab agent via the coordinator so their run() aborts.
    // This is the critical difference from a natural finish: we call
    // abortController.abort() on each subagent's run signal, which
    // propagates into agent.run() → tool executor and kills the run
    // before the budget or natural iteration limit ends it.
    // The abort is cooperative — the agent finishes its current iteration
    // then sees the signal and exits with status 'aborted', so no context
    // is silently lost.
    for (const [_role, subagentId] of entry.session.getSubagentIds()) {
      this.deps.coordinator.stop(subagentId).catch((err) => {
        this.deps.logger?.debug(
          `stop subagent ${subagentId} failed (may have already completed)`,
          {
            subagentId,
            err: err instanceof Error ? err.message : String(err),
          },
        );
      });
    }
  }

  onAlert(handler: (alert: DirectorAlert) => void): () => void {
    return this.deps.fleet.filter('collab.warning', (e) => {
      handler(e.payload as DirectorAlert);
    });
  }

  activeSessionIds(): string[] {
    return Array.from(this.activeSessions.keys());
  }
}
