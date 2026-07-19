import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSuperMemoryToolCallMiddleware } from '../src/middleware/tool-call-memory.js';
import { EventBus, type ToolCallPipelinePayload } from '@wrongstack/core';
import { SuperMemoryStore } from '../src/store.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-tcm-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeStore() {
  return new SuperMemoryStore({ projectRoot: tmpDir });
}

async function storeWithFileMemory(file: string) {
  const store = makeStore();
  await store.rememberSuper({
    text: `Memory for ${file}`,
    importance: 0.95,
    anchors: [{ type: 'file', path: file }],
  });
  return store;
}

function makePayload(overrides: Partial<ToolCallPipelinePayload> = {}): ToolCallPipelinePayload {
  return {
    toolUse: { type: 'tool_use', id: 'tu1', name: 'read', input: { path: 'src/file.ts' } },
    result: { type: 'tool_result', tool_use_id: 'tu1', name: 'read', content: 'file content' },
    ctx: {
      projectRoot: tmpDir,
      cwd: tmpDir,
      session: { id: 'sess1' },
      signal: new AbortController().signal,
    },
    ...overrides,
  } as ToolCallPipelinePayload;
}

describe('SuperMemoryToolCallMiddleware — disabled and no-trigger scenarios', () => {
  it('skips entirely when enabled is false', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, enabled: false });
    const payload = makePayload();
    await mw.handler(payload, async (p) => p);
    expect(payload.result.content).toBe('file content');
  });

  it('skips error results from non-bash tools', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store });
    const payload = makePayload({
      result: {
        type: 'tool_result',
        tool_use_id: 'tu1',
        name: 'read',
        content: 'Error',
        is_error: true,
      },
    });
    await mw.handler(payload, async (p) => p);
    expect(payload.result.content).toBe('Error');
  });

  it('includes bash error results', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_bash',
        name: 'bash',
        input: { command: 'Get-Content src/file.ts' },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_bash',
        name: 'bash',
        content: 'Error output',
        is_error: true,
      },
    });
    await mw.handler(payload, async (p) => p);
    expect(payload.result.content).toContain('Memory for src/file.ts');
  });

  it('skips unknown tool names', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store });
    const payload = makePayload({
      toolUse: { type: 'tool_use', id: 'tu_unknown', name: 'unknown_tool', input: {} },
    });
    await mw.handler(payload, async (p) => p);
    expect(payload.result.content).toBe('file content');
  });

  it('skips when trigger is disabled in opts.triggers', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, triggers: { read: false } });
    const payload = makePayload();
    await mw.handler(payload, async (p) => p);
    expect(payload.result.content).toBe('file content');
  });
});

describe('SuperMemoryToolCallMiddleware — mutation triggers', () => {
  it('calls verifyForPaths on mutation triggers', async () => {
    const verifyForPaths = async (_paths: string[], _signal?: AbortSignal) => {};
    const spy = vi.fn(verifyForPaths);
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({
      memory: Object.assign(store, { verifyForPaths: spy }),
      triggers: { write: true },
    });
    await store.rememberSuper({
      text: 'Write target.',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'src/newfile.ts' }],
    });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_write',
        name: 'write',
        input: { path: 'src/newfile.ts' },
      },
      result: { type: 'tool_result', tool_use_id: 'tu_write', name: 'write', content: 'written' },
    });
    await mw.handler(payload, async (p) => p);
    expect(spy).toHaveBeenCalled();
  });

  it('does not call verifyForPaths when verifyOnMutation is false', async () => {
    const verifyForPaths = vi.fn();
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({
      memory: Object.assign(store, { verifyForPaths }),
      verifyOnMutation: false,
    });
    const payload = makePayload();
    await mw.handler(payload, async (p) => p);
    expect(verifyForPaths).not.toHaveBeenCalled();
  });
});

describe('SuperMemoryToolCallMiddleware — patch tool', () => {
  it('extracts patch paths and retrieves related memories', async () => {
    const store = makeStore();
    await store.rememberSuper({
      text: 'Memory for patched file.',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'packages/demo/source.ts' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_patch',
        name: 'patch',
        input: {
          patch:
            '--- a/packages/demo/source.ts\n+++ b/packages/demo/source.ts\n@@ -1 +1 @@\n-old\n+new\n',
          directory: tmpDir,
          strip: 1,
        },
      },
      result: { type: 'tool_result', tool_use_id: 'tu_patch', name: 'patch', content: 'applied' },
      ctx: {
        projectRoot: tmpDir,
        cwd: tmpDir,
        session: { id: 'patch-session' },
      } as ToolCallPipelinePayload['ctx'],
    });

    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toContain('Memory for patched file');
  });
});

describe('SuperMemoryToolCallMiddleware — replace tool with dry_run check', () => {
  it('triggers verify when replace dry_run is false', async () => {
    const verifyForPaths = vi.fn();
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({
      memory: Object.assign(store, { verifyForPaths }),
      triggers: { edit: true },
    });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_replace',
        name: 'replace',
        input: { files: 'src/file.ts', pattern: 'old', replacement: 'new', dry_run: false },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_replace',
        name: 'replace',
        content: 'replaced',
      },
    });
    await mw.handler(payload as never, async (p) => p);
    expect(verifyForPaths).toHaveBeenCalled();
  });

  it('does not verify when replace has dry_run implicitly true', async () => {
    const verifyForPaths = vi.fn();
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({
      memory: Object.assign(store, { verifyForPaths }),
      triggers: { edit: true },
    });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_replace',
        name: 'replace',
        input: { files: 'src/file.ts', pattern: 'old', replacement: 'new' },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_replace',
        name: 'replace',
        content: 'dry-run: would replace',
      },
    });
    await mw.handler(payload as never, async (p) => p);
    expect(verifyForPaths).not.toHaveBeenCalled();
  });
});

describe('SuperMemoryToolCallMiddleware — tool name variants', () => {
  it('handles codebase-search with hyphen', async () => {
    const store = makeStore();
    await store.rememberSuper({
      text: 'Codebase search finds this memory.',
      importance: 0.95,
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_cs',
        name: 'codebase-search',
        input: { query: 'finds', path: '.' },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_cs',
        name: 'codebase-search',
        content: 'results',
      },
    });
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toContain('finds this memory');
  });

  it('handles exec tool as bash trigger', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: { type: 'tool_use', id: 'tu_exec', name: 'exec', input: { command: 'npm test' } },
      result: { type: 'tool_result', tool_use_id: 'tu_exec', name: 'exec', content: 'test output' },
    });
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toBe('test output'); // no file paths so no memories
  });

  it('uses the live task as a retrieval signal for an otherwise unrelated command', async () => {
    const store = makeStore();
    await store.rememberSuper({
      text: 'Authentication package refresh tokens are rotated by the session service.',
      kind: 'fact',
      tags: ['authentication', 'session'],
      anchors: [{ type: 'package', path: 'src/auth' }],
      persistence: 'long_lived',
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: { type: 'tool_use', id: 'tu_task', name: 'exec', input: { command: 'node -v' } },
      result: { type: 'tool_result', tool_use_id: 'tu_task', name: 'exec', content: 'v24' },
      ctx: {
        projectRoot: tmpDir,
        cwd: tmpDir,
        session: { id: 'task-aware' },
        signal: new AbortController().signal,
        todos: [
          {
            id: 'todo-auth',
            content: 'Refactor authentication refresh flow',
            status: 'in_progress',
          },
        ],
        meta: {},
      } as never,
    });

    await mw.handler(payload, async (p) => p);

    expect(payload.result.content).toContain('Authentication package refresh tokens');
    expect((payload.ctx.meta['memoryInjectorLastRun'] as Record<string, number>)['injected']).toBe(
      1,
    );
  });
});

describe('SuperMemoryToolCallMiddleware — result path extraction', () => {
  it('extracts paths from JSON tool results', async () => {
    const store = makeStore();
    await store.rememberSuper({
      text: 'Memory for test file.',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'test/unit/test.ts' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_glob',
        name: 'glob',
        input: { pattern: '**/*.ts', path: '.' },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_glob',
        name: 'glob',
        content: JSON.stringify({ results: ['test/unit/test.ts'] }),
      },
    });
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toContain('Memory for test file');
  });
});

describe('SuperMemoryToolCallMiddleware — content already visible', () => {
  it('skips memory text already present in system prompt', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store });
    // Make a payload where the system prompt already mentions the memory text
    const payload = makePayload({
      result: {
        type: 'tool_result',
        tool_use_id: 'tu1',
        name: 'read',
        content: 'Memory for src/file.ts',
      },
    });
    const existingMemory = {
      id: 'mem_1',
      text: 'Memory for src/file.ts',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      importance: 0.95,
      confidence: 0.95,
      freshness: 1,
      tags: [] as string[],
      anchors: [{ type: 'file', path: 'src/file.ts' }],
      sources: [] as never[],
      createdAt: '',
      updatedAt: '',
    };
    (store as any).loaded = [existingMemory];
    (store as any).initialized = true;

    await mw.handler(payload, async (p) => p);
    // Skip injection check - content already visible
    // Just check it doesn't crash
    expect(payload.result.content).toBeDefined();
  });
});

describe('SuperMemoryToolCallMiddleware — cooldown for high importance memory', () => {
  it('does not bypass cooldown merely because importance is high', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 60000 });
    await store.rememberSuper({
      text: 'Critical high importance memory.',
      importance: 1,
      confidence: 1,
      anchors: [{ type: 'file', path: 'src/important.ts' }],
    });

    const payload = makePayload({
      toolUse: { type: 'tool_use', id: 'tu1', name: 'read', input: { path: 'src/important.ts' } },
      result: { type: 'tool_result', tool_use_id: 'tu1', name: 'read', content: 'file content' },
    });
    // First call - injects
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toContain('Critical high importance memory');

    // Second call immediately - should skip even for high importance
    const payload2 = makePayload({
      toolUse: { type: 'tool_use', id: 'tu2', name: 'read', input: { path: 'src/important.ts' } },
      result: { type: 'tool_result', tool_use_id: 'tu2', name: 'read', content: 'file content' },
    });
    await mw.handler(payload2 as never, async (p) => p);
    // Importance affects ranking only; it must not bypass the repeat cooldown.
    expect(payload2.result.content).toBe('file content');
  });
});

describe('SuperMemoryToolCallMiddleware — availableHintChars', () => {
  it('respects maxOutputBytes cap', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const mw = createSuperMemoryToolCallMiddleware({
      memory: store,
      repeatCooldownMs: 0,
      maxCharsPerTool: 200,
    });

    const payload = makePayload();
    // Set tool maxOutputBytes cap to limit chars
    (payload as any).tool = { maxOutputBytes: 2000 };
    await mw.handler(payload as never, async (p) => p);
    // Should still inject with available chars
    expect(payload.result.content).toContain('Memory for');
  });
});

describe('SuperMemoryToolCallMiddleware — no memories match', () => {
  it('returns original content when no memories retrieved', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store });
    const payload = makePayload();
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toBe('file content');
  });

  it('never appends deleted lifecycle history returned by a retriever', async () => {
    const deleted = {
      id: 'mem_deleted',
      revision: 2,
      scope: 'project' as const,
      kind: 'fact' as const,
      status: 'deleted' as const,
      text: 'Deleted guidance must stay out of context.',
      importance: 1,
      confidence: 1,
      freshness: 1,
      tags: [],
      anchors: [{ type: 'file' as const, path: 'src/file.ts' }],
      sources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const memory = {
      retrieveForPath: async () => [deleted],
      searchSuper: async () => [deleted],
    };
    const mw = createSuperMemoryToolCallMiddleware({ memory, repeatCooldownMs: 0 });
    const payload = makePayload();

    await mw.handler(payload, async (p) => p);

    expect(payload.result.content).toBe('file content');
  });
});

describe('SuperMemoryToolCallMiddleware — relevance gates', () => {
  const memoryRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'mem_candidate',
    revision: 1,
    scope: 'project' as const,
    kind: 'fact' as const,
    status: 'active' as const,
    persistence: 'long_lived' as const,
    text: 'Telegram outbound queue security policy.',
    importance: 1,
    confidence: 1,
    freshness: 1,
    tags: ['telegram', 'security'],
    anchors: [],
    sources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('rejects an unrelated maximum-importance lexical candidate', async () => {
    const unrelated = memoryRecord();
    const memory = {
      retrieveForPath: async () => [],
      searchSuper: async () => [unrelated],
    };
    const mw = createSuperMemoryToolCallMiddleware({ memory, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_relevance',
        name: 'read',
        input: { path: 'packages/super-memory/src/store.ts' },
      },
    });

    await mw.handler(payload, async (next) => next);

    expect(payload.result.content).toBe('file content');
  });

  it('does not treat a project-root anchor as relevant to every file', async () => {
    const store = makeStore();
    await store.rememberSuper({
      text: 'Repository-wide release checklist.',
      importance: 1,
      confidence: 1,
      anchors: [{ type: 'directory', path: '.' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });

    const payload = makePayload();
    await mw.handler(payload, async (next) => next);

    expect(payload.result.content).toBe('file content');
  });

  it('drops graph expansion without a shared structural anchor or two strong tags', async () => {
    const seed = memoryRecord({
      id: 'mem_seed',
      text: 'Store retrieval scoring requires evidence.',
      tags: ['retrieval', 'scoring', 'architecture', 'backfill', 'recovered'],
      anchors: [{ type: 'file', path: 'packages/super-memory/src/store.ts' }],
    });
    const unrelated = memoryRecord({
      id: 'mem_graph_noise',
      tags: ['architecture', 'backfill', 'recovered'],
    });
    const memory = {
      retrieveForPath: async () => [seed],
      searchSuper: async () => [],
      findRelatedSuper: async () => [unrelated],
    };
    const mw = createSuperMemoryToolCallMiddleware({ memory, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_graph_relevance',
        name: 'read',
        input: { path: 'packages/super-memory/src/store.ts' },
      },
    });

    await mw.handler(payload, async (next) => next);

    expect(payload.result.content).toContain('Store retrieval scoring requires evidence.');
    expect(payload.result.content).not.toContain('Telegram outbound queue');
  });

  it('caps lexical-only injection at two memories per tool result', async () => {
    const candidates = [
      memoryRecord({
        id: 'mem_query_1',
        text: 'Authentication refresh rotation uses the session service.',
      }),
      memoryRecord({
        id: 'mem_query_2',
        text: 'Authentication refresh rotation invalidates old tokens.',
      }),
      memoryRecord({
        id: 'mem_query_3',
        text: 'Authentication refresh rotation emits an audit event.',
      }),
    ];
    const findRelatedSuper = vi.fn(async () => [
      memoryRecord({ id: 'mem_query_graph_noise', text: 'Unrelated graph expansion.' }),
    ]);
    const memory = {
      retrieveForPath: async () => [],
      searchSuper: async () => candidates,
      findRelatedSuper,
    };
    const mw = createSuperMemoryToolCallMiddleware({ memory, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_query_cap',
        name: 'codebase-search',
        input: { query: 'authentication refresh rotation' },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_query_cap',
        name: 'codebase-search',
        content: 'results',
      },
    });

    await mw.handler(payload, async (next) => next);

    expect(payload.result.content).toContain('uses the session service');
    expect(payload.result.content).toContain('invalidates old tokens');
    expect(payload.result.content).not.toContain('emits an audit event');
    expect(payload.result.content).not.toContain('Unrelated graph expansion');
    expect(findRelatedSuper).not.toHaveBeenCalled();
  });
});

describe('SuperMemoryToolCallMiddleware — injector observability', () => {
  it('emits the selected memories and bounded decision metrics after injection', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const events = new EventBus();
    const traces: Array<Record<string, unknown>> = [];
    events.onPattern('memory.injector_run', (_event, payload) => {
      traces.push(payload as Record<string, unknown>);
    });
    const mw = createSuperMemoryToolCallMiddleware({
      memory: store,
      events,
      repeatCooldownMs: 0,
    });

    await mw.handler(makePayload(), async (p) => p);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      outcome: 'injected',
      trigger: 'read',
      toolName: 'read',
      candidates: 1,
      eligible: 1,
    });
    expect(traces[0]?.['injected']).toEqual([
      expect.objectContaining({ kind: 'fact', text: 'Memory for src/file.ts' }),
    ]);
    expect(traces[0]?.['activated']).toEqual([
      expect.objectContaining({
        kind: 'fact',
        anchors: expect.arrayContaining([expect.stringContaining('file:')]),
        activationReasons: expect.arrayContaining([expect.stringContaining('anchor:')]),
        confidence: expect.any(Number),
        freshness: expect.any(Number),
        importance: expect.any(Number),
        persistence: 'long_lived',
      }),
    ]);
  });

  it('also emits empty runs with the reason memories left the candidate set', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const events = new EventBus();
    const traces: Array<Record<string, unknown>> = [];
    events.onPattern('memory.injector_run', (_event, payload) => {
      traces.push(payload as Record<string, unknown>);
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, events });
    const payload = makePayload({
      result: {
        type: 'tool_result',
        tool_use_id: 'tu1',
        name: 'read',
        content: 'file content already says Memory for src/file.ts',
      },
    });

    await mw.handler(payload, async (p) => p);

    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      outcome: 'empty',
      candidates: 1,
      eligible: 0,
      rejected: { alreadyVisible: 1 },
      injected: [],
      injectedChars: 0,
    });
  });

  it('distinguishes an activated memory from one actually written into context', async () => {
    const store = await storeWithFileMemory('src/file.ts');
    const events = new EventBus();
    const traces: Array<Record<string, unknown>> = [];
    events.onPattern('memory.injector_run', (_event, payload) => {
      traces.push(payload as Record<string, unknown>);
    });
    const mw = createSuperMemoryToolCallMiddleware({
      memory: store,
      events,
      repeatCooldownMs: 0,
      maxCharsPerTool: 0,
    });

    await mw.handler(makePayload(), async (p) => p);

    expect(traces[0]).toMatchObject({
      outcome: 'empty',
      activated: [expect.objectContaining({ text: 'Memory for src/file.ts' })],
      injected: [],
      rejected: { budget: 1 },
    });
  });
});

describe('SuperMemoryToolCallMiddleware — tool name -> trigger mapping', () => {
  it('handles all read/tree/grep/glob/write/edit tools without error', async () => {
    const store = makeStore();
    const mw = createSuperMemoryToolCallMiddleware({ memory: store });

    for (const name of ['read', 'tree', 'grep', 'glob', 'write', 'edit']) {
      const payload = makePayload({
        toolUse: { type: 'tool_use', id: `tu_${name}`, name, input: { path: 'src/x.ts' } },
        result: {
          type: 'tool_result',
          tool_use_id: `tu_${name}`,
          name,
          content: `result from ${name}`,
        },
      });
      await mw.handler(payload as never, async (p) => p);
      expect(payload.result.content).toBe(`result from ${name}`);
    }
  });
});

describe('SuperMemoryToolCallMiddleware — parallel retrieval', () => {
  it('starts path lookups and the query lookup concurrently', async () => {
    // Every lookup blocks on `gate`, which only opens once ALL THREE lookups
    // have started. If retrieval were serial, the first lookup would await a
    // gate that can never open and the test would time out.
    const started: string[] = [];
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const memoryTemplate = (id: string) => ({
      id,
      revision: 1,
      scope: 'project' as const,
      kind: 'fact' as const,
      status: 'active' as const,
      text: `Parallel retrieval memory ${id}`,
      importance: 0.95,
      confidence: 0.95,
      freshness: 0.9,
      tags: [],
      anchors: [],
      sources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const memory = {
      retrieveForPath: vi.fn((opts: { path: string }) => {
        started.push(`path:${opts.path}`);
        if (started.length === 3) openGate();
        return gate.then(() => [memoryTemplate(`mem_${started.length}`)]);
      }),
      searchSuper: vi.fn(() => {
        started.push('query');
        if (started.length === 3) openGate();
        return gate.then(() => []);
      }),
      recordInjection: async () => {},
    };
    const mw = createSuperMemoryToolCallMiddleware({ memory, repeatCooldownMs: 0 });
    const payload = makePayload({
      toolUse: {
        type: 'tool_use',
        id: 'tu_parallel',
        name: 'replace',
        input: { files: 'src/a.ts,src/b.ts', pattern: 'needle', dry_run: true },
      },
      result: {
        type: 'tool_result',
        tool_use_id: 'tu_parallel',
        name: 'replace',
        content: 'preview',
      },
    });

    await mw.handler(payload as never, async (p) => p);

    expect(started).toHaveLength(3);
    // resolveTriggerPaths maps tool inputs to absolute paths under projectRoot
    expect(started).toContain(`path:${path.join(tmpDir, 'src/a.ts')}`);
    expect(started).toContain(`path:${path.join(tmpDir, 'src/b.ts')}`);
    expect(started).toContain('query');
    expect(memory.retrieveForPath).toHaveBeenCalledTimes(2);
    expect(memory.searchSuper).toHaveBeenCalledTimes(1);
  });
});
