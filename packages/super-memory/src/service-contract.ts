import type { MemoryStore } from '@wrongstack/core';
import type {
  CandidateDecision,
  CreateCandidateInput,
  FindMemoriesForFileOptions,
  FindMemoriesForFileResponse,
  MemoryCandidate,
  MemoryCandidateResolution,
  MemoryGraphEdge,
  MemoryVerificationResult,
  RememberSuperMemoryInput,
  SuperMemory,
  SuperMemoryBackfillOptions,
  SuperMemoryBackfillReport,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
  UpdateSuperMemoryInput,
} from './types.js';

/** Capabilities required by the complete Super Memory tool surface. */
export interface SuperMemoryServiceLike extends MemoryStore {
  retrieveForPath(opts: {
    path: string;
    limit?: number;
    includeAncestors?: boolean;
    includeStatuses?: SuperMemory['status'][];
  }): Promise<SuperMemory[]>;
  searchSuper(
    query: string,
    opts?: { limit?: number; includeStatuses?: SuperMemory['status'][] },
  ): Promise<SuperMemory[]>;
  retrieveForAudience?(
    context: { role?: string; taskType?: string; mode?: string },
    limit?: number,
  ): Promise<SuperMemory[]>;
  graphFor(query: string, maxDepth?: number, limit?: number): Promise<MemoryGraphEdge[]>;
  verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]>;
  hygiene(
    options?: SuperMemoryHygieneOptions,
    signal?: AbortSignal,
  ): Promise<SuperMemoryHygieneReport>;
  listCandidates(includeResolved?: boolean): Promise<MemoryCandidate[]>;
  createCandidate(input: CreateCandidateInput): Promise<MemoryCandidate>;
  resolveCandidate(
    candidateId: string,
    decision: CandidateDecision,
    reason?: string,
  ): Promise<MemoryCandidateResolution | undefined>;
  acceptCandidate(candidateId: string): Promise<SuperMemory | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
  rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory>;
  updateSuperMemory(id: string, patch: UpdateSuperMemoryInput): Promise<SuperMemory>;
  deleteSuperMemory(
    id: string,
    reason?: string,
    options?: { force?: boolean; neverInject?: boolean },
  ): Promise<void>;
  recoverSuperMemory(id: string, reason?: string): Promise<SuperMemory>;
  backfillRecoverable(options?: SuperMemoryBackfillOptions): Promise<SuperMemoryBackfillReport>;
  findMemoriesForFile(
    filePath: string,
    options?: FindMemoriesForFileOptions,
  ): Promise<FindMemoriesForFileResponse>;
  getSuperMemory(id: string): Promise<SuperMemory | null>;
}
