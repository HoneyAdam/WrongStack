import type { MemoryStore, Tool } from '@wrongstack/core';
import type {
  MemoryCandidate,
  MemoryGraphEdge,
  MemoryVerificationResult,
  SuperMemory,
  SuperMemoryHygieneOptions,
  SuperMemoryHygieneReport,
} from '../types.js';

export interface SuperMemoryServiceLike extends MemoryStore {
  retrieveForPath(opts: {
    path: string;
    limit?: number;
    includeAncestors?: boolean;
    includeStatuses?: SuperMemory['status'][];
  }): Promise<SuperMemory[]>;
  searchSuper(query: string, opts?: { limit?: number; includeStatuses?: SuperMemory['status'][] }): Promise<SuperMemory[]>;
  graphFor(query: string, maxDepth?: number, limit?: number): Promise<MemoryGraphEdge[]>;
  verify(memoryId?: string, signal?: AbortSignal): Promise<MemoryVerificationResult[]>;
  hygiene(options?: SuperMemoryHygieneOptions, signal?: AbortSignal): Promise<SuperMemoryHygieneReport>;
  listCandidates(includeResolved?: boolean): Promise<MemoryCandidate[]>;
  acceptCandidate(candidateId: string): Promise<SuperMemory | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
}

export function createSuperMemoryTools(memory: SuperMemoryServiceLike): Tool[] {
  return [
    memoryForFileTool(memory),
    memoryForPathTool(memory),
    memorySearchTool(memory),
    memoryGraphTool(memory),
    memoryVerifyTool(memory),
    memoryHygieneTool(memory),
    memoryCandidatesTool(memory),
  ];
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
