import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';
import { verifyMemoryAnchors } from '../src/anchors/verify.js';
import { formatMemoryHintsDetailed } from '../src/retrieval/format.js';
import { createSuperMemoryToolCallMiddleware } from '../src/middleware/tool-call-memory.js';
import type { SuperMemory } from '../src/types.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-edge-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ======================================================
// store.ts — sourceNode final return undefined (line 1427)
// ======================================================
describe('store.ts — sourceNode edge cases', () => {
  it('handles source with type=user and no path/command/sessionId', async () => {
    const mem = await store.rememberSuper({
      text: 'Source edge case.',
      sources: [{ type: 'user' }],
    });
    // sourceNode returns undefined for type=user with no extra fields.
    // The memory should still be stored.
    expect(mem.text).toBe('Source edge case.');
  });

  it('handles source with tool_result but no toolUseId', async () => {
    const mem = await store.rememberSuper({
      text: 'Tool result source edge.',
      sources: [{ type: 'tool_result' }],
    });
    expect(mem.text).toBe('Tool result source edge.');
  });
});

// ======================================================
// store.ts — compareMemoryQuality (line 1445)
// ======================================================
describe('store.ts — compareMemoryQuality', () => {
  it('sort by importance, then confidence, then createdAt', async () => {
    // Create memories with same importance but different confidence
    await store.rememberSuper({ text: 'Low importance.', importance: 0.3, confidence: 0.9 });
    await store.rememberSuper({ text: 'High importance.', importance: 0.9, confidence: 0.5 });
    await store.rememberSuper({ text: 'Mid importance.', importance: 0.6, confidence: 0.8 });

    const results = await store.searchSuper('importance');
    // Should be sorted by importance descending
    expect(results[0]?.importance).toBeGreaterThanOrEqual(results[1]?.importance ?? 0);
  });

  it('breaks ties by confidence', async () => {
    await store.rememberSuper({ text: 'Same imp higher conf.', importance: 0.5, confidence: 0.9 });
    await store.rememberSuper({ text: 'Same imp lower conf.', importance: 0.5, confidence: 0.3 });

    const results = await store.searchSuper('Same imp');
    // Higher confidence should come first
    expect(results[0]?.text).toBe('Same imp higher conf.');
  });
});

// ======================================================
// store.ts — fileSignature throw path (line 1495)
// ======================================================
describe('store.ts — fileSignature error path', () => {
  it('handles file stats errors', async () => {
    // verifyForPaths on non-existent path works (returns stale from verifyAnchor)
    const result = await store.verifyForPaths(['nonexistent_dir/nonexistent_file.ts']);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ======================================================
// verify.ts — git blob hash (lines 90-102)
// ======================================================
describe('verify.ts — git blob hash', () => {
  it('handles git blob hash computation (git anchor type)', async () => {
    const file = path.join(tmpDir, 'source.ts');
    await fs.writeFile(file, 'export const x = 1;\n', 'utf8');
    const memory: SuperMemory = {
      id: 'mem_git_test',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      text: 'Git blob test.',
      importance: 0.5,
      confidence: 0.5,
      freshness: 0.5,
      tags: [],
      anchors: [{ type: 'git', path: 'source.ts' }],
      sources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // git hash-object works on any file even without a git repo
    expect(result.status).toBe('verified');
  });

  it('detects git blob hash mismatch', async () => {
    const file = path.join(tmpDir, 'source.ts');
    await fs.writeFile(file, 'export const x = 1;\n', 'utf8');
    const memory: SuperMemory = {
      id: 'mem_git_mismatch',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      text: 'Git blob mismatch test.',
      importance: 0.5,
      confidence: 0.5,
      freshness: 0.5,
      tags: [],
      anchors: [{ type: 'file', path: 'source.ts', gitBlobHash: 'sha256:deadbeef' }],
      sources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // git hash-object will return a real hash that doesn't match deadbeef
    expect(result.status).toBe('stale');
    expect(result.anchors[0]?.reason).toContain('Git blob hash changed');
  });
});

// ======================================================
// tool-call-memory.ts — pruneCooldowns (lines 180-182)
// ======================================================
describe('tool-call-memory.ts — cooldown management', () => {
  it('handles cooldowns with repeated invocations across paths', async () => {
    await store.rememberSuper({
      text: 'Memory for cooldown test.',
      importance: 0.9,
      anchors: [{ type: 'file', path: 'src/a.ts' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 30000, maxHintsPerTool: 2 });

    const payload = {
      toolUse: { type: 'tool_use' as const, id: 'cd1', name: 'read', input: { path: 'src/a.ts' } },
      result: { type: 'tool_result' as const, tool_use_id: 'cd1', name: 'read', content: 'content' },
      ctx: { projectRoot: tmpDir, session: { id: 'cd-session' }, signal: new AbortController().signal },
    };
    await mw.handler(payload as never, async (p) => p);
    expect(payload.result.content).toContain('cooldown test');
  });
});

// ======================================================
// tool-call-memory.ts — visibleContextText (line 356)
// ======================================================
describe('tool-call-memory.ts — visible context text', () => {
  it('deduplicates against existing system prompt content', async () => {
    await store.rememberSuper({
      text: 'Already in prompt.',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'src/x.ts' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });

    const payload = {
      toolUse: { type: 'tool_use' as const, id: 'vt1', name: 'read', input: { path: 'src/x.ts' } },
      result: { type: 'tool_result' as const, tool_use_id: 'vt1', name: 'read', content: 'Some content' },
      ctx: {
        projectRoot: tmpDir,
        session: { id: 'vt-session' },
        signal: new AbortController().signal,
        systemPrompt: [{ text: 'Already in prompt.' }],
      },
    };
    await mw.handler(payload as never, async (p) => p);
    // Memory text already in system prompt, so shouldn't be injected again
    expect(payload.result.content).not.toContain('Super Memory');
  });
});

// ======================================================
// format.ts — empty primary anchor (line 67)
// ======================================================
describe('format.ts — primary anchor edge cases', () => {
  it('formatMemoryHintsDetailed handles memory with no anchors at all', () => {
    const mem: SuperMemory = {
      id: 'mem_no_anchor',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      text: 'No anchor memory.',
      importance: 0.5,
      confidence: 0.5,
      freshness: 0.5,
      tags: [],
      anchors: [],
      sources: [],
      createdAt: '',
      updatedAt: '',
    };
    const result = formatMemoryHintsDetailed([mem]);
    expect(result.text).toContain('No anchor memory.');
  });

  it('formatMemoryHintsDetailed skips anchor with no path/symbol/command', () => {
    const mem: SuperMemory = {
      id: 'mem_empty_anchor',
      revision: 1,
      scope: 'project',
      kind: 'fact',
      status: 'active',
      text: 'Empty anchor fields.',
      importance: 0.5,
      confidence: 0.5,
      freshness: 0.5,
      tags: [],
      anchors: [{ type: 'file', path: '', symbol: '', command: '' }],
      sources: [],
      createdAt: '',
      updatedAt: '',
    };
    const result = formatMemoryHintsDetailed([mem]);
    expect(result.text).toContain('Empty anchor fields.');
    expect(result.text).not.toContain('(');
  });
});

// ======================================================
// turn-memory.ts — recordInjection (line 43)
// ======================================================
describe('turn-memory.ts — recordInjection', () => {
  it('calls recordInjection when injecting', async () => {
    let injected = false;
    const memory = {
      searchSuper: async () => [{
        id: 'mem_turn_inj',
        revision: 1,
        scope: 'project',
        kind: 'fact',
        status: 'active',
        text: 'Turn injection test.',
        importance: 0.95,
        confidence: 0.95,
        freshness: 0.9,
        tags: [],
        anchors: [],
        sources: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies SuperMemory],
      recordInjection: async (_memoryIds: string[], trigger: string) => {
        if (trigger === 'turn_context') injected = true;
      },
    };
    const { createSuperMemoryTurnMiddleware } = await import('../src/middleware/turn-memory.js');
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Turn injection test.' }],
      system: [],
    };
    await middleware.handler(request as never, async (next) => next);
    expect(injected).toBe(true);
  });
});

// ======================================================
// store.ts — clear, readAll, read, list, search, forget
// ======================================================
describe('store.ts — legacy API coverage', () => {
  it('clear removes project-memory by default', async () => {
    await store.rememberSuper({ text: 'Memory to clear.' });
    await store.clear();
    const entries = await store.list('project-memory');
    expect(entries).toHaveLength(0);
  });

  it('clear removes specific scope', async () => {
    await store.rememberSuper({ text: 'User memory.', scope: 'user' });
    await store.clear('user-memory');
    const entries = await store.list('user-memory');
    expect(entries).toHaveLength(0);
  });

  it('clear skips permanent memories and audit-logs the skip', async () => {
    const normal = await store.rememberSuper({ text: 'Normal clear target.' });
    const permanent = await store.rememberSuper({ text: 'Permanent survivor.', persistence: 'permanent' });
    await store.clear();

    // Normal is deleted.
    expect((await store.getSuperMemory(normal.id))?.status).toBe('deleted');
    // Permanent survives.
    expect((await store.getSuperMemory(permanent.id))?.status).toBe('active');

    // Skip is audit-logged.
    const audit = await store.readAudit(50);
    expect(audit.some((r) => r.event === 'memory.clear_skipped_permanent')).toBe(true);
  });

  it('readAll returns stored content', async () => {
    await store.rememberSuper({ text: 'Readable memory.', importance: 0.5 });
    const text = await store.readAll();
    expect(text).toContain('Readable memory.');
  });

  it('read returns scope-formatted content', async () => {
    await store.rememberSuper({ text: 'Scope-specific.', importance: 0.5, scope: 'user' });
    const text = await store.read('user-memory');
    expect(text).toContain('Scope-specific.');
  });

  it('list returns entries with correct scope', async () => {
    await store.rememberSuper({ text: 'Project specific.', importance: 0.5, scope: 'project' });
    const entries = await store.list('project-memory', 10);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(entries)).toBe(true);
  });

  it('search returns scored entries', async () => {
    await store.rememberSuper({ text: 'Search target.', importance: 0.5, scope: 'project' });
    const results = await store.search('search', 'project-memory', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('scoreRelevant returns scored entries sorted by relevance', async () => {
    await store.rememberSuper({ text: 'Relevant result.', importance: 0.5, scope: 'project' });
    const results = await store.scoreRelevant({ currentTask: 'relevant' }, 'project-memory', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.score).toBeGreaterThan(0);
  });
});

// ======================================================
// store.ts — createCandidate with different inputs
// ======================================================
describe('store.ts — createCandidate', () => {
  it('creates a candidate with all fields', async () => {
    const mem = await store.rememberSuper({ text: 'Original for candidate.' });
    const candidate = await (store as any).createCandidate?.({
      text: 'Candidate text',
      kind: 'convention',
      scope: 'project',
      confidence: 0.6,
      importance: 0.5,
      tags: ['tag1'],
      anchors: [],
      sources: [{ type: 'session', sessionId: 's1' }],
      memoryId: mem.id,
      reason: 'Auto-extracted',
    });
    expect(candidate).toBeDefined();
  });
});

// ======================================================
// store.ts — advanced search with scope/conversion
// ======================================================
describe('store.ts — scope conversion edge cases', () => {
  it('handles project-agents scope in legacyToSuperScope', async () => {
    await store.remember('agent rule', 'project-agents');
    const found = await store.searchSuper('agent rule');
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});
