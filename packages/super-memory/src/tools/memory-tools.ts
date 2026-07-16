import type { MemoryScope, MemoryStore, Tool } from '@wrongstack/core';
import type {
  MemoryAnchor,
  MemoryAudienceSelector,
  MemoryCandidate,
  MemoryGraphEdge,
  MemoryVerificationResult,
  RememberSuperMemoryInput,
  SuperMemory,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
  SuperMemoryKind,
  SuperMemoryScope,
  SuperMemoryStatus,
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
  deleteSuperMemory(id: string, reason?: string): Promise<void>;
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
  ];
}

interface RememberToolInput {
  text: string;
  kind?: SuperMemoryKind | undefined;
  scope?: SuperMemoryScope | undefined;
  tags?: string[] | undefined;
  anchors?: MemoryAnchor[] | undefined;
  audience?: MemoryAudienceSelector | undefined;
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
      const autoAudience = !input.audience && detectedRole
        ? { roles: [detectedRole] }
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

function memoryDeleteTool(memory: SuperMemoryServiceLike): Tool<{ id: string; reason?: string }, { deleted: true; id: string }> {
  return {
    name: 'memory_delete',
    category: 'Session',
    description: 'Delete one Super Memory entry by id (soft-delete with graph/relationship cascade cleanup).',
    usageHint:
      'Exact, single-entry removal by id — safer than substring `forget`.\n' +
      '- Find the id via `memory_search`. Provide a short `reason` for the audit log.',
    permission: 'confirm',
    mutating: true,
    riskTier: 'standard',
    timeoutMs: 2_000,
    capabilities: ['memory.delete'],
    icon: 'settings',
    inputSchema: objectSchema({
      id: { type: 'string', minLength: 1, description: 'The memory id to delete.' },
      reason: stringSchema('Reason recorded in the audit log.'),
    }, ['id']),
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      await memory.deleteSuperMemory(input.id, input.reason);
      return { deleted: true, id: input.id };
    },
  };
}

function memoryForFileTool(memory: SuperMemoryServiceLike): Tool<{ path: string; limit?: number }, SuperMemory[]> {
  return {
    name: 'memory_for_file',
    category: 'Inspect',
    description: 'Retrieve verified project knowledge attached directly to a file.',
    inputSchema: objectSchema({ path: stringSchema('Project-relative file path.'), limit: numberSchema(1, 50) }, ['path']),
    permission: 'auto',
    mutating: false,
    riskTier: 'safe',
    capabilities: ['memory.read'],
    icon: 'search',
    async execute(input, _ctx, opts) {
      opts.signal.throwIfAborted();
      return memory.retrieveForPath({ path: input.path, limit: input.limit ?? 10, includeAncestors: false });
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
    description: 'Deduplicate, verify, stale, archive, supersede, and compact structured project memory.',
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
