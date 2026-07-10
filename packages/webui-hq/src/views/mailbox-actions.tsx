/**
 * Per-message action buttons.
 *
 * Renders the primary actions on each mailbox message — mark-read,
 * acknowledge, reopen, soft-delete (and restore for deleted rows) — wired to
 * {@link mailboxActions}, which posts to the HQ server's
 * `POST /api/mailbox/messages/:id/action` route. The server resolves the
 * target project mailbox from `projectId`, so rows without a known projectId
 * should not render this component.
 *
 * Showing the right subset of actions per message keeps the row
 * scannable. The visibility rules deliberately mirror the rules
 * the server uses (so the user never sees a button that would 4xx):
 *   - `mark-read` / `acknowledge` / `reopen` / `soft-delete` are
 *     always shown for the basic case; the server is the source of
 *     truth for what the user has already done (the action is a
 *     no-op on the server when the user has already performed it).
 *   - `restore` is only shown when the message is soft-deleted. The
 *     `isDeleted` flag here is a UI hint; the server enforces the
 *     actual rule.
 */
import { useState } from 'react';
import { mailboxActions } from '../lib/mailbox-actions.js';

export interface MessageActionsProps {
  /**
   * Mail id of the message. The component intentionally does not
   * take a `FlatMessage` — the HQ `HqMailboxMessageSummary` snapshot
   * type is a wire format that intentionally omits per-recipient
   * `readBy` + soft-delete metadata, so the visibility rules here
   * live entirely on the server side and the client only needs the
   * id to issue a request.
   */
  mailId: string;
  /** Agent id of the acting user (read from session). */
  actorId: string;
  /** HQ projectId of the message's group — the server-side routing key. */
  projectId: string;
  /**
   * When true, the `restore` button is rendered. The parent decides
   * this from the live HQ event stream (e.g. when a soft-deleted
   * message is visible in the "trash" view). Default: false.
   */
  isDeleted?: boolean | undefined;
  /**
   * Called after every successful action with the post-action
   * message id. The parent uses this to update its in-memory copy
   * (optimistic reconcile) before the HQ event stream catches up.
   */
  onAction?: ((mailId: string, action: string) => void) | undefined;
  /** Disable all buttons (e.g. while a request is in flight). */
  disabled?: boolean | undefined;
}

export function MessageActions({
  mailId,
  actorId,
  projectId,
  isDeleted = false,
  onAction,
  disabled = false,
}: MessageActionsProps): React.ReactElement {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, action: () => Promise<unknown>) => {
    if (disabled || pending !== null) return;
    setPending(label);
    setError(null);
    try {
      await action();
      onAction?.(mailId, label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(null);
    }
  };

  const input = { mailId, readerId: actorId, projectId };

  return (
    <div className="hq-msg-actions">
      {!isDeleted && (
        <button
          type="button"
          className="hq-btn secondary"
          disabled={disabled || pending !== null}
          onClick={() => run('mark-read', () => mailboxActions.markRead(input))}
        >
          {pending === 'mark-read' ? '…' : 'Mark read'}
        </button>
      )}
      {!isDeleted && (
        <button
          type="button"
          className="hq-btn"
          disabled={disabled || pending !== null}
          onClick={() => run('acknowledge', () => mailboxActions.acknowledge(input))}
        >
          {pending === 'acknowledge' ? '…' : 'Acknowledge'}
        </button>
      )}
      {!isDeleted && (
        <button
          type="button"
          className="hq-btn secondary"
          disabled={disabled || pending !== null}
          onClick={() => run('reopen', () => mailboxActions.reopen(input))}
        >
          {pending === 'reopen' ? '…' : 'Reopen'}
        </button>
      )}
      {!isDeleted && (
        <button
          type="button"
          className="hq-btn danger"
          disabled={disabled || pending !== null}
          onClick={() => run('soft-delete', () => mailboxActions.softDelete(input))}
        >
          {pending === 'soft-delete' ? '…' : 'Delete'}
        </button>
      )}
      {isDeleted && (
        <button
          type="button"
          className="hq-btn secondary"
          disabled={disabled || pending !== null}
          onClick={() => run('restore', () => mailboxActions.restore(input))}
        >
          {pending === 'restore' ? '…' : 'Restore'}
        </button>
      )}
      {error !== null && (
        <span className="hq-msg-action-error" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
