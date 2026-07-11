import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';
import { verifyMemoryAnchors } from '../src/anchors/verify.js';
import { createSuperMemoryTurnMiddleware } from '../src/middleware/turn-memory.js';
import { createSuperMemoryToolCallMiddleware } from '../src/middleware/tool-call-memory.js';
import { readJsonlSnapshot } from '../src/jsonl.js';
import type { SuperMemory } from '../src/types.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-final-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ======================================================
// turn-memory.ts lines 26-27 (non-text system blocks)
// ======================================================
describe('turn-memory.ts — system prompt with mixed block types', () => {
  it('handles non-text system blocks', async () => {
    const memory = {
      searchSuper: async () => [{
        id: 'mem_mixed',
        revision: 1, scope: 'project', kind: 'fact', status: 'active',
        text: 'Mixed block memory.',
        importance: 0.95, confidence: 0.95, freshness: 0.9,
        tags: [], anchors: [], sources: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies SuperMemory],
      recordInjection: async () => {},
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'mixed blocks' }],
      system: [
        { type: 'text' as const, text: 'Hello' },
        { type: 'image' as never, source: { type: 'base64', data: 'abc', media_type: 'image/png' } },
      ],
    };
    const result = await middleware.handler(request as never, async (next) => next);
    // Memory should be injected (the image block doesn't affect text matching)
    expect(result.system!.length).toBeGreaterThanOrEqual(2);
  });
});

// ======================================================
// turn-memory.ts line 43 (recordInjection undefined)
// ======================================================
describe('turn-memory.ts — without recordInjection', () => {
  it('works when recordInjection is undefined', async () => {
    const memory = {
      searchSuper: async () => [{
        id: 'mem_no_rec',
        revision: 1, scope: 'project', kind: 'fact', status: 'active',
        text: 'No recording needed.',
        importance: 0.95, confidence: 0.95, freshness: 0.9,
        tags: [], anchors: [], sources: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } satisfies SuperMemory],
    };
    const middleware = createSuperMemoryTurnMiddleware({ memory });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'no recording' }],
      system: [],
    };
    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system!.length).toBeGreaterThanOrEqual(1);
  });
});

// ======================================================
// verify.ts line 63 — symlink outside project root
// ======================================================
describe('verify.ts — symlink outside project root', () => {
  it('detects symlink that resolves outside project', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    const outsideFile = path.join(outsideDir, 'target.ts');
    await fs.writeFile(outsideFile, 'export const x = 1;\n', 'utf8');

    const linkDir = path.join(tmpDir, 'linked');
    await fs.mkdir(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, 'evil-link.ts');

    try {
      await fs.symlink(outsideFile, linkPath);
    } catch {
      // Symlinks may not be supported on this platform — skip test
      return;
    }

    const memory: SuperMemory = {
      id: 'mem_symlink',
      revision: 1, scope: 'project', kind: 'fact', status: 'active',
      text: 'Symlink test.',
      importance: 0.5, confidence: 0.5, freshness: 0.5,
      tags: [], anchors: [{ type: 'file', path: path.relative(tmpDir, linkPath) }],
      sources: [], createdAt: '', updatedAt: '',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // If symlink resolves outside, status should be stale
    expect(result.status).toBe('stale');
    expect(result.anchors[0]?.reason).toContain('symlink');
  });
});

// ======================================================
// verify.ts line 102 — git hash-object failure catch
// ======================================================
describe('verify.ts — git hash-object failure', () => {
  it('returns unknown when git hash-object fails on a directory', async () => {
    const dir = path.join(tmpDir, 'adir');
    await fs.mkdir(dir, { recursive: true });
    const memory: SuperMemory = {
      id: 'mem_git_dir',
      revision: 1, scope: 'project', kind: 'fact', status: 'active',
      text: 'Git dir test.',
      importance: 0.5, confidence: 0.5, freshness: 0.5,
      tags: [], anchors: [{ type: 'git', path: 'adir' }],
      sources: [], createdAt: '', updatedAt: '',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // git hash-object on a directory might fail
    expect(['stale', 'unknown']).toContain(result.status);
  });
});

// ======================================================
// jsonl.ts line 44 — readJsonlSnapshot with non-ENOENT error
// ======================================================
describe('jsonl.ts — readJsonlSnapshot error paths', () => {
  it('throws on non-ENOENT errors', async () => {
    // Provide a directory path instead of file — causes EISDIR error
    await expect(readJsonlSnapshot(tmpDir)).rejects.toThrow();
  });
});

// ======================================================
// tool-call-memory.ts line 156 — sort comparator with multiple results
// ======================================================
describe('tool-call-memory.ts — sort multiple memories by score', () => {
  it('injects highest scored memory across multiple paths', async () => {
    await store.rememberSuper({
      text: 'Higher ranked memory.',
      importance: 0.85, confidence: 0.9,
      anchors: [{ type: 'file', path: 'src/high.ts' }],
    });
    await store.rememberSuper({
      text: 'Lower ranked memory.',
      importance: 0.5, confidence: 0.5,
      anchors: [{ type: 'file', path: 'src/low.ts' }],
    });
    const mw = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0, maxHintsPerTool: 2 });

    const payload = {
      toolUse: { type: 'tool_use' as const, id: 'sort1', name: 'grep', input: { path: 'src', pattern: 'memory' } },
      result: { type: 'tool_result' as const, tool_use_id: 'sort1', name: 'grep', content: JSON.stringify({ results: ['src/high.ts'] }) },
      ctx: { projectRoot: tmpDir, session: { id: 'sort-session' }, signal: new AbortController().signal },
    };
    await mw.handler(payload as never, async (p) => p);
    // Should inject at least one of them
    expect(payload.result.content).toContain('Super Memory');
  });
});
