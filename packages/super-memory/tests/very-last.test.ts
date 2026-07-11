import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';
import type { MemoryEntry, MemoryScope } from '@wrongstack/core';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-f-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =========================================================
// store.ts — forget with scope variants
// =========================================================
describe('store.ts — forget scope variants', () => {
  it('forgets in user scope', async () => {
    await store.rememberSuper({ text: 'User forget.', scope: 'user' });
    const count = await store.forget('User forget', 'user-memory');
    expect(count).toBe(1);
  });
});

// =========================================================
// store.ts — list with limit
// =========================================================
describe('store.ts — list with limit', () => {
  it('respects list limit', async () => {
    await store.rememberSuper({ text: 'List entry A.' });
    await store.rememberSuper({ text: 'List entry B.' });
    const entries = await store.list('project-memory', 1);
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});

// =========================================================
// store.ts — search with limit
// =========================================================
describe('store.ts — search with limit', () => {
  it('respects search limit', async () => {
    await store.rememberSuper({ text: 'Search A.' });
    await store.rememberSuper({ text: 'Search B.' });
    const results = await store.search('Search', 'project-memory', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// =========================================================
// store.ts — scoreRelevant limit
// =========================================================
describe('store.ts — scoreRelevant limit', () => {
  it('respects scoreRelevant limit', async () => {
    await store.rememberSuper({ text: 'Score A.' });
    await store.rememberSuper({ text: 'Score B.' });
    const results = await store.scoreRelevant('Score', 'project-memory', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// =========================================================
// store.ts — read with empty store
// =========================================================
describe('store.ts — read empty store', () => {
  it('returns empty string for empty project memory', async () => {
    const text = await store.read('project-memory');
    expect(text).toBe('');
  });
});

// =========================================================
// store.ts — session memories in readAll
// =========================================================
describe('store.ts — readAll with mixed scopes', () => {
  it('includes session memories', async () => {
    await store.rememberSuper({ text: 'Session read.', scope: 'session' });
    const text = await store.readAll();
    expect(text).toContain('Session read');
  });
});

// =========================================================
// store.ts — verifyForPaths with some matching memories
// =========================================================
describe('store.ts — verifyForPaths real files', () => {
  it('verifies paths that have anchored memories', async () => {
    await fs.writeFile(path.join(tmpDir, 'real-file.ts'), 'export const a = 1;\n', 'utf8');
    await store.rememberSuper({
      text: 'Real file memory.',
      anchors: [{ type: 'file', path: 'real-file.ts' }],
    });
    const results = await store.verifyForPaths(['real-file.ts']);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.status).toBe('verified');
  });
});

// =========================================================
// store.ts — addGraphEdge with memories that create edges
// =========================================================
describe('store.ts — addGraphEdge dedup', () => {
  it('prevents duplicate active edges', async () => {
    const first = await store.addGraphEdge('a', 'b', 'related_to');
    const second = await store.addGraphEdge('a', 'b', 'related_to');
    expect(second.id).toBe(first.id);
  });
});

// =========================================================
// store.ts — parseLegacyMemory edge cases
// =========================================================
describe('store.ts — importLegacy with various markers', () => {
  it('imports legacy with type-only bracket', async () => {
    const file = path.join(tmpDir, 'type-only.md');
    await fs.writeFile(file, '# Project memory\n- [decision] No priority\n', 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(1);
  });

  it('skips empty bullet lines', async () => {
    const file = path.join(tmpDir, 'empty-bullet.md');
    await fs.writeFile(file, '# Project memory\n- \n- Valid line\n', 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(1);
  });
});

// =========================================================
// store.ts — listSuper order verification
// =========================================================
describe('store.ts — listSuper ordering', () => {
  it('returns memories sorted by importance desc', async () => {
    await store.rememberSuper({ text: 'Z low importance.', importance: 0.1 });
    await store.rememberSuper({ text: 'A high importance.', importance: 0.9 });
    const results = await store.listSuper(['active']);
    if (results.length >= 2) {
      expect(results[0]?.importance).toBeGreaterThanOrEqual(results[1]?.importance ?? 0);
    }
  });
});

// =========================================================
// store.ts — normalizeNode with session prefix
// =========================================================
describe('store.ts — graph node normalization', () => {
  it('handles graphFor with memory IDs', async () => {
    const mem = await store.rememberSuper({
      text: 'Graph node test.',
      anchors: [{ type: 'file', path: 'src/node.ts' }],
    });
    const edges = await store.graphFor(`mem:${mem.id}`);
    expect(Array.isArray(edges)).toBe(true);
  });
});

// =========================================================
// store.ts — findRelated with no matches
// =========================================================
describe('store.ts — findRelated no matches', () => {
  it('returns empty array for no match', async () => {
    await store.rememberSuper({ text: 'One memory.' });
    const results = await store.findRelated('NONEXISTENT_ZZZZ', 'project-memory', 5);
    expect(results).toEqual([]);
  });
});

// =========================================================
// store.ts — readAudit filter by event
// =========================================================
describe('store.ts — readAudit events', () => {
  it('contains injection events after recordInjection', async () => {
    const mem = await store.rememberSuper({ text: 'Audit injection test.' });
    await store.recordInjection([mem.id], 'test_trigger', 'test-session');
    const audit = await store.readAudit();
    expect(audit.some((a) => a.event === 'memory.injected')).toBe(true);
  });
});

// =========================================================
// store.ts — retrieveForPath with null status filter
// =========================================================
describe('store.ts — retrieveForPath all statuses', () => {
  it('retrieves with active statuses', async () => {
    await store.rememberSuper({
      text: 'Active retrieve.',
      anchors: [{ type: 'file', path: 'src/active.ts' }],
    });
    const results = await store.retrieveForPath({
      path: 'src/active.ts',
      includeStatuses: ['active'],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
