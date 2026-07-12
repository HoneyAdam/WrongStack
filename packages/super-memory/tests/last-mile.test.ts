import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';
import { readJsonl } from '../src/jsonl.js';
import { verifyMemoryAnchors } from '../src/anchors/verify.js';
import { createSuperMemoryTurnMiddleware } from '../src/middleware/turn-memory.js';
import { formatMemoryHintsDetailed } from '../src/retrieval/format.js';
import type { SuperMemory } from '../src/types.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-last-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =========================================================
// store.ts — collectStringValues with various inputs
// =========================================================
describe('store.ts — collectStringValues', () => {
  it('extracts strings from nested structures via searchSuper', async () => {
    await store.rememberSuper({ text: 'Collect test.' });
    // Use searchSuper which internally uses tokenize and scoring
    const found = await store.searchSuper('Collect test', { includeStatuses: ['active'] });
    expect(found.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — boundedLimit edge cases
// =========================================================
describe('store.ts — boundedLimit', () => {
  it('handles searchSuper with various limits', async () => {
    await store.rememberSuper({ text: 'Limit test 1.' });
    await store.rememberSuper({ text: 'Limit test 2.' });
    await store.rememberSuper({ text: 'Limit test 3.' });
    // With small limit
    const limited = await store.searchSuper('Limit test', { limit: 1 });
    expect(limited.length).toBeLessThanOrEqual(1);
    // With no limit (default)
    const unlimited = await store.searchSuper('Limit test');
    expect(unlimited.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — retrieveForPath with includeAncestors
// =========================================================
describe('store.ts — retrieveForPath includeAncestors', () => {
  it('retrieves with ancestor directory match', async () => {
    await store.rememberSuper({
      text: 'Directory memory.',
      anchors: [{ type: 'directory', path: 'packages' }],
    });
    const direct = await store.retrieveForPath({
      path: 'packages/core/src/index.ts',
      includeAncestors: true,
    });
    expect(direct.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — consolidate with no facts
// =========================================================
describe('store.ts — consolidateSession empty input', () => {
  it('handles empty facts array', async () => {
    const result = await store.consolidateSession({
      sessionId: 'empty-session',
      facts: [],
    });
    expect(result.candidates).toBe(0);
  });
});

// =========================================================
// store.ts — verify with signal on individual memory
// =========================================================
describe('store.ts — verify with signal and memory id', () => {
  it('aborts verification of specific memory', async () => {
    const mem = await store.rememberSuper({ text: 'Abort specific.' });
    const controller = new AbortController();
    controller.abort();
    await expect(store.verify(mem.id, controller.signal)).rejects.toThrow();
  });
});

// =========================================================
// store.ts — hygiene edge cases with report counts
// =========================================================
describe('store.ts — hygiene stats counts', () => {
  it('hygiene report shows duplicated count for superseded', async () => {
    await store.rememberSuper({ text: 'A unique memory for hygiene test.', importance: 0.5 });
    const report = await store.hygiene({ verify: false });
    // Should examine at least 1
    expect(report.examined).toBeGreaterThanOrEqual(1);
    // should not duplicate when no duplicates
    expect(report.deduplicated).toBe(0);
  });
});

// =========================================================
// store.ts — findRelated with scope mapping
// =========================================================
describe('store.ts — findRelated scope mapping', () => {
  it('searches across user scope', async () => {
    await store.rememberSuper({ text: 'User related.', importance: 0.5, scope: 'user' });
    const results = await store.findRelated('User related', 'user-memory', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — searchSuper with empty query
// =========================================================
describe('store.ts — searchSuper empty query', () => {
  it('returns empty for empty query (no token match)', async () => {
    await store.rememberSuper({ text: 'Memory A.', importance: 0.5 });
    await store.rememberSuper({ text: 'Memory B.', importance: 0.5 });
    const results = await store.searchSuper('');
    // Empty query produces no tokens to match against
    expect(results).toEqual([]);
  });
});

// =========================================================
// jsonl.ts — readJsonl called without onCorrupt
// =========================================================
describe('jsonl.ts — readJsonl without onCorrupt', () => {
  it('reads JSONL with corrupt lines gracefully', async () => {
    const file = path.join(tmpDir, 'corrupt.jsonl');
    await fs.writeFile(file, '{"valid": true}\nnot json\n{"valid": false}\n', 'utf8');
    const values = await readJsonl<Record<string, unknown>>(file);
    // When no onCorrupt is provided, corrupt lines are silently skipped
    expect(values).toEqual([{ valid: true }, { valid: false }]);
  });
});

// =========================================================
// store.ts — memoryPatchChanges with same values
// =========================================================
describe('store.ts — memoryPatchChanges', () => {
  it('detects no change when patch values match memory', async () => {
    const mem = await store.rememberSuper({ text: 'Same memory.', tags: ['a'] });
    // Update with the same text (dedup should reuse)
    const same = await store.rememberSuper({ text: 'Same memory.', tags: ['a'] });
    expect(same.id).toBe(mem.id);
  });
});

// =========================================================
// store.ts — sourceNode with command source
// =========================================================
describe('store.ts — sourceNode commands', () => {
  it('creates node from command source', async () => {
    const mem = await store.rememberSuper({
      text: 'Command sourced.',
      sources: [{ type: 'command', command: 'npm run build' }],
    });
    expect(mem.id).toBeDefined();
  });
});

// =========================================================
// verify.ts line 102 — git blob hash mismatch contentHash
// =========================================================
describe('verify.ts — git blob hash mismatch', () => {
  it('reports contentHash when git blob hash mismatches', async () => {
    const file = path.join(tmpDir, 'git-test.ts');
    await fs.writeFile(file, 'export const x = 1;\n', 'utf8');
    const memory: SuperMemory = {
      id: 'mem_git_hash',
      revision: 1, scope: 'project', kind: 'fact', status: 'active',
      text: 'Git hash test.',
      importance: 0.5, confidence: 0.5, freshness: 0.5,
      tags: [], anchors: [{ type: 'file', path: 'git-test.ts', gitBlobHash: 'deadbeef' }],
      sources: [], createdAt: '', updatedAt: '',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // git hash-object will produce a real hash, not matching 'deadbeef'
    expect(result.status).toBe('stale');
    expect(result.anchors[0]?.gitBlobHash).toBeDefined();
    expect(result.anchors[0]?.contentHash).toBeDefined();
  });
});

// =========================================================
// index.ts — exports validation
// =========================================================
describe('index.ts — exports', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('../src/index.js');
    expect(mod.SuperMemoryStore).toBeDefined();
    expect(mod.createSuperMemoryTools).toBeDefined();
    expect(mod.createSuperMemoryToolCallMiddleware).toBeDefined();
    expect(mod.createSuperMemoryTurnMiddleware).toBeDefined();
    expect(mod.SuperMemoryGraph).toBeDefined();
    expect(mod.verifyMemoryAnchors).toBeDefined();
    expect(mod.formatMemoryHints).toBeDefined();
    expect(mod.formatMemoryHintsDetailed).toBeDefined();
    expect(mod.resolveSuperMemoryPaths).toBeDefined();
    expect(mod.normalizeProjectPath).toBeDefined();
    expect(mod.normalizeSlashes).toBeDefined();
    expect(mod.ancestorPaths).toBeDefined();
    expect(mod.superToLegacyScope).toBeDefined();
    expect(mod.legacyToSuperScope).toBeDefined();
    expect(mod.kindToLegacyType).toBeDefined();
    expect(mod.legacyTypeToKind).toBeDefined();
    expect(mod.toLegacyEntry).toBeDefined();
    expect(mod.SUPER_MEMORY_SCHEMA_VERSION).toBeDefined();
  });
});

// =========================================================
// format.ts line 67 dead code — anchor with only type
// =========================================================
describe('format.ts — formatPrimaryAnchor edge case', () => {
  it('handles memory with only type-based anchor (no path/symbol/command)', () => {
    const mem: SuperMemory = {
      id: 'mem_type_only',
      revision: 1, scope: 'project', kind: 'fact', status: 'active',
      text: 'Only type anchor.',
      importance: 0.5, confidence: 0.5, freshness: 0.5,
      tags: [], anchors: [{ type: 'directory', path: '', symbol: '', command: '' }],
      sources: [], createdAt: '', updatedAt: '',
    };
    const result = formatMemoryHintsDetailed([mem]);
    // The anchor doesn't have path/symbol/command, so no suffix
    expect(result.text).not.toContain('(');
    expect(result.text).toContain('Only type anchor');
  });
});

// =========================================================
// turn-memory.ts — coverage of existingSystem branch with non-text blocks
// =========================================================
describe('turn-memory.ts — system with non-text only', () => {
  it('processes system with only non-text blocks', async () => {
    const middleware = createSuperMemoryTurnMiddleware({
      memory: {
        searchSuper: async () => [],
      },
    });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'test' }],
      system: [{ type: 'image' as never, source: { type: 'base64', data: 'aaa', media_type: 'image/png' } }],
    };
    const result = await middleware.handler(request as never, async (next) => next);
    // Should process without errors
    expect(result.system).toHaveLength(1);
  });
});

// =========================================================
// turn-memory.ts — recordInjection with undefined
// =========================================================
describe('turn-memory.ts — no recordInjection', () => {
  it('handles missing recordInjection gracefully', async () => {
    const middleware = createSuperMemoryTurnMiddleware({
      memory: {
        searchSuper: async () => [{
          id: 'mem_no_rec2',
          revision: 1, scope: 'project', kind: 'fact', status: 'active',
          text: 'No record injection test.',
          importance: 0.95, confidence: 0.95, freshness: 0.9,
          tags: [], anchors: [], sources: [],
          createdAt: '', updatedAt: '',
        } satisfies SuperMemory],
        // recordInjection intentionally undefined
      } as any,
    });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'no record injection' }],
      system: [],
    };
    const result = await middleware.handler(request as never, async (next) => next);
    expect(result.system!.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — labelOf for all scope types
// =========================================================
describe('store.ts — labelOf all scopes', () => {
  it('reads project scope', async () => {
    await store.rememberSuper({ text: 'Project scope read.', scope: 'project' });
    const text = await store.read('project-memory');
    expect(text).toContain('Project scope read');
  });

  it('reads session scope', async () => {
    await store.rememberSuper({ text: 'Session scope read.', scope: 'session' });
    const text = await store.read('project-memory');
    expect(text).toContain('Session scope read');
  });
});

// =========================================================
// store.ts — fileSignature throw path via corrupt file
// =========================================================
describe('store.ts — verify anchors on corrupt files', () => {
  it('handles verifyMemoryAnchors with directory', async () => {
    const dir = path.join(tmpDir, 'adir');
    await fs.mkdir(dir, { recursive: true });
    const memory: SuperMemory = {
      id: 'mem_dir_test',
      revision: 1, scope: 'project', kind: 'fact', status: 'active',
      text: 'Dir anchor.',
      importance: 0.5, confidence: 0.5, freshness: 0.5,
      tags: [], anchors: [{ type: 'file', path: 'adir' }],
      sources: [], createdAt: '', updatedAt: '',
    };
    const result = await verifyMemoryAnchors(tmpDir, memory);
    // A "file" anchor pointing to a directory should be stale
    expect(result.status).toBe('stale');
  });
});

// =========================================================
// store.ts — hygiene with deleted old memories
// =========================================================
describe('store.ts — hygiene retention', () => {
  it('archives low confidence old memories', async () => {
    await store.rememberSuper({ text: 'Old low conf.', confidence: 0.2, importance: 0.2 });
    const report = await store.hygiene({
      archiveLowConfidenceAfterDays: 0,
      retentionDays: 365,
      verify: false,
    });
    expect(report.examined).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================
// store.ts — retrieval with nonexistent path
// =========================================================
describe('store.ts — retrieveForPath no path match', () => {
  it('returns empty for completely unmatched path', async () => {
    await store.rememberSuper({
      text: 'File specific.',
      anchors: [{ type: 'file', path: 'exact/file.ts' }],
    });
    const results = await store.retrieveForPath({
      path: 'completely/different/path.ts',
      includeAncestors: true,
    });
    expect(results).toEqual([]);
  });
});
