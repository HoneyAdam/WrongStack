import type {
  EventBus,
  MemoryEntry,
  MemoryPriority,
  MemoryScope,
  MemoryType,
} from '@wrongstack/core';

/**
 * Module augmentation — declare the recovery events here so the super-memory
 * package can `emit` them without depending on core's `dist` being rebuilt.
 *
 * Core's `MemoryEventMap` (in @wrongstack/core/kernel/events/memory-events.ts)
 * already declares `memory.recovered` and `memory.recover_noop` with the same
 * payload shape; this augmentation keeps the local source-of-truth self-
 * contained and works whether or not core's dist has been freshly built.
 */
declare module '@wrongstack/core' {
  interface MemoryEventMap {
    'memory.recovered': {
      memoryId: string;
      reason: string;
      sessionId?: string | undefined;
      traceId?: string | undefined;
    };
    'memory.recover_noop': {
      requestedId: string;
      activeId: string;
      sessionId?: string | undefined;
      traceId?: string | undefined;
    };
    /** Emitted after a backfillRecoverable run completes in dry-run mode. */
    'memory.backfill_dry_run': {
      examined: number;
      recoverable: number;
      recovered: number;
      skipped: number;
      sessionId?: string | undefined;
      traceId?: string | undefined;
    };
    /** Emitted after a backfillRecoverable run has written new active versions. */
    'memory.backfill_applied': {
      examined: number;
      recoverable: number;
      recovered: number;
      skipped: number;
      sessionId?: string | undefined;
      traceId?: string | undefined;
    };
    /**
     * Emitted after a review candidate is resolved via `resolveCandidate`
     * (`memory_candidates` `resolve` action). `decision` is the review
     * decision applied; `applied` is false when the target was permanent
     * or missing.
     */
    'memory.candidate_resolved': {
      candidateId: string;
      decision: CandidateDecision;
      applied: boolean;
      targetMemoryId?: string | undefined;
      sessionId?: string | undefined;
      traceId?: string | undefined;
    };
  }
}

export const SUPER_MEMORY_SCHEMA_VERSION = 1;

export type SuperMemoryScope = 'project' | 'user' | 'session' | 'file' | 'symbol';

/**
 * Persistence class — controls how hygiene treats a memory.
 *
 * - `permanent`:   Hygiene never deletes or recommends deletion. Anchors are
 *                  still verified, and a stale flag is set on failure, but no
 *                  time-based or usage-based retention ever fires.
 * - `long_lived`:  Default. Hygiene surfaces review candidates for never-used,
 *                  injected-but-unused, or low-confidence memories; final
 *                  decision always belongs to the user/LLM via `memory_forget`
 *                  or `memory_update`. Time-based deletion is **off**.
 * - `short_lived`: Subject to the (still advisory, not auto-applying) time-
 *                  based review thresholds. Caller may also set `expiresAt`
 *                  for a hard TTL the user explicitly opted into.
 *
 * Migration: existing stores without this field are treated as `long_lived`.
 */
export type PersistenceClass = 'permanent' | 'long_lived' | 'short_lived';

export const DEFAULT_PERSISTENCE: PersistenceClass = 'long_lived';
export const VALID_PERSISTENCE: ReadonlySet<PersistenceClass> = new Set([
  'permanent', 'long_lived', 'short_lived',
]);

export type SuperMemoryKind =
  | 'fact'
  | 'decision'
  | 'convention'
  | 'preference'
  | 'warning'
  | 'anti_pattern'
  | 'workflow'
  | 'bug_root_cause'
  | 'file_note'
  | 'symbol_note'
  | 'command_note'
  | 'summary'
  | 'memory_review';

export type SuperMemoryStatus =
  | 'active'
  | 'stale'
  | 'superseded'
  | 'contradicted'
  | 'archived'
  | 'deleted';

export interface MemoryAnchor {
  type: 'file' | 'directory' | 'symbol' | 'package' | 'command' | 'test' | 'git';
  path?: string | undefined;
  symbol?: string | undefined;
  command?: string | undefined;
  contentHash?: string | undefined;
  gitBlobHash?: string | undefined;
  lineStart?: number | undefined;
  lineEnd?: number | undefined;
}

export interface MemoryAudienceSelector {
  /** Stable fleet/catalog role ids (for example `reviewer`, `refactor-planner`, or `git`). */
  roles?: string[] | undefined;
  /** Work classifications such as `review`, `refactor`, or Kanban task types. */
  taskTypes?: string[] | undefined;
  /** Runtime modes that should receive the memory (for example `code-review`). */
  modes?: string[] | undefined;
}

export interface MemoryAudienceContext {
  role?: string | undefined;
  taskType?: string | undefined;
  mode?: string | undefined;
}

export interface MemorySourceRef {
  type:
    | 'user'
    | 'session'
    | 'tool_result'
    | 'project_instruction'
    | 'file'
    | 'test'
    | 'command'
    | 'legacy_memory';
  sessionId?: string | undefined;
  toolUseId?: string | undefined;
  path?: string | undefined;
  command?: string | undefined;
  excerptHash?: string | undefined;
}

export interface SuperMemory {
  id: string;
  revision: number;
  scope: SuperMemoryScope;
  legacyScope?: MemoryScope | undefined;
  kind: SuperMemoryKind;
  status: SuperMemoryStatus;
  /** Orthogonal to lifecycle: only `never` is an absolute LLM-context ban. */
  contextPolicy?: 'eligible' | 'never' | undefined;
  /**
   * Persistence class. Optional for back-compat: legacy records without this
   * field are treated as `long_lived` by the load path (see
   * `withDefaultPersistence` in store.ts).
   */
  persistence?: PersistenceClass | undefined;
  text: string;
  summary?: string | undefined;
  importance: number;
  confidence: number;
  freshness: number;
  tags: string[];
  anchors: MemoryAnchor[];
  /** Optional project-local audience. Omitted memories remain general project knowledge. */
  audience?: MemoryAudienceSelector | undefined;
  sources: MemorySourceRef[];
  supersedes?: string[] | undefined;
  supersededBy?: string | undefined;
  contradicts?: string[] | undefined;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | undefined;
  lastVerifiedAt?: string | undefined;
  /** Last time the assistant referenced an injected memory (usefulness signal). */
  lastUsedAt?: string | undefined;
  expiresAt?: string | undefined;
  /**
   * How often this memory was injected into context. Approximate: stores batch
   * counter persistence (JSONL) or count process-locally (SQLite); the audit
   * log's `memory.injected` events remain the exact record.
   */
  injectionCount?: number | undefined;
  /** How often an injected memory was referenced by the assistant afterwards. */
  useCount?: number | undefined;
}

export type MemoryGraphRelation =
  | 'about_file'
  | 'about_directory'
  | 'about_symbol'
  | 'about_package'
  | 'about_command'
  | 'derived_from'
  | 'validated_by'
  | 'invalidated_by'
  | 'supersedes'
  | 'contradicts'
  | 'related_to'
  | 'same_topic';

export interface MemoryGraphEdge {
  schemaVersion: 1;
  id: string;
  from: string;
  to: string;
  relation: MemoryGraphRelation;
  weight: number;
  createdAt: string;
  deletedAt?: string | undefined;
}

export type VerificationStatus = 'verified' | 'stale' | 'contradicted' | 'unknown';

export interface AnchorVerificationResult {
  anchor: MemoryAnchor;
  status: VerificationStatus;
  reason: string;
  contentHash?: string | undefined;
  gitBlobHash?: string | undefined;
}

export interface MemoryVerificationResult {
  memoryId: string;
  status: VerificationStatus;
  checkedAt: string;
  anchors: AnchorVerificationResult[];
}

export interface SuperMemoryHygieneOptions {
  retentionDays?: number | undefined;
  archiveLowConfidenceAfterDays?: number | undefined;
  /**
   * Archive active memories that were injected at least `unusedMinInjections`
   * times but never referenced by the assistant, this many days after their
   * last content update. Default: 30.
   */
  archiveUnusedAfterDays?: number | undefined;
  /** Minimum injection count before a never-used memory is archived. Default: 10. */
  unusedMinInjections?: number | undefined;
  verify?: boolean | undefined;
}

export interface SuperMemoryHygieneReport {
  startedAt: string;
  completedAt: string;
  examined: number;
  deduplicated: number;
  superseded: number;
  contradicted: number;
  staled: number;
  /** Review candidates produced by hygiene this run. Final deletion/archival
   *  decision is made by the user or LLM via `memory_forget`/`memory_update`,
   *  never by hygiene itself. */
  reviewCandidatesCreated: number;
  /** Subset of historical semantics: ALWAYS 0 in the current pipeline —
   *  retained for backward-compatible tooling that reads the field. */
  archived: number;
  /** Subset of historical semantics: ALWAYS 0 in the current pipeline. */
  archivedUnused: number;
  /** Subset of historical semantics: ALWAYS 0 in the current pipeline. */
  deleted: number;
  verified: number;
}

/**
 * Why hygiene surfaced a memory for review. Distinct from the candidate's own
 * status (`pending`/`accepted`/`rejected`) — these are the *reasons* a candidate
 * exists, surfaced as tags on the candidate and in the audit log.
 */
export type MemoryReviewReason =
  | 'anchor_invalid'
  | 'never_injected'
  | 'injected_never_used'
  | 'confidence_low'
  | 'expires_at_passed'
  | 'contradicted_by_graph'
  | 'freshness_low';

export interface SuperMemoryStats {
  total: number;
  byStatus: Record<SuperMemoryStatus, number>;
  byKind: Partial<Record<SuperMemoryKind, number>>;
  edges: number;
  /** Total recorded context injections across all memories. */
  injections?: number | undefined;
  /** Total recorded assistant references to injected memories. */
  uses?: number | undefined;
}

/**
 * Filter for `backfillRecoverable`. Restricts which `status='deleted'` records
 * are eligible for new-active-version creation. Empty fields mean "no filter".
 */
export interface SuperMemoryBackfillFilter {
  kinds?: SuperMemoryKind[] | undefined;
  scopes?: SuperMemoryScope[] | undefined;
  /** Only consider records with `updatedAt >= this`. ISO-8601 string. */
  updatedAfter?: string | undefined;
  /** Only consider records with `updatedAt <= this`. ISO-8601 string. */
  updatedBefore?: string | undefined;
  /** Skip records whose `text` is empty or whitespace-only. Default true. */
  requireText?: boolean | undefined;
  /** Skip records with no `sources` and no `anchors`. Default true. */
  requireProvenance?: boolean | undefined;
}

export interface SuperMemoryBackfillOptions {
  filter?: SuperMemoryBackfillFilter | undefined;
  /** Default true: report only, no writes. Pass `dryRun: false` to apply. */
  dryRun?: boolean | undefined;
}

export interface SuperMemoryBackfillRecord {
  /** Original `status='deleted'` memory id. */
  originalId: string;
  /** New active version id (only populated when `dryRun=false`). */
  newActiveId?: string | undefined;
  /** Short reason the record is recoverable / or skipped. */
  reason: string;
  kind: SuperMemoryKind;
  scope: SuperMemoryScope;
  /** Truncated text preview for display. */
  textPreview: string;
  /** Original `updatedAt` (when it was deleted). */
  deletedAt: string;
  /** Detected persistence class at deletion time. */
  persistence: PersistenceClass;
}

export interface SuperMemoryBackfillReport {
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  examined: number;
  /** Subset of `examined` that pass the recoverability filter. */
  recoverable: number;
  /** Count of records that were actually restored to a new active version. */
  recovered: number;
  skipped: number;
  /** Records that did NOT pass the filter, with a reason. */
  skippedRecords: SuperMemoryBackfillRecord[];
  /** Records that DO pass the filter. When `dryRun=true` these are preview-only;
   *  when `dryRun=false` they have `newActiveId` populated. */
  recoverableRecords: SuperMemoryBackfillRecord[];
  byKind: Partial<Record<SuperMemoryKind, number>>;
  byReason: Record<string, number>;
}

export interface LegacyImportResult {
  imported: number;
  skipped: number;
  files: number;
}

export type MemoryCandidateStatus = 'pending' | 'accepted' | 'rejected' | 'merged';

export interface MemoryCandidate {
  schemaVersion: 1;
  id: string;
  status: MemoryCandidateStatus;
  text: string;
  kind: SuperMemoryKind;
  scope: SuperMemoryScope;
  confidence: number;
  importance: number;
  tags: string[];
  anchors: MemoryAnchor[];
  audience?: MemoryAudienceSelector | undefined;
  sources: MemorySourceRef[];
  createdAt: string;
  updatedAt: string;
  memoryId?: string | undefined;
  reason?: string | undefined;
  /** First-class linkage to the memory this proposal reviews (proposal metadata — never overwritten by resolution). */
  targetMemoryId?: string | undefined;
  /** Why the review was proposed (proposal metadata — never overwritten by resolution). */
  reviewReason?: string | undefined;
}

export interface SessionConsolidationInput {
  sessionId: string;
  facts: Array<{
    text: string;
    kind?: SuperMemoryKind | undefined;
    confidence?: number | undefined;
    importance?: number | undefined;
    tags?: string[] | undefined;
    anchors?: MemoryAnchor[] | undefined;
  }>;
  autoAcceptThreshold?: number | undefined;
}

export interface SessionConsolidationResult {
  candidates: number;
  accepted: number;
  rejected: number;
  duplicate: number;
}

export type SuperMemoryOp = 'create' | 'update' | 'delete';

export interface SuperMemoryRecord {
  recordType: 'memory';
  schemaVersion: 1;
  op: SuperMemoryOp;
  memory: SuperMemory;
}

export interface SuperMemoryAuditRecord {
  schemaVersion: 1;
  event: string;
  memoryId?: string | undefined;
  source?: string | undefined;
  reason?: string | undefined;
  at: string;
  traceId?: string | undefined;
  details?: Record<string, unknown> | undefined;
}

export interface SuperMemoryManifest {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  lastSnapshotId?: string | undefined;
  indexes?: {
    version: 1;
    builtAt: string;
  } | undefined;
}

export interface SuperMemorySnapshot {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  memories: SuperMemory[];
}

export interface SuperMemoryIndexes {
  byPath: Record<string, string[]>;
  bySymbol: Record<string, string[]>;
  byTag: Record<string, string[]>;
  byKind: Record<string, string[]>;
  lexical: Record<string, string[]>;
}

export interface SuperMemoryPaths {
  rootDir: string;
  manifest: string;
  memoriesLog: string;
  candidatesLog: string;
  auditLog: string;
  graphDir: string;
  edgesLog: string;
  indexesDir: string;
  snapshotsDir: string;
  hygieneDir: string;
  tmpDir: string;
  locksDir: string;
}

export interface SuperMemoryStoreOptions {
  projectRoot: string;
  directory?: string | undefined;
  traceId?: string | undefined;
  events?: EventBus | undefined;
  now?: (() => Date) | undefined;
  /**
   * Minimum interval between persisted feedback-counter flushes
   * (injection/use counters). Must be finite and non-negative; `0` flushes
   * every update. Default: 3600000 (1 hour). Lower values reduce staleness
   * but increase disk writes on every store instance.
   */
  counterFlushIntervalMs?: number | undefined;
}

export interface RememberSuperMemoryInput {
  text: string;
  scope?: SuperMemoryScope | undefined;
  legacyScope?: MemoryScope | undefined;
  /**
   * Persistence class. Defaults to `long_lived` when omitted. Validated against
   * `VALID_PERSISTENCE`; unknown values are rejected.
   */
  persistence?: PersistenceClass | undefined;
  kind?: SuperMemoryKind | undefined;
  tags?: string[] | undefined;
  /** Limit automatic agent injection to matching project roles/tasks/modes. */
  audience?: MemoryAudienceSelector | undefined;
  priority?: MemoryPriority | undefined;
  type?: MemoryType | undefined;
  importance?: number | undefined;
  confidence?: number | undefined;
  freshness?: number | undefined;
  anchors?: MemoryAnchor[] | undefined;
  sources?: MemorySourceRef[] | undefined;
  supersedes?: string[] | undefined;
  contradicts?: string[] | undefined;
}

/**
 * Input for `createCandidate` (review proposals). Carries the optional
 * first-class target linkage (`targetMemoryId`) and review reason
 * (`reviewReason`) so proposal consumers (ReviewQueue, resolvers) can attach
 * the candidate to the memory it reviews without parsing tags. Distinct from
 * `memoryId`/`reason` on `MemoryCandidate`, which record resolution results
 * (accepted memory id / rejection reason) and must not be overwritten.
 */
export type CreateCandidateInput = Omit<RememberSuperMemoryInput, 'legacyScope' | 'priority' | 'type'> & {
  /** Id of the memory this proposal reviews (e.g. a suggested delete/archive target). */
  targetMemoryId?: string | undefined;
  /** Review reason (e.g. 'noise', 'contradiction', 'expires_at_passed'). */
  reviewReason?: string | undefined;
};

/** Outcome of resolving a review candidate (the redesign contract's decision path). */
export type CandidateDecision = 'delete' | 'archive' | 'keep';

export interface MemoryCandidateResolution {
  candidateId: string;
  decision: CandidateDecision;
  /** The memory the decision applied to, when the candidate carried target linkage. */
  targetMemoryId?: string | undefined;
  /** Whether the memory was actually mutated (false for permanent/missing targets). */
  applied: boolean;
  /** True when the candidate was already resolved — the call was a no-op. */
  alreadyResolved?: boolean | undefined;
}

export interface UpdateSuperMemoryInput {
  text?: string | undefined;
  tags?: string[] | undefined;
  /** Promote/demote persistence class. Forward-compatible: any future value is rejected. */
  persistence?: PersistenceClass | undefined;
  kind?: SuperMemoryKind | undefined;
  anchors?: MemoryAnchor[] | undefined;
  /** Replace the automatic-injection audience; `{}` clears role/task/mode restrictions. */
  audience?: MemoryAudienceSelector | undefined;
  importance?: number | undefined;
  confidence?: number | undefined;
  freshness?: number | undefined;
  status?: SuperMemoryStatus | undefined;
  supersedes?: string[] | undefined;
  contradicts?: string[] | undefined;
  /**
   * Override the permanent-memory guard when setting `status: 'deleted'`.
   * Mirrors the `{ force: true }` contract on `deleteSuperMemory`. The
   * override is recorded in the audit log so the caller's intent is always
   * traceable. Ignored for non-deletion patches.
   */
  force?: boolean | undefined;
}

export interface SuperMemorySearchOptions {
  scope?: SuperMemoryScope | undefined;
  legacyScope?: MemoryScope | undefined;
  limit?: number | undefined;
  includeStatuses?: SuperMemoryStatus[] | undefined;
  /** Default true for management/search surfaces; automatic injection opts out explicitly. */
  includeAudienceScoped?: boolean | undefined;
}

export interface SuperMemoryForAudienceOptions extends MemoryAudienceContext {
  limit?: number | undefined;
  includeStatuses?: SuperMemoryStatus[] | undefined;
}

export interface SuperMemoryForPathOptions {
  path: string;
  limit?: number | undefined;
  includeAncestors?: boolean | undefined;
  includeStatuses?: SuperMemoryStatus[] | undefined;
  /** Default true for explicit reads; automatic tool-result injection sets false. */
  includeAudienceScoped?: boolean | undefined;
}

/**
 * How a memory matched the file/drawer query. Used by the UI to show the user
 * *why* a record appeared — `scope_file` is the strongest signal (the memory
 * was created specifically for this file); `mention` is the weakest.
 */
export type MemoryMatchVia =
  | 'scope_file'
  | 'scope_symbol'
  | 'anchor_file'
  | 'anchor_symbol'
  | 'anchor_directory'
  | 'mention';

/** Compact review-candidate metadata surfaced with a matched memory. */
export interface MemoryPendingReview {
  candidateId: string;
  reason: string;
  suggestedAction: 'delete' | 'archive' | 'update' | 'investigate';
  ageDays: number;
}

/**
 * A memory returned by `findMemoriesForFile`, augmented with UI-friendly
 * metadata: how it matched, whether a pending review candidate exists, and
 * — for superseded records — the head-of-chain id.
 *
 * Always use this shape (not raw `SuperMemory`) for file-drawer / file-editor
 * surfaces, because the user needs the *why* before they decide what to do.
 */
export interface MemoryForFileMatch {
  memory: SuperMemory;
  matchedVia: MemoryMatchVia;
  /** 0..1 — `scope_file` = 1.0, `anchor_file` = 0.85, `mention` = 0.3. */
  matchStrength: number;
  /** Populated when the memory is `superseded` and a head-of-chain exists. */
  supersededByActiveId?: string | undefined;
  /** Populated when hygiene has emitted a pending review candidate. */
  pendingReview?: MemoryPendingReview | undefined;
}

/** Filter / sort knobs for `findMemoriesForFile`. */
export interface FindMemoriesForFileOptions {
  /** Optional cursor line range — only symbol anchors overlapping this range are boosted. */
  lineStart?: number | undefined;
  lineEnd?: number | undefined;
  /** Default true. If true, also include `superseded` and (optionally) `deleted` matches. */
  includeSuperseded?: boolean | undefined;
  /** Default false. Requires the explicit `deletedToggle` to opt in. */
  includeDeleted?: boolean | undefined;
  /** Cap on returned matches. Default 50. */
  limit?: number | undefined;
}

/**
 * Aggregated response from `findMemoriesForFile`. Returns three buckets so
 * the file drawer can render primary / symbol-anchored / mentioned memories
 * in separate sections. Counts let the UI show "5 matches" headers without
 * needing the caller to recount.
 */
export interface FindMemoriesForFileResponse {
  filePath: string;
  /** file/symbol scope matches + file/directory anchor matches. */
  primaryMatches: MemoryForFileMatch[];
  /** symbol-anchored matches overlapping the cursor line range (if provided). */
  symbolMatches: MemoryForFileMatch[];
  /** Memories that mention this file path but aren't anchored to it. */
  relatedMatches: MemoryForFileMatch[];
  totalCount: number;
  activeCount: number;
  supersededCount: number;
  /** Count of matches that have a pending review candidate (any bucket). */
  reviewPendingCount: number;
}

export function superToLegacyScope(scope: SuperMemoryScope): MemoryScope {
  switch (scope) {
    case 'user':
      return 'user-memory';
    case 'project':
    case 'session':
    case 'file':
    case 'symbol':
      return 'project-memory';
  }
}

export function legacyToSuperScope(scope: MemoryScope): SuperMemoryScope {
  switch (scope) {
    case 'user-memory':
      return 'user';
    case 'project-agents':
    case 'project-memory':
      return 'project';
  }
}

export function kindToLegacyType(kind: SuperMemoryKind): MemoryType {
  switch (kind) {
    case 'decision':
      return 'decision';
    case 'convention':
      return 'convention';
    case 'preference':
      return 'preference';
    case 'anti_pattern':
      return 'anti_pattern';
    case 'file_note':
    case 'symbol_note':
    case 'command_note':
      return 'reference';
    case 'warning':
    case 'workflow':
    case 'bug_root_cause':
    case 'summary':
    case 'memory_review':
    case 'fact':
      return 'fact';
  }
}

export function legacyTypeToKind(type: MemoryType | undefined): SuperMemoryKind {
  switch (type) {
    case 'decision':
      return 'decision';
    case 'convention':
      return 'convention';
    case 'preference':
      return 'preference';
    case 'anti_pattern':
      return 'anti_pattern';
    case 'reference':
      return 'file_note';
    case 'fact':
    case undefined:
      return 'fact';
  }
}

export function toLegacyEntry(memory: SuperMemory): MemoryEntry {
  return {
    scope: memory.legacyScope ?? superToLegacyScope(memory.scope),
    text: memory.text,
    ts: memory.createdAt,
    type: kindToLegacyType(memory.kind),
    tags: memory.tags.length > 0 ? memory.tags : undefined,
    priority: priorityFromImportance(memory.importance),
    source: memory.sources[0]?.type,
    confidence: memory.confidence,
    lastAccessed: memory.lastAccessedAt,
  };
}

function priorityFromImportance(importance: number): MemoryPriority {
  if (importance >= 0.9) return 'critical';
  if (importance >= 0.75) return 'high';
  if (importance >= 0.4) return 'medium';
  return 'low';
}
