import type { ContentBlock } from './blocks.js';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string | ContentBlock[];
  /**
   * ISO-8601 timestamp from the originating SessionEvent.
   * Populated by SessionStore.replay() during session load/resume
   * so consumers (WebUI, TUI, exports) can reconstruct the original
   * conversation timeline instead of seeing every message stamped
   * with "now". Absent for in-memory messages created during a live
   * run — those use wall-clock time from the caller.
   */
  ts?: string | undefined;
  /**
   * Pre-computed token estimate for this message, set by
   * ConversationState on append/replace. Used by estimateMessageTokens
   * and estimateRequestTokens to skip the O(n·m) content-block walk
   * on every context-pressure check. Undefined means "not yet computed"
   * — the estimator falls back to walking content blocks.
   */
  _estTokens?: number | undefined;
}
