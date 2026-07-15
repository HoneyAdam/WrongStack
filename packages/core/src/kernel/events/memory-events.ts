import type { MemoryClearedPayload, MemoryConsolidatedPayload, MemoryForgottenPayload, MemoryRememberedPayload } from '../../types/memory.js';

export interface MemoryEventMap {
  /** Cache hit on session store load — used by observability layers. */
  'storage.cache_hit': {
    sessionId: string;
    store: string;
    filePath: string;
    operation: string;
    durationMs: number;
  };
  /**
   * Fired after the user chooses 'always' or 'deny' on a confirmation prompt.
   * The TUI can use this to show a brief notification that the decision was
   * persisted to the trust file (e.g. "✓ always allowed popo.txt" / "✗ denied popo.txt").
   */
  'trust.persisted': {
    sessionId?: string | undefined;
    tool: string;
    pattern: string;
    decision: 'always' | 'deny';
  };
  // ── Memory store events — emitted by SuperMemoryStore so plugins can react ──
  'memory.remembered': MemoryRememberedPayload;
  'memory.forgotten': MemoryForgottenPayload;
  'memory.cleared': MemoryClearedPayload;
  'memory.consolidated': MemoryConsolidatedPayload;
  /** Structured Super Memory lifecycle events. Kept structural so core never depends on the package. */
  'memory.accepted': { memoryId: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.candidate_created': { candidateId: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.candidate_rejected': { candidateId: string; reason: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.updated': { memoryId: string; status: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.merged': { memoryId: string; mergedIds: string[]; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.superseded': { memoryId: string; supersededBy: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.contradicted': { memoryId: string; contradicts: string[]; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.staled': { memoryId: string; reason: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.archived': { memoryId: string; reason: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.injected': { memoryIds: string[]; trigger: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.verified': { memoryId: string; status: string; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.hygiene_started': { examined: number; sessionId?: string | undefined; traceId?: string | undefined };
  'memory.hygiene_completed': {
    examined: number;
    deduplicated: number;
    staled: number;
    archived: number;
    sessionId?: string | undefined;
    traceId?: string | undefined;
  };
  'memory.graph_edge_added': {
    edgeId: string;
    from: string;
    to: string;
    relation: string;
    sessionId?: string | undefined;
    traceId?: string | undefined;
  };
  // ── Storage events — emitted by DefaultSessionStore, FileSessionWriter, goal-store, plan-store, boot, todos-checkpoint, queue-store, task-store ──
  /**
   * Fired when a store completes a read operation. Carries the session ID
   * and file path so dashboards can correlate storage I/O with agent
   * iterations via the session ID.
   */
  'storage.read': {
    sessionId: string;
    /** Which store was read. */
    store:
      | 'session'
      | 'goal'
      | 'plan'
      | 'project'
      | 'todos'
      | 'queue'
      | 'tasks'
      | 'completed-work'
      | 'memory'
      | 'annotations'
      | 'audit'
      | 'replay'
      | 'config';
    filePath: string;
    /** Session store: load|list|summary|index_read. Goal store: load. Plan store: load. Memory store: readAll. Annotations: list. Audit: verify|load. Replay: load|lookup. Config: read_json|load_sync. Completed-work: load. */
    operation: string;
    outcome: 'success' | 'failure';
    durationMs: number;
    error?: string;
    traceId?: string;
  };
  /**
   * Fired when a store completes a write operation. Covers both individual
   * event appends and batch flushes — check `eventCount` to distinguish.
   */
  'storage.write': {
    sessionId: string;
    store:
      | 'session'
      | 'goal'
      | 'plan'
      | 'project'
      | 'todos'
      | 'queue'
      | 'tasks'
      | 'completed-work'
      | 'memory'
      | 'annotations'
      | 'audit'
      | 'replay'
      | 'config';
    filePath: string;
    /** Session store: create|resume|append|flush|close|index_append|compact|checkpoint.
     * Goal store: save|update|delete. Plan store: save. Project manifest: manifest_write.
     * Todos: save. Queue: write|clear. Tasks: save. Memory: remember|forget|clear|consolidate.
     * Annotations: add|resolve|evict. Audit: record. Replay: record|compact. Config: persist_sync.
     * Completed-work: save. */
    operation: string;
    outcome: 'success' | 'failure';
    durationMs: number;
    eventCount?: number;
    error?: string;
    traceId?: string;
  };
  /**
   * Fired when a store operation fails after best-effort retries.
   * Use this for alert-worthy persistent failures (disk full, permissions).
   */
  'storage.error': {
    sessionId: string;
    store:
      | 'session'
      | 'goal'
      | 'plan'
      | 'project'
      | 'todos'
      | 'queue'
      | 'tasks'
      | 'completed-work'
      | 'memory'
      | 'annotations'
      | 'audit'
      | 'replay'
      | 'config';
    filePath: string;
    operation: string;
    outcome?: 'failure';
    error: string;
    recoverable: boolean;
    durationMs?: number;
    traceId?: string;
  };
}
