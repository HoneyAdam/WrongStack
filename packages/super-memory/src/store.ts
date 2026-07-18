import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  MemoryEntry,
  MemoryRelevanceContext,
  MemoryScope,
  MemoryStore,
  ScoredEntry,
} from '@wrongstack/core';
import { ensureDir, ulid, withFileLock } from '@wrongstack/core/utils';
import { appendJsonl, readJson, readJsonl, readJsonlSnapshot, writeJson } from './jsonl.js';
import { verifyMemoryAnchors } from './anchors/verify.js';
import { SuperMemoryGraph } from './graph/graph.js';
import {
  ancestorPaths,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSuperMemoryPaths,
} from './paths.js';
import { collectStringValues, looksLikeSecret, tokenize } from './store-helpers.js';
import {
  SUPER_MEMORY_SCHEMA_VERSION,
  legacyToSuperScope,
  legacyTypeToKind,
  superToLegacyScope,
  toLegacyEntry,
  DEFAULT_PERSISTENCE,
  VALID_PERSISTENCE,
  type CreateCandidateInput,
  type FindMemoriesForFileOptions,
  type FindMemoriesForFileResponse,
  type MemoryForFileMatch,
  type MemoryMatchVia,
  type MemoryAnchor,
  type MemoryAudienceContext,
  type MemoryAudienceSelector,
  type MemoryReviewReason,
  type PersistenceClass,
  type SuperMemoryBackfillOptions,
  type SuperMemoryBackfillReport,
  type LegacyImportResult,
  type CandidateDecision,
  type MemoryCandidate,
  type MemoryCandidateResolution,
  type MemoryGraphEdge,
  type MemoryGraphRelation,
  type MemoryVerificationResult,
  type RememberSuperMemoryInput,
  type SessionConsolidationInput,
  type SessionConsolidationResult,
  type SuperMemory,
  type SuperMemoryAuditRecord,
  type SuperMemoryForPathOptions,
  type SuperMemoryHygieneOptions,
  type SuperMemoryHygieneReport,
  type SuperMemoryIndexes,
  type SuperMemoryManifest,
  type SuperMemoryRecord,
  type SuperMemorySearchOptions,
  type SuperMemorySnapshot,
  type SuperMemoryStatus,
  type SuperMemoryStats,
  type SuperMemoryStoreOptions,
} from './types.js';

const DEFAULT_LIMIT = 20;
const MAX_MEMORY_TEXT_CHARS = 20_000;
const MAX_MEMORY_METADATA_ITEMS = 128;
/** Minimum interval between persisted feedback-counter flushes (per store instance). */
const COUNTER_FLUSH_INTERVAL_MS = 60 * 60_000;
const CONTEXT_STATUSES: SuperMemoryStatus[] = ['active', 'deleted'];
const VALID_STATUSES = new Set<SuperMemoryStatus>(['active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted']);
const VALID_SCOPES = new Set<SuperMemory['scope']>(['project', 'user', 'session', 'file', 'symbol']);
const VALID_KINDS = new Set<SuperMemory['kind']>([
  'fact', 'decision', 'convention', 'preference', 'warning', 'anti_pattern',
  'workflow', 'bug_root_cause', 'file_note', 'symbol_note', 'command_note', 'summary',
  'memory_review',
]);
const VALID_ANCHOR_TYPES = new Set<MemoryAnchor['type']>([
  'file', 'directory', 'symbol', 'package', 'command', 'test', 'git',
]);
const VALID_CANDIDATE_STATUSES = new Set<MemoryCandidate['status']>([
  'pending', 'accepted', 'rejected', 'merged',
]);
const VALID_SOURCE_TYPES = new Set<SuperMemory['sources'][number]['type']>([
  'user', 'session', 'tool_result', 'project_instruction', 'file', 'test',
  'command', 'legacy_memory',
]);

export class SuperMemoryStore implements MemoryStore {
  readonly paths;
  private readonly projectRoot: string;
  private readonly now: () => Date;
  private readonly events;
  private traceId?: string | undefined;
  private loaded: SuperMemory[] | undefined;
  private loadedLogSignature: string | undefined;
  private readonly invalidRecordsAudited = new Set<string>();
  private readonly graph: SuperMemoryGraph;
  private initialized = false;
  private initializing: Promise<void> | undefined;
  private mutationChain: Promise<unknown> = Promise.resolve();
  /**
   * Feedback-counter deltas accumulated since the last persisted flush.
   * Flushing writes one JSONL record per touched memory, so increments are
   * batched: the flush applies `onDisk + pendingDelta` inside a mutation
   * (which reloads from disk first), keeping multi-process increments additive.
   */
  private readonly pendingCounters = new Map<string, { injections: number; uses: number }>();
  private lastCounterFlushAtMs = 0;

  constructor(opts: SuperMemoryStoreOptions) {
    this.projectRoot = path.resolve(opts.projectRoot);
    this.paths = resolveSuperMemoryPaths(this.projectRoot, opts.directory);
    this.traceId = opts.traceId;
    this.events = opts.events;
    this.now = opts.now ?? (() => new Date());
    this.graph = new SuperMemoryGraph(this.paths.edgesLog, this.now);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.initializeOnce();
    try {
      await this.initializing;
    } finally {
      this.initializing = undefined;
    }
  }

  private async initializeOnce(): Promise<void> {
    await Promise.all([
      ensureDir(this.paths.rootDir),
      ensureDir(this.paths.graphDir),
      ensureDir(this.paths.indexesDir),
      ensureDir(this.paths.snapshotsDir),
      ensureDir(this.paths.hygieneDir),
      ensureDir(this.paths.tmpDir),
      ensureDir(this.paths.locksDir),
    ]);
    await withFileLock(this.paths.manifest, async () => {
      const existing = await readJson<SuperMemoryManifest>(this.paths.manifest);
      if (!existing) {
        const now = this.nowIso();
        const manifest: SuperMemoryManifest = {
          schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
          createdAt: now,
          updatedAt: now,
        };
        await writeJson(this.paths.manifest, manifest);
      }
    });
    this.initialized = true;
  }

  async rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory> {
    validateRememberInput(input);
    const normalizedText = normalizeText(input.text);
    if (!normalizedText) throw new Error('Super Memory text must not be empty.');
    this.rejectIfUnsafeInput(input);
    await this.initialize();
    const scope = input.scope ?? legacyToSuperScope(input.legacyScope ?? 'project-memory');
    const legacyScope = input.legacyScope;
    const kind = input.kind ?? legacyTypeToKind(input.type);
    const tags = normalizeTags(input.tags);
    const anchors = normalizeAnchors(this.projectRoot, input.anchors ?? []);
    const audience = normalizeAudience(input.audience);
    const sources = normalizeSources(input.sources ?? [{ type: 'user' }]);
    const persistence = normalizePersistence(input.persistence);
    let created = false;
    const memory = await this.runMutation(async () => {
      const duplicate = (await this.loadMemories()).find((candidate) =>
        (candidate.status === 'active' || candidate.status === 'stale')
        && memoryIdentity(candidate) === memoryIdentity({
          text: normalizedText,
          scope,
          legacyScope,
        }));
      if (duplicate) {
        const mergedPatch = {
          kind: duplicate.kind === 'fact' && kind !== 'fact' ? kind : duplicate.kind,
          tags: [...new Set([...duplicate.tags, ...tags])],
          anchors: dedupeAnchors([...duplicate.anchors, ...anchors]),
          ...(audience ? { audience } : {}),
          sources: dedupeSources([...duplicate.sources, ...sources]),
          importance: Math.max(duplicate.importance, clamp01(input.importance ?? importanceFromPriority(input.priority))),
          confidence: Math.max(duplicate.confidence, clamp01(input.confidence ?? 0.8)),
          freshness: Math.max(duplicate.freshness, clamp01(input.freshness ?? 1)),
          supersedes: uniqueIds([...(duplicate.supersedes ?? []), ...(input.supersedes ?? [])]),
          contradicts: uniqueIds([...(duplicate.contradicts ?? []), ...(input.contradicts ?? [])]),
        } satisfies Partial<SuperMemory>;
        const merged = memoryPatchChanges(duplicate, mergedPatch)
          ? await this.updateMemory(duplicate, mergedPatch)
          : duplicate;
        await this.addAutomaticEdges(merged);
        await this.applyDeclaredRelationships(merged);
        await this.afterMutation();
        await this.audit('memory.duplicate_merged', {
          memoryId: merged.id,
          source: sources[0]?.type,
          reason: 'rememberSuper',
        });
        this.events?.emit('memory.merged', this.eventPayload({ memoryId: merged.id, mergedIds: [] }));
        return merged;
      }

      const now = this.nowIso();
      const freshMemory: SuperMemory = {
        id: `mem_${ulid()}`,
        revision: 1,
        scope,
        legacyScope,
        kind,
        status: 'active',
        text: normalizedText,
        importance: clamp01(input.importance ?? importanceFromPriority(input.priority)),
        confidence: clamp01(input.confidence ?? 0.8),
        freshness: clamp01(input.freshness ?? 1),
        tags,
        anchors,
        ...(audience ? { audience } : {}),
        sources,
        persistence,
        supersedes: uniqueIds(input.supersedes),
        contradicts: uniqueIds(input.contradicts),
        createdAt: now,
        updatedAt: now,
      };
      created = true;
      await this.appendRecord('create', freshMemory);
      await this.addAutomaticEdges(freshMemory);
      await this.applyDeclaredRelationships(freshMemory);
      await this.afterMutation();
      return freshMemory;
    });
    if (created) {
      await this.audit('memory.accepted', {
        memoryId: memory.id,
        source: memory.sources[0]?.type,
        reason: 'rememberSuper',
      });
      this.events?.emit('memory.remembered', {
        scope: memory.legacyScope ?? superToLegacyScope(memory.scope),
        text: memory.text,
        ts: memory.createdAt,
        type: toLegacyEntry(memory).type,
        tags: memory.tags,
        priority: toLegacyEntry(memory).priority,
      });
      this.events?.emit('memory.accepted', this.eventPayload({ memoryId: memory.id }));
    }
    return memory;
  }

  async listSuper(statuses?: SuperMemoryStatus[]): Promise<SuperMemory[]> {
    const all = await this.loadMemories();
    const allowed = statuses ? new Set(statuses) : undefined;
    return all
      .filter((memory) => !allowed || allowed.has(memory.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async addGraphEdge(
    from: string,
    to: string,
    relation: MemoryGraphRelation,
    weight = 1,
  ): Promise<MemoryGraphEdge> {
    await this.initialize();
    const edge = await this.graph.add(normalizeNode(from), normalizeNode(to), relation, weight);
    this.events?.emit('memory.graph_edge_added', this.eventPayload({
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
    }));
    await this.audit('memory.graph_edge_added', {
      details: { edgeId: edge.id, from: edge.from, to: edge.to, relation: edge.relation },
    });
    return edge;
  }

  async graphFor(query: string, maxDepth = 2, limit = 100): Promise<MemoryGraphEdge[]> {
    const starts = new Set<string>();
    if (/^(mem|file|dir|symbol|command|session|tool):/.test(query)) starts.add(normalizeNode(query));
    else if (/^mem_[A-Za-z0-9]+$/.test(query.trim())) starts.add(`mem:${query.trim()}`);
    const normalizedPath = normalizeProjectPath(this.projectRoot, query);
    starts.add(`file:${normalizedPath}`);
    starts.add(`dir:${normalizedPath}`);
    for (const memory of await this.searchSuper(query, { limit: 20 })) starts.add(`mem:${memory.id}`);
    return this.graph.traverse([...starts], { maxDepth, limit });
  }

  async verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]> {
    signal?.throwIfAborted();
    await this.initialize();
    return this.runMutation(async () => {
      const memories = (await this.loadMemories()).filter(
        (memory) => memory.status !== 'deleted' && (!memoryId || memory.id === memoryId),
      );
      return this.verifyMemoriesUnlocked(memories, signal);
    });
  }

  async verifyForPaths(paths: string[], signal?: AbortSignal): Promise<MemoryVerificationResult[]> {
    signal?.throwIfAborted();
    await this.initialize();
    const normalized = paths.map((value) => normalizeProjectPath(this.projectRoot, value));
    return this.runMutation(async () => {
      const matching = (await this.loadMemories()).filter(
        (memory) => memory.status !== 'deleted' && memory.anchors.some((anchor) => {
          if (!anchor.path) return false;
          const anchorPath = normalizeSlashes(anchor.path);
          return normalized.some((target) => target === anchorPath || target.startsWith(`${anchorPath}/`) || anchorPath.startsWith(`${target}/`));
        }),
      );
      return this.verifyMemoriesUnlocked(matching, signal);
    });
  }

  async recordInjection(memoryIds: string[], trigger: string, sessionId?: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.initialize();
    this.accumulateCounters(memoryIds, 'injections');
    await this.audit('memory.injected', { details: { memoryIds, trigger, sessionId } });
    this.events?.emit('memory.injected', this.eventPayload({ memoryIds, trigger, sessionId }));
    await this.flushCountersIfDue();
  }

  async recordUse(memoryIds: string[], source: string, sessionId?: string): Promise<void> {
    if (memoryIds.length === 0) return;
    await this.initialize();
    this.accumulateCounters(memoryIds, 'uses');
    await this.audit('memory.used', { details: { memoryIds, source, sessionId } });
    this.events?.emit('memory.used', this.eventPayload({ memoryIds, source, sessionId }));
    // Uses are rare (at most one per injection) and are the higher-value
    // signal — persist them promptly instead of waiting out the batch window.
    await this.flushCounters();
  }

  private accumulateCounters(memoryIds: string[], field: 'injections' | 'uses'): void {
    for (const id of memoryIds) {
      const pending = this.pendingCounters.get(id) ?? { injections: 0, uses: 0 };
      pending[field] += 1;
      this.pendingCounters.set(id, pending);
    }
  }

  private async flushCountersIfDue(): Promise<void> {
    if (this.pendingCounters.size === 0) return;
    const nowMs = this.now().getTime();
    if (this.lastCounterFlushAtMs !== 0 && nowMs - this.lastCounterFlushAtMs < COUNTER_FLUSH_INTERVAL_MS) return;
    await this.flushCounters();
  }

  private async flushCounters(): Promise<void> {
    if (this.pendingCounters.size === 0) return;
    this.lastCounterFlushAtMs = this.now().getTime();
    try {
      await this.runMutation(() => this.flushCountersUnlocked());
    } catch (error) {
      // Counters are advisory analytics; a failed flush must not break the
      // tool call that triggered it. Unapplied deltas stay pending because
      // flushCountersUnlocked only deletes entries it has persisted.
      this.lastCounterFlushAtMs = 0;
      await this.audit('memory.counter_flush_failed', {
        reason: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
  }

  private async flushCountersUnlocked(opts: { skipAfterMutation?: boolean } = {}): Promise<void> {
    if (this.pendingCounters.size === 0) return;
    const now = this.nowIso();
    const memories = await this.loadMemories();
    const seen = new Set<string>();
    let changed = false;
    for (const memory of memories) {
      const pending = this.pendingCounters.get(memory.id);
      if (!pending) continue;
      seen.add(memory.id);
      if (memory.status === 'deleted') {
        this.pendingCounters.delete(memory.id);
        continue;
      }
      await this.updateMemory(memory, {
        injectionCount: (memory.injectionCount ?? 0) + pending.injections,
        useCount: (memory.useCount ?? 0) + pending.uses,
        lastAccessedAt: now,
        ...(pending.uses > 0 ? { lastUsedAt: now } : {}),
      }, { preserveUpdatedAt: true });
      this.pendingCounters.delete(memory.id);
      changed = true;
    }
    // Drop deltas for memories that no longer exist; they can never be applied.
    for (const id of this.pendingCounters.keys()) {
      if (!seen.has(id) && !memories.some((memory) => memory.id === id)) this.pendingCounters.delete(id);
    }
    if (changed && !opts.skipAfterMutation) await this.afterMutation();
  }

  async hygiene(options: SuperMemoryHygieneOptions = {}, signal?: AbortSignal): Promise<SuperMemoryHygieneReport> {
    signal?.throwIfAborted();
    await this.initialize();
    return this.runMutation(() => this.hygieneUnlocked(options, signal));
  }

  private async hygieneUnlocked(
    options: SuperMemoryHygieneOptions,
    signal?: AbortSignal,
  ): Promise<SuperMemoryHygieneReport> {
    await this.initialize();
    // Apply this instance's pending feedback deltas so archive-unused
    // decisions below see current counters.
    await this.flushCountersUnlocked({ skipAfterMutation: true });
    const startedAt = this.nowIso();
    const initial = await this.loadMemories();
    const report: SuperMemoryHygieneReport = {
      startedAt,
      completedAt: startedAt,
      examined: initial.filter((memory) => memory.status !== 'deleted').length,
      deduplicated: 0,
      superseded: 0,
      contradicted: 0,
      staled: 0,
      reviewCandidatesCreated: 0,
      archived: 0,
      archivedUnused: 0,
      deleted: 0,
      verified: 0,
    };
    this.events?.emit('memory.hygiene_started', this.eventPayload({ examined: report.examined }));
    await this.audit('memory.hygiene_started', { details: { examined: report.examined } });

    const active = initial.filter((memory) => memory.status === 'active');
    const duplicateGroups = groupBy(active, memoryIdentity);
    for (const group of duplicateGroups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort(compareMemoryQuality);
      const keeper = sorted[0];
      if (!keeper) continue;
      const duplicates = sorted.slice(1);
      await this.updateMemory(keeper, {
        tags: [...new Set(sorted.flatMap((memory) => memory.tags))],
        anchors: dedupeAnchors(sorted.flatMap((memory) => memory.anchors)),
        sources: dedupeSources(sorted.flatMap((memory) => memory.sources)),
        supersedes: [...new Set([...(keeper.supersedes ?? []), ...duplicates.map((memory) => memory.id)])],
      });
      for (const duplicate of duplicates) {
        await this.updateMemory(duplicate, { status: 'superseded', supersededBy: keeper.id });
        await this.addGraphEdge(`mem:${keeper.id}`, `mem:${duplicate.id}`, 'supersedes', 1);
        report.deduplicated++;
        report.superseded++;
        this.events?.emit('memory.superseded', this.eventPayload({ memoryId: duplicate.id, supersededBy: keeper.id }));
      }
      this.events?.emit('memory.merged', this.eventPayload({ memoryId: keeper.id, mergedIds: duplicates.map((memory) => memory.id) }));
    }

    if (options.verify !== false) {
      const verified = await this.verifyMemoriesUnlocked(
        (await this.loadMemories()).filter((memory) => memory.status !== 'deleted'),
        signal,
      );
      report.verified = verified.filter((item) => item.status === 'verified').length;
      report.staled = verified.filter((item) => item.status === 'stale').length;
    }

    const nowMs = this.now().getTime();
    const retentionMs = daysToMs(options.retentionDays ?? 90);
    const lowConfidenceMs = daysToMs(options.archiveLowConfidenceAfterDays ?? 30);
    const unusedMs = daysToMs(options.archiveUnusedAfterDays ?? 30);
    const unusedMinInjections = Math.max(1, Math.floor(options.unusedMinInjections ?? 10));
    // Track ids we already produced a candidate for this run — prevents
    // duplicate candidates if multiple rules match the same memory.
    const candidateEmittedFor = new Set<string>();
    for (const memory of await this.loadMemories()) {
      if (memory.status === 'deleted' || memory.status === 'superseded' || memory.status === 'contradicted') continue;
      const age = nowMs - Date.parse(memory.lastAccessedAt ?? memory.updatedAt);
      const persistence = memory.persistence ?? DEFAULT_PERSISTENCE;
      let reason: MemoryReviewReason | undefined;
      let suggestedAction: 'delete' | 'archive' | 'investigate' = 'investigate';
      if (memory.scope === 'session' && memory.expiresAt && Date.parse(memory.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (memory.expiresAt && Date.parse(memory.expiresAt) <= nowMs) {
        reason = 'expires_at_passed';
        suggestedAction = 'delete';
      } else if (
        memory.status === 'active'
        && memory.scope !== 'session'
        && (memory.injectionCount ?? 0) >= unusedMinInjections
        && (memory.useCount ?? 0) === 0
        && nowMs - Date.parse(memory.updatedAt) >= unusedMs
      ) {
        // Age is measured from updatedAt, not lastAccessedAt: every injection
        // bumps lastAccessedAt, which is exactly the signal this rule targets,
        // so measuring from it would never let a frequently-injected memory
        // qualify. updatedAt only moves on real content edits (counter flushes
        // preserve it), making it the honest "untouched for N days" basis.
        reason = 'injected_never_used';
        suggestedAction = 'delete';
      } else if (
        (memory.status === 'stale' && age >= retentionMs)
        || (memory.confidence < 0.5 && age >= lowConfidenceMs)
      ) {
        reason = memory.confidence < 0.5 ? 'confidence_low' : 'freshness_low';
        suggestedAction = 'investigate';
      }

      // `permanent` memories are exempt from time/usage rules. They may still
      // be reported as `stale` by anchor verify above — that flow is the only
      // hygiene surface for permanent.
      if (reason && persistence !== 'permanent' && !candidateEmittedFor.has(memory.id)) {
        candidateEmittedFor.add(memory.id);
        const ageDays = Math.floor((nowMs - Date.parse(memory.updatedAt)) / 86_400_000);
        const candidate = await this.createCandidateUnlocked({
          // text + kind + scope mirror the memory so the ReviewQueue UI can
          // render it without joining; review metadata rides on tags.
          text: memory.text,
          kind: memory.kind,
          scope: memory.scope,
          confidence: 0.6,
          importance: 0.4,
          anchors: memory.anchors,
          sources: [{ type: 'session', sessionId: this.traceId }],
          // Carry review metadata on the candidate for the UI to surface.
          tags: [
            ...memory.tags,
            `review:${reason}`,
            `suggested:${suggestedAction}`,
            `persistence:${persistence}`,
          ],
        });
        // Audit log is the durable source-of-truth for review metadata — the
        // eventBus surface is left to subscribers that already consume the
        // core MemoryEventMap (which doesn't include this key locally yet).
        await this.audit('memory.review_candidate_created', {
          memoryId: memory.id,
          reason,
          details: {
            candidateId: candidate.id,
            suggestedAction,
            ageDays,
            persistence,
            status: memory.status,
            confidence: memory.confidence,
          },
        });
        report.reviewCandidatesCreated++;
      }
    }
    await this.afterMutation();
    report.completedAt = this.nowIso();
    await appendJsonl(path.join(this.paths.hygieneDir, 'runs.jsonl'), report);
    await this.audit('memory.hygiene_completed', { details: report as unknown as Record<string, unknown> });
    this.events?.emit('memory.hygiene_completed', this.eventPayload({
      examined: report.examined,
      deduplicated: report.deduplicated,
      staled: report.staled,
      archived: report.archived,
    }));
    return report;
  }

  async stats(): Promise<SuperMemoryStats> {
    const memories = await this.loadMemories();
    const byStatus = Object.fromEntries(
      ['active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted'].map((status) => [status, 0]),
    ) as Record<SuperMemoryStatus, number>;
    const byKind: SuperMemoryStats['byKind'] = {};
    let injections = 0;
    let uses = 0;
    for (const memory of memories) {
      byStatus[memory.status]++;
      byKind[memory.kind] = (byKind[memory.kind] ?? 0) + 1;
      injections += memory.injectionCount ?? 0;
      uses += memory.useCount ?? 0;
    }
    return { total: memories.length, byStatus, byKind, edges: (await this.graph.list()).length, injections, uses };
  }

  /**
   * Restore a deleted memory to `active`. Superseded memories resolve to
   * the head of their version chain (the chain head is the active record).
   * Already-active memories are returned unchanged with `noop: true`.
   * Permanence is preserved — recovering a deleted memory does not alter
   * its `persistence` class. The whole operation is audit-logged.
   */
  async recoverSuperMemory(id: string, reason = 'Manually recovered via API.'): Promise<SuperMemory> {
    const memory = await this.getSuperMemory(id);
    if (!memory) throw new Error(`Super Memory "${id}" not found.`);

    // Superseded: return the head of the version chain without writing.
    if (memory.status === 'superseded') {
      if (memory.supersededBy) {
        const head = await this.getSuperMemory(memory.supersededBy);
        if (head) {
          await this.audit('memory.recover_noop', {
            memoryId: id,
            reason: 'Already superseded; returning head of version chain.',
            details: { activeId: head.id },
          });
          this.events?.emit('memory.recover_noop', this.eventPayload({ requestedId: id, activeId: head.id }));
          return head;
        }
      }
      throw new Error(
        `Super Memory "${id}" is superseded but its chain head is unavailable. ` +
        `Use memory_update to create a new active version.`
      );
    }

    // Active: no-op.
    if (memory.status === 'active') {
      return memory;
    }

    // Deleted (or any other terminal status): restore to active.
    if (memory.status !== 'deleted') {
      throw new Error(
        `Super Memory "${id}" has status "${memory.status}" and cannot be recovered. ` +
        `Use memory_update to alter its status explicitly.`
      );
    }

    return this.runMutation(async () => {
      const fresh = (await this.loadMemories()).find((m) => m.id === id);
      if (!fresh) throw new Error(`Super Memory "${id}" was removed before recover completed.`);
      if (fresh.status === 'active') return fresh; // race-safe: another caller won.

      const restored = await this.updateMemory(fresh, { status: 'active' });
      await this.afterMutation();
      await this.audit('memory.recovered', {
        memoryId: id,
        reason,
        details: { persistence: restored.persistence ?? DEFAULT_PERSISTENCE },
      });
      this.events?.emit('memory.recovered', this.eventPayload({ memoryId: id, reason }));
      return restored;
    });
  }

  /**
   * Backfill recoverable `deleted` memories into fresh active versions.
   *
   * Why "backfill" instead of "recover":
   *   - The redesigned contract preserves the "once deleted, never active again"
   *     invariant for the original record. So instead of mutating
   *     `status: 'deleted'` → `'active'` (which would erase audit history),
   *     we create a NEW active version of the memory and link it to the
   *     original via the `supersedes` chain. The original stays `deleted`,
   *     preserving the immutable audit trail of the deletion.
   *   - This is the path used by users who want to undo a hygiene-driven
   *     deletion from a prior session (the contract was already safer after
   *     PR #2, but legacy deleted records from before then may still exist).
   *
   * `dryRun: true` (default) returns a report without writing anything.
   * `dryRun: false` actually creates the new versions inside a single mutation.
   */
  async backfillRecoverable(
    options: SuperMemoryBackfillOptions = {},
  ): Promise<SuperMemoryBackfillReport> {
    await this.initialize();
    const dryRun = options.dryRun !== false;
    const filter = options.filter ?? {};
    const requireText = filter.requireText !== false;
    const requireProvenance = filter.requireProvenance !== false;

    const startedAt = this.nowIso();
    const allMemories = await this.loadMemories();
    const deleted = allMemories.filter((memory) => memory.status === 'deleted');

    const report: SuperMemoryBackfillReport = {
      startedAt,
      completedAt: startedAt,
      dryRun,
      examined: deleted.length,
      recoverable: 0,
      recovered: 0,
      skipped: 0,
      skippedRecords: [],
      recoverableRecords: [],
      byKind: {},
      byReason: {},
    };

    if (deleted.length === 0) {
      report.completedAt = this.nowIso();
      return report;
    }

    // Phase 1 — analyze and classify (no writes).
    for (const memory of deleted) {
      if (filter.kinds && !filter.kinds.includes(memory.kind)) {
        report.skipped++;
        report.byReason['filter_kinds'] = (report.byReason['filter_kinds'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'filter_kinds', undefined));
        continue;
      }
      if (filter.scopes && !filter.scopes.includes(memory.scope)) {
        report.skipped++;
        report.byReason['filter_scopes'] = (report.byReason['filter_scopes'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'filter_scopes', undefined));
        continue;
      }
      if (filter.updatedAfter && memory.updatedAt < filter.updatedAfter) {
        report.skipped++;
        report.byReason['filter_updatedAfter'] = (report.byReason['filter_updatedAfter'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'filter_updatedAfter', undefined));
        continue;
      }
      if (filter.updatedBefore && memory.updatedAt > filter.updatedBefore) {
        report.skipped++;
        report.byReason['filter_updatedBefore'] = (report.byReason['filter_updatedBefore'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'filter_updatedBefore', undefined));
        continue;
      }
      if (requireText && (!memory.text || memory.text.trim().length === 0)) {
        report.skipped++;
        report.byReason['empty_text'] = (report.byReason['empty_text'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'empty_text', undefined));
        continue;
      }
      if (
        requireProvenance
        && (!memory.sources || memory.sources.length === 0)
        && (!memory.anchors || memory.anchors.length === 0)
      ) {
        report.skipped++;
        report.byReason['no_provenance'] = (report.byReason['no_provenance'] ?? 0) + 1;
        report.skippedRecords.push(this.toBackfillRecord(memory, 'no_provenance', undefined));
        continue;
      }

      // Eligible for backfill.
      report.recoverable++;
      report.byKind[memory.kind] = (report.byKind[memory.kind] ?? 0) + 1;
      report.recoverableRecords.push(this.toBackfillRecord(memory, 'recoverable', undefined));
    }

    // Phase 2 — apply (only when not dry-run). Single mutation so all
    // new versions land atomically; the original `deleted` records are
    // untouched (the JSONL append-only contract is preserved).
    if (!dryRun && report.recoverable > 0) {
      await this.runMutation(async () => {
        // Re-read deleted set inside the mutation to avoid stale references.
        const freshDeleted = new Set(
          (await this.loadMemories())
            .filter((memory) => memory.status === 'deleted')
            .map((memory) => memory.id),
        );
        for (let i = 0; i < report.recoverableRecords.length; i++) {
          const preview = report.recoverableRecords[i]!;
          const originalId = preview.originalId;
          if (!freshDeleted.has(originalId)) {
            // The deleted record was modified (rare, since deletion is
            // terminal under our contract). Skip rather than corrupt.
            report.byReason['race_lost'] = (report.byReason['race_lost'] ?? 0) + 1;
            preview.reason = 'race_lost';
            continue;
          }
          const original = (await this.loadMemories()).find((memory) => memory.id === originalId);
          if (!original) continue;

          const newMemory = await this.createBackfilledVersionUnlocked(original);
          preview.newActiveId = newMemory.id;
          report.recovered++;
          await this.audit('memory.backfilled', {
            memoryId: original.id,
            reason: 'backfillRecoverable',
            details: {
              newActiveId: newMemory.id,
              kind: newMemory.kind,
              scope: newMemory.scope,
              persistence: newMemory.persistence,
            },
          });
        }
      });
    }

    report.completedAt = this.nowIso();
    await this.audit(
      dryRun ? 'memory.backfill_dry_run' : 'memory.backfill_applied',
      { details: report as unknown as Record<string, unknown> },
    );
    // Event emission is intentionally skipped here: the consumer for these
    // backfill signals is the same caller that invoked backfillRecoverable
    // (they already have the report). Subscribing downstream callers via
    // EventBus would only matter if we wanted real-time UI updates — the
    // MemoryManager instead refreshes after the tool returns. The audit
    // log remains the durable source-of-truth for analytics/dashboards.
    return report;
  }

  /**
   * Build a `SuperMemoryBackfillRecord` snapshot from a deleted memory.
   * Used both for skipped (with a reason) and recoverable (reason: 'recoverable')
   * classifications. Truncates `text` to 200 chars for UI display.
   */
  private toBackfillRecord(
    memory: SuperMemory,
    reason: string,
    newActiveId: string | undefined,
  ): SuperMemoryBackfillReport['recoverableRecords'][number] {
    const preview = (memory.text ?? '').slice(0, 200);
    return {
      originalId: memory.id,
      newActiveId,
      reason,
      kind: memory.kind,
      scope: memory.scope,
      textPreview: preview,
      deletedAt: memory.updatedAt,
      persistence: memory.persistence ?? DEFAULT_PERSISTENCE,
    };
  }

  /**
   * Build a fresh active version of a deleted memory. Mirrors every
   * metadata field that still makes sense (anchors, sources, audience,
   * tags, persistence) and threads the original id through `supersedes`
   * so the version chain is discoverable.
   *
   * Must be called inside an existing mutation (uses `appendRecord` +
   * `addAutomaticEdges` + `applyDeclaredRelationships` + `afterMutation`).
   * Does NOT mutate the source record — its `status` stays `deleted`.
   */
  private async createBackfilledVersionUnlocked(
    original: SuperMemory,
  ): Promise<SuperMemory> {
    const now = this.nowIso();
    const newMemory: SuperMemory = {
      id: `mem_${ulid()}`,
      revision: 1,
      scope: original.scope,
      legacyScope: original.legacyScope,
      kind: original.kind,
      status: 'active',
      persistence: original.persistence ?? DEFAULT_PERSISTENCE,
      text: original.text,
      summary: original.summary,
      importance: original.importance,
      confidence: original.confidence,
      freshness: original.freshness,
      tags: [...original.tags, 'backfill:recovered'],
      anchors: original.anchors,
      audience: original.audience,
      sources: original.sources,
      // Thread the original id through the supersedes chain so memory_graph
      // can show "this version was backfilled from <originalId>".
      supersedes: uniqueIds([...(original.supersedes ?? []), original.id]),
      createdAt: now,
      updatedAt: now,
    };
    await this.appendRecord('create', newMemory);
    await this.addAutomaticEdges(newMemory);
    await this.applyDeclaredRelationships(newMemory);
    return newMemory;
  }

  async getSuperMemory(id: string): Promise<SuperMemory | null> {
    const all = await this.loadMemories();
    return all.find((memory) => memory.id === id) ?? null;
  }

  /**
   * Find memories attached to / relevant to a file path.
   *
   * The contract is read-only and side-effect-free: opening a file in the
   * editor must never mutate the memory store. Returns three buckets:
   *   - `primaryMatches`: scope='file' memories OR memory anchors that
   *     directly match the file path (or sit in a parent directory if
   *     `lineStart`/`lineEnd` aren't supplied).
   *   - `symbolMatches`: memory anchors on a symbol whose line range
   *     overlaps the supplied cursor range (when provided); otherwise empty.
   *   - `relatedMatches`: memories whose text mentions the file basename
   *     (weakest signal — surfaced as "💬 Mentioned in").
   *
   * Each match carries `matchedVia`, `matchStrength`, an optional
   * `supersededByActiveId` (for navigation), and an optional
   * `pendingReview` (for hygiene review candidates).
   */
  async findMemoriesForFile(
    filePath: string,
    options: FindMemoriesForFileOptions = {},
  ): Promise<FindMemoriesForFileResponse> {
    await this.initialize();
    const normalizedPath = normalizeProjectPath(this.projectRoot, filePath);
    const includeSuperseded = options.includeSuperseded !== false;
    const includeDeleted = options.includeDeleted === true;
    const limit = options.limit ?? 50;

    const allMemories = await this.loadMemories();
    // Build candidate id set first so we can resolve supersededByActiveId /
    // pendingReview without O(n²) lookups inside the loop.
    const memoryById = new Map<string, SuperMemory>();
    for (const memory of allMemories) memoryById.set(memory.id, memory);

    // Pending review candidate index — one pass over all candidates.
    const pendingByMemoryId = new Map<string, NonNullable<MemoryForFileMatch['pendingReview']>>();
    try {
      const allCandidates = await this.listCandidates();
      for (const candidate of allCandidates) {
        if (candidate.status !== 'pending') continue;
        // Candidates carry `tags: [..., 'review:<reason>', 'suggested:<action>', ...]`
        // and `text` mirrors the source memory so we can reverse-lookup by text.
        // Source memory id is exposed via tag `source:<memoryId>` (set by the
        // review candidate emitter) — fall back to text match if absent.
        const sourceTag = candidate.tags.find((tag) => tag.startsWith('source:'));
        const sourceId = sourceTag ? sourceTag.slice('source:'.length) : undefined;
        const reasonTag = candidate.tags.find((tag) => tag.startsWith('review:'));
        const reason = reasonTag ? reasonTag.slice('review:'.length) : candidate.kind;
        const actionTag = candidate.tags.find((tag) => tag.startsWith('suggested:'));
        const actionRaw = actionTag ? actionTag.slice('suggested:'.length) : 'investigate';
        const suggestedAction = (actionRaw === 'delete' || actionRaw === 'archive' || actionRaw === 'update')
          ? actionRaw
          : 'investigate';
        const ageDays = Math.floor(
          (Date.now() - Date.parse(candidate.createdAt)) / 86_400_000,
        );
        const review: NonNullable<MemoryForFileMatch['pendingReview']> = {
          candidateId: candidate.id,
          reason,
          suggestedAction,
          ageDays,
        };
        if (sourceId && memoryById.has(sourceId)) {
          pendingByMemoryId.set(sourceId, review);
        } else {
          // Fall back: match by text equality (best-effort). This is rare
          // because the candidate emitter always sets `source:<id>`.
          for (const memory of memoryById.values()) {
            if (memory.text === candidate.text && !pendingByMemoryId.has(memory.id)) {
              pendingByMemoryId.set(memory.id, review);
              break;
            }
          }
        }
      }
    } catch {
      // Candidate log missing or unreadable — proceed without review metadata.
    }

    const basename = normalizedPath.split('/').pop() ?? '';
    const primaryMatches: MemoryForFileMatch[] = [];
    const symbolMatches: MemoryForFileMatch[] = [];
    const relatedMatches: MemoryForFileMatch[] = [];

    for (const memory of allMemories) {
      // Skip deleted unless the caller explicitly opted in.
      if (memory.status === 'deleted' && !includeDeleted) continue;
      // Superseded memories are surfaced but flagged via supersededByActiveId.
      // Active + stale + archived + superseded all reach this point.
      const matched = matchMemoryToFileDraw(
        memory,
        normalizedPath,
        basename,
        options.lineStart,
        options.lineEnd,
      );
      if (!matched) continue;

      const match: MemoryForFileMatch = {
        memory,
        matchedVia: matched.via,
        matchStrength: matched.strength,
        ...(memory.status === 'superseded' && memory.supersededBy
          ? (() => {
              const head = memoryById.get(memory.supersededBy);
              return head && head.status === 'active'
                ? { supersededByActiveId: head.id }
                : {};
            })()
          : {}),
        ...(pendingByMemoryId.has(memory.id)
          ? { pendingReview: pendingByMemoryId.get(memory.id) }
          : {}),
      };

      if (matched.via === 'scope_symbol' || matched.via === 'anchor_symbol') {
        symbolMatches.push(match);
      } else if (
        matched.via === 'scope_file' ||
        matched.via === 'anchor_file' ||
        matched.via === 'anchor_directory'
      ) {
        primaryMatches.push(match);
      } else {
        relatedMatches.push(match);
      }

      // Respect includeSuperseded: if false, drop superseded matches.
      if (!includeSuperseded && memory.status === 'superseded') {
        const bucket = symbolMatches.includes(match)
          ? symbolMatches
          : primaryMatches.includes(match)
            ? primaryMatches
            : relatedMatches;
        const idx = bucket.indexOf(match);
        if (idx >= 0) bucket.splice(idx, 1);
      }

      // Apply per-bucket caps.
      if (primaryMatches.length + symbolMatches.length + relatedMatches.length >= limit * 3) {
        break;
      }
    }

    // Sort each bucket by matchStrength DESC then updatedAt DESC.
    const sorter = (a: MemoryForFileMatch, b: MemoryForFileMatch) =>
      b.matchStrength - a.matchStrength
      || b.memory.updatedAt.localeCompare(a.memory.updatedAt);
    primaryMatches.sort(sorter);
    symbolMatches.sort(sorter);
    relatedMatches.sort(sorter);

    // Apply final per-bucket cap so callers can rely on ≤ limit per bucket.
    const cap = (arr: MemoryForFileMatch[]) => arr.slice(0, limit);
    const all = [...primaryMatches, ...symbolMatches, ...relatedMatches];
    return {
      filePath: normalizedPath,
      primaryMatches: cap(primaryMatches),
      symbolMatches: cap(symbolMatches),
      relatedMatches: cap(relatedMatches),
      totalCount: all.length,
      activeCount: all.filter((m) => m.memory.status === 'active').length,
      supersededCount: all.filter((m) => m.memory.status === 'superseded').length,
      reviewPendingCount: all.filter((m) => m.pendingReview !== undefined).length,
    };
  }

  async updateSuperMemory(
    id: string,
    patch: import('./types.js').UpdateSuperMemoryInput,
  ): Promise<SuperMemory> {
    if (Object.keys(patch).length === 0) throw new Error('Update patch must not be empty.');

    const memory = await this.getSuperMemory(id);
    if (!memory) throw new Error(`Super Memory "${id}" not found.`);
    if (memory.status === 'deleted') throw new Error(`Super Memory "${id}" is deleted and cannot be updated.`);

    const validatedPatch: Record<string, unknown> = {};

    if (patch.text !== undefined) {
      const normalized = normalizeText(patch.text);
      if (!normalized) throw new Error('Super Memory text must not be empty.');
      validatedPatch.text = normalized;
    }
    if (patch.tags !== undefined) {
      if (!Array.isArray(patch.tags)) throw new Error('tags must be an array of strings.');
      if (patch.tags.length > MAX_MEMORY_METADATA_ITEMS) throw new Error(`tags exceeds maximum of ${MAX_MEMORY_METADATA_ITEMS} items.`);
      validatedPatch.tags = normalizeTags(patch.tags);
    }
    if (patch.persistence !== undefined) {
      // Forward-compat: only known values accepted. Throws on unknown so a
      // future enum value never silently round-trips into an invalid record.
      if (!VALID_PERSISTENCE.has(patch.persistence)) {
        throw new Error(`Invalid persistence class: ${String(patch.persistence)}`);
      }
      validatedPatch.persistence = patch.persistence;
    }
    if (patch.kind !== undefined) {
      if (!VALID_KINDS.has(patch.kind)) throw new Error(`Invalid kind: ${patch.kind}`);
      validatedPatch.kind = patch.kind;
    }
    if (patch.anchors !== undefined) {
      if (!Array.isArray(patch.anchors)) throw new Error('anchors must be an array.');
      if (patch.anchors.length > MAX_MEMORY_METADATA_ITEMS) throw new Error(`anchors exceeds maximum of ${MAX_MEMORY_METADATA_ITEMS} items.`);
      validatedPatch.anchors = normalizeAnchors(this.projectRoot, patch.anchors);
    }
    if (patch.audience !== undefined) {
      validatedPatch.audience = normalizeAudience(patch.audience);
    }
    if (patch.importance !== undefined) {
      validatedPatch.importance = clamp01(patch.importance);
    }
    if (patch.confidence !== undefined) {
      validatedPatch.confidence = clamp01(patch.confidence);
    }
    if (patch.freshness !== undefined) {
      validatedPatch.freshness = clamp01(patch.freshness);
    }
    if (patch.status !== undefined) {
      if (!VALID_STATUSES.has(patch.status)) throw new Error(`Invalid status: ${patch.status}`);
      // Permanent memories cannot be soft-deleted via updateSuperMemory —
      // callers must pass `force: true` (mirrors deleteSuperMemory). This
      // closes the bypass where updateSuperMemory({ status: 'deleted' })
      // skipped the permanence guard entirely.
      if (patch.status === 'deleted'
        && (memory.persistence ?? DEFAULT_PERSISTENCE) === 'permanent'
        && !patch.force) {
        throw new Error(
          `Super Memory "${id}" is marked 'permanent' and cannot be deleted via update. ` +
          `Pass { force: true } to override; the override will be recorded in the audit log.`,
        );
      }
      validatedPatch.status = patch.status;
    }
    if (patch.supersedes !== undefined) {
      if (!Array.isArray(patch.supersedes)) throw new Error('supersedes must be an array of strings.');
      if (patch.supersedes.length > MAX_MEMORY_METADATA_ITEMS) throw new Error(`supersedes exceeds maximum of ${MAX_MEMORY_METADATA_ITEMS} items.`);
      validatedPatch.supersedes = uniqueIds(patch.supersedes);
    }
    if (patch.contradicts !== undefined) {
      if (!Array.isArray(patch.contradicts)) throw new Error('contradicts must be an array of strings.');
      if (patch.contradicts.length > MAX_MEMORY_METADATA_ITEMS) throw new Error(`contradicts exceeds maximum of ${MAX_MEMORY_METADATA_ITEMS} items.`);
      validatedPatch.contradicts = uniqueIds(patch.contradicts);
    }

    return this.runMutation(async () => {
      // Reload memory inside the mutation to get latest revision
      const fresh = (await this.loadMemories()).find((m) => m.id === id);
      if (!fresh) throw new Error(`Super Memory "${id}" was removed before update completed.`);
      if (fresh.status === 'deleted') throw new Error(`Super Memory "${id}" was deleted before update completed.`);

      const updated = await this.updateMemory(fresh, validatedPatch as Partial<Omit<SuperMemory, 'id' | 'revision' | 'createdAt'>>);

      const patchHasRelationships = patch.supersedes !== undefined || patch.contradicts !== undefined;

      // If tags or text changed, rebuild anchor edges
      if (patch.tags || patch.text || patch.anchors) {
        await this.addAutomaticEdges(updated);
      }

      // If supersedes/contradicts changed, apply declared relationships
      if (patchHasRelationships) {
        // Re-read state so applyDeclaredRelationships sees the latest
        const refreshed = (await this.loadMemories()).find((m) => m.id === id);
        if (refreshed) {
          await this.applyDeclaredRelationships(refreshed);
        }
      }

      await this.afterMutation();
      await this.audit('memory.updated', {
        memoryId: id,
        reason: 'updateSuperMemory',
        details: { force: patch.force === true && validatedPatch.status === 'deleted' },
      });
      this.events?.emit('memory.updated', this.eventPayload({ memoryId: id, status: updated.status }));
      return updated;
    });
  }

  async deleteSuperMemory(
    id: string,
    reason = 'Manually deleted via API.',
    options: { force?: boolean; neverInject?: boolean } = {},
  ): Promise<void> {
    const memory = await this.getSuperMemory(id);
    if (!memory) throw new Error(`Super Memory "${id}" not found.`);
    if (memory.status === 'deleted') return; // Idempotent
    const persistence = memory.persistence ?? DEFAULT_PERSISTENCE;
    // ALL deletions require explicit force. This is the store-layer guard
    // that prevents autonomous agents (consolidator, Mnemosyne, direct
    // tool calls) from removing memories without explicit authorization.
    // The resolver (resolveCandidate) passes force internally as the
    // authorized review-decision path; human/LLM callers pass force via
    // the memory_delete tool's schema.
    if (!options.force) {
      if (persistence === 'permanent') {
        throw new Error(
          `Super Memory "${id}" is marked 'permanent' and cannot be deleted. ` +
          `Pass { force: true } to override; the override will be recorded in the audit log.`
        );
      }
      throw new Error(
        `Super Memory "${id}" cannot be deleted without explicit authorization. ` +
        `Pass { force: true } to the memory_delete tool, or resolve a review candidate ` +
        `via memory_candidates({ action: 'resolve', decision: 'delete' }). ` +
        `The force flag is recorded in the audit log.`
      );
    }

    await this.runMutation(async () => {
      // Reload inside mutation
      const fresh = (await this.loadMemories()).find((m) => m.id === id);
      if (!fresh) throw new Error(`Super Memory "${id}" was removed before delete completed.`);
      if (fresh.status === 'deleted') return; // Idempotent

      const removedEdges = await this.cascadeDeleteUnlocked(fresh, options.neverInject === true);

      await this.afterMutation();
      await this.audit('memory.deleted', {
        memoryId: id,
        reason,
        details: { removedEdges, force: options.force === true, contextPolicy: options.neverInject === true ? 'never' : 'eligible' },
      });
      this.events?.emit('memory.updated', this.eventPayload({ memoryId: id, status: 'deleted', contextPolicy: options.neverInject === true ? 'never' : 'eligible' }));
    });
  }

  /**
   * Soft-delete a memory and remove every reference to it: graph edges are
   * dropped and `supersedes`/`contradicts`/`supersededBy` pointers in other
   * memories are cleaned (preserving their updatedAt). Must be called from
   * inside a mutation (`runMutation`); the caller owns afterMutation/audit.
   * Shared by `deleteSuperMemory` and `forgetUnlocked` so both paths leave
   * the store in the same consistent state. Returns edges removed.
   */
  private async cascadeDeleteUnlocked(memory: SuperMemory, neverInject = false): Promise<number> {
    // 1. Remove graph edges involving this memory
    const removedEdges = await this.graph.removeNodeEdges(`mem:${memory.id}`);

    // 2. Cascade: clean up references in other memories
    const all = await this.loadMemories();
    for (const other of all) {
      if (other.id === memory.id || other.status === 'deleted') continue;
      const patch: Record<string, unknown> = {};
      if (other.supersedes?.includes(memory.id)) {
        patch.supersedes = other.supersedes.filter((s) => s !== memory.id);
      }
      if (other.contradicts?.includes(memory.id)) {
        patch.contradicts = other.contradicts.filter((c) => c !== memory.id);
      }
      if (other.supersededBy === memory.id) {
        patch.supersededBy = undefined;
      }
      if (Object.keys(patch).length > 0) {
        await this.updateMemory(other, patch as Partial<Omit<SuperMemory, 'id' | 'revision' | 'createdAt'>>, { preserveUpdatedAt: true });
      }
    }

    // 3. Soft-delete the memory itself
    await this.updateMemory(memory, { status: 'deleted', contextPolicy: neverInject ? 'never' : 'eligible' });
    return removedEdges;
  }

  async importLegacy(files: string | string[]): Promise<LegacyImportResult> {
    const paths = Array.isArray(files) ? files : [files];
    const result: LegacyImportResult = { imported: 0, skipped: 0, files: 0 };
    const existing = new Set(
      (await this.loadMemories())
        .filter((memory) => memory.status === 'active' || memory.status === 'stale')
        .map((memory) => memoryIdentity(memory)),
    );
    for (const filePath of paths) {
      let raw: string;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      result.files++;
      for (const entry of parseLegacyMemory(raw)) {
        const key = memoryIdentity({
          text: entry.text,
          scope: legacyToSuperScope(entry.scope),
          legacyScope: entry.scope,
        });
        if (!key || existing.has(key)) {
          result.skipped++;
          continue;
        }
        await this.rememberSuper({
          text: entry.text,
          legacyScope: entry.scope,
          type: entry.type,
          priority: entry.priority,
          tags: entry.tags,
          sources: [{ type: 'legacy_memory', path: filePath }],
        });
        existing.add(key);
        result.imported++;
      }
    }
    return result;
  }

  async createCandidate(
    input: CreateCandidateInput,
  ): Promise<MemoryCandidate> {
    validateRememberInput(input);
    this.rejectIfUnsafeInput(input);
    await this.initialize();
    return this.runMutation(() => this.createCandidateUnlocked(input));
  }

  private async createCandidateUnlocked(
    input: CreateCandidateInput,
  ): Promise<MemoryCandidate> {
    const text = normalizeText(input.text);
    if (!text) throw new Error('Super Memory candidate text must not be empty.');
    const scope = input.scope ?? 'project';
    const duplicate = (await this.listCandidates()).find((candidate) =>
      candidate.scope === scope && canonicalMemoryText(candidate.text) === canonicalMemoryText(text));
    if (duplicate) return duplicate;
    const now = this.nowIso();
    const candidate: MemoryCandidate = {
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      id: `candidate_${ulid()}`,
      status: 'pending',
      text,
      kind: input.kind ?? 'fact',
      scope,
      confidence: clamp01(input.confidence ?? 0.6),
      importance: clamp01(input.importance ?? 0.6),
      tags: normalizeTags(input.tags),
      anchors: normalizeAnchors(this.projectRoot, input.anchors ?? []),
      ...(normalizeAudience(input.audience) ? { audience: normalizeAudience(input.audience) } : {}),
      sources: normalizeSources(input.sources ?? [{ type: 'session' }]),
      createdAt: now,
      updatedAt: now,
      ...(input.targetMemoryId ? { targetMemoryId: input.targetMemoryId } : {}),
      ...(input.reviewReason ? { reviewReason: input.reviewReason } : {}),
    };
    await appendJsonl(this.paths.candidatesLog, candidate);
    await this.audit('memory.candidate_created', { details: { candidateId: candidate.id } });
    this.events?.emit('memory.candidate_created', this.eventPayload({ candidateId: candidate.id }));
    return candidate;
  }

  async listCandidates(includeResolved = false): Promise<MemoryCandidate[]> {
    const rows = await readJsonl<MemoryCandidate>(this.paths.candidatesLog);
    const latest = new Map<string, MemoryCandidate>();
    for (const row of rows) {
      if (isMemoryCandidate(row)) latest.set(row.id, row);
    }
    return [...latest.values()]
      .filter((candidate) => includeResolved || candidate.status === 'pending')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async readAudit(limit = 50): Promise<SuperMemoryAuditRecord[]> {
    const rows = await readJsonl<SuperMemoryAuditRecord>(this.paths.auditLog);
    return rows.slice(-Math.max(1, Math.min(limit, 500))).reverse();
  }

  async acceptCandidate(candidateId: string): Promise<SuperMemory | undefined> {
    return withFileLock(`${this.paths.candidatesLog}.mutation`, async () => {
      const candidate = (await this.listCandidates()).find((item) => item.id === candidateId);
      if (!candidate) return undefined;
      const memory = await this.rememberSuper({
        text: candidate.text,
        kind: candidate.kind,
        scope: candidate.scope,
        confidence: candidate.confidence,
        importance: candidate.importance,
        tags: candidate.tags,
        anchors: candidate.anchors,
        audience: candidate.audience,
        sources: candidate.sources,
      });
      await appendJsonl(this.paths.candidatesLog, {
        ...candidate,
        status: 'accepted',
        memoryId: memory.id,
        updatedAt: this.nowIso(),
      } satisfies MemoryCandidate);
      return memory;
    }, { timeoutMs: 60_000, staleMs: 30 * 60_000 });
  }

  async rejectCandidate(candidateId: string, reason: string): Promise<boolean> {
    return withFileLock(`${this.paths.candidatesLog}.mutation`, async () => {
      const candidate = (await this.listCandidates()).find((item) => item.id === candidateId);
      if (!candidate) return false;
      await appendJsonl(this.paths.candidatesLog, {
        ...candidate,
        status: 'rejected',
        reason: normalizeText(reason),
        updatedAt: this.nowIso(),
      } satisfies MemoryCandidate);
      await this.audit('memory.candidate_rejected', { reason, details: { candidateId } });
      this.events?.emit('memory.candidate_rejected', this.eventPayload({ candidateId, reason }));
      return true;
    }, { timeoutMs: 60_000, staleMs: 30 * 60_000 });
  }

  /**
   * The redesign contract's decision path (`memory_candidate_resolve`).
   * Applies the review decision to the candidate's TARGET memory and marks
   * the candidate resolved — unlike `acceptCandidate`, which persists the
   * candidate text as a new memory and is the wrong semantics for review
   * proposals. `delete`/`archive` mark the candidate `accepted` (proposal
   * endorsed); `keep` marks it `rejected` (proposal dismissed, memory kept).
   * Permanent targets refuse deletion via `deleteSuperMemory`'s force guard
   * and are recorded as `applied: false`.
   */
  async resolveCandidate(
    candidateId: string,
    decision: CandidateDecision,
    reason?: string,
  ): Promise<MemoryCandidateResolution | undefined> {
    return withFileLock(`${this.paths.candidatesLog}.mutation`, async () => {
      const candidate = (await this.listCandidates(true)).find((item) => item.id === candidateId);
      if (!candidate) return undefined;
      if (candidate.status !== 'pending') {
        return { candidateId, decision, applied: false, alreadyResolved: true };
      }
      const targetId = candidate.targetMemoryId
        ?? candidate.tags.find((tag) => tag.startsWith('source:'))?.slice('source:'.length);
      let applied = false;
      if (decision !== 'keep' && targetId) {
        // Permanent memories refuse deletion even via the resolver — the
        // force flag authorizes the *decision*, but permanence is an
        // absolute invariant. Archival is still permitted.
        const target = await this.getSuperMemory(targetId);
        const isPermanent = target && (target.persistence ?? DEFAULT_PERSISTENCE) === 'permanent';
        try {
          if (decision === 'delete') {
            if (isPermanent) {
              applied = false; // Permanent — refuse deletion
            } else {
              await this.deleteSuperMemory(
                targetId,
                reason ?? `Review resolve (${candidate.reviewReason ?? 'candidate review'})`,
                { force: true }, // Authorized: this call IS the review decision
              );
              applied = true;
            }
          } else {
            await this.updateSuperMemory(targetId, { status: 'archived' });
            applied = true;
          }
        } catch {
          // Permanent target (force guard) or missing memory — the review
          // outcome is recorded on the candidate; the memory stays untouched.
          applied = false;
        }
      } else if (decision === 'keep') {
        applied = true; // Nothing to mutate — the memory is kept as-is.
      }
      const resolutionNote = reason ?? (decision === 'keep' ? 'Reviewed: keep' : `Reviewed: ${decision}`);
      await appendJsonl(this.paths.candidatesLog, {
        ...candidate,
        status: decision === 'keep' ? 'rejected' : 'accepted',
        reason: normalizeText(resolutionNote),
        updatedAt: this.nowIso(),
      } satisfies MemoryCandidate);
      await this.audit('memory.candidate_resolved', {
        ...(targetId ? { memoryId: targetId } : {}),
        reason: resolutionNote,
        details: { candidateId, decision, applied },
      });
      const resolution = {
        candidateId,
        decision,
        ...(targetId ? { targetMemoryId: targetId } : {}),
        applied,
      };
      this.events?.emit('memory.candidate_resolved', this.eventPayload(resolution));
      return resolution;
    }, { timeoutMs: 60_000, staleMs: 30 * 60_000 });
  }

  async consolidateSession(input: SessionConsolidationInput): Promise<SessionConsolidationResult> {
    const result: SessionConsolidationResult = { candidates: 0, accepted: 0, rejected: 0, duplicate: 0 };
    const existing = new Set(
      (await this.loadMemories())
        .filter((memory) => (memory.status === 'active' || memory.status === 'stale') && memory.scope === 'project')
        .map((memory) => canonicalMemoryText(memory.text)),
    );
    for (const candidate of await this.listCandidates()) {
      if (candidate.scope === 'project') existing.add(canonicalMemoryText(candidate.text));
    }
    const threshold = clamp01(input.autoAcceptThreshold ?? 0.85);
    for (const fact of input.facts) {
      const text = normalizeText(fact.text);
      const key = canonicalMemoryText(text);
      if (!text || existing.has(key)) {
        result.duplicate++;
        continue;
      }
      let candidate: MemoryCandidate;
      try {
        candidate = await this.createCandidate({
          text,
          kind: fact.kind,
          confidence: fact.confidence,
          importance: fact.importance,
          tags: fact.tags,
          anchors: fact.anchors,
          sources: [{ type: 'session', sessionId: input.sessionId }],
        });
      } catch {
        result.rejected++;
        continue;
      }
      result.candidates++;
      existing.add(key);
      const policyScore = candidate.confidence * 0.55 + candidate.importance * 0.45;
      if (policyScore >= threshold) {
        await this.acceptCandidate(candidate.id);
        result.accepted++;
      }
    }
    return result;
  }

  async retrieveForPath(opts: SuperMemoryForPathOptions): Promise<SuperMemory[]> {
    const automaticContext = opts.includeStatuses === undefined;
    const statuses = new Set(opts.includeStatuses ?? CONTEXT_STATUSES);
    const all = (await this.loadMemories()).filter((memory) =>
      statuses.has(memory.status)
      && (!automaticContext || memory.contextPolicy !== 'never')
      && (opts.includeAudienceScoped !== false || !memory.audience));
    const target = normalizeProjectPath(this.projectRoot, opts.path);
    const includeAncestors = opts.includeAncestors !== false;
    const candidates = !includeAncestors
      ? [target]
      : ancestorPaths(target);
    const scored = all
      .map((memory) => ({
        memory,
        score: scorePathMemory(memory, target, candidates, includeAncestors),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, boundedLimit(opts.limit, DEFAULT_LIMIT, 100)).map((item) => item.memory);
  }

  async searchSuper(query: string, opts: SuperMemorySearchOptions = {}): Promise<SuperMemory[]> {
    const automaticContext = opts.includeStatuses === undefined;
    const statuses = opts.includeStatuses ?? CONTEXT_STATUSES;
    const all = await this.loadMemories();
    const scored = all
      .filter((memory) => statuses.includes(memory.status))
      .filter((memory) => !automaticContext || memory.contextPolicy !== 'never')
      .filter((memory) => opts.includeAudienceScoped !== false || !memory.audience)
      .filter((memory) => !opts.scope || memory.scope === opts.scope)
      .filter((memory) => !opts.legacyScope || (memory.legacyScope ?? superToLegacyScope(memory.scope)) === opts.legacyScope)
      .map((memory) => ({ memory, score: scoreQueryMemory(memory, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, boundedLimit(opts.limit, DEFAULT_LIMIT, 500)).map((item) => item.memory);
  }

  /** Retrieve project policy targeted at the current stable agent/task identity. */
  async retrieveForAudience(
    context: MemoryAudienceContext,
    limit = DEFAULT_LIMIT,
    includeStatuses: SuperMemoryStatus[] = CONTEXT_STATUSES,
  ): Promise<SuperMemory[]> {
    const normalizedContext = normalizeAudienceContext(context);
    if (!normalizedContext.role && !normalizedContext.taskType && !normalizedContext.mode) return [];
    const statuses = new Set(includeStatuses);
    return (await this.loadMemories())
      .filter((memory) => statuses.has(memory.status))
      .filter((memory) => memory.contextPolicy !== 'never')
      .filter((memory) => memory.scope === 'project' && !!memory.audience)
      .filter((memory) => memory.audience
        ? audienceMatches(memory.audience, normalizedContext)
        : false)
      .sort(compareMemoryQuality)
      .slice(0, boundedLimit(limit, DEFAULT_LIMIT, 100));
  }

  async readAll(): Promise<string> {
    const scopes: MemoryScope[] = ['project-agents', 'project-memory', 'user-memory'];
    const parts: string[] = [];
    for (const scope of scopes) {
      const body = await this.read(scope);
      if (body.trim()) parts.push(`## ${labelOf(scope)}\n\n${body.trim()}`);
    }
    return parts.join('\n\n');
  }

  async read(scope: MemoryScope): Promise<string> {
    const entries = await this.list(scope);
    if (entries.length === 0) return '';
    return entries
      .map((entry) => {
        const tags = entry.tags?.length ? ` ${entry.tags.map((tag) => `#${tag}`).join(' ')}` : '';
        const type = entry.type ? ` [${entry.type}${entry.priority ? `|${entry.priority}` : ''}]` : '';
        return `- [${entry.ts}]${type} ${entry.text}${tags}`;
      })
      .join('\n');
  }

  async remember(
    text: string,
    scope: MemoryScope = 'project-memory',
    metadata?: Omit<Partial<MemoryEntry>, 'scope' | 'text' | 'ts'>,
  ): Promise<void> {
    await this.rememberSuper({
      text,
      legacyScope: scope,
      scope: legacyToSuperScope(scope),
      type: metadata?.type,
      tags: metadata?.tags,
      priority: metadata?.priority,
      confidence: metadata?.confidence,
      sources: metadata?.source ? [{ type: 'legacy_memory', excerptHash: metadata.source }] : undefined,
    });
  }

  async forget(query: string, scope: MemoryScope = 'project-memory'): Promise<number> {
    await this.initialize();
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return 0;
    return this.runMutation(() => this.forgetUnlocked(normalizedQuery, scope));
  }

  private async forgetUnlocked(query: string, scope: MemoryScope): Promise<number> {
    const all = await this.loadMemories();
    let removed = 0;
    const skippedPermanent: string[] = [];
    for (const memory of all) {
      if (memory.status === 'deleted') continue;
      const legacyScope = memory.legacyScope ?? superToLegacyScope(memory.scope);
      if (legacyScope !== scope) continue;
      if (!matchesForget(memory, query)) continue;
      // Permanent memories are never removed by a substring sweep. Deleting
      // them requires the id-exact `deleteSuperMemory` path with
      // `{ force: true }` — the same contract the public delete tool exposes.
      if ((memory.persistence ?? DEFAULT_PERSISTENCE) === 'permanent') {
        skippedPermanent.push(memory.id);
        continue;
      }
      removed++;
      await this.cascadeDeleteUnlocked(memory);
    }
    if (removed > 0 || skippedPermanent.length > 0) {
      if (removed > 0) {
        await this.audit('memory.deleted', { reason: query, details: { removed, scope } });
        this.events?.emit('memory.forgotten', { scope, query, removed });
      }
      if (skippedPermanent.length > 0) {
        // The skip is audit-logged so a query that silently left permanent
        // memories behind is always traceable.
        await this.audit('memory.forget_skipped_permanent', {
          reason: query,
          details: { skipped: skippedPermanent, scope },
        });
      }
      await this.afterMutation();
    }
    return removed;
  }

  async consolidate(scope: MemoryScope): Promise<void> {
    await this.initialize();
    await this.runMutation(async () => {
      const matching = (await this.loadMemories()).filter((memory) =>
        memory.status === 'active'
        && (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope);
      const groups = groupBy(matching, (memory) => canonicalMemoryText(memory.text));
      let removed = 0;
      for (const group of groups.values()) {
        if (group.length < 2) continue;
        const [keeper, ...duplicates] = [...group].sort(compareMemoryQuality);
        if (!keeper) continue;
        await this.updateMemory(keeper, {
          tags: [...new Set(group.flatMap((memory) => memory.tags))],
          anchors: dedupeAnchors(group.flatMap((memory) => memory.anchors)),
          sources: dedupeSources(group.flatMap((memory) => memory.sources)),
          supersedes: uniqueIds([...(keeper.supersedes ?? []), ...duplicates.map((memory) => memory.id)]),
        });
        for (const duplicate of duplicates) {
          await this.updateMemory(duplicate, { status: 'superseded', supersededBy: keeper.id });
          await this.addGraphEdge(`mem:${keeper.id}`, `mem:${duplicate.id}`, 'supersedes', 1);
          removed++;
        }
      }
      if (removed > 0) {
        await this.afterMutation();
        this.events?.emit('memory.consolidated', { scope, removed });
      }
    });
  }

  async clear(scope?: MemoryScope): Promise<void> {
    await this.initialize();
    await this.runMutation(async () => {
      const scopes: MemoryScope[] = scope ? [scope] : ['project-agents', 'project-memory', 'user-memory'];
      const all = await this.loadMemories();
      let changed = false;
      const skippedPermanent: string[] = [];
      for (const s of scopes) {
        for (const memory of all) {
          if (memory.status === 'deleted') continue;
          if ((memory.legacyScope ?? superToLegacyScope(memory.scope)) !== s) continue;
          // Permanent memories survive a clear() — they require explicit
          // per-id deleteSuperMemory({ force: true }). The skip is
          // audit-logged so a clear that left permanents behind is traceable.
          if ((memory.persistence ?? DEFAULT_PERSISTENCE) === 'permanent') {
            skippedPermanent.push(memory.id);
            continue;
          }
          await this.updateMemory(memory, { status: 'deleted' });
          changed = true;
        }
        this.events?.emit('memory.cleared', { scope: s });
      }
      if (skippedPermanent.length > 0) {
        await this.audit('memory.clear_skipped_permanent', {
          details: { skipped: skippedPermanent, scope: scope ?? 'all' },
        });
      }
      if (changed) await this.afterMutation();
    });
  }

  async list(scope: MemoryScope = 'project-memory', limit?: number): Promise<MemoryEntry[]> {
    const all = await this.loadActive();
    const entries = all
      .filter((memory) => (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toLegacyEntry);
    return limit === undefined ? entries : entries.slice(0, boundedLimit(limit, DEFAULT_LIMIT, 500));
  }

  async search(query: string, scope: MemoryScope = 'project-memory', limit?: number): Promise<MemoryEntry[]> {
    const memories = await this.searchSuper(query, { legacyScope: scope, limit });
    return memories.map(toLegacyEntry);
  }

  async findRelated(text: string, scope: MemoryScope = 'project-memory', limit = 5): Promise<MemoryEntry[]> {
    const bounded = boundedLimit(limit, 5, 100);
    const seeds = await this.searchSuper(text, { legacyScope: scope, limit: Math.max(bounded, 5) });
    if (seeds.length === 0) return [];
    const edges = await this.graph.traverse(
      seeds.map((memory) => `mem:${memory.id}`),
      { maxDepth: 3, limit: Math.max(100, bounded * 20) },
    );
    const relatedIds = new Set<string>();
    for (const edge of edges) {
      for (const node of [edge.from, edge.to]) {
        if (node.startsWith('mem:')) relatedIds.add(node.slice(4));
      }
    }
    const seedIds = new Set(seeds.map((memory) => memory.id));
    const related = (await this.loadActive())
      .filter((memory) => relatedIds.has(memory.id) && !seedIds.has(memory.id))
      .filter((memory) => (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope)
      .sort(compareMemoryQuality);
    return [...related, ...seeds]
      .filter((memory, index, all) => all.findIndex((candidate) => candidate.id === memory.id) === index)
      .slice(0, bounded)
      .map(toLegacyEntry);
  }

  async scoreRelevant(
    ctx: MemoryRelevanceContext,
    scope: MemoryScope = 'project-memory',
    limit = 8,
  ): Promise<ScoredEntry[]> {
    const query = ctx.currentTask || [...(ctx.activeSkills ?? []), ...(ctx.toolNames ?? [])].join(' ');
    if (!query.trim()) {
      const entries = await this.list(scope, limit);
      return entries.map((entry) => ({ ...entry, score: 1, matchReason: 'recent project memory' }));
    }
    const memories = await this.searchSuper(query, { legacyScope: scope, limit });
    return memories.map((memory) => ({
      ...toLegacyEntry(memory),
      score: scoreQueryMemory(memory, query),
      matchReason: 'super-memory retrieval',
    }));
  }

  getBackend(): unknown {
    return this;
  }

  withTraceId(traceId: string): MemoryStore {
    this.traceId = traceId;
    return this;
  }

  private async verifyMemoriesUnlocked(
    memories: SuperMemory[],
    signal?: AbortSignal,
  ): Promise<MemoryVerificationResult[]> {
    const results: MemoryVerificationResult[] = [];
    let changed = false;
    try {
      for (const memory of memories) {
        signal?.throwIfAborted();
        const result = await verifyMemoryAnchors(this.projectRoot, memory, this.nowIso(), signal);
        results.push(result);
        if (result.status === 'stale' && memory.status === 'active') {
          const reason = result.anchors.find((anchor) => anchor.status === 'stale')?.reason ?? 'Anchor is stale.';
          await this.updateMemory(memory, { status: 'stale', lastVerifiedAt: result.checkedAt });
          changed = true;
          this.events?.emit('memory.staled', this.eventPayload({ memoryId: memory.id, reason }));
        } else if (result.status === 'verified') {
          await this.updateMemory(memory, {
            status: memory.status === 'stale' ? 'active' : memory.status,
            lastVerifiedAt: result.checkedAt,
            freshness: 1,
          });
          changed = true;
        } else if (memory.anchors.length > 0 && memory.lastVerifiedAt !== result.checkedAt) {
          // Anchorless memories are not verifiable. Avoid appending a no-value
          // revision on every session hygiene pass.
          await this.updateMemory(memory, { lastVerifiedAt: result.checkedAt });
          changed = true;
        }
        this.events?.emit('memory.verified', this.eventPayload({ memoryId: memory.id, status: result.status }));
        await this.audit('memory.verified', {
          memoryId: memory.id,
          details: { status: result.status, anchors: result.anchors },
        });
      }
    } finally {
      if (changed) await this.afterMutation();
    }
    return results;
  }

  private async loadActive(): Promise<SuperMemory[]> {
    const all = await this.loadMemories();
    return all.filter((memory) => memory.status === 'active');
  }

  private async loadMemories(): Promise<SuperMemory[]> {
    if (!this.initialized) await this.initialize();
    if (this.loaded && this.loadedLogSignature === await fileSignature(this.paths.memoriesLog)) {
      return this.loaded;
    }
    const snapshot = await readJsonlSnapshot<SuperMemoryRecord>(this.paths.memoriesLog, async (line) => {
      await this.audit('memory.corrupt_line', {
        reason: line.error,
        details: {
          filePath: line.filePath,
          lineNumber: line.lineNumber,
        },
      });
    });
    const records = snapshot.values;
    const latest = new Map<string, SuperMemory>();
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (!isMemoryRecord(record)) {
        const key = `${index}:${String(JSON.stringify(record)).slice(0, 256)}`;
        if (!this.invalidRecordsAudited.has(key)) {
          this.invalidRecordsAudited.add(key);
          await this.audit('memory.invalid_record', {
            reason: 'Record failed Super Memory schema validation.',
            details: { recordIndex: index + 1 },
          });
        }
        continue;
      }
      const current = latest.get(record.memory.id);
      if (!current || record.memory.revision > current.revision) {
        latest.set(record.memory.id, record.memory);
      } else if (record.memory.revision === current.revision) {
        // Equal revision: last-in-file normally wins, but a `deleted`
        // tombstone at the same revision is a stale duplicate — not a
        // newer state. Prefer the non-deleted record so that an older
        // active entry isn't overwritten by a same-revision tombstone
        // left by file reordering or direct JSONL manipulation.
        if (current.status === 'deleted' && record.memory.status !== 'deleted') {
          latest.set(record.memory.id, record.memory);
        }
      }
    }
    if (latest.size === 0) {
      const snapshot = await readJson<SuperMemorySnapshot>(path.join(this.paths.snapshotsDir, 'latest.json'));
      if (snapshot?.schemaVersion === SUPER_MEMORY_SCHEMA_VERSION && Array.isArray(snapshot.memories)) {
        for (const memory of snapshot.memories) {
          if (isSuperMemory(memory)) latest.set(memory.id, memory);
        }
        await this.audit('memory.snapshot_recovered', { details: { snapshotId: snapshot.id, memories: latest.size } });
      }
    }
    this.loaded = [...latest.values()].map(withDefaultPersistence);
    this.loadedLogSignature = snapshot.signature;
    return this.loaded;
  }

  private async appendRecord(op: SuperMemoryRecord['op'], memory: SuperMemory): Promise<void> {
    const record: SuperMemoryRecord = {
      recordType: 'memory',
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      op,
      memory,
    };
    await appendJsonl(this.paths.memoriesLog, record);
    this.loaded = undefined;
    this.loadedLogSignature = undefined;
  }

  private async afterMutation(): Promise<void> {
    const memories = await this.loadMemories();
    const snapshotId = await this.writeSnapshot(memories);
    await this.writeIndexes(memories.filter((memory) => memory.status === 'active'));
    await this.writeManifest(snapshotId);
  }

  private async writeSnapshot(memories: SuperMemory[]): Promise<string> {
    const snapshot: SuperMemorySnapshot = {
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      id: `snap_${ulid()}`,
      createdAt: this.nowIso(),
      memories,
    };
    await writeJson(path.join(this.paths.snapshotsDir, 'latest.json'), snapshot);
    return snapshot.id;
  }

  private async writeIndexes(memories: SuperMemory[]): Promise<void> {
    const indexes: SuperMemoryIndexes = {
      byPath: {},
      bySymbol: {},
      byTag: {},
      byKind: {},
      lexical: {},
    };
    for (const memory of memories) {
      pushIndex(indexes.byKind, memory.kind, memory.id);
      for (const tag of memory.tags) pushIndex(indexes.byTag, tag, memory.id);
      for (const anchor of memory.anchors) {
        if (anchor.path) pushIndex(indexes.byPath, anchor.path, memory.id);
        if (anchor.symbol) pushIndex(indexes.bySymbol, anchor.symbol, memory.id);
      }
      for (const term of tokenize(`${memory.text} ${memory.tags.join(' ')}`)) {
        pushIndex(indexes.lexical, term, memory.id);
      }
    }
    await Promise.all([
      writeJson(path.join(this.paths.indexesDir, 'by-path.json'), indexes.byPath),
      writeJson(path.join(this.paths.indexesDir, 'by-symbol.json'), indexes.bySymbol),
      writeJson(path.join(this.paths.indexesDir, 'by-tag.json'), indexes.byTag),
      writeJson(path.join(this.paths.indexesDir, 'by-kind.json'), indexes.byKind),
      writeJson(path.join(this.paths.indexesDir, 'lexical.json'), indexes.lexical),
    ]);
  }

  private async writeManifest(lastSnapshotId?: string): Promise<void> {
    const now = this.nowIso();
    const existing = await readJson<SuperMemoryManifest>(this.paths.manifest);
    const manifest: SuperMemoryManifest = {
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastSnapshotId: lastSnapshotId ?? existing?.lastSnapshotId,
      indexes: {
        version: SUPER_MEMORY_SCHEMA_VERSION,
        builtAt: now,
      },
    };
    await writeJson(this.paths.manifest, manifest);
  }

  private async updateMemory(
    memory: SuperMemory,
    patch: Partial<Omit<SuperMemory, 'id' | 'revision' | 'createdAt'>>,
    opts: { preserveUpdatedAt?: boolean } = {},
  ): Promise<SuperMemory> {
    const updated: SuperMemory = {
      ...memory,
      ...patch,
      id: memory.id,
      revision: memory.revision + 1,
      createdAt: memory.createdAt,
      updatedAt: opts.preserveUpdatedAt ? memory.updatedAt : this.nowIso(),
    };
    await this.appendRecord(updated.status === 'deleted' ? 'delete' : 'update', updated);
    this.events?.emit('memory.updated', this.eventPayload({ memoryId: updated.id, status: updated.status }));
    return updated;
  }

  private async addAutomaticEdges(memory: SuperMemory): Promise<void> {
    for (const anchor of memory.anchors) {
      const target = anchorNode(anchor);
      const relation = anchorRelation(anchor);
      if (target && relation) await this.addGraphEdge(`mem:${memory.id}`, target, relation, memory.confidence);
      if (!anchor.path) continue;
      const anchoredPath = normalizeSlashes(anchor.path);
      const isDirectory = anchor.type === 'directory' || anchor.type === 'package';
      const fileNode = `file:${anchoredPath}`;
      const directoryPath = isDirectory ? anchoredPath : normalizeSlashes(path.posix.dirname(anchoredPath));

      if (anchor.type === 'symbol' && anchor.symbol) {
        await this.addGraphEdge(
          `symbol:${anchoredPath}#${anchor.symbol}`,
          fileNode,
          'related_to',
          memory.confidence,
        );
      }
      if (!isDirectory) {
        await this.addGraphEdge(fileNode, `dir:${directoryPath}`, 'related_to', 1);
      }
      const directories = ancestorPaths(directoryPath);
      for (let i = 0; i < directories.length - 1; i++) {
        await this.addGraphEdge(`dir:${directories[i]}`, `dir:${directories[i + 1]}`, 'related_to', 1);
      }
    }
    for (const source of memory.sources) {
      const target = sourceNode(this.projectRoot, source);
      if (target) await this.addGraphEdge(`mem:${memory.id}`, target, 'derived_from', memory.confidence);
    }
  }

  private async applyDeclaredRelationships(memory: SuperMemory): Promise<void> {
    const all = await this.loadMemories();
    for (const id of memory.supersedes ?? []) {
      const target = all.find((candidate) => candidate.id !== memory.id && candidate.id === id && candidate.status !== 'deleted');
      if (!target) continue;
      await this.updateMemory(target, { status: 'superseded', supersededBy: memory.id });
      await this.addGraphEdge(`mem:${memory.id}`, `mem:${id}`, 'supersedes', 1);
      this.events?.emit('memory.superseded', this.eventPayload({ memoryId: id, supersededBy: memory.id }));
    }
    for (const id of memory.contradicts ?? []) {
      const target = all.find((candidate) => candidate.id !== memory.id && candidate.id === id && candidate.status !== 'deleted');
      if (!target) continue;
      await this.updateMemory(target, {
        status: 'contradicted',
        contradicts: [...new Set([...(target.contradicts ?? []), memory.id])],
      });
      await this.addGraphEdge(`mem:${memory.id}`, `mem:${id}`, 'contradicts', 1);
      this.events?.emit('memory.contradicted', this.eventPayload({ memoryId: id, contradicts: [memory.id] }));
    }
  }

  private eventPayload<T extends object>(payload: T): T & { traceId?: string | undefined } {
    return this.traceId ? { ...payload, traceId: this.traceId } : payload;
  }

  private async runMutation<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationChain.catch(() => undefined).then(() =>
      withFileLock(path.join(this.paths.locksDir, 'store-mutation'), async () => {
        // Another process may have appended records since this instance last
        // read the log. Every mutation starts from the canonical on-disk view.
        this.loaded = undefined;
        this.loadedLogSignature = undefined;
        return work();
      }, { timeoutMs: 60_000, staleMs: 30 * 60_000 }));
    this.mutationChain = next;
    try {
      return await next;
    } finally {
      if (this.mutationChain === next) this.mutationChain = Promise.resolve();
    }
  }

  private async audit(
    event: string,
    input: Omit<SuperMemoryAuditRecord, 'schemaVersion' | 'event' | 'at' | 'traceId'> = {},
  ): Promise<void> {
    const record: SuperMemoryAuditRecord = {
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      event,
      at: this.nowIso(),
      ...(this.traceId !== undefined && { traceId: this.traceId }),
      ...input,
    };
    await appendJsonl(this.paths.auditLog, record);
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private rejectIfUnsafe(text: string): void {
    if (looksLikeSecret(text)) {
      throw new Error('Super Memory refused to store text that looks like a secret or credential.');
    }
  }

  private rejectIfUnsafeInput(input: RememberSuperMemoryInput): void {
    for (const value of collectStringValues(input)) this.rejectIfUnsafe(value);
  }
}

function isMemoryRecord(value: unknown): value is SuperMemoryRecord {
  const record = value as Partial<SuperMemoryRecord>;
  return record?.recordType === 'memory'
    && record.schemaVersion === SUPER_MEMORY_SCHEMA_VERSION
    && isSuperMemory(record.memory);
}

function isSuperMemory(value: unknown): value is SuperMemory {
  const memory = value as Partial<SuperMemory> | undefined;
  return !!memory
    && typeof memory.id === 'string'
    && memory.id.length > 0
    && Number.isInteger(memory.revision)
    && (memory.revision ?? 0) >= 1
    && typeof memory.text === 'string'
    && memory.text.trim().length > 0
    && VALID_SCOPES.has(memory.scope as SuperMemory['scope'])
    && VALID_KINDS.has(memory.kind as SuperMemory['kind'])
    && VALID_STATUSES.has(memory.status as SuperMemoryStatus)
    && isUnitNumber(memory.importance)
    && isUnitNumber(memory.confidence)
    && isUnitNumber(memory.freshness)
    && Array.isArray(memory.tags)
    && memory.tags.every((tag) => typeof tag === 'string')
    && Array.isArray(memory.anchors)
    && (memory.audience === undefined || isMemoryAudience(memory.audience))
    && Array.isArray(memory.sources)
    && typeof memory.createdAt === 'string'
    && Number.isFinite(Date.parse(memory.createdAt))
    && typeof memory.updatedAt === 'string'
    && Number.isFinite(Date.parse(memory.updatedAt))
    && (memory.injectionCount === undefined || isNonNegativeInteger(memory.injectionCount))
    && (memory.useCount === undefined || isNonNegativeInteger(memory.useCount));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isMemoryCandidate(value: unknown): value is MemoryCandidate {
  const candidate = value as Partial<MemoryCandidate>;
  return candidate?.schemaVersion === SUPER_MEMORY_SCHEMA_VERSION
    && typeof candidate.id === 'string'
    && candidate.id.length > 0
    && VALID_CANDIDATE_STATUSES.has(candidate.status as MemoryCandidate['status'])
    && typeof candidate.text === 'string'
    && candidate.text.trim().length > 0
    && VALID_SCOPES.has(candidate.scope as SuperMemory['scope'])
    && VALID_KINDS.has(candidate.kind as SuperMemory['kind'])
    && isUnitNumber(candidate.importance)
    && isUnitNumber(candidate.confidence)
    && Array.isArray(candidate.tags)
    && Array.isArray(candidate.anchors)
    && Array.isArray(candidate.sources)
    && typeof candidate.createdAt === 'string'
    && Number.isFinite(Date.parse(candidate.createdAt))
    && typeof candidate.updatedAt === 'string'
    && Number.isFinite(Date.parse(candidate.updatedAt));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function validateRememberInput(input: RememberSuperMemoryInput): void {
  if (typeof input.text !== 'string') throw new Error('Super Memory text must be a string.');
  if (input.text.length > MAX_MEMORY_TEXT_CHARS) {
    throw new Error(`Super Memory text exceeds ${MAX_MEMORY_TEXT_CHARS} characters.`);
  }
  for (const [name, values] of [
    ['tags', input.tags],
    ['anchors', input.anchors],
    ['sources', input.sources],
    ['supersedes', input.supersedes],
    ['contradicts', input.contradicts],
  ] as const) {
    if (values && values.length > MAX_MEMORY_METADATA_ITEMS) {
      throw new Error(`Super Memory ${name} exceeds ${MAX_MEMORY_METADATA_ITEMS} items.`);
    }
  }
  if (input.tags?.some((tag) => typeof tag !== 'string' || tag.length > 256)) {
    throw new Error('Super Memory tags must be strings no longer than 256 characters.');
  }
  if (input.scope && !VALID_SCOPES.has(input.scope)) throw new Error('Invalid Super Memory scope.');
  if (input.kind && !VALID_KINDS.has(input.kind)) throw new Error('Invalid Super Memory kind.');
  normalizeAudience(input.audience);
  for (const anchor of input.anchors ?? []) {
    if (!anchor || !VALID_ANCHOR_TYPES.has(anchor.type)) throw new Error('Invalid Super Memory anchor type.');
    if (anchor.type === 'command') {
      if (!anchor.command?.trim()) throw new Error('Command memory anchors require a command.');
    } else if (!anchor.path?.trim()) {
      throw new Error(`${anchor.type} memory anchors require a path.`);
    }
    if (anchor.type === 'symbol' && !anchor.symbol?.trim()) {
      throw new Error('Symbol memory anchors require a symbol.');
    }
    if ((anchor.path?.length ?? 0) > 4_096 || (anchor.symbol?.length ?? 0) > 1_024 || (anchor.command?.length ?? 0) > 8_192) {
      throw new Error('Super Memory anchor metadata is too long.');
    }
    if (anchor.lineStart !== undefined && (!Number.isInteger(anchor.lineStart) || anchor.lineStart < 1)) {
      throw new Error('Super Memory anchor lineStart must be a positive integer.');
    }
    if (anchor.lineEnd !== undefined && (!Number.isInteger(anchor.lineEnd) || anchor.lineEnd < (anchor.lineStart ?? 1))) {
      throw new Error('Super Memory anchor lineEnd must be at or after lineStart.');
    }
  }
  for (const source of input.sources ?? []) {
    if (!source || !VALID_SOURCE_TYPES.has(source.type)) throw new Error('Invalid Super Memory source type.');
    if ((source.path?.length ?? 0) > 4_096 || (source.command?.length ?? 0) > 8_192) {
      throw new Error('Super Memory source metadata is too long.');
    }
  }
}

function canonicalMemoryText(text: string): string {
  return normalizeText(text)
    .normalize('NFKC')
    .toLowerCase()
    // Ignore cosmetic sentence-ending punctuation while retaining semantic
    // punctuation inside identifiers/languages (`C++`, `C#`, `foo.bar`).
    .replace(/[.!?,;:]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function memoryIdentity(
  memory: Pick<SuperMemory, 'text' | 'scope'> & {
    legacyScope?: MemoryScope | undefined;
    audience?: MemoryAudienceSelector | undefined;
  },
): string {
  const legacyScope = memory.legacyScope ?? superToLegacyScope(memory.scope);
  return `${memory.scope}\0${legacyScope}\0${audienceIdentity(memory.audience)}\0${canonicalMemoryText(memory.text)}`;
}

const AUDIENCE_KEYS = ['roles', 'taskTypes', 'modes'] as const;

function normalizeAudience(value: MemoryAudienceSelector | undefined): MemoryAudienceSelector | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Super Memory audience must be an object.');
  }
  const normalized: MemoryAudienceSelector = {};
  for (const key of AUDIENCE_KEYS) {
    const values = value[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
      throw new Error(`Super Memory audience.${key} must be an array of strings.`);
    }
    if (values.length > MAX_MEMORY_METADATA_ITEMS) {
      throw new Error(`Super Memory audience.${key} exceeds ${MAX_MEMORY_METADATA_ITEMS} items.`);
    }
    const items = [...new Set(values.map(normalizeSelectorValue).filter(Boolean))];
    if (items.some((item) => item.length > 256)) {
      throw new Error(`Super Memory audience.${key} values must be no longer than 256 characters.`);
    }
    if (items.length > 0) normalized[key] = items;
  }
  return AUDIENCE_KEYS.some((key) => normalized[key]?.length) ? normalized : undefined;
}

function normalizeAudienceContext(context: MemoryAudienceContext): MemoryAudienceContext {
  return {
    role: context.role ? normalizeSelectorValue(context.role) : undefined,
    taskType: context.taskType ? normalizeSelectorValue(context.taskType) : undefined,
    mode: context.mode ? normalizeSelectorValue(context.mode) : undefined,
  };
}

function normalizeSelectorValue(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

function isMemoryAudience(value: unknown): value is MemoryAudienceSelector {
  try {
    return normalizeAudience(value as MemoryAudienceSelector) !== undefined;
  } catch {
    return false;
  }
}

function audienceMatches(audience: MemoryAudienceSelector, context: MemoryAudienceContext): boolean {
  return dimensionMatches(audience.roles, context.role)
    && dimensionMatches(audience.taskTypes, context.taskType)
    && dimensionMatches(audience.modes, context.mode);
}

function dimensionMatches(expected: string[] | undefined, actual: string | undefined): boolean {
  return !expected?.length || (!!actual && expected.includes(actual));
}

function audienceIdentity(audience: MemoryAudienceSelector | undefined): string {
  const normalized = normalizeAudience(audience);
  return normalized ? JSON.stringify(normalized) : '*';
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeAnchors(projectRoot: string, anchors: MemoryAnchor[]): MemoryAnchor[] {
  return dedupeAnchors(anchors.map((anchor) => ({
    ...anchor,
    path: anchor.path ? normalizeProjectPath(projectRoot, anchor.path) : undefined,
    symbol: anchor.symbol?.trim() || undefined,
    command: anchor.command?.trim().replace(/\s+/g, ' ') || undefined,
  })));
}

function normalizeSources(sources: SuperMemory['sources']): SuperMemory['sources'] {
  return dedupeSources(sources.map((source) => ({
    ...source,
    path: source.path ? normalizeSlashes(source.path.trim()) : undefined,
    command: source.command?.trim().replace(/\s+/g, ' ') || undefined,
  })));
}

function importanceFromPriority(priority: MemoryEntry['priority']): number {
  switch (priority) {
    case 'critical':
      return 0.95;
    case 'high':
      return 0.8;
    case 'medium':
      return 0.55;
    case 'low':
      return 0.25;
    case undefined:
      return 0.6;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize the persistence field at write time. Unknown values throw so a
 * typo or future enum drift is caught immediately rather than silently
 * round-tripping through the JSONL log.
 */
function normalizePersistence(value: unknown): PersistenceClass {
  if (value === undefined || value === null) return DEFAULT_PERSISTENCE;
  if (VALID_PERSISTENCE.has(value as PersistenceClass)) return value as PersistenceClass;
  throw new Error(`Invalid persistence class: ${String(value)}`);
}

/**
 * Migration shim: legacy records (and SQLite rows created before the field
 * existed) have no `persistence` field. Treat them as `long_lived` so existing
 * users see no behavior change.
 */
function withDefaultPersistence(memory: SuperMemory): SuperMemory {
  if (memory.persistence !== undefined) return memory;
  return { ...memory, persistence: DEFAULT_PERSISTENCE };
}

function scoreQueryMemory(memory: SuperMemory, query: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const normalizedQuery = normalizeText(query).toLowerCase();
  const haystack = `${memory.text} ${memory.tags.join(' ')} ${memory.anchors.map((a) => `${a.path ?? ''} ${a.symbol ?? ''} ${a.command ?? ''}`).join(' ')}`.normalize('NFKC').toLowerCase();
  let score = 0;
  if (normalizedQuery.length >= 3 && haystack.includes(normalizedQuery)) score += 4;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
    if (memory.tags.some((tag) => tag.includes(term))) score += 2;
    if (memory.anchors.some((anchor) => anchor.path?.toLowerCase().includes(term))) score += 2;
    if (memory.anchors.some((anchor) => anchor.symbol?.toLowerCase().includes(term))) score += 3;
    if (memory.anchors.some((anchor) => anchor.command?.toLowerCase().includes(term))) score += 3;
  }
  // Quality ranks relevant matches; it must never manufacture relevance for
  // an unrelated high-importance memory.
  if (score === 0) return 0;
  score += memory.importance * 2;
  score += memory.confidence;
  score += memory.freshness;
  return score;
}

/**
 * Match a memory against a file path for the drawer / file-editor surface.
 * Returns the strongest `via` channel and a 0..1 strength score, or null when
 * the memory is unrelated to the file.
 *
 * Priority order (highest first):
 *   1. `scope_file` — the memory was created specifically for this file.
 *   2. `scope_symbol` — the memory's scope is `symbol` and any anchor matches.
 *   3. `anchor_file` — anchor.path matches the target file exactly.
 *   4. `anchor_symbol` — anchor with line range overlapping the cursor range.
 *   5. `anchor_directory` — anchor.path is a parent of the target.
 *   6. `mention` — the file basename appears in the memory text.
 */
function matchMemoryToFileDraw(
  memory: SuperMemory,
  normalizedPath: string,
  basename: string,
  lineStart: number | undefined,
  lineEnd: number | undefined,
): { via: MemoryMatchVia; strength: number } | null {
  // 1. scope_file — the memory's scope was set to the file path itself.
  if (memory.scope === 'file') {
    const scopePath = String(memory.legacyScope ?? '');
    // scope='file' is a coarse signal; we accept it when its normalized
    // path equals the target. (Scope doesn't currently carry the path
    // in SuperMemory; we fall through to anchor matching in that case.)
    if (scopePath && normalizeProjectPath(memory.scope === 'file' ? memory.scope : '', normalizedPath) === normalizedPath) {
      return { via: 'scope_file', strength: 1.0 };
    }
  }

  // 2 + 3 + 4 + 5. Anchors.
  for (const anchor of memory.anchors ?? []) {
    if (!anchor.path) continue;
    const anchorPath = normalizeProjectPath(memory.scope, anchor.path);
    if (anchorPath === normalizedPath) {
      if (anchor.type === 'symbol') {
        // Symbol anchor with line range → boosted when cursor overlaps.
        if (
          lineStart !== undefined && lineEnd !== undefined &&
          anchor.lineStart !== undefined && anchor.lineEnd !== undefined &&
          lineStart <= anchor.lineEnd && lineEnd >= anchor.lineStart
        ) {
          return { via: 'anchor_symbol', strength: 0.95 };
        }
        return { via: 'anchor_symbol', strength: 0.75 };
      }
      return { via: 'anchor_file', strength: 0.9 };
    }
    if (anchor.type === 'directory' && normalizedPath.startsWith(`${anchorPath}/`)) {
      return { via: 'anchor_directory', strength: 0.5 };
    }
  }

  // 2b. scope_symbol — memory.scope is 'symbol' and at least one anchor
  // matches the file (even if not the line range).
  if (memory.scope === 'symbol') {
    for (const anchor of memory.anchors ?? []) {
      if (!anchor.path) continue;
      const anchorPath = normalizeProjectPath(memory.scope, anchor.path);
      if (anchorPath === normalizedPath) {
        return { via: 'scope_symbol', strength: 0.92 };
      }
    }
  }

  // 6. Mention — basename appears in memory text (weakest signal).
  if (basename && memory.text.toLowerCase().includes(basename.toLowerCase())) {
    return { via: 'mention', strength: 0.3 };
  }

  return null;
}

function scorePathMemory(
  memory: SuperMemory,
  target: string,
  ancestors: string[],
  includeAncestors: boolean,
): number {
  let score = 0;
  for (const anchor of memory.anchors) {
    if (!anchor.path) continue;
    const anchorPath = normalizeSlashes(anchor.path);
    if (anchorPath === target) score += 10;
    else if (includeAncestors && ancestors.includes(anchorPath)) score += 5;
    else if (includeAncestors && (target.startsWith(`${anchorPath}/`) || anchorPath.startsWith(`${target}/`))) score += 3;
  }
  if (score === 0) return 0;
  return score + memory.importance * 2 + memory.confidence + memory.freshness;
}

function matchesForget(memory: SuperMemory, query: string): boolean {
  const needle = query.toLowerCase();
  return memory.id === query
    || memory.text.toLowerCase().includes(needle)
    || memory.tags.some((tag) => tag.toLowerCase() === needle)
    || memory.anchors.some((anchor) => anchor.path?.toLowerCase().includes(needle));
}

function pushIndex(index: Record<string, string[]>, key: string, id: string): void {
  const normalized = key.toLowerCase();
  const values = index[normalized] ?? [];
  if (!values.includes(id)) values.push(id);
  index[normalized] = values;
}

function labelOf(scope: MemoryScope): string {
  switch (scope) {
    case 'project-agents':
      return 'Project AGENTS.md';
    case 'project-memory':
      return 'Project memory';
    case 'user-memory':
      return 'User memory';
  }
}

function uniqueIds(ids: string[] | undefined): string[] | undefined {
  if (!ids) return undefined;
  const result = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  return result.length > 0 ? result : undefined;
}

function normalizeNode(node: string): string {
  return normalizeSlashes(node.trim());
}

function anchorNode(anchor: MemoryAnchor): string | undefined {
  switch (anchor.type) {
    case 'file':
    case 'test':
    case 'git':
      return anchor.path ? `file:${normalizeSlashes(anchor.path)}` : undefined;
    case 'directory':
      return anchor.path ? `dir:${normalizeSlashes(anchor.path)}` : undefined;
    case 'symbol':
      return anchor.path && anchor.symbol
        ? `symbol:${normalizeSlashes(anchor.path)}#${anchor.symbol}`
        : undefined;
    case 'package':
      return anchor.path ? `dir:${normalizeSlashes(anchor.path)}` : undefined;
    case 'command':
      return anchor.command ? `command:${anchor.command.trim().replace(/\s+/g, ' ')}` : undefined;
  }
}

function anchorRelation(anchor: MemoryAnchor): MemoryGraphRelation | undefined {
  switch (anchor.type) {
    case 'file':
    case 'test':
    case 'git':
      return 'about_file';
    case 'directory':
      return 'about_directory';
    case 'symbol':
      return 'about_symbol';
    case 'package':
      return 'about_package';
    case 'command':
      return 'about_command';
  }
}

function sourceNode(
  projectRoot: string,
  source: SuperMemory['sources'][number],
): string | undefined {
  if (source.type === 'session' && source.sessionId) return `session:${source.sessionId}`;
  if (source.type === 'tool_result' && source.toolUseId) {
    return `tool:${source.sessionId ?? 'unknown'}/${source.toolUseId}`;
  }
  if (source.command) return `command:${source.command.trim().replace(/\s+/g, ' ')}`;
  if (source.path) {
    try {
      return `file:${normalizeProjectPath(projectRoot, source.path)}`;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function groupBy<T>(values: T[], keyOf: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function compareMemoryQuality(a: SuperMemory, b: SuperMemory): number {
  return b.importance - a.importance
    || b.confidence - a.confidence
    || a.createdAt.localeCompare(b.createdAt);
}

function dedupeAnchors(anchors: MemoryAnchor[]): MemoryAnchor[] {
  return dedupeByKey(anchors, (anchor) => JSON.stringify([
    anchor.type,
    anchor.path ?? null,
    anchor.symbol ?? null,
    anchor.command ?? null,
    anchor.contentHash ?? null,
    anchor.gitBlobHash ?? null,
    anchor.lineStart ?? null,
    anchor.lineEnd ?? null,
  ]));
}

function dedupeSources(sources: SuperMemory['sources']): SuperMemory['sources'] {
  return dedupeByKey(sources, (source) => JSON.stringify([
    source.type,
    source.sessionId ?? null,
    source.toolUseId ?? null,
    source.path ?? null,
    source.command ?? null,
    source.excerptHash ?? null,
  ]));
}

function dedupeByKey<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function memoryPatchChanges(memory: SuperMemory, patch: Partial<SuperMemory>): boolean {
  return Object.entries(patch).some(([key, value]) =>
    JSON.stringify(memory[key as keyof SuperMemory]) !== JSON.stringify(value));
}

async function fileSignature(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) return fallback;
  return Math.max(0, Math.min(maximum, Math.floor(resolved)));
}

function daysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1_000;
}

function parseLegacyMemory(raw: string): Array<{
  scope: MemoryScope;
  text: string;
  type?: MemoryEntry['type'];
  priority?: MemoryEntry['priority'];
  tags?: string[];
}> {
  const result: Array<{
    scope: MemoryScope;
    text: string;
    type?: MemoryEntry['type'];
    priority?: MemoryEntry['priority'];
    tags?: string[];
  }> = [];
  let scope: MemoryScope = 'project-memory';
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const label = heading[1]?.toLowerCase() ?? '';
      if (label.includes('user')) scope = 'user-memory';
      else if (label.includes('agent')) scope = 'project-agents';
      else scope = 'project-memory';
      continue;
    }
    if (!/^\s*[-*]\s+/.test(line)) continue;
    let text = line.replace(/^\s*[-*]\s+/, '').trim();
    text = text.replace(/^\[[^\]]+\]\s*/, '');
    const meta = text.match(/^\[([a-z_]+)(?:\|([a-z]+))?\]\s*/i);
    const type = meta?.[1] as MemoryEntry['type'] | undefined;
    const priority = meta?.[2] as MemoryEntry['priority'] | undefined;
    if (meta) text = text.slice(meta[0].length);
    const tags = [...text.matchAll(/#([\w-]+)/g)].map((match) => match[1] ?? '').filter(Boolean);
    text = text.replace(/\s+#[\w-]+/g, '').trim();
    if (text) {
      result.push({
        scope,
        text,
        ...(type !== undefined && { type }),
        ...(priority !== undefined && { priority }),
        ...(tags.length > 0 && { tags }),
      });
    }
  }
  return result;
}
