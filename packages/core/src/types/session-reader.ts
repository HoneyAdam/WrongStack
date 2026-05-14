import type { SessionEvent, SessionMetadata, SessionStore } from './session.js';

/**
 * L2-A: SessionReader — query, replay, search, export over a `SessionStore`.
 *
 * Keeps a clean read-only interface (no `append`, no `delete`) so analytics
 * code can be wired against a store without granting it the writer surface.
 */

export type SessionEventType = SessionEvent['type'];

export interface SessionQuery {
  /** Filter by start timestamp (ISO). Sessions started before this are excluded. */
  since?: string;
  /** Filter by start timestamp (ISO). Sessions started after this are excluded. */
  until?: string;
  /** Substring match against title (case-insensitive). */
  titleContains?: string;
  /** Filter by provider id. */
  provider?: string;
  /** Filter by model id. */
  model?: string;
  /** Minimum total tokens (input+output) to keep. */
  minTokens?: number;
  /** Limit result count. Defaults to no limit. */
  limit?: number;
}

export interface SessionSearchHit {
  sessionId: string;
  eventIndex: number;
  ts: string;
  type: SessionEventType;
  /** Short snippet of the matched text — null for events without text content. */
  snippet: string | null;
}

export interface SessionSearchQuery {
  /** Plain text or regex pattern. */
  query: string;
  /** Treat `query` as a regex. Defaults to false (literal substring). */
  regex?: boolean;
  /** Case-insensitive match. Defaults to true. */
  caseInsensitive?: boolean;
  /** Limit only to these event types. Defaults to all event types. */
  types?: SessionEventType[];
  /** Limit hit count. Defaults to 100. */
  limit?: number;
}

export interface SessionExportOptions {
  /** "markdown" produces a human-readable chat log; "json" passes through raw events. */
  format: 'markdown' | 'json' | 'text';
  /** Include tool_use/tool_result blocks. Defaults to true. */
  includeTools?: boolean;
  /** Include system/diagnostic events (errors, compaction). Defaults to true. */
  includeDiagnostics?: boolean;
}

export interface SessionSummaryLite {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  provider: string;
  model: string;
  tokenTotal: number;
}

export interface SessionReader {
  /** List sessions matching the query. Uses the underlying store's summary cache. */
  query(q?: SessionQuery): Promise<SessionSummaryLite[]>;
  /** Yield events for `sessionId` in chronological order. */
  replay(sessionId: string): AsyncIterable<SessionEvent>;
  /** Full-text/regex search across one or all sessions. */
  search(q: SessionSearchQuery, sessionId?: string): Promise<SessionSearchHit[]>;
  /** Render a session for human or downstream-tool consumption. */
  export(sessionId: string, opts: SessionExportOptions): Promise<string>;
  /** Read the metadata header without loading the full event stream. */
  metadata(sessionId: string): Promise<SessionMetadata>;
}

export interface DefaultSessionReaderOptions {
  store: SessionStore;
}
