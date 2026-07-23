import type { MemoryStore } from '@wrongstack/core/types';
import type {
  CandidateDecision,
  CreateCandidateInput,
  FindMemoriesForFileOptions,
  FindMemoriesForFileResponse,
  LegacyImportResult,
  ListSagePageOptions,
  ListSagePageResult,
  MemoryCandidate,
  MemoryCandidateResolution,
  MemoryGraphEdge,
  MemoryVerificationResult,
  RememberSageInput,
  Sage,
  SageBackfillOptions,
  SageBackfillReport,
  SageForPathOptions,
  SageHygieneOptions,
  SageHygieneReport,
  SageStats,
  SageStatus,
  UpdateSageInput,
} from './types.js';

/** Capability used by CLI/TUI/WebUI presentation adapters. */
export interface SageSurface {
  stats(): Promise<SageStats>;
  listSage(statuses?: SageStatus[]): Promise<Sage[]>;
  listSagePage?(options?: ListSagePageOptions): Promise<ListSagePageResult>;
  getSage(id: string): Promise<Sage | null>;
  rememberSage(input: RememberSageInput): Promise<Sage>;
  updateSage(id: string, patch: UpdateSageInput): Promise<Sage>;
  deleteSage(
    id: string,
    reason?: string,
    options?: { force?: boolean; neverInject?: boolean },
  ): Promise<void>;
  retrieveForPath(options: SageForPathOptions): Promise<Sage[]>;
  searchSage(
    query: string,
    options?: { limit?: number; includeStatuses?: SageStatus[] },
  ): Promise<Sage[]>;
  acceptCandidate(candidateId: string): Promise<Sage | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
  retrieveForAudience(
    context: { role?: string; taskType?: string; mode?: string },
    limit?: number,
  ): Promise<Sage[]>;
  hygiene(options?: SageHygieneOptions): Promise<SageHygieneReport>;
  listCandidates(includeResolved?: boolean): Promise<MemoryCandidate[]>;
  graphFor?(query: string, maxDepth?: number, limit?: number): Promise<MemoryGraphEdge[]>;
  verify?(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]>;
  recoverSage?(id: string, reason?: string): Promise<Sage>;
  backfillRecoverable?(options?: SageBackfillOptions): Promise<SageBackfillReport>;
  findMemoriesForFile?(
    filePath: string,
    options?: FindMemoriesForFileOptions,
  ): Promise<FindMemoriesForFileResponse>;
  readAudit?(limit?: number): Promise<import('./types.js').SageAuditRecord[]>;
  importLegacy?(files: string[]): Promise<LegacyImportResult>;
  compactLog?(): Promise<{ beforeRecords: number; afterRecords: number; uniqueIds: number }>;
  getLogStats?(): Promise<{
    rawRecords: number;
    uniqueIds: number;
    duplicateRatio: number;
    fileSizeBytes: number;
  }>;
}

/** Capabilities required by the complete SAGE tool surface. */
export interface SageServiceLike extends MemoryStore {
  retrieveForPath(opts: {
    path: string;
    limit?: number;
    includeAncestors?: boolean;
    includeStatuses?: Sage['status'][];
  }): Promise<Sage[]>;
  searchSage(
    query: string,
    opts?: { limit?: number; includeStatuses?: Sage['status'][] },
  ): Promise<Sage[]>;
  retrieveForAudience?(
    context: { role?: string; taskType?: string; mode?: string },
    limit?: number,
  ): Promise<Sage[]>;
  graphFor(query: string, maxDepth?: number, limit?: number): Promise<MemoryGraphEdge[]>;
  verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]>;
  hygiene(
    options?: SageHygieneOptions,
    signal?: AbortSignal,
  ): Promise<SageHygieneReport>;
  listCandidates(includeResolved?: boolean): Promise<MemoryCandidate[]>;
  createCandidate(input: CreateCandidateInput): Promise<MemoryCandidate>;
  resolveCandidate(
    candidateId: string,
    decision: CandidateDecision,
    reason?: string,
  ): Promise<MemoryCandidateResolution | undefined>;
  acceptCandidate(candidateId: string): Promise<Sage | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
  rememberSage(input: RememberSageInput): Promise<Sage>;
  updateSage(id: string, patch: UpdateSageInput): Promise<Sage>;
  deleteSage(
    id: string,
    reason?: string,
    options?: { force?: boolean; neverInject?: boolean },
  ): Promise<void>;
  recoverSage(id: string, reason?: string): Promise<Sage>;
  backfillRecoverable(options?: SageBackfillOptions): Promise<SageBackfillReport>;
  findMemoriesForFile(
    filePath: string,
    options?: FindMemoriesForFileOptions,
  ): Promise<FindMemoriesForFileResponse>;
  getSage(id: string): Promise<Sage | null>;
}
