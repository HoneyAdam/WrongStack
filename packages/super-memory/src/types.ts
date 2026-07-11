import type {
  EventBus,
  MemoryEntry,
  MemoryPriority,
  MemoryScope,
  MemoryType,
} from '@wrongstack/core';

export const SUPER_MEMORY_SCHEMA_VERSION = 1;

export type SuperMemoryScope = 'project' | 'user' | 'session' | 'file' | 'symbol';

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
  | 'summary';

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
  text: string;
  summary?: string | undefined;
  importance: number;
  confidence: number;
  freshness: number;
  tags: string[];
  anchors: MemoryAnchor[];
  sources: MemorySourceRef[];
  supersedes?: string[] | undefined;
  supersededBy?: string | undefined;
  contradicts?: string[] | undefined;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string | undefined;
  lastVerifiedAt?: string | undefined;
  expiresAt?: string | undefined;
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
  archived: number;
  deleted: number;
  verified: number;
}

export interface SuperMemoryStats {
  total: number;
  byStatus: Record<SuperMemoryStatus, number>;
  byKind: Partial<Record<SuperMemoryKind, number>>;
  edges: number;
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
  sources: MemorySourceRef[];
  createdAt: string;
  updatedAt: string;
  memoryId?: string | undefined;
  reason?: string | undefined;
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
}

export interface RememberSuperMemoryInput {
  text: string;
  scope?: SuperMemoryScope | undefined;
  legacyScope?: MemoryScope | undefined;
  kind?: SuperMemoryKind | undefined;
  tags?: string[] | undefined;
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

export interface SuperMemorySearchOptions {
  scope?: SuperMemoryScope | undefined;
  legacyScope?: MemoryScope | undefined;
  limit?: number | undefined;
  includeStatuses?: SuperMemoryStatus[] | undefined;
}

export interface SuperMemoryForPathOptions {
  path: string;
  limit?: number | undefined;
  includeAncestors?: boolean | undefined;
  includeStatuses?: SuperMemoryStatus[] | undefined;
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
