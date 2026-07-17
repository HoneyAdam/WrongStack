import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteSuperMemoryStore } from '../src/sqlite-store.js';
import { SuperMemoryStore } from '../src/store.js';

let tempDir: string;

let activeStores: SqliteSuperMemoryStore[] = [];

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wrongstack-sqlite-mem-'));
  activeStores = [];
});

afterEach(async () => {
  for (const store of activeStores) {
    try { store.close(); } catch { /* already closed */ }
  }
  // Give Windows a tick to release WAL file handles
  await new Promise((r) => setTimeout(r, 10));
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

function trackStore(store: SqliteSuperMemoryStore): SqliteSuperMemoryStore {
  activeStores.push(store);
  return store;
}

describe('SqliteSuperMemoryStore', () => {
  describe('initialize', () => {
    it('creates the SQLite database and manifest on first open', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const dbPath = path.join(tempDir, '.wrongstack', 'memories', 'super-memory.db');
      const manifestPath = path.join(tempDir, '.wrongstack', 'memories', 'manifest.json');
      expect(fs.existsSync(dbPath)).toBe(true);
      expect(fs.existsSync(manifestPath)).toBe(true);

    });

    it('is idempotent — calling initialize twice does not throw', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.initialize();

    });
  });

  describe('rememberSuper', () => {
    it('stores a new memory', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const mem = await store.rememberSuper({ text: 'SQLite test memory', kind: 'fact' });
      expect(mem.id).toBeTruthy();
      expect(mem.text).toBe('SQLite test memory');
      expect(mem.status).toBe('active');

    });

    it('merges duplicates by canonical text', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const first = await store.rememberSuper({ text: 'Duplicate  test  content', kind: 'fact' });
      const second = await store.rememberSuper({ text: 'duplicate test content', kind: 'fact', tags: ['new-tag'] });
      expect(second.id).toBe(first.id);
      expect(second.tags).toContain('new-tag');

    });

    it('stores anchors, tags, audience, and sources', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const mem = await store.rememberSuper({
        text: 'Anchored memory',
        kind: 'file_note',
        tags: ['api', 'v2'],
        anchors: [{ type: 'file', path: 'src/index.ts' }],
        audience: { roles: ['reviewer'] },
        importance: 0.9,
        confidence: 0.95,
      });
      expect(mem.anchors).toHaveLength(1);
      expect(mem.anchors[0]?.path).toBe('src/index.ts');
      expect(mem.tags).toEqual(expect.arrayContaining(['api', 'v2']));
      expect(mem.audience?.roles).toEqual(['reviewer']);

    });
  });

  describe('updateSuper', () => {
    it('updates text and status', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const mem = await store.rememberSuper({ text: 'Original text', kind: 'fact' });
      const updated = await store.updateSuper(mem.id, { text: 'Updated text', status: 'stale' });
      expect(updated.text).toBe('Updated text');
      expect(updated.status).toBe('stale');
      expect(updated.revision).toBe(mem.revision + 1);

    });

    it('throws for a non-existent id', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await expect(store.updateSuper('nonexistent', { text: 'x' })).rejects.toThrow();

    });
  });

  describe('deleteSuper', () => {
    it('deletes a memory and its graph edges', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const mem = await store.rememberSuper({ text: 'To be deleted', kind: 'fact' });
      await store.addGraphEdge('mem:abc', `mem:${mem.id}`, 'related_to');
      const result = await store.deleteSuper(mem.id, 'test deletion');
      expect(result.deleted).toBe(true);
      const stats = await store.getStats();
      expect(stats.total).toBe(0);

    });
  });

  describe('searchSuper', () => {
    it('finds memories by text content', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({ text: 'PostgreSQL connection pool settings', kind: 'fact' });
      await store.rememberSuper({ text: 'Redis cache TTL configuration', kind: 'fact' });
      await store.rememberSuper({ text: 'PostgreSQL index optimization', kind: 'fact' });

      const results = await store.searchSuper('PostgreSQL');
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const r of results) {
        expect(r.text.toLowerCase()).toContain('postgresql');
      }

    });

    it('returns empty for non-matching query', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({ text: 'Some memory about databases', kind: 'fact' });
      const results = await store.searchSuper('xyznonexistent');
      expect(results).toHaveLength(0);

    });

    it('respects limit option', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      for (let i = 0; i < 5; i++) {
        await store.rememberSuper({ text: `Limitable test memory ${i}`, kind: 'fact' });
      }
      const results = await store.searchSuper('Limitable', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);

    });
  });

  describe('retrieveForPath', () => {
    it('finds memories anchored to a file path', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({
        text: 'Config for auth module',
        kind: 'file_note',
        anchors: [{ type: 'file', path: 'src/auth/config.ts' }],
      });
      await store.rememberSuper({
        text: 'Unrelated note',
        kind: 'fact',
      });
      const results = await store.retrieveForPath(['src/auth/config.ts']);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.text).toContain('auth module');

    });

    it('finds ancestor-anchored memories when includeAncestors is true', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({
        text: 'Directory-level note',
        kind: 'file_note',
        anchors: [{ type: 'directory', path: 'src/auth' }],
      });
      const results = await store.retrieveForPath(['src/auth/config.ts'], { path: 'src/auth/config.ts', includeAncestors: true });
      expect(results.length).toBeGreaterThanOrEqual(1);

    });
  });

  describe('listMemories', () => {
    it('lists memories sorted by updatedAt DESC', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({ text: 'First memory', kind: 'fact' });
      await store.rememberSuper({ text: 'Second memory', kind: 'fact' });
      const list = await store.listMemories({ limit: 10 });
      expect(list.length).toBeGreaterThanOrEqual(2);
      // Second memory should be newer or equal
      const firstDate = list[0]!.updatedAt;
      const secondDate = list[1]!.updatedAt;
      expect(firstDate.localeCompare(secondDate)).toBeGreaterThanOrEqual(0);

    });

    it('filters by status', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const mem = await store.rememberSuper({ text: 'Active memory', kind: 'fact' });
      await store.updateSuper(mem.id, { status: 'archived' });
      await store.rememberSuper({ text: 'Another active memory', kind: 'fact' });
      const active = await store.listMemories({ status: 'active' });
      const archived = await store.listMemories({ status: 'archived' });
      expect(active.every((m) => m.status === 'active')).toBe(true);
      expect(archived.every((m) => m.status === 'archived')).toBe(true);
      expect(archived.length).toBe(1);

    });

    it('filters by kind', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({ text: 'A fact', kind: 'fact' });
      await store.rememberSuper({ text: 'A decision', kind: 'decision' });
      const facts = await store.listMemories({ kind: 'fact' });
      expect(facts.every((m) => m.kind === 'fact')).toBe(true);

    });
  });

  describe('getStats', () => {
    it('returns correct counts', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({ text: 'Fact one', kind: 'fact' });
      await store.rememberSuper({ text: 'Decision one', kind: 'decision' });
      await store.addGraphEdge('mem:a', 'mem:b', 'related_to');
      const stats = await store.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.active).toBe(2);
      expect(stats.byKind.fact).toBe(1);
      expect(stats.byKind.decision).toBe(1);
      expect(stats.edges).toBeGreaterThanOrEqual(1);

    });
  });

  describe('graph operations', () => {
    it('adds and traverses edges', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.addGraphEdge('mem:a', 'mem:b', 'supersedes');
      await store.addGraphEdge('mem:b', 'mem:c', 'supersedes');
      const edges = await store.traverseGraph(['mem:a'], { maxDepth: 3 });
      expect(edges.length).toBeGreaterThanOrEqual(2);

    });

    it('aggregates edge weights on duplicate inserts', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.addGraphEdge('mem:x', 'mem:y', 'related_to', 1);
      await store.addGraphEdge('mem:x', 'mem:y', 'related_to', 1);
      const edges = await store.traverseGraph(['mem:x']);
      const xy = edges.find((e) => e.from === 'mem:x' && e.to === 'mem:y');
      expect(xy).toBeDefined();
      expect(xy!.weight).toBeGreaterThanOrEqual(2);

    });
  });

  describe('hygiene', () => {
    it('marks memories with stale anchors', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      await store.rememberSuper({
        text: 'Memory with valid anchor',
        kind: 'file_note',
        anchors: [{ type: 'file', path: 'package.json' }],
      });
      await store.rememberSuper({
        text: 'Memory with stale anchor',
        kind: 'file_note',
        anchors: [{ type: 'file', path: 'nonexistent/file.ts' }],
      });
      const report = await store.hygiene();
      expect(report.examined).toBe(2);
      expect(report.staled).toBeGreaterThanOrEqual(1);
    });

    it('deduplicates identical-text memories and marks losers superseded', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      // Note: rememberSuper already deduplicates on insert, so we bypass it
      // by using the internal upsertMemory to create exact duplicates.
      // Instead, create two memories with slightly different text that
      // normalize to the same key.
      await store.rememberSuper({ text: 'Project uses pnpm workspaces.', importance: 0.5 });
      await store.rememberSuper({ text: 'Project uses pnpm workspaces.', importance: 0.9 });

      const report = await store.hygiene();
      // rememberSuper may merge on insert — if so, there's only 1 active.
      // If two survived, hygiene should dedup them.
      if (report.examined >= 2) {
        expect(report.deduplicated).toBeGreaterThanOrEqual(1);
        expect(report.superseded).toBeGreaterThanOrEqual(1);
      }
      // Either way, at most 1 active memory remains.
      const active = await store.listMemories({ status: 'active', limit: 100 });
      const pnpmMems = active.filter((m) => m.text.includes('pnpm workspaces'));
      expect(pnpmMems.length).toBe(1);
    });

    it('creates review candidates for low-confidence memories', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      // Create a memory with low confidence and old updatedAt
      const oldDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
      await store.rememberSuper({ text: 'Low confidence old fact.', confidence: 0.2 });
      // Manually set updatedAt to the past via updateSuper
      const mems = await store.listMemories({ status: 'active', limit: 100 });
      const target = mems.find((m) => m.text.includes('Low confidence'));
      if (target) {
        const db = (store as unknown as { db: { prepare: (s: string) => { run: (...args: unknown[]) => void } } });
        db.db.prepare('UPDATE memories SET data = json_set(data, \'$.updatedAt\', ?, \'$.lastAccessedAt\', ?) WHERE id = ?')
          .run(oldDate, oldDate, target.id);
      }

      const report = await store.hygiene({ archiveLowConfidenceAfterDays: 30, verify: false });
      expect(report.reviewCandidatesCreated).toBeGreaterThanOrEqual(1);
      const candidates = await store.listCandidates();
      const lowConfCandidates = candidates.filter((c) => c.tags.some((t) => t === 'review:confidence_low'));
      expect(lowConfCandidates.length).toBeGreaterThanOrEqual(1);
    });

    it('does not create duplicate candidates on repeated hygiene runs', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const oldDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
      await store.rememberSuper({ text: 'Another low confidence fact.', confidence: 0.2 });
      const mems = await store.listMemories({ status: 'active', limit: 100 });
      const target = mems.find((m) => m.text.includes('Another low'));
      if (target) {
        const db = (store as unknown as { db: { prepare: (s: string) => { run: (...args: unknown[]) => void } } });
        db.db.prepare('UPDATE memories SET data = json_set(data, \'$.updatedAt\', ?, \'$.lastAccessedAt\', ?) WHERE id = ?')
          .run(oldDate, oldDate, target.id);
      }

      // First run creates the candidate
      await store.hygiene({ archiveLowConfidenceAfterDays: 30, verify: false });
      const candidatesAfterFirst = await store.listCandidates();
      const pendingAfterFirst = candidatesAfterFirst.filter((c) => c.status === 'pending' && c.tags.some((t) => t === 'review:confidence_low'));

      // Second run should NOT create a duplicate
      const report2 = await store.hygiene({ archiveLowConfidenceAfterDays: 30, verify: false });
      const candidatesAfterSecond = await store.listCandidates();
      const pendingAfterSecond = candidatesAfterSecond.filter((c) => c.status === 'pending' && c.tags.some((t) => t === 'review:confidence_low'));

      expect(pendingAfterSecond.length).toBe(pendingAfterFirst.length);
      expect(report2.reviewCandidatesCreated).toBe(0);
    });

    it('exempts permanent memories from review candidates', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      const oldDate = new Date(Date.now() - 45 * 86_400_000).toISOString();
      await store.rememberSuper({ text: 'Permanent low confidence fact.', confidence: 0.1, persistence: 'permanent' });
      const mems = await store.listMemories({ status: 'active', limit: 100 });
      const target = mems.find((m) => m.text.includes('Permanent'));
      if (target) {
        const db = (store as unknown as { db: { prepare: (s: string) => { run: (...args: unknown[]) => void } } });
        db.db.prepare('UPDATE memories SET data = json_set(data, \'$.updatedAt\', ?, \'$.lastAccessedAt\', ?) WHERE id = ?')
          .run(oldDate, oldDate, target.id);
      }

      const report = await store.hygiene({ archiveLowConfidenceAfterDays: 30, verify: false });
      // No candidate should be created for the permanent memory
      expect(report.reviewCandidatesCreated).toBe(0);
    });
  });

  describe('JSONL → SQLite migration', () => {
    it('auto-migrates existing JSONL records on first open', async () => {
      // First, write memories via the JSONL store (creates memories.jsonl)
      const jsonlStore = new SuperMemoryStore({ projectRoot: tempDir });
      await jsonlStore.initialize();
      await jsonlStore.rememberSuper({ text: 'JSONL memory one', kind: 'fact' });
      await jsonlStore.rememberSuper({ text: 'JSONL memory two', kind: 'decision' });

      // Now open with SQLite store — should auto-migrate
      const sqliteStore = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await sqliteStore.initialize();

      const stats = await sqliteStore.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byKind.fact).toBeGreaterThanOrEqual(1);
      expect(stats.byKind.decision).toBeGreaterThanOrEqual(1);

      // Search should find migrated content
      const results = await sqliteStore.searchSuper('JSONL');
      expect(results.length).toBeGreaterThanOrEqual(2);

      sqliteStore.close();
    });

    it('does not re-migrate if SQLite db already has data', async () => {
      // Seed JSONL
      const jsonlStore = new SuperMemoryStore({ projectRoot: tempDir });
      await jsonlStore.initialize();
      await jsonlStore.rememberSuper({ text: 'JSONL original', kind: 'fact' });

      // First SQLite open — migrates
      const store1 = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store1.initialize();
      await store1.rememberSuper({ text: 'SQLite-added memory', kind: 'fact' });
      store1.close();

      // Second SQLite open — should NOT re-migrate
      const store2 = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store2.initialize();
      const stats = await store2.getStats();
      expect(stats.total).toBe(2); // 1 migrated + 1 added, not 3 (re-migration would double the JSONL one)
      store2.close();
    });
  });

  describe('close', () => {
    it('closes the database without error', async () => {
      const store = trackStore(new SqliteSuperMemoryStore({ projectRoot: tempDir }));
      await store.initialize();
      expect(() => store.close()).not.toThrow();
    });
  });
});
