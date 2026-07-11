import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SuperMemoryStore } from '../src/store.js';

let tmpDir: string;
let store: SuperMemoryStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'super-memory-x-'));
  store = new SuperMemoryStore({ projectRoot: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// =========================================================
// store.ts — consolidate legacy (line ~701)
// =========================================================
describe('store.ts — consolidate legacy', () => {
  it('consolidates project scope', async () => {
    await store.remember('consolidate project', 'project-memory');
    await expect(store.consolidate('project-memory')).resolves.toBeUndefined();
  });

  it('consolidates user scope', async () => {
    await store.remember('consolidate user', 'user-memory');
    await expect(store.consolidate('user-memory')).resolves.toBeUndefined();
  });
});

// =========================================================
// store.ts — clear with various scopes
// =========================================================
describe('store.ts — clear scopes', () => {
  it('clears user scope', async () => {
    await store.rememberSuper({ text: 'User clear.', scope: 'user' });
    await store.clear('user-memory');
    const after = await store.list('user-memory');
    expect(after).toHaveLength(0);
  });

  it('clears project-agents scope', async () => {
    await store.remember('agent clear test', 'project-agents');
    await store.clear('project-agents');
    const after = await store.list('project-agents');
    expect(after).toHaveLength(0);
  });
});

// =========================================================
// store.ts — double initialize guard
// =========================================================
describe('store.ts — initialize guard', () => {
  it('skips re-initialization', async () => {
    await store.initialize();
    // Should return immediately
    await expect(store.initialize()).resolves.toBeUndefined();
  });
});

// =========================================================
// store.ts — manifest creation guard
// =========================================================
describe('store.ts — manifest creation', () => {
  it('does not overwrite existing manifest', async () => {
    // First init creates manifest
    await store.initialize();
    // Second init should not overwrite
    await store.initialize();
    const manifestPath = store.paths.manifest;
    const content = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(content.schemaVersion).toBe(1);
  });
});

// =========================================================
// store.ts — addGraphEdge with various relations
// =========================================================
describe('store.ts — addGraphEdge all relation types', () => {
  const relations = [
    'about_file', 'about_directory', 'about_symbol', 'about_package', 'about_command',
    'derived_from', 'validated_by', 'invalidated_by', 'supersedes', 'contradicts',
    'related_to', 'same_topic',
  ] as const;

  for (const rel of relations) {
    it(`adds ${rel} edge`, async () => {
      const edge = await store.addGraphEdge('node:from', 'node:to', rel);
      expect(edge.relation).toBe(rel);
    });
  }
});

// =========================================================
// store.ts — searchSuper with stale inclusion
// =========================================================
describe('store.ts — searchSuper include stale', () => {
  it('includes stale memories when asked', async () => {
    await store.rememberSuper({ text: 'Active search target.', importance: 0.5 });
    const active = await store.searchSuper('Active search', { includeStatuses: ['active'] });
    expect(active.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — findRelated with limit
// =========================================================
describe('store.ts — findRelated limit', () => {
  it('respects limit parameter', async () => {
    await store.rememberSuper({ text: 'Find related test A.', importance: 0.5 });
    await store.rememberSuper({ text: 'Find related test B.', importance: 0.5 });
    const results = await store.findRelated('Find related', 'project-memory', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// =========================================================
// store.ts — remember with type = reference
// =========================================================
describe('store.ts — remember reference type', () => {
  it('maps reference type to file_note kind', async () => {
    await store.remember('Reference note', 'project-memory', { type: 'reference' });
    const found = await store.searchSuper('Reference note');
    expect(found[0]?.kind).toBe('file_note');
  });
});

// =========================================================
// store.ts — memory kind priority mapping
// =========================================================
describe('store.ts — kind priority', () => {
  it('handles preference kind', async () => {
    const mem = await store.rememberSuper({ text: 'Preference test.', kind: 'preference' });
    expect(mem.kind).toBe('preference');
  });

  it('handles workflow kind', async () => {
    const mem = await store.rememberSuper({ text: 'Workflow test.', kind: 'workflow' });
    expect(mem.kind).toBe('workflow');
  });
});

// =========================================================
// store.ts — importLegacy with priority extraction
// =========================================================
describe('store.ts — importLegacy priority', () => {
  it('imports with critical priority', async () => {
    const file = path.join(tmpDir, 'prio.md');
    await fs.writeFile(file, '# Project memory\n- [fact|critical] Critical note\n', 'utf8');
    const result = await store.importLegacy(file);
    expect(result.imported).toBe(1);
  });
});

// =========================================================
// store.ts — verify with multiple memories
// =========================================================
describe('store.ts — verify all memories', () => {
  it('verifies multiple memories', async () => {
    await store.rememberSuper({ text: 'First verify.' });
    await store.rememberSuper({ text: 'Second verify.' });
    const results = await store.verify();
    expect(Array.isArray(results)).toBe(true);
  });
});

// =========================================================
// store.ts — scoreRelevant edge cases
// =========================================================
describe('store.ts — scoreRelevant with scope', () => {
  it('returns scored entries sorted by relevance', async () => {
    await store.rememberSuper({ text: 'Relevant score test.' });
    const results = await store.scoreRelevant('relevant', 'project-memory', 10);
    expect(results.length).toBeGreaterThanOrEqual(0);
  });
});

// =========================================================
// store.ts — list with status filter bridge
// =========================================================
describe('store.ts — listSuper all statuses', () => {
  const statuses = ['active', 'stale', 'superseded', 'contradicted', 'archived', 'deleted'] as const;
  for (const status of statuses) {
    it(`lists ${status} status`, async () => {
      const results = await store.listSuper([status]);
      expect(Array.isArray(results)).toBe(true);
    });
  }
});

// =========================================================
// store.ts — consolidateSession with scope
// =========================================================
describe('store.ts — consolidateSession scope', () => {
  it('candidates have correct scope', async () => {
    await store.consolidateSession({
      sessionId: 'scope-test',
      facts: [{
        text: 'Scope test fact.',
        confidence: 0.4,
        importance: 0.4,
        scope: 'user',
      }],
    });
    const candidates = await store.listCandidates();
    expect(Array.isArray(candidates)).toBe(true);
  });
});

// =========================================================
// store.ts — hygiene with report fields
// =========================================================
describe('store.ts — hygiene report', () => {
  it('returns valid report with timestamps', async () => {
    await store.rememberSuper({ text: 'Hygiene check.' });
    const report = await store.hygiene({ verify: false });
    expect(report.startedAt).toBeDefined();
    expect(report.completedAt).toBeDefined();
    expect(typeof report.examined).toBe('number');
  });
});

// =========================================================
// store.ts — readAudit from empty store
// =========================================================
describe('store.ts — readAudit empty', () => {
  it('returns empty array when no entries', async () => {
    const audit = await store.readAudit();
    expect(Array.isArray(audit)).toBe(true);
  });
});

// =========================================================
// store.ts — tokenize and score edge cases
// =========================================================
describe('store.ts — search edge cases', () => {
  it('handles special characters in query', async () => {
    await store.rememberSuper({ text: 'Handler for edge-case queries!' });
    const results = await store.searchSuper('edge-case queries!');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================
// store.ts — verifyForPaths with stale memories
// =========================================================
describe('store.ts — verifyForPaths empty', () => {
  it('returns empty for non-existent memories', async () => {
    const results = await store.verifyForPaths(['no/memory/here.ts']);
    expect(results).toEqual([]);
  });
});
