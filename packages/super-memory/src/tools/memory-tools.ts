import type { MemoryScope, MemoryStore, Tool } from '@wrongstack/core';
import type {
  MemoryAnchor,
  MemoryAudienceSelector,
  MemoryCandidate,
  MemoryGraphEdge,
  MemoryVerificationResult,
  RememberSuperMemoryInput,
  SuperMemory,
  SuperMemoryBackfillFilter,
  SuperMemoryBackfillOptions,
  SuperMemoryBackfillReport,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
  SuperMemoryKind,
  SuperMemoryScope,
  SuperMemoryStatus,
  FindMemoriesForFileOptions,
  FindMemoriesForFileResponse,
  UpdateSuperMemoryInput,
} from '../types.js';

const KIND_VALUES: SuperMemoryKind[] = [
  'fact', 'decision', 'convention', 'preference', 'warning', 'anti_pattern',
  'workflow', 'bug_root_cause', 'file_note', 'symbol_note', 'command_note', 'summary',
];
const SCOPE_VALUES: SuperMemoryScope[] = ['project', 'user', 'session', 'file', 'symbol'];
const STATUS_VALUES: SuperMemoryStatus[] = [
  'active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted',
];
const ANCHOR_TYPE_VALUES: MemoryAnchor['type'][] = [
  'file', 'directory', 'symbol', 'package', 'command', 'test', 'git',
];
const LEGACY_SCOPE_VALUES: MemoryScope[] = ['project-agents', 'project-memory', 'user-memory'];

export interface SuperMemoryServiceLike extends MemoryStore {
  retrieveForPath(opts: {
    path: string;
    limit?: number;
    includeAncestors?: boolean;
    includeStatuses?: SuperMemory['status'][];
  }): Promise<SuperMemory[]>;
  searchSuper(query: string, opts?: { limit?: number; includeStatuses?: SuperMemory['status'][] }): Promise<SuperMemory[]>;
  retrieveForAudience?(context: { role?: string; taskType?: string; mode?: string }, limit?: number): Promise<SuperMemory[]>;
  graphFor(query: string, maxDepth?: number, limit?: number): Promise<MemoryGraphEdge[]>;
  verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]>;
  hygiene(options?: SuperMemoryHygieneOptions, signal?: AbortSignal): Promise<SuperMemoryHygieneReport>;
  listCandidates(includeResolved?: boolean): Promise<MemoryCandidate[]>;
  acceptCandidate(candidateId: string): Promise<SuperMemory | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
  rememberSuper(input: RememberSuperMemoryInput): Promise<SuperMemory>;
  updateSuperMemory(id: string, patch: UpdateSuperMemoryInput): Promise<SuperMemory>;
  deleteSuperMemory(id: string, reason?: string, options?: { force?: boolean; neverInject?: boolean }): Promise<void>;
  /**
   * Restore a `deleted` memory to `active`. Superseded memories return the
   * head of their version chain (no-op write). Throws if the id is unknown.
   */
  recoverSuperMemory(id: string, reason?: string): Promise<SuperMemory>;
  /**
   * Scan `status='deleted'` records and create fresh active versions for
   * the ones that pass the recoverability filter. Default `dryRun: true`.
   * Used by users/LLMs to undo a hygiene-driven deletion from a prior
   * session (legacy records from before the redesigned contract).
   */
  backfillRecoverable(options?: SuperMemoryBackfillOptions): Promise<SuperMemoryBackfillReport>;
  /**
   * File-drawer query: returns primary / symbol / related buckets with
   * `matchedVia`, `matchStrength`, and `pendingReview` metadata.
   * Read-only — opening a file in the editor must never mutate memory.
   */
  findMemoriesForFile(
    filePath: string,
    options?: FindMemoriesForFileOptions,
  ): Promise<FindMemoriesForFileResponse>;
  getSuperMemory(id: string): Promise<SuperMemory | null>;
}

export function createSuperMemoryTools(memory: SuperMemoryServiceLike): Tool[] {
  return [
    // Read surface (indices 0-6 — kept first for positional test stability).
    memoryForFileTool(memory),
    memoryForPathTool(memory),
    memorySearchTool(memory),
    memoryGraphTool(memory),
    memoryVerifyTool(memory),
    memoryHygieneTool(memory),
    memoryCandidatesTool(memory),
    // Write surface — the single, structured way to persist/update/delete
    // project knowledge. Replaces the legacy `remember`/`forget` tools.
    memoryRememberTool(memory),
    memoryForgetTool(memory),
    memoryUpdateTool(memory),
    memoryDeleteTool(memory),
    memoryRecoverTool(memory),
    memoryBackfillRecoverableTool(memory),
  ];
}

interface RememberToolInput {
  text: string;
  kind?: SuperMemoryKind | undefined;
  scope?: SuperMemoryScope | undefined;
  tags?: string[] | undefined;
  anchors?: MemoryAnchor[] | undefined;
  audience?: MemoryAudienceSelector | undefined;
  /** When true, disables auto-scoping from agent role/mode. */
  no_auto_audience?: boolean | undefined;
  importance?: number | undefined;
  confidence?: number | undefined;
  supersedes?: string[] | undefined;
  contradicts?: string[] | undefined;
  /** Legacy back-compat — mapped to `kind`/`importance` by rememberSuper. */
  type?: 'fact' | 'decision' | 'convention' | 'preference' | 'reference' | 'anti_pattern' | undefined;
  priority?: 'critical' | 'high' | 'medium' | 'low' | undefined;
}

function memoryRememberTool(memory: SuperMemoryServiceLike): Tool<RememberToolInput, SuperMemory> {
  return {
    name: 'remember',
    category: 'Session',
    description:
      'Persist structured project knowledge into long-term Super Memory. Bind it to files, symbols, or commands with `anchors` so it can be verified and auto-surfaced later.',
    usageHint:
      'Persist facts, conventions, decisions, and preferences into long-term memory.\n\n' +
      'WHEN TO USE:\n' +
      '- Project conventions discovered during a task (build tool, lint rules, code style)\n' +
      '- Architecture decisions made (chose X over Y, decided to use pattern Z)\n' +
      '- User preferences expressed (prefers short names, always uses pnpm)\n' +
      '- Anti-patterns / warnings identified (never do X, avoid pattern Y)\n' +
      '- Bug root-causes and file/symbol notes useful across sessions\n\n' +
      'WHEN NOT TO USE:\n' +
      '- Temporary task state or progress → use `todo`\n' +
      '- One-off debugging notes\n' +
      '- Information already obvious from the codebase\n\n' +
      'Pick the most specific `kind`. Add 1-3 `tags`. Anchor to a `path`/`symbol`/`command`\n' +
      'whenever the memory is about a concrete code location so it stays verifiable.\n\n' +
      'AUDIENCE SCOPING:\n' +
      '- Pass `audience: { roles: [...] }` to target a memory to specific agent types.\n' +
      '- Scoped memories are injected into matching subagent system prompts automatically.\n' +
      '- They are excluded from ordinary search/retrieval so they do not clutter general hints.\n' +
      '- Example: a reviewer agent can record `audience: { roles: ["reviewer"] }` to share\n' +
      '  review-specific guidance with future reviewer instances across sessions.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.write'],
    icon: 'settings',
    inputSchema: objectSchema({
      text: { type: 'string', minLength: 1, description: 'The fact or note to remember. Concise and factual.' },
      kind: enumSchema(KIND_VALUES, 'Category — the most specific kind that fits.'),
      scope: enumSchema(SCOPE_VALUES, 'project (shared, default), user (personal), session, file, or symbol.'),
      tags: stringArraySchema('Hashtag-style tags for grouping and search (omit the #).'),
      anchors: anchorsSchema(),
      audience: audienceSchema(),
      no_auto_audience: { type: 'boolean', description: 'Set to true to prevent auto-scoping from your agent role/mode. Creates a general project memory even when called from a subagent.' },
      importance: numberSchema(0, 1),
      confidence: numberSchema(0, 1),
      supersedes: stringArraySchema('Memory ids this replaces (they become superseded).'),
      contradicts: stringArraySchema('Memory ids this contradicts.'),
      type: { type: 'string', enum: ['fact', 'decision', 'convention', 'preference', 'reference', 'anti_pattern'], description: 'Legacy category (optional; prefer `kind`).' },
      priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: 'Legacy priority (optional; prefer `importance`).' },
    }, ['text']),
    async execute(input, ctx, opts) {
      opts.signal.throwIfAborted();
      const detectedRole = typeof ctx?.meta?.['agentRole'] === 'string'
        ? ctx.meta['agentRole'] as string
        : undefined;
      const detectedMode = typeof ctx?.meta?.['mode'] === 'string'
        ? ctx.meta['mode'] as string
        : undefined;
      const autoAudience = !input.audience && !input.no_auto_audience && (detectedRole || detectedMode)
        ? {
            ...(detectedRole ? { roles: [detectedRole] } : {}),
            ...(detectedMode ? { modes: [detectedMode] } : {}),
          }
        : input.audience;
      return memory.rememberSuper({
        text: input.text,
        kind: input.kind,
        scope: input.scope,
        tags: input.tags,
        anchors: input.anchors,
        audience: autoAudience,
        importance: input.importance,
        confidence: input.confidence,
        supersedes: input.supersedes,
        contradicts: input.contradicts,
        type: input.type,
        priority: input.priority,
      });
    },
  };
}

function memoryForgetTool(memory: SuperMemoryServiceLike): Tool<{ query: string; scope?: MemoryScope }, { removed: number; scope: MemoryScope }> {
  return {
    name: 'forget',
    category: 'Session',
    description: 'Remove memory entries whose text/tag/anchor matches the query (case-insensitive). Prefer `memory_delete` when you have a specific memory id.',
    usageHint:
      'This soft-deletes matching memories in the chosen scope.\n' +
      '- Provide a reasonably specific `query` to avoid deleting unrelated memories.\n' +
      '- Use `memory_delete` with an id for exact, single-entry removal.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.delete'],
    icon: 'settings',
    inputSchema: objectSchema({
      query: { type: 'string', minLength: 1, description: 'Substring/tag/id to match.' },
      scope: enumSchema(LEGACY_SCOPE_VALUES, 'Which scope to search. Defaults to project-memory.'),
    }, ['query']),
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      const scope: MemoryScope = input.scope ?? 'project-memory';
      const removed = await memory.forget(input.query, scope);
      return { removed, scope };
    },
  };
}

function memoryUpdateTool(memory: SuperMemoryServiceLike): Tool<{ id: string } & UpdateSuperMemoryInput, SuperMemory> {
  return {
    name: 'memory_update',
    category: 'Session',
    description: 'Update a single Super Memory entry by id — edit text, tags, kind, anchors, importance/confidence, status, or relationships.',
    usageHint:
      'Refine or re-scope an existing memory instead of creating a near-duplicate.\n' +
      '- Find the id via `memory_search` or `memory_for_file`.\n' +
      '- Set `status` to "stale"/"archived" to retire a memory without deleting it.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.write'],
    icon: 'settings',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1, description: 'The memory id to update.' },
      text: { type: 'string', minLength: 1, description: 'Replacement text.' },
      tags: stringArraySchema('Replacement tags (omit the #).'),
      kind: enumSchema(KIND_VALUES, 'New kind.'),
      anchors: anchorsSchema(),
      audience: audienceSchema(),
      importance: numberSchema(0, 1),
      confidence: numberSchema(0, 1),
      freshness: numberSchema(0, 1),
      status: enumSchema(STATUS_VALUES, 'New lifecycle status.'),
      supersedes: stringArraySchema('Memory ids this replaces.'),
      contradicts: stringArraySchema('Memory ids this contradicts.'),
      force: { type: 'boolean', description: 'Override the permanent-memory guard when setting status to "deleted". The override is audit-logged.' },
    }, ['id']),
    validate(input) {
      const { id, ...patch } = input;
      if (!id) return ['id is required'];
      if (Object.values(patch).every((v) => v === undefined)) {
        return ['at least one field to update is required'];
      }
      return [];
    },
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      const { id, ...patch } = input;
      return memory.updateSuperMemory(id, patch);
    },
  };
}

function memoryDeleteTool(memory: SuperMemoryServiceLike): Tool<{ id: string; reason?: string; force?: boolean; neverInject?: boolean }, { deleted: true; id: string }> {
  return {
    name: 'memory_delete',
    category: 'Session',
    description: 'Delete one Super Memory entry by id (soft-delete with graph/relationship cascade cleanup).',
    usageHint:
      'Exact, single-entry removal by id — safer than substring `forget`.\n' +
      '- Find the id via `memory_search`. Provide a short `reason` for the audit log.\n' +
      '- Normal deletion keeps historical evidence eligible for relevant LLM context. Set `neverInject: true` only for an explicit privacy/safety ban.\n' +
      '- Memories marked `permanent` are refused unless `force: true` is passed; the override is recorded in the audit log.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.delete'],
    icon: 'settings',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1, description: 'The memory id to delete.' },
      reason: stringSchema('Reason recorded in the audit log.'),
      force: { type: 'boolean', description: 'Required to delete memories marked `permanent`. The override is audited.' },
      neverInject: { type: 'boolean', description: 'Absolute privacy/safety ban: this memory must never enter LLM context. Normal deletion remains context-eligible historical evidence.' },
    }, ['id']),
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      // Only forward `force` when it's truthy — keeps the call signature
      // backward-compatible for callers/tests that match on positional args.
      if (input.force === true || input.neverInject === true) {
        await memory.deleteSuperMemory(input.id, input.reason, { ...(input.force === true ? { force: true } : {}), ...(input.neverInject === true ? { neverInject: true } : {}) });
      } else {
        await memory.deleteSuperMemory(input.id, input.reason);
      }
      return { deleted: true, id: input.id };
    },
  };
}

interface RecoverToolOutput {
  recovered: true;
  id: string;
  /** Memory returned (after restore for `deleted`, or head-of-chain for `superseded`). */
  memory: SuperMemory;
  /** True when the requested id was already-active or superseded (no-op write). */
  noop: boolean;
}

function memoryRecoverTool(memory: SuperMemoryServiceLike): Tool<{ id: string; reason?: string }, RecoverToolOutput> {
  return {
    name: 'memory_recover',
    category: 'Session',
    description: 'Restore a deleted Super Memory entry to active status. Superseded entries resolve to the head of their version chain (no-op write).',
    usageHint:
      'Use after a `deleted` entry has been surfaced by `memory_search` with `includeStatuses: ["deleted"]`, ' +
      'or from the MemoryManager "↺ Recover" button. Idempotent: already-active or superseded entries return `noop: true`.\n' +
      '- Provide a short `reason` for the audit log.\n' +
      '- Permanence is preserved — recovering a `deleted` memory does not alter its `persistence` class.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.recover'],
    icon: 'settings',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1, description: 'The memory id to recover.' },
      reason: stringSchema('Reason recorded in the audit log.'),
    }, ['id']),
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      // Read pre-call status: only `deleted` → `active` is a real write.
      // Id-equality can't distinguish "wrote and returned same id" from
      // "returned same id unchanged" (the idempotent already-active retry path).
      const preCall = await memory.getSuperMemory(input.id);
      if (!preCall) {
        throw new Error(`Super Memory "${input.id}" not found.`);
      }
      const result = await memory.recoverSuperMemory(input.id, input.reason);
      const noop = preCall.status !== 'deleted';
      return { recovered: true, id: input.id, memory: result, noop };
    },
  };
}

interface BackfillRecoverableToolInput {
  filter?: SuperMemoryBackfillFilter | undefined;
  /** Default true: report only. Pass `--apply` (set false) to actually create new versions. */
  apply?: boolean | undefined;
  /** Optional operator/LLM reason recorded in audit. */
  reason?: string | undefined;
}

function memoryBackfillRecoverableTool(
  memory: SuperMemoryServiceLike,
): Tool<BackfillRecoverableToolInput, SuperMemoryBackfillReport> {
  return {
    name: 'memory_backfill_recoverable',
    category: 'Session',
    description: 'Find status="deleted" memories that are still recoverable and either preview them (default) or restore them as fresh active versions.',
    usageHint:
      'Use when you want to undo legacy hygiene-driven deletions. Default is `dryRun: true` — the tool returns a report without writing anything.\n' +
      '- Pass `--apply` (or `apply: false`) to actually create fresh active versions for each recoverable memory. The original `deleted` records are preserved (audit trail); a new active version is created and linked via `supersedes`.\n' +
      '- Use `filter.kinds` / `filter.scopes` / `filter.updatedAfter` / `filter.updatedBefore` to narrow scope. `filter.requireText: false` lets in records with empty text; `filter.requireProvenance: false` lets in records with neither sources nor anchors.\n' +
      '- The audit log records every run (`memory.backfill_dry_run` or `memory.backfill_applied`).',
    permission: 'confirm',
    mutating: false, // default dry-run; flips to true when apply is requested — see execute()
    riskTier: 'standard',
    timeoutMs: 5_000,
    capabilities: ['memory.backfill'],
    icon: 'search',
    inputSchema: objectSchema({
      filter: {
        type: 'object',
        description: 'Optional filter — see schema for fields. Empty/missing means "no filter".',
        properties: {
          kinds: {
            type: 'array',
            items: { type: 'string', enum: KIND_VALUES },
            description: 'Only consider memories with one of these kinds.',
          },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: SCOPE_VALUES },
            description: 'Only consider memories with one of these scopes.',
          },
          updatedAfter: stringSchema('ISO-8601 cutoff: only memories with updatedAt >= this are considered.'),
          updatedBefore: stringSchema('ISO-8601 cutoff: only memories with updatedAt <= this are considered.'),
          requireText: { type: 'boolean', description: 'Default true. Set false to also consider empty-text records.' },
          requireProvenance: { type: 'boolean', description: 'Default true. Set false to consider records with neither sources nor anchors.' },
        },
        additionalProperties: false,
      },
      apply: { type: 'boolean', description: 'Default false (dry-run). Set true to actually create new active versions.' },
      reason: stringSchema('Optional reason recorded in the audit log.'),
    }, []),
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      // `--apply` semantics: the CLI surfaces the flag as `apply: true`,
      // the JS API as `dryRun: false`. We accept both shapes here.
      const dryRun = input.apply !== true;
      const report = await memory.backfillRecoverable({
        dryRun,
        ...(input.filter !== undefined ? { filter: input.filter } : {}),
      });
      return report;
    },
  };
}

/**
 * Rich file-drawer query: returns three buckets (`primaryMatches`,
 * `symbolMatches`, `relatedMatches`) with `matchedVia`, `matchStrength`,
 * `supersededByActiveId`, and `pendingReview` metadata so the file-editor
 * UI can render "why this matched" + give the user recovery / review actions.
 *
 * Side-effect-free: opening a file in the editor must never mutate the memory
 * store. Cursor-aware via `lineStart`/`lineEnd` — when both are provided,
 * symbol anchors overlapping that range get a strength boost (0.95) so the
 * user sees the most relevant notes pinned when their caret lands on a
 * function/class.
 */
function memoryForFileTool(
  memory: SuperMemoryServiceLike,
): Tool<
  {
    path: string;
    /** Optional cursor line — symbol anchors overlapping get a strength boost. */
    lineStart?: number;
    lineEnd?: number;
    /** Per-bucket cap. Default 50. */
    limit?: number;
    /** Default true. Include superseded memories (with `supersededByActiveId`). */
    showSuperseded?: boolean;
    /**
     * Default false. Set true (typically via a "Show recoverable" UI toggle)
     * to surface `status='deleted'` memories for one-click recovery.
     */
    showDeleted?: boolean;
  },
  FindMemoriesForFileResponse
> {
  return {
    name: 'memory_for_file',
    category: 'Inspect',
    description:
      'Retrieve memories attached to a file, grouped by how they match. ' +
      'Supports a cursor line range so symbol-anchored memories under the caret surface first.',
    usageHint:
      'Use when opening a file in the editor and you want to surface every memory ' +
      'that is attached, anchored, or mentions the file. Pass `lineStart` / `lineEnd` ' +
      'to pin symbol-anchored memories overlapping the cursor.\n' +
      '- `primaryMatches`: scope_file or file/directory anchor (strongest).\n' +
      '- `symbolMatches`: scope_symbol or symbol anchor (cursor-boosted).\n' +
      '- `relatedMatches`: text mentions (weakest — shown under "Mentioned in").\n' +
      'Set `showDeleted: true` after a Show-recoverable toggle to include deleted records.',
    inputSchema: objectSchema(
      {
        path: stringSchema('Project-relative file path.'),
        lineStart: {
          type: 'integer',
          minimum: 1,
          description:
            'Optional — caret line (1-indexed). When both `lineStart` and `lineEnd` are set, symbol anchors overlapping this range get a strength boost.',
        },
        lineEnd: {
          type: 'integer',
          minimum: 1,
          description: 'Optional — last caret line. Pair with `lineStart`.',
        },
        limit: { ...numberSchema(1, 200), description: 'Per-bucket cap. Default 50.' },
        showSuperseded: {
          type: 'boolean',
          description:
            'Default true. Set false to hide superseded memories (use for compact UI).',
        },
        showDeleted: {
          type: 'boolean',
          description:
            'Default false. Set true (typically via a "Show recoverable" UI toggle) to surface deleted memories for recovery.',
        },
      },
      ['path'],
    ),
    permission: 'auto',
    mutating: false,
    riskTier: 'safe',
    capabilities: ['memory.read'],
    icon: 'search',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.findMemoriesForFile(input.path, {
        ...(input.lineStart !== undefined ? { lineStart: input.lineStart } : {}),
        ...(input.lineEnd !== undefined ? { lineEnd: input.lineEnd } : {}),
        limit: input.limit ?? 50,
        includeSuperseded: input.showSuperseded !== false,
        includeDeleted: input.showDeleted === true,
      });
    },
  };
}

function memoryForPathTool(memory: SuperMemoryServiceLike): Tool<{ path: string; limit?: number }, SuperMemory[]> {
  return {
    name: 'memory_for_path',
    category: 'Inspect',
    description: 'Retrieve project knowledge for a path and its ancestor directories.',
    inputSchema: objectSchema({ path: stringSchema('Project-relative file or directory path.'), limit: numberSchema(1, 50) }, ['path']),
    permission: 'auto',
    mutating: false,
    riskTier: 'safe',
    capabilities: ['memory.read'],
    icon: 'search',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.retrieveForPath({ path: input.path, limit: input.limit ?? 20, includeAncestors: true });
    },
  };
}

function memorySearchTool(memory: SuperMemoryServiceLike): Tool<{ query: string; limit?: number; include_stale?: boolean }, SuperMemory[]> {
  return {
    name: 'memory_search',
    category: 'Inspect',
    description: 'Search structured project memory using lexical, tag, path, and anchor signals.',
    inputSchema: objectSchema({
      query: stringSchema('Search text, symbol, tag, command, or path.'),
      limit: numberSchema(1, 100),
      include_stale: { type: 'boolean' },
    }, ['query']),
    permission: 'auto',
    mutating: false,
    riskTier: 'safe',
    capabilities: ['memory.read'],
    icon: 'search',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.searchSuper(input.query, {
        limit: input.limit ?? 20,
        includeStatuses: input.include_stale ? ['active', 'stale'] : ['active'],
      });
    },
  };
}

function memoryGraphTool(memory: SuperMemoryServiceLike): Tool<{ query: string; depth?: number; limit?: number }, MemoryGraphEdge[]> {
  return {
    name: 'memory_graph',
    category: 'Inspect',
    description: 'Traverse relationships between memories, files, symbols, commands, and sessions.',
    inputSchema: objectSchema({
      query: stringSchema('A memory id, graph node, path, symbol, or search query.'),
      depth: numberSchema(1, 6),
      limit: numberSchema(1, 500),
    }, ['query']),
    permission: 'auto',
    mutating: false,
    riskTier: 'safe',
    capabilities: ['memory.read'],
    icon: 'tree',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.graphFor(input.query, input.depth ?? 2, input.limit ?? 100);
    },
  };
}

function memoryVerifyTool(memory: SuperMemoryServiceLike): Tool<{ memory_id?: string }, MemoryVerificationResult[]> {
  return {
    name: 'memory_verify',
    category: 'Session',
    description: 'Verify file, directory, symbol, content-hash, and git-blob anchors and update stale state.',
    inputSchema: objectSchema({ memory_id: stringSchema('Optional memory id; omit to verify all.') }),
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    capabilities: ['memory.write', 'fs.read'],
    icon: 'settings',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.verify(input.memory_id, opts.signal);
    },
  };
}

function memoryHygieneTool(memory: SuperMemoryServiceLike): Tool<SuperMemoryHygieneOptions, SuperMemoryHygieneReport> {
  return {
    name: 'memory_hygiene',
    category: 'Session',
    description: 'Deduplicate, verify anchors, mark stale, supersede old versions, and surface review candidates for deletion or archival. Never auto-deletes or auto-archives — final decisions belong to the user or agent.',
    inputSchema: objectSchema({
      retentionDays: numberSchema(0, 3650),
      archiveLowConfidenceAfterDays: numberSchema(0, 3650),
      verify: { type: 'boolean' },
    }),
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    capabilities: ['memory.write', 'fs.read'],
    icon: 'settings',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.hygiene(input, opts.signal);
    },
  };
}

function memoryCandidatesTool(memory: SuperMemoryServiceLike): Tool<{
  action?: 'list' | 'accept' | 'reject';
  candidate_id?: string;
  reason?: string;
  include_resolved?: boolean;
}, MemoryCandidate[] | SuperMemory | { rejected: boolean } | undefined> {
  return {
    name: 'memory_candidates',
    category: 'Session',
    description: 'List, accept, or reject memory candidates produced by session consolidation.',
    inputSchema: objectSchema({
      action: { type: 'string', enum: ['list', 'accept', 'reject'] },
      candidate_id: stringSchema('Required for accept or reject.'),
      reason: stringSchema('Reason for rejection.'),
      include_resolved: { type: 'boolean' },
    }),
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    capabilities: ['memory.read', 'memory.write'],
    icon: 'settings',
    validate(input) {
      if ((input.action === 'accept' || input.action === 'reject') && !input.candidate_id) {
        return ['candidate_id is required for accept or reject'];
      }
      return [];
    },
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      if (input.action === 'accept') return memory.acceptCandidate(input.candidate_id!);
      if (input.action === 'reject') return { rejected: await memory.rejectCandidate(input.candidate_id!, input.reason ?? 'Rejected by user or agent.') };
      return memory.listCandidates(input.include_resolved ?? false);
    },
  };
}

function objectSchema(properties: Record<string, Record<string, unknown>>, required?: string[]) {
  return { type: 'object', properties, ...(required ? { required } : {}), additionalProperties: false };
}

function stringSchema(description: string) {
  return { type: 'string', minLength: 1, description };
}

function numberSchema(minimum: number, maximum: number) {
  return { type: 'number', minimum, maximum };
}

function enumSchema(values: readonly string[], description: string) {
  return { type: 'string', enum: [...values], description };
}

function stringArraySchema(description: string) {
  return { type: 'array', items: { type: 'string' }, description };
}

function audienceSchema() {
  return {
    type: 'object',
    description: 'Optional automatic-injection audience. Values are stable project role/task/mode ids.',
    properties: {
      roles: stringArraySchema('Agent role ids, for example reviewer, refactor-planner, or git.'),
      taskTypes: stringArraySchema('Task classifications such as review, refactor, or bugfix.'),
      modes: stringArraySchema('Runtime mode ids.'),
    },
    additionalProperties: false,
  };
}

function anchorsSchema() {
  return {
    type: 'array',
    description: 'Bind this memory to concrete code locations so it can be verified and auto-surfaced.',
    items: {
      type: 'object',
      properties: {
        type: enumSchema(ANCHOR_TYPE_VALUES, 'Anchor kind.'),
        path: stringSchema('Project-relative path (required for file/directory/package/test/git).'),
        symbol: stringSchema('Symbol name (required for symbol anchors).'),
        command: stringSchema('Shell command (required for command anchors).'),
      },
      required: ['type'],
      additionalProperties: false,
    },
  };
}
