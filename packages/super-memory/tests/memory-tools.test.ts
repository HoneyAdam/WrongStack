import { describe, expect, it, vi } from 'vitest';
import { createSuperMemoryTools } from '../src/tools/memory-tools.js';
import type { SuperMemoryServiceLike } from '../src/tools/memory-tools.js';

function createMockService(): SuperMemoryServiceLike {
  return {
    async readAll() { return ''; },
    async read() { return ''; },
    async remember() {},
    async forget() { return 0; },
    async consolidate() {},
    async clear() {},
    async list() { return []; },
    async search() { return []; },
    async findRelated() { return []; },
    withTraceId() { return this; },
    async retrieveForPath() { return []; },
    async searchSuper() { return []; },
    async graphFor() { return []; },
    async verify() { return []; },
    async hygiene() { return { startedAt: '', completedAt: '', examined: 0, deduplicated: 0, superseded: 0, contradicted: 0, staled: 0, archived: 0, deleted: 0, verified: 0 }; },
    async listCandidates() { return []; },
    async acceptCandidate() { return undefined; },
    async rejectCandidate() { return false; },
    async rememberSuper() { return { id: 'mem_new' } as never; },
    async updateSuperMemory() { return { id: 'mem_upd' } as never; },
    async deleteSuperMemory() {},
    async getSuperMemory() { return { id: 'mem_get' } as never; },
  };
}

describe('createSuperMemoryTools', () => {
  it('returns 11 tools with correct names', () => {
    const service = createMockService();
    const tools = createSuperMemoryTools(service);
    expect(tools).toHaveLength(11);
    expect(tools.map((t) => t.name)).toEqual([
      'memory_for_file',
      'memory_for_path',
      'memory_search',
      'memory_graph',
      'memory_verify',
      'memory_hygiene',
      'memory_candidates',
      'remember',
      'forget',
      'memory_update',
      'memory_delete',
    ]);
  });

  it('all tools have expected shape', () => {
    const tools = createSuperMemoryTools(createMockService());
    for (const tool of tools) {
      expect(tool.category).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });
});

describe('memory_for_file tool', () => {
  it('calls retrieveForPath with includeAncestors: false', async () => {
    const retrieveForPath = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.retrieveForPath = retrieveForPath;

    const tool = createSuperMemoryTools(service)[0]!;
    const signal = new AbortController().signal;
    await tool.execute({ path: 'src/file.ts', limit: 5 }, {} as never, { signal } as never);

    expect(retrieveForPath).toHaveBeenCalledWith({
      path: 'src/file.ts',
      limit: 5,
      includeAncestors: false,
    });
  });

  it('throws on abort', async () => {
    const tool = createSuperMemoryTools(createMockService())[0]!;
    const abort = new AbortController();
    abort.abort();
    await expect(tool.execute({ path: 'x' }, {} as never, { signal: abort.signal } as never)).rejects.toThrow();
  });
});

describe('memory_for_path tool', () => {
  it('calls retrieveForPath with includeAncestors: true and default limit 20', async () => {
    const retrieveForPath = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.retrieveForPath = retrieveForPath;

    const tools = createSuperMemoryTools(service);
    const tool = tools[1]!;
    await tool.execute({ path: 'src/' }, {} as never, { signal: new AbortController().signal } as never);

    expect(retrieveForPath).toHaveBeenCalledWith({
      path: 'src/',
      limit: 20,
      includeAncestors: true,
    });
  });
});

describe('memory_search tool', () => {
  it('calls searchSuper with limit default 20 and active only', async () => {
    const searchSuper = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.searchSuper = searchSuper;

    const tools = createSuperMemoryTools(service);
    const tool = tools[2]!;
    await tool.execute({ query: 'test query' }, {} as never, { signal: new AbortController().signal } as never);

    expect(searchSuper).toHaveBeenCalledWith('test query', {
      limit: 20,
      includeStatuses: ['active'],
    });
  });

  it('includes stale when include_stale is true', async () => {
    const searchSuper = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.searchSuper = searchSuper;

    const tools = createSuperMemoryTools(service);
    const tool = tools[2]!;
    await tool.execute({ query: 'test', include_stale: true }, {} as never, { signal: new AbortController().signal } as never);

    expect(searchSuper).toHaveBeenCalledWith('test', {
      limit: 20,
      includeStatuses: ['active', 'stale'],
    });
  });
});

describe('memory_graph tool', () => {
  it('calls graphFor with defaults', async () => {
    const graphFor = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.graphFor = graphFor;

    const tools = createSuperMemoryTools(service);
    const tool = tools[3]!;
    await tool.execute({ query: 'test' }, {} as never, { signal: new AbortController().signal } as never);

    expect(graphFor).toHaveBeenCalledWith('test', 2, 100);
  });
});

describe('memory_verify tool', () => {
  it('calls verify with memory_id', async () => {
    const verify = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.verify = verify;

    const tools = createSuperMemoryTools(service);
    const tool = tools[4]!;
    const signal = new AbortController().signal;
    await tool.execute({ memory_id: 'mem_123' }, {} as never, { signal } as never);

    expect(verify).toHaveBeenCalledWith('mem_123', signal);
  });

  it('calls verify without memory_id', async () => {
    const verify = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.verify = verify;

    const tools = createSuperMemoryTools(service);
    const tool = tools[4]!;
    const signal = new AbortController().signal;
    await tool.execute({}, {} as never, { signal } as never);

    expect(verify).toHaveBeenCalledWith(undefined, signal);
  });
});

describe('memory_hygiene tool', () => {
  it('calls hygiene with options', async () => {
    const hygiene = vi.fn().mockResolvedValue({ examined: 5, startedAt: '', completedAt: '', deduplicated: 0, superseded: 0, contradicted: 0, staled: 0, archived: 0, deleted: 0, verified: 0 });
    const service = createMockService();
    service.hygiene = hygiene;

    const tools = createSuperMemoryTools(service);
    const tool = tools[5]!;
    const signal = new AbortController().signal;
    await tool.execute({ retentionDays: 30 }, {} as never, { signal } as never);

    expect(hygiene).toHaveBeenCalledWith({ retentionDays: 30 }, signal);
  });
});

describe('memory_candidates tool', () => {
  it('lists candidates by default', async () => {
    const listCandidates = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.listCandidates = listCandidates;

    const tools = createSuperMemoryTools(service);
    const tool = tools[6]!;
    const signal = new AbortController().signal;
    await tool.execute({}, {} as never, { signal } as never);

    expect(listCandidates).toHaveBeenCalledWith(false);
  });

  it('lists candidates with include_resolved', async () => {
    const listCandidates = vi.fn().mockResolvedValue([]);
    const service = createMockService();
    service.listCandidates = listCandidates;

    const tools = createSuperMemoryTools(service);
    const tool = tools[6]!;
    await tool.execute({ include_resolved: true }, {} as never, { signal: new AbortController().signal } as never);

    expect(listCandidates).toHaveBeenCalledWith(true);
  });

  it('accepts a candidate', async () => {
    const acceptCandidate = vi.fn().mockResolvedValue({ id: 'mem_1', text: 'Accepted' });
    const service = createMockService();
    service.acceptCandidate = acceptCandidate;

    const tools = createSuperMemoryTools(service);
    const tool = tools[6]!;
    await tool.execute({ action: 'accept', candidate_id: 'cand_1' }, {} as never, { signal: new AbortController().signal } as never);

    expect(acceptCandidate).toHaveBeenCalledWith('cand_1');
  });

  it('rejects a candidate', async () => {
    const rejectCandidate = vi.fn().mockResolvedValue(true);
    const service = createMockService();
    service.rejectCandidate = rejectCandidate;

    const tools = createSuperMemoryTools(service);
    const tool = tools[6]!;
    const result = await tool.execute({ action: 'reject', candidate_id: 'cand_1', reason: 'Not needed' }, {} as never, { signal: new AbortController().signal } as never);

    expect(rejectCandidate).toHaveBeenCalledWith('cand_1', 'Not needed');
    expect(result).toEqual({ rejected: true });
  });

  it('validates candidate_id required for accept/reject', async () => {
    const tools = createSuperMemoryTools(createMockService());
    const tool = tools[6]!;
    const errors = tool.validate?.({ action: 'accept' }) ?? [];
    expect(errors).toContain('candidate_id is required for accept or reject');
  });

  it('validation passes for accept with candidate_id', async () => {
    const tools = createSuperMemoryTools(createMockService());
    const tool = tools[6]!;
    const errors = tool.validate?.({ action: 'accept', candidate_id: 'cand_1' }) ?? [];
    expect(errors).toHaveLength(0);
  });

  it('validation passes for list action', async () => {
    const tools = createSuperMemoryTools(createMockService());
    const tool = tools[6]!;
    const errors = tool.validate?.({ action: 'list' }) ?? [];
    expect(errors).toHaveLength(0);
  });
});

describe('remember tool (structured write)', () => {
  it('forwards full structured args to rememberSuper', async () => {
    const rememberSuper = vi.fn().mockResolvedValue({ id: 'mem_1', kind: 'decision', text: 'x', tags: [] });
    const service = createMockService();
    service.rememberSuper = rememberSuper;

    const tool = createSuperMemoryTools(service)[7]!;
    expect(tool.name).toBe('remember');
    await tool.execute(
      {
        text: 'Use pnpm v9',
        kind: 'convention',
        scope: 'project',
        tags: ['pnpm'],
        anchors: [{ type: 'file', path: 'package.json' }],
        audience: { roles: ['reviewer'] },
        importance: 0.9,
        supersedes: ['mem_old'],
      } as never,
      {} as never,
      { signal: new AbortController().signal } as never,
    );

    expect(rememberSuper).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Use pnpm v9',
      kind: 'convention',
      scope: 'project',
      tags: ['pnpm'],
      anchors: [{ type: 'file', path: 'package.json' }],
      audience: { roles: ['reviewer'] },
      importance: 0.9,
      supersedes: ['mem_old'],
    }));
  });

  it('auto-detects agent role from ctx.meta when no explicit audience is given', async () => {
    const rememberSuper = vi.fn().mockResolvedValue({ id: 'mem_2', kind: 'convention', text: 'x', tags: [] });
    const service = createMockService();
    service.rememberSuper = rememberSuper;

    const tool = createSuperMemoryTools(service)[7]!;
    await tool.execute(
      { text: 'Always verify migration reversibility.' } as never,
      { meta: { agentRole: 'reviewer' } } as never,
      { signal: new AbortController().signal } as never,
    );

    expect(rememberSuper).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Always verify migration reversibility.',
      audience: { roles: ['reviewer'] },
    }));
  });

  it('does not auto-detect when ctx.meta has no agentRole (leader agent)', async () => {
    const rememberSuper = vi.fn().mockResolvedValue({ id: 'mem_3', kind: 'fact', text: 'x', tags: [] });
    const service = createMockService();
    service.rememberSuper = rememberSuper;

    const tool = createSuperMemoryTools(service)[7]!;
    await tool.execute(
      { text: 'General project note.' } as never,
      { meta: {} } as never,
      { signal: new AbortController().signal } as never,
    );

    expect(rememberSuper).toHaveBeenCalledWith(expect.objectContaining({
      text: 'General project note.',
      audience: undefined,
    }));
  });

  it('explicit audience wins over auto-detected role', async () => {
    const rememberSuper = vi.fn().mockResolvedValue({ id: 'mem_4', kind: 'fact', text: 'x', tags: [] });
    const service = createMockService();
    service.rememberSuper = rememberSuper;

    const tool = createSuperMemoryTools(service)[7]!;
    await tool.execute(
      { text: 'Scoped memory.', audience: { roles: ['refactor-planner'], taskTypes: ['refactor'] } } as never,
      { meta: { agentRole: 'reviewer' } } as never,
      { signal: new AbortController().signal } as never,
    );

    expect(rememberSuper).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Scoped memory.',
      audience: { roles: ['refactor-planner'], taskTypes: ['refactor'] },
    }));
  });
});

describe('forget tool', () => {
  it('calls forget with query and default scope', async () => {
    const forget = vi.fn().mockResolvedValue(2);
    const service = createMockService();
    service.forget = forget;

    const tool = createSuperMemoryTools(service)[8]!;
    expect(tool.name).toBe('forget');
    const result = await tool.execute({ query: 'stale note' } as never, {} as never, { signal: new AbortController().signal } as never);

    expect(forget).toHaveBeenCalledWith('stale note', 'project-memory');
    expect(result).toEqual({ removed: 2, scope: 'project-memory' });
  });
});

describe('memory_update tool', () => {
  it('applies a patch by id and requires at least one field', async () => {
    const updateSuperMemory = vi.fn().mockResolvedValue({ id: 'mem_1', kind: 'fact', status: 'stale', text: 'x' });
    const service = createMockService();
    service.updateSuperMemory = updateSuperMemory;

    const tool = createSuperMemoryTools(service)[9]!;
    expect(tool.name).toBe('memory_update');
    expect(tool.validate?.({ id: 'mem_1' } as never)).toContain('at least one field to update is required');

    await tool.execute({ id: 'mem_1', status: 'stale', tags: ['x'] } as never, {} as never, { signal: new AbortController().signal } as never);
    expect(updateSuperMemory).toHaveBeenCalledWith('mem_1', { status: 'stale', tags: ['x'] });
  });
});

describe('memory_delete tool', () => {
  it('soft-deletes by id with a reason', async () => {
    const deleteSuperMemory = vi.fn().mockResolvedValue(undefined);
    const service = createMockService();
    service.deleteSuperMemory = deleteSuperMemory;

    const tool = createSuperMemoryTools(service)[10]!;
    expect(tool.name).toBe('memory_delete');
    const result = await tool.execute({ id: 'mem_1', reason: 'obsolete' } as never, {} as never, { signal: new AbortController().signal } as never);

    expect(deleteSuperMemory).toHaveBeenCalledWith('mem_1', 'obsolete');
    expect(result).toEqual({ deleted: true, id: 'mem_1' });
  });
});
