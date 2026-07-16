import type { Message } from '../types/messages.js';
import type { SessionWriter } from '../types/session.js';
import { DefaultSessionStore } from './session-store.js';

/**
 * The slice of ConversationState this module needs. Kept structural so callers
 * can pass `ctx.state` without this module depending on the core layer.
 */
export interface RewindableConversation {
  replaceMessages(messages: Message[]): void;
}

export interface ApplyRewindOptions {
  /** The live writer for the session being rewound. */
  session: SessionWriter;
  /** The live conversation to cut back. */
  state: RewindableConversation;
  /** Directory holding the session JSONL files. */
  sessionsDir: string;
  /** Checkpoint promptIndex to rewind to. */
  promptIndex: number;
  /**
   * Files the SessionRewinder just reverted, recorded on the `rewound` event.
   * Only this caller knows them: the file_snapshot events that prove what
   * changed are truncated away by this very call.
   */
  revertedFiles?: readonly string[] | undefined;
}

export interface ApplyRewindResult {
  /** Events dropped from the JSONL by the truncation. */
  removedEvents: number;
  /** Message count the live conversation was cut back to. */
  messageCount: number;
}

/**
 * Truncate the session JSONL to a checkpoint AND cut the live conversation
 * back to match.
 *
 * Truncating the log alone is not a rewind: the model keeps the rewound turns
 * in its working set, so the next prompt is answered against a history the log
 * no longer contains. Worse, the conversation journal records `message_updated`
 * by absolute index, so once the log is shorter than the live array those
 * updates fail the `index < messages.length` guard on reload and are dropped as
 * damage — the file diverges from the session permanently.
 *
 * The truncated log is the source of truth for what survives, so this reloads
 * it and replays the result into the live state rather than trying to compute
 * the cut point twice. `replaceMessages` emits `messages_replaced`, which
 * re-anchors the journal at the new length and makes the cut explicit to any
 * later reader.
 *
 * The caller is responsible for reverting files (see `SessionRewinder`); this
 * only reconciles the log with the live conversation.
 */
export async function applyRewindToConversation(
  opts: ApplyRewindOptions,
): Promise<ApplyRewindResult> {
  const { session, state, sessionsDir, promptIndex, revertedFiles } = opts;
  const removedEvents = await session.truncateToCheckpoint(promptIndex, revertedFiles ?? []);

  // A fresh store avoids serving a pre-truncation cache entry; load() keys its
  // cache on mtime+size, both of which the rewrite changes, but a caller's
  // long-lived store may also hold a reference to the old data object.
  const store = new DefaultSessionStore({ dir: sessionsDir });
  const data = await store.load(session.id);
  state.replaceMessages(data.messages);

  return { removedEvents, messageCount: data.messages.length };
}
