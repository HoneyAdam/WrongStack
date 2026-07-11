import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  MemoryEntry,
  MemoryRelevanceContext,
  MemoryScope,
  MemoryStore,
  ScoredEntry,
} from '@wrongstack/core';
import { ensureDir, ulid } from '@wrongstack/core/utils';
import { appendJsonl, readJson, readJsonl, writeJson } from './jsonl.js';
import { verifyMemoryAnchors } from './anchors/verify.js';
import { SuperMemoryGraph } from './graph/graph.js';
import {
  ancestorPaths,
  normalizeProjectPath,
  normalizeSlashes,
  resolveSuperMemoryPaths,
} from './paths.js';
import {
  SUPER_MEMORY_SCHEMA_VERSION,
  legacyToSuperScope,
  legacyTypeToKind,
  superToLegacyScope,
  toLegacyEntry,
  type MemoryAnchor,
  type LegacyImportResult,
  type MemoryCandidate,
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
const ACTIVE_STATUSES: SuperMemoryStatus[] = ['active'];

export class SuperMemoryStore implements MemoryStore {
  readonly paths;
  private readonly projectRoot: string;
  private readonly now: () => Date;
  private readonly events;
  private traceId?: string | undefined;
  private loaded: SuperMemory[] | undefined;
  private readonly graph: SuperMemoryGraph;
  private initialized = false;
  private mutationChain: Promise<unknown> = Promise.resolve();

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
    await Promise.all([
      ensureDir(this.paths.rootDir),
      ensureDir(this.paths.graphDir),
      ensureDir(this.paths.indexesDir),
      ensureDir(this.paths.snapshotsDir),
      ensureDir(this.paths.hygieneDir),
      ensureDir(this.paths.tmpDir),
      ensureDir(this.paths.locksDir),
    ]);
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
    this.initialized = true;
  }

  async rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory> {
    this.rejectIfUnsafe(input.text);
    await this.initialize();
    const now = this.nowIso();
    const memory: SuperMemory = {
      id: `mem_${ulid()}`,
      revision: 1,
      scope: input.scope ?? legacyToSuperScope(input.legacyScope ?? 'project-memory'),
      legacyScope: input.legacyScope,
      kind: input.kind ?? legacyTypeToKind(input.type),
      status: 'active',
      text: normalizeText(input.text),
      importance: clamp01(input.importance ?? importanceFromPriority(input.priority)),
      confidence: clamp01(input.confidence ?? 0.8),
      freshness: clamp01(input.freshness ?? 1),
      tags: normalizeTags(input.tags),
      anchors: normalizeAnchors(this.projectRoot, input.anchors ?? []),
      sources: input.sources ?? [{ type: 'user' }],
      supersedes: uniqueIds(input.supersedes),
      contradicts: uniqueIds(input.contradicts),
      createdAt: now,
      updatedAt: now,
    };
    await this.runMutation(async () => {
      await this.appendRecord('create', memory);
      await this.addAutomaticEdges(memory);
      await this.applyDeclaredRelationships(memory);
      await this.afterMutation();
    });
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
    const normalizedPath = normalizeProjectPath(this.projectRoot, query);
    starts.add(`file:${normalizedPath}`);
    starts.add(`dir:${normalizedPath}`);
    for (const memory of await this.searchSuper(query, { limit: 20 })) starts.add(`mem:${memory.id}`);
    return this.graph.traverse([...starts], { maxDepth, limit });
  }

  async verify(memoryId?: string): Promise<MemoryVerificationResult[]> {
    const memories = (await this.loadMemories()).filter(
      (memory) => memory.status !== 'deleted' && (!memoryId || memory.id === memoryId),
    );
    const results: MemoryVerificationResult[] = [];
    for (const memory of memories) {
      const result = await verifyMemoryAnchors(this.projectRoot, memory, this.nowIso());
      results.push(result);
      if (result.status === 'stale' && memory.status === 'active') {
        const reason = result.anchors.find((anchor) => anchor.status === 'stale')?.reason ?? 'Anchor is stale.';
        await this.updateMemory(memory, { status: 'stale', lastVerifiedAt: result.checkedAt });
        this.events?.emit('memory.staled', this.eventPayload({ memoryId: memory.id, reason }));
      } else if (result.status === 'verified') {
        await this.updateMemory(memory, {
          status: memory.status === 'stale' ? 'active' : memory.status,
          lastVerifiedAt: result.checkedAt,
          freshness: 1,
        });
      } else if (memory.lastVerifiedAt !== result.checkedAt) {
        await this.updateMemory(memory, { lastVerifiedAt: result.checkedAt });
      }
      this.events?.emit('memory.verified', this.eventPayload({ memoryId: memory.id, status: result.status }));
      await this.audit('memory.verified', {
        memoryId: memory.id,
        details: { status: result.status, anchors: result.anchors },
      });
    }
    if (results.length > 0) await this.afterMutation();
    return results;
  }

  async verifyForPaths(paths: string[]): Promise<MemoryVerificationResult[]> {
    const normalized = paths.map((value) => normalizeProjectPath(this.projectRoot, value));
    const matching = (await this.loadMemories()).filter(
      (memory) => memory.status !== 'deleted' && memory.anchors.some((anchor) => {
        if (!anchor.path) return false;
        const anchorPath = normalizeSlashes(anchor.path);
        return normalized.some((target) => target === anchorPath || target.startsWith(`${anchorPath}/`) || anchorPath.startsWith(`${target}/`));
      }),
    );
    const results: MemoryVerificationResult[] = [];
    for (const memory of matching) results.push(...await this.verify(memory.id));
    return results;
  }

  recordInjection(memoryIds: string[], trigger: string, sessionId?: string): void {
    this.events?.emit('memory.injected', this.eventPayload({ memoryIds, trigger, sessionId }));
    void this.audit('memory.injected', { details: { memoryIds, trigger, sessionId } });
  }

  async hygiene(options: SuperMemoryHygieneOptions = {}): Promise<SuperMemoryHygieneReport> {
    await this.initialize();
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
      archived: 0,
      deleted: 0,
      verified: 0,
    };
    this.events?.emit('memory.hygiene_started', this.eventPayload({ examined: report.examined }));
    await this.audit('memory.hygiene_started', { details: { examined: report.examined } });

    const active = initial.filter((memory) => memory.status === 'active');
    const duplicateGroups = groupBy(active, (memory) => normalizeText(memory.text).toLowerCase());
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
      const verified = await this.verify();
      report.verified = verified.filter((item) => item.status === 'verified').length;
      report.staled = verified.filter((item) => item.status === 'stale').length;
    }

    const nowMs = this.now().getTime();
    const retentionMs = daysToMs(options.retentionDays ?? 90);
    const lowConfidenceMs = daysToMs(options.archiveLowConfidenceAfterDays ?? 30);
    for (const memory of await this.loadMemories()) {
      if (memory.status === 'deleted' || memory.status === 'superseded' || memory.status === 'contradicted') continue;
      const age = nowMs - Date.parse(memory.updatedAt);
      if (memory.scope === 'session' && memory.expiresAt && Date.parse(memory.expiresAt) <= nowMs) {
        await this.updateMemory(memory, { status: 'deleted' });
        report.deleted++;
      } else if (memory.expiresAt && Date.parse(memory.expiresAt) <= nowMs) {
        await this.updateMemory(memory, { status: 'archived' });
        report.archived++;
      } else if (
        (memory.status === 'stale' && age >= retentionMs)
        || (memory.confidence < 0.5 && age >= lowConfidenceMs)
      ) {
        await this.updateMemory(memory, { status: 'archived' });
        report.archived++;
        this.events?.emit('memory.archived', this.eventPayload({ memoryId: memory.id, reason: 'Hygiene retention policy.' }));
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
    for (const memory of memories) {
      byStatus[memory.status]++;
      byKind[memory.kind] = (byKind[memory.kind] ?? 0) + 1;
    }
    return { total: memories.length, byStatus, byKind, edges: (await this.graph.list()).length };
  }

  async importLegacy(files: string | string[]): Promise<LegacyImportResult> {
    const paths = Array.isArray(files) ? files : [files];
    const result: LegacyImportResult = { imported: 0, skipped: 0, files: 0 };
    const existing = new Set((await this.loadMemories()).map((memory) => normalizeText(memory.text).toLowerCase()));
    for (const filePath of paths) {
      let raw: string;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      result.files++;
      for (const entry of parseLegacyMemory(raw)) {
        const key = normalizeText(entry.text).toLowerCase();
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
    input: Omit<RememberSuperMemoryInput, 'legacyScope' | 'priority' | 'type'>,
  ): Promise<MemoryCandidate> {
    this.rejectIfUnsafe(input.text);
    await this.initialize();
    const now = this.nowIso();
    const candidate: MemoryCandidate = {
      schemaVersion: SUPER_MEMORY_SCHEMA_VERSION,
      id: `candidate_${ulid()}`,
      status: 'pending',
      text: normalizeText(input.text),
      kind: input.kind ?? 'fact',
      scope: input.scope ?? 'project',
      confidence: clamp01(input.confidence ?? 0.6),
      importance: clamp01(input.importance ?? 0.6),
      tags: normalizeTags(input.tags),
      anchors: normalizeAnchors(this.projectRoot, input.anchors ?? []),
      sources: input.sources ?? [{ type: 'session' }],
      createdAt: now,
      updatedAt: now,
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
      if (row?.schemaVersion === 1 && row.id && row.text) latest.set(row.id, row);
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
      sources: candidate.sources,
    });
    await appendJsonl(this.paths.candidatesLog, {
      ...candidate,
      status: 'accepted',
      memoryId: memory.id,
      updatedAt: this.nowIso(),
    } satisfies MemoryCandidate);
    return memory;
  }

  async rejectCandidate(candidateId: string, reason: string): Promise<boolean> {
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
  }

  async consolidateSession(input: SessionConsolidationInput): Promise<SessionConsolidationResult> {
    const result: SessionConsolidationResult = { candidates: 0, accepted: 0, rejected: 0, duplicate: 0 };
    const existing = new Set((await this.loadMemories()).map((memory) => normalizeText(memory.text).toLowerCase()));
    const threshold = clamp01(input.autoAcceptThreshold ?? 0.85);
    for (const fact of input.facts) {
      const text = normalizeText(fact.text);
      if (!text || existing.has(text.toLowerCase())) {
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
      const policyScore = candidate.confidence * 0.55 + candidate.importance * 0.45;
      if (policyScore >= threshold) {
        await this.acceptCandidate(candidate.id);
        existing.add(text.toLowerCase());
        result.accepted++;
      }
    }
    return result;
  }

  async retrieveForPath(opts: SuperMemoryForPathOptions): Promise<SuperMemory[]> {
    const all = await this.loadActive();
    const target = normalizeProjectPath(this.projectRoot, opts.path);
    const candidates = opts.includeAncestors === false
      ? [target]
      : ancestorPaths(target);
    const scored = all
      .map((memory) => ({
        memory,
        score: scorePathMemory(memory, target, candidates),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, opts.limit ?? DEFAULT_LIMIT).map((item) => item.memory);
  }

  async searchSuper(query: string, opts: SuperMemorySearchOptions = {}): Promise<SuperMemory[]> {
    const statuses = opts.includeStatuses ?? ACTIVE_STATUSES;
    const all = await this.loadMemories();
    const scored = all
      .filter((memory) => statuses.includes(memory.status))
      .filter((memory) => !opts.scope || memory.scope === opts.scope)
      .filter((memory) => !opts.legacyScope || (memory.legacyScope ?? superToLegacyScope(memory.scope)) === opts.legacyScope)
      .map((memory) => ({ memory, score: scoreQueryMemory(memory, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, opts.limit ?? DEFAULT_LIMIT).map((item) => item.memory);
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
    const all = await this.loadMemories();
    const now = this.nowIso();
    let removed = 0;
    for (const memory of all) {
      if (memory.status === 'deleted') continue;
      const legacyScope = memory.legacyScope ?? superToLegacyScope(memory.scope);
      if (legacyScope !== scope) continue;
      if (!matchesForget(memory, query)) continue;
      removed++;
      await this.appendRecord('delete', {
        ...memory,
        revision: memory.revision + 1,
        status: 'deleted',
        updatedAt: now,
      });
    }
    if (removed > 0) {
      await this.audit('memory.deleted', { reason: query, details: { removed, scope } });
      this.events?.emit('memory.forgotten', { scope, query, removed });
      await this.afterMutation();
    }
    return removed;
  }

  async consolidate(scope: MemoryScope): Promise<void> {
    await this.initialize();
    const entries = await this.list(scope);
    const seen = new Set<string>();
    let removed = 0;
    for (const entry of entries) {
      const key = normalizeText(entry.text).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      removed += await this.forget(entry.text, scope);
    }
    if (removed > 0) {
      this.events?.emit('memory.consolidated', { scope, removed });
    }
  }

  async clear(scope?: MemoryScope): Promise<void> {
    await this.initialize();
    const scopes: MemoryScope[] = scope ? [scope] : ['project-agents', 'project-memory', 'user-memory'];
    for (const s of scopes) {
      const entries = await this.list(s);
      for (const entry of entries) {
        await this.forget(entry.text, s);
      }
      this.events?.emit('memory.cleared', { scope: s });
    }
  }

  async list(scope: MemoryScope = 'project-memory', limit?: number): Promise<MemoryEntry[]> {
    const all = await this.loadActive();
    const entries = all
      .filter((memory) => (memory.legacyScope ?? superToLegacyScope(memory.scope)) === scope)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toLegacyEntry);
    return limit ? entries.slice(0, limit) : entries;
  }

  async search(query: string, scope: MemoryScope = 'project-memory', limit?: number): Promise<MemoryEntry[]> {
    const memories = await this.searchSuper(query, { legacyScope: scope, limit });
    return memories.map(toLegacyEntry);
  }

  async findRelated(text: string, scope: MemoryScope = 'project-memory', limit = 5): Promise<MemoryEntry[]> {
    return this.search(text, scope, limit);
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

  private async loadActive(): Promise<SuperMemory[]> {
    const all = await this.loadMemories();
    return all.filter((memory) => memory.status === 'active');
  }

  private async loadMemories(): Promise<SuperMemory[]> {
    if (this.loaded) return this.loaded;
    const records = await readJsonl<SuperMemoryRecord>(this.paths.memoriesLog, async (line) => {
      await this.audit('memory.corrupt_line', {
        reason: line.error,
        details: {
          filePath: line.filePath,
          lineNumber: line.lineNumber,
        },
      });
    });
    const latest = new Map<string, SuperMemory>();
    for (const record of records) {
      if (!isMemoryRecord(record)) continue;
      const current = latest.get(record.memory.id);
      if (!current || record.memory.revision >= current.revision) {
        latest.set(record.memory.id, record.memory);
      }
    }
    if (latest.size === 0) {
      const snapshot = await readJson<SuperMemorySnapshot>(path.join(this.paths.snapshotsDir, 'latest.json'));
      if (snapshot?.schemaVersion === SUPER_MEMORY_SCHEMA_VERSION && Array.isArray(snapshot.memories)) {
        for (const memory of snapshot.memories) latest.set(memory.id, memory);
        await this.audit('memory.snapshot_recovered', { details: { snapshotId: snapshot.id, memories: snapshot.memories.length } });
      }
    }
    this.loaded = [...latest.values()];
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
  ): Promise<SuperMemory> {
    const updated: SuperMemory = {
      ...memory,
      ...patch,
      id: memory.id,
      revision: memory.revision + 1,
      createdAt: memory.createdAt,
      updatedAt: this.nowIso(),
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
    }
  }

  private async applyDeclaredRelationships(memory: SuperMemory): Promise<void> {
    const all = await this.loadMemories();
    for (const id of memory.supersedes ?? []) {
      const target = all.find((candidate) => candidate.id === id && candidate.status !== 'deleted');
      if (!target) continue;
      await this.updateMemory(target, { status: 'superseded', supersededBy: memory.id });
      await this.addGraphEdge(`mem:${memory.id}`, `mem:${id}`, 'supersedes', 1);
      this.events?.emit('memory.superseded', this.eventPayload({ memoryId: id, supersededBy: memory.id }));
    }
    for (const id of memory.contradicts ?? []) {
      const target = all.find((candidate) => candidate.id === id && candidate.status !== 'deleted');
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
    const next = this.mutationChain.catch(() => undefined).then(work);
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
}

function isMemoryRecord(value: unknown): value is SuperMemoryRecord {
  const record = value as Partial<SuperMemoryRecord>;
  return record?.recordType === 'memory'
    && record.schemaVersion === SUPER_MEMORY_SCHEMA_VERSION
    && !!record.memory?.id
    && typeof record.memory.text === 'string';
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeAnchors(projectRoot: string, anchors: MemoryAnchor[]): MemoryAnchor[] {
  return anchors.map((anchor) => ({
    ...anchor,
    path: anchor.path ? normalizeProjectPath(projectRoot, anchor.path) : undefined,
  }));
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

function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9_.-]+/).filter((term) => term.length >= 3))];
}

function scoreQueryMemory(memory: SuperMemory, query: string): number {
  const terms = tokenize(query);
  if (terms.length === 0) return 0;
  const haystack = `${memory.text} ${memory.tags.join(' ')} ${memory.anchors.map((a) => `${a.path ?? ''} ${a.symbol ?? ''}`).join(' ')}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
    if (memory.tags.some((tag) => tag.includes(term))) score += 2;
    if (memory.anchors.some((anchor) => anchor.path?.toLowerCase().includes(term))) score += 2;
  }
  score += memory.importance * 2;
  score += memory.confidence;
  score += memory.freshness;
  return score;
}

function scorePathMemory(memory: SuperMemory, target: string, ancestors: string[]): number {
  let score = 0;
  for (const anchor of memory.anchors) {
    if (!anchor.path) continue;
    const anchorPath = normalizeSlashes(anchor.path);
    if (anchorPath === target) score += 10;
    else if (ancestors.includes(anchorPath)) score += 5;
    else if (target.startsWith(`${anchorPath}/`) || anchorPath.startsWith(`${target}/`)) score += 3;
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

function looksLikeSecret(text: string): boolean {
  return [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}/i,
    /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  ].some((pattern) => pattern.test(text));
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
  return dedupeObjects(anchors);
}

function dedupeSources(sources: SuperMemory['sources']): SuperMemory['sources'] {
  return dedupeObjects(sources);
}

function dedupeObjects<T>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
