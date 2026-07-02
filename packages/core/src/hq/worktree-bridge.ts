/**
 * WorktreeTelemetryBridge — forwards local git-worktree lifecycle events to
 * the HQ publisher as `worktree.event` envelopes, so the command center can
 * render live build phase swim-lanes / DAG across every connected machine.
 *
 * Source: the `worktree.*` EventBus events emitted by `WorktreeManager`
 * (`worktree/worktree-manager.ts`): allocated, committed, merged, conflict,
 * released, failed. All payload fields are plain serializable data
 * (handleId, ownerId, branch, diff stats, conflict files) — no closures, no
 * decoupled relay needed.
 *
 * @module hq/worktree-bridge
 */
import type { EventBus } from '../kernel/events.js';
import type { HqEventEnvelope, HqWorktreeEventPayload } from './protocol.js';
import type { HqPublisher } from './publisher.js';

export interface WorktreeTelemetryBridgeOptions {
  /** Local EventBus emitting `worktree.*` events. */
  events: EventBus;
  /** HQ publisher to forward envelopes to. */
  publisher: HqPublisher;
  /** Optional sessionId to tag envelopes with. */
  sessionId?: string;
  /** Override `now()` for deterministic tests. */
  now?: () => string;
}

type WorktreeAllocated = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  ownerLabel: string;
  slug: string;
  dir: string;
  branch: string;
  baseBranch: string;
};
type WorktreeCommitted = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  branch: string;
  committed: boolean;
  insertions: number;
  deletions: number;
  files: number;
  sha?: string | undefined;
};
type WorktreeMerged = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  branch: string;
  baseBranch: string;
  squash: boolean;
};
type WorktreeConflict = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  branch: string;
  conflictFiles: string[];
};
type WorktreeReleased = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  branch: string;
  kept: boolean;
};
type WorktreeFailed = {
  sessionId?: string | undefined;
  handleId: string;
  ownerId: string;
  branch?: string | undefined;
  error: string;
};

/**
 * Start forwarding worktree lifecycle events to HQ. Returns a disposer that
 * unsubscribes all listeners — call on shutdown.
 */
export function startWorktreeTelemetryBridge(opts: WorktreeTelemetryBridgeOptions): () => void {
  const { events, publisher } = opts;
  const now = opts.now ?? (() => new Date().toISOString());

  function publish(payload: HqWorktreeEventPayload, sessionId?: string): void {
    try {
      publisher.publishEvent({
        type: 'worktree.event',
        payload,
        ...(sessionId !== undefined && sessionId !== '' ? { sessionId } : {}),
        ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
        timestamp: now(),
      });
    } catch {
      /* best-effort */
    }
  }

  const offs: Array<() => void> = [];

  offs.push(
    events.on('worktree.allocated', (p: WorktreeAllocated) => {
      publish(
        {
          kind: 'allocated',
          handleId: p.handleId,
          ownerId: p.ownerId,
          ownerLabel: p.ownerLabel,
          slug: p.slug,
          branch: p.branch,
          baseBranch: p.baseBranch,
        },
        p.sessionId,
      );
    }),
  );

  offs.push(
    events.on('worktree.committed', (p: WorktreeCommitted) => {
      publish(
        {
          kind: 'committed',
          handleId: p.handleId,
          ownerId: p.ownerId,
          branch: p.branch,
          insertions: p.insertions,
          deletions: p.deletions,
          files: p.files,
          ...(p.sha !== undefined ? { sha: p.sha } : {}),
        },
        p.sessionId,
      );
    }),
  );

  offs.push(
    events.on('worktree.merged', (p: WorktreeMerged) => {
      publish(
        {
          kind: 'merged',
          handleId: p.handleId,
          ownerId: p.ownerId,
          branch: p.branch,
          baseBranch: p.baseBranch,
          squash: p.squash,
        },
        p.sessionId,
      );
    }),
  );

  offs.push(
    events.on('worktree.conflict', (p: WorktreeConflict) => {
      publish(
        {
          kind: 'conflict',
          handleId: p.handleId,
          ownerId: p.ownerId,
          branch: p.branch,
          conflictFiles: p.conflictFiles,
        },
        p.sessionId,
      );
    }),
  );

  offs.push(
    events.on('worktree.released', (p: WorktreeReleased) => {
      publish(
        {
          kind: 'released',
          handleId: p.handleId,
          ownerId: p.ownerId,
          branch: p.branch,
          kept: p.kept,
        },
        p.sessionId,
      );
    }),
  );

  offs.push(
    events.on('worktree.failed', (p: WorktreeFailed) => {
      publish(
        {
          kind: 'failed',
          handleId: p.handleId,
          ownerId: p.ownerId,
          ...(p.branch !== undefined ? { branch: p.branch } : {}),
          error: p.error,
        },
        p.sessionId,
      );
    }),
  );

  return () => {
    for (const off of offs) off();
  };
}

/** Re-export for type-only consumers. */
export type { HqEventEnvelope };
