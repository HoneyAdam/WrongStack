import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SuperMemoryStore,
  createSuperMemoryToolCallMiddleware,
} from '../src/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-super-memory-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('SuperMemoryStore', () => {
  it('stores project-local JSONL memory and exposes the legacy MemoryStore list/search contract', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await store.remember('Project uses pnpm for workspace commands', 'project-memory', {
      type: 'convention',
      tags: ['pnpm', 'workspace'],
      priority: 'high',
    });

    const list = await store.list('project-memory');
    expect(list).toHaveLength(1);
    expect(list[0]?.text).toBe('Project uses pnpm for workspace commands');
    expect(list[0]?.type).toBe('convention');

    const found = await store.search('pnpm workspace', 'project-memory');
    expect(found).toHaveLength(1);

    const raw = await fs.readFile(path.join(tempDir, '.wrongstack', 'memories', 'memories.jsonl'), 'utf8');
    expect(raw).toContain('"recordType":"memory"');
  });

  it('retrieves memory attached to a file path and ancestor directory', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await store.rememberSuper({
      text: 'Session storage changes require lifecycle regression tests',
      kind: 'warning',
      importance: 0.95,
      anchors: [{ type: 'directory', path: 'packages/core/src/storage' }],
      tags: ['session', 'storage'],
    });

    const direct = await store.retrieveForPath({
      path: 'packages/core/src/storage/session-store.ts',
      limit: 5,
    });

    expect(direct.map((m) => m.text)).toContain('Session storage changes require lifecycle regression tests');
  });

  it('rejects obvious secrets', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    await expect(
      store.remember('api_key = "abcdefghijklmnopqrstuvwxyz123456"'),
    ).rejects.toThrow(/secret/i);
  });
});

describe('Super Memory tool-call middleware', () => {
  it('appends related file memory to read results and applies repeat cooldown', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Do not emit session_end from save-only flows',
      kind: 'warning',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'packages/core/src/storage/session-store.ts' }],
      tags: ['session'],
    });

    const mw = createSuperMemoryToolCallMiddleware({
      memory: store,
      repeatCooldownMs: 60_000,
    });

    const payload = {
      toolUse: {
        type: 'tool_use' as const,
        id: 'toolu_1',
        name: 'read',
        input: { path: 'packages/core/src/storage/session-store.ts' },
      },
      result: {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_1',
        name: 'read',
        content: '1| export class SessionStore {}',
      },
      ctx: { projectRoot: tempDir, session: { id: 'sess' } },
    };

    await mw.handler(payload as never, async (value) => value);
    expect(payload.result.content).toContain('Super Memory: related project knowledge');
    expect(payload.result.content).toContain('Do not emit session_end');

    const second = {
      ...payload,
      result: {
        ...payload.result,
        content: '1| export class SessionStore {}',
      },
    };
    await mw.handler(second as never, async (value) => value);
    expect(second.result.content).not.toContain('Super Memory: related project knowledge');

    const otherSession = {
      ...payload,
      result: { ...payload.result, content: '1| export class SessionStore {}' },
      ctx: { projectRoot: tempDir, cwd: tempDir, session: { id: 'sess-2' } },
    };
    await mw.handler(otherSession as never, async (value) => value);
    expect(otherSession.result.content).toContain('Do not emit session_end');
  });

  it('resolves relative tool paths from the active working directory and extracts patch targets', async () => {
    await fs.mkdir(path.join(tempDir, 'packages', 'demo'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'packages', 'demo', 'source.ts'), 'export const value = 1;\n');
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Keep the demo source API stable.',
      kind: 'warning',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'packages/demo/source.ts' }],
    });
    const middleware = createSuperMemoryToolCallMiddleware({ memory: store, repeatCooldownMs: 0 });

    const readPayload = {
      toolUse: { type: 'tool_use' as const, id: 'read-1', name: 'read', input: { path: 'source.ts' } },
      result: { type: 'tool_result' as const, tool_use_id: 'read-1', name: 'read', content: 'file body' },
      ctx: { projectRoot: tempDir, cwd: path.join(tempDir, 'packages', 'demo'), session: { id: 'cwd-session' } },
    };
    await middleware.handler(readPayload as never, async (value) => value);
    expect(readPayload.result.content).toContain('Keep the demo source API stable');

    const patchPayload = {
      toolUse: {
        type: 'tool_use' as const,
        id: 'patch-1',
        name: 'patch',
        input: { patch: '--- a/source.ts\n+++ b/source.ts\n@@ -1 +1 @@\n-old\n+new\n' },
      },
      result: { type: 'tool_result' as const, tool_use_id: 'patch-1', name: 'patch', content: 'patch applied' },
      ctx: { projectRoot: tempDir, cwd: path.join(tempDir, 'packages', 'demo'), session: { id: 'patch-session' } },
    };
    await middleware.handler(patchPayload as never, async (value) => value);
    expect(patchPayload.result.content).toContain('Keep the demo source API stable');
  });

  it('fails open when advisory memory retrieval is unavailable', async () => {
    const middleware = createSuperMemoryToolCallMiddleware({
      memory: {
        retrieveForPath: async () => { throw new Error('storage unavailable'); },
        searchSuper: async () => { throw new Error('storage unavailable'); },
      },
    });
    const payload = {
      toolUse: { type: 'tool_use' as const, id: 'read-fail-open', name: 'read', input: { path: 'source.ts' } },
      result: { type: 'tool_result' as const, tool_use_id: 'read-fail-open', name: 'read', content: 'original tool result' },
      ctx: { projectRoot: tempDir, cwd: tempDir, session: { id: 'fail-open' } },
    };

    await expect(middleware.handler(payload as never, async (value) => value)).resolves.toBe(payload);
    expect(payload.result.content).toBe('original tool result');
  });

  describe('SuperMemory public CRUD (get/update/delete)', () => {
    let store: SuperMemoryStore;
    let memoryId: string;

    beforeEach(async () => {
      store = new SuperMemoryStore({ projectRoot: tempDir });
      const created = await store.rememberSuper({
        text: 'Use pnpm for monorepo management',
        kind: 'convention',
        tags: ['pnpm', 'monorepo'],
      });
      memoryId = created.id;
    });

    it('getSuperMemory returns a memory by ID', async () => {
      const found = await store.getSuperMemory(memoryId);
      expect(found).not.toBeNull();
      expect(found!.text).toBe('Use pnpm for monorepo management');
      expect(found!.kind).toBe('convention');
      expect(found!.tags).toEqual(['pnpm', 'monorepo']);
    });

    it('getSuperMemory returns null for a non-existent ID', async () => {
      const found = await store.getSuperMemory('nonexistent_id');
      expect(found).toBeNull();
    });

    it('updateSuperMemory changes text', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        text: 'Use pnpm v9 for monorepo management',
      });
      expect(updated.text).toBe('Use pnpm v9 for monorepo management');
      expect(updated.revision).toBe(2);

      // Verify persistence
      const refetched = await store.getSuperMemory(memoryId);
      expect(refetched!.text).toBe('Use pnpm v9 for monorepo management');
    });

    it('updateSuperMemory changes tags', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        tags: ['pnpm', 'v9', 'workspace'],
      });
      expect(updated.tags).toEqual(['pnpm', 'v9', 'workspace']);

      const refetched = await store.getSuperMemory(memoryId);
      expect(refetched!.tags).toEqual(['pnpm', 'v9', 'workspace']);
    });

    it('updateSuperMemory changes kind', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        kind: 'preference',
      });
      expect(updated.kind).toBe('preference');
    });

    it('updateSuperMemory changes anchors', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        anchors: [{ type: 'file', path: 'pnpm-workspace.yaml' }],
      });
      expect(updated.anchors).toHaveLength(1);
      expect(updated.anchors[0]!.path).toContain('pnpm-workspace.yaml');
    });

    it('updateSuperMemory changes status', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        status: 'archived',
      });
      expect(updated.status).toBe('archived');
    });

    it('updateSuperMemory rejects empty patch', async () => {
      await expect(store.updateSuperMemory(memoryId, {})).rejects.toThrow(
        'Update patch must not be empty.',
      );
    });

    it('updateSuperMemory rejects non-existent ID', async () => {
      await expect(
        store.updateSuperMemory('mem_nonexistent', { text: 'whatever' }),
      ).rejects.toThrow('not found');
    });

    it('updateSuperMemory rejects empty text', async () => {
      await expect(
        store.updateSuperMemory(memoryId, { text: '' }),
      ).rejects.toThrow('must not be empty');
    });

    it('updateSuperMemory rejects invalid kind', async () => {
      await expect(
        store.updateSuperMemory(memoryId, { kind: 'invalid_kind' as never }),
      ).rejects.toThrow('Invalid kind');
    });

    it('updateSuperMemory rejects invalid status', async () => {
      await expect(
        store.updateSuperMemory(memoryId, { status: 'invalid_status' as never }),
      ).rejects.toThrow('Invalid status');
    });

    it('updateSuperMemory clamps importance/confidence/freshness', async () => {
      const updated = await store.updateSuperMemory(memoryId, {
        importance: 1.5,
        confidence: -0.5,
        freshness: 0.75,
      });
      expect(updated.importance).toBe(1);
      expect(updated.confidence).toBe(0);
      expect(updated.freshness).toBe(0.75);
    });

    it('deleteSuperMemory soft-deletes by ID', async () => {
      await store.deleteSuperMemory(memoryId, 'test', { force: true });

      const deleted = await store.getSuperMemory(memoryId);
      expect(deleted).not.toBeNull();
      expect(deleted!.status).toBe('deleted');

      // Should not appear in active-only listing
      const active = await store.listSuper(['active']);
      expect(active.find((m) => m.id === memoryId)).toBeUndefined();
    });

    it('rejects deletion without force and keeps the memory active', async () => {
      // Use a separate memory so the shared memoryId isn't consumed
      const mem = await store.rememberSuper({ text: 'Guard test target', kind: 'fact' });
      await expect(store.deleteSuperMemory(mem.id)).rejects.toThrow(/explicit authorization/);
      const stillActive = await store.getSuperMemory(mem.id);
      expect(stillActive!.status).toBe('active');
    });

    it('prefers non-deleted record when two entries have equal revision', async () => {
      // Simulate the file-reordering bug: append an active record, then a
      // deleted tombstone with the SAME revision (what direct JSONL
      // manipulation or a race produces). The store must keep the memory
      // active because the tombstone is a stale duplicate, not a newer state.
      const mem = await store.rememberSuper({ text: 'Dedup test', kind: 'fact' });
      // Directly append a same-revision deleted tombstone to the JSONL
      const paths = (store as unknown as { paths: { memoriesLog: string } }).paths;
      const fs = await import('node:fs');
      fs.appendFileSync(paths.memoriesLog, JSON.stringify({
        recordType: 'memory',
        schemaVersion: 1,
        op: 'delete',
        memory: { ...mem, status: 'deleted' as const },
      }) + '\n');
      // Invalidate cache and reload
      (store as unknown as { loaded: unknown }).loaded = undefined;
      (store as unknown as { loadedLogSignature: unknown }).loadedLogSignature = undefined;
      const reloaded = await store.getSuperMemory(mem.id);
      // The active record should win — the same-revision tombstone is stale
      expect(reloaded?.status).toBe('active');
    });

    it('compacts the JSONL log when duplicate records exceed threshold', async () => {
      // Lower thresholds so duplicates always compact
      (store as unknown as { compactionMinRecords: number }).compactionMinRecords = 2;
      (store as unknown as { compactionDuplicateRatio: number }).compactionDuplicateRatio = 1;

      // Create 3 memories, then update each twice (3 records each = 9 total, > 3×2)
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const mem = await store.rememberSuper({ text: `Compaction test ${i}`, kind: 'fact' });
        ids.push(mem.id);
        await store.updateSuperMemory(mem.id, { text: `Updated ${i}` });
        await store.updateSuperMemory(mem.id, { text: `Updated again ${i}` });
      }
      // The last update triggers afterMutation → maybeCompactLog

      // Read the raw file — after compaction, record count should equal unique ID count
      const fs = await import('node:fs');
      const paths = (store as unknown as { paths: { memoriesLog: string } }).paths;
      const rawLines = fs.readFileSync(paths.memoriesLog, 'utf8').split('\n').filter((l: string) => l.trim());
      const records = rawLines.map((l: string) => JSON.parse(l));
      const memoryRecords = records.filter((r: { recordType?: string }) => r.recordType === 'memory');
      const uniqueIds = new Set(memoryRecords.map((r: { memory: { id: string } }) => r.memory.id));

      // After compaction: one record per unique ID (no duplicates)
      expect(memoryRecords.length).toBe(uniqueIds.size);
      // Should include our 3 test memories + the seed
      expect(uniqueIds.size).toBeGreaterThanOrEqual(4);

      // All test memories should still be readable with the latest text
      for (let i = 0; i < 3; i++) {
        const mem = await store.getSuperMemory(ids[i]);
        expect(mem?.text).toBe(`Updated again ${i}`);
        expect(mem?.status).toBe('active');
      }
    });

    it('does not compact below the minimum record threshold', async () => {
      // Set a high minimum so a small store won't compact
      (store as unknown as { compactionMinRecords: number }).compactionMinRecords = 1000;
      (store as unknown as { compactionDuplicateRatio: number }).compactionDuplicateRatio = 2;

      await store.rememberSuper({ text: 'Small store test', kind: 'fact' });

      const fs = await import('node:fs');
      const paths = (store as unknown as { paths: { memoriesLog: string } }).paths;
      const rawLines = fs.readFileSync(paths.memoriesLog, 'utf8').split('\n').filter((l: string) => l.trim());
      // Should still have the original seed + this record (no compaction)
      expect(rawLines.length).toBeGreaterThanOrEqual(2);
    });

    it('keeps ordinary soft-deleted memory eligible for automatic LLM retrieval', async () => {
      await store.deleteSuperMemory(memoryId, 'No longer shown as active', { force: true });
      const matches = await store.searchSuper('pnpm monorepo');
      expect(matches).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: memoryId, status: 'deleted', contextPolicy: 'eligible' }),
      ]));
    });

    it('honors an explicit neverInject deletion as an absolute context ban', async () => {
      await store.deleteSuperMemory(memoryId, 'Private; never send to a model', { force: true, neverInject: true });
      await expect(store.searchSuper('pnpm monorepo')).resolves.toEqual([]);
      const deleted = await store.getSuperMemory(memoryId);
      expect(deleted).toMatchObject({ status: 'deleted', contextPolicy: 'never' });
    });

    it('deleteSuperMemory is idempotent', async () => {
      await store.deleteSuperMemory(memoryId, 'test', { force: true });
      // Second call should not throw
      await expect(store.deleteSuperMemory(memoryId)).resolves.toBeUndefined();
    });

    it('deleteSuperMemory rejects non-existent ID', async () => {
      await expect(store.deleteSuperMemory('mem_nonexistent')).rejects.toThrow(
        'not found',
      );
    });

    it('deleteSuperMemory cascade cleans supersedes references', async () => {
      const mem2 = await store.rememberSuper({
        text: 'Use yarn for monorepo management',
        kind: 'fact',
      });
      // Make mem2 supersede the original
      await store.updateSuperMemory(mem2.id, { supersedes: [memoryId] });
      // Now delete the superseded memory
      await store.deleteSuperMemory(memoryId, 'test', { force: true });

      // mem2 should no longer reference the deleted memory
      const refreshed = await store.getSuperMemory(mem2.id);
      expect(refreshed!.supersedes).not.toContain(memoryId);
    });

    it('deleteSuperMemory cascade cleans contradicts references', async () => {
      const mem2 = await store.rememberSuper({
        text: 'Use yarn for monorepo management',
        kind: 'fact',
      });
      // Make mem2 contradict the original
      await store.updateSuperMemory(mem2.id, { contradicts: [memoryId] });
      // Now delete the contradicted memory
      await store.deleteSuperMemory(memoryId, 'test', { force: true });

      const refreshed = await store.getSuperMemory(mem2.id);
      expect(refreshed!.contradicts).not.toContain(memoryId);
    });

    it('deleteSuperMemory cascade cleans supersededBy references', async () => {
      const mem2 = await store.rememberSuper({
        text: 'Better pnpm practice',
        kind: 'convention',
        tags: ['pnpm'],
      });
      // Make mem2 supersede the original memory
      await store.updateSuperMemory(mem2.id, { supersedes: [memoryId] });
      // Force the original to track supersededBy
      const original = await store.getSuperMemory(memoryId);
      expect(original!.supersededBy).toBe(mem2.id);

      // Delete the superseding memory
      await store.deleteSuperMemory(mem2.id, 'test', { force: true });

      // Original should no longer reference the deleted memory
      const refreshed = await store.getSuperMemory(memoryId);
      expect(refreshed!.supersededBy).toBeUndefined();
    });

    it('deleteSuperMemory removes graph edges', async () => {
      // Create a memory with anchors to generate graph edges
      const memWithAnchors = await store.rememberSuper({
        text: 'Config file is important',
        kind: 'fact',
        anchors: [{ type: 'file', path: 'config.yaml' }],
      });
      // Verify edges exist
      const beforeEdges = await store.graphFor(memWithAnchors.id);
      expect(beforeEdges.length).toBeGreaterThan(0);

      // Delete
      await store.deleteSuperMemory(memWithAnchors.id, 'test', { force: true });
      // Verify edges are gone
      const afterEdges = await store.graphFor(memWithAnchors.id);
      expect(afterEdges.length).toBe(0);
    });

    // ── Extended cascade cleanup tests ────────────────────────────────

    it('cascade cleans multiple supersedes references at once', async () => {
      const memA = await store.rememberSuper({ text: 'Fact A', kind: 'fact' });
      const memB = await store.rememberSuper({ text: 'Fact B', kind: 'fact' });
      const memC = await store.rememberSuper({ text: 'Fact C', kind: 'fact' });

      // mB and mC both reference mA via supersedes
      await store.updateSuperMemory(memB.id, { supersedes: [memA.id] });
      await store.updateSuperMemory(memC.id, { supersedes: [memA.id] });

      // Delete mA
      await store.deleteSuperMemory(memA.id, 'test', { force: true });

      // Both mB and mC should have the reference removed
      const refB = await store.getSuperMemory(memB.id);
      const refC = await store.getSuperMemory(memC.id);
      expect(refB!.supersedes).not.toContain(memA.id);
      expect(refC!.supersedes).not.toContain(memA.id);
    });

    it('cascade cleans multiple contradicts references at once', async () => {
      const memA = await store.rememberSuper({ text: 'Base fact', kind: 'fact' });
      const memB = await store.rememberSuper({ text: 'Contradicting B', kind: 'fact' });
      const memC = await store.rememberSuper({ text: 'Contradicting C', kind: 'fact' });

      await store.updateSuperMemory(memB.id, { contradicts: [memA.id] });
      await store.updateSuperMemory(memC.id, { contradicts: [memA.id] });

      await store.deleteSuperMemory(memA.id, 'test', { force: true });

      const refB = await store.getSuperMemory(memB.id);
      const refC = await store.getSuperMemory(memC.id);
      expect(refB!.contradicts).not.toContain(memA.id);
      expect(refC!.contradicts).not.toContain(memA.id);
    });

    it('cascade cleans supersededBy when the superseding memory is deleted', async () => {
      const memA = await store.rememberSuper({ text: 'Original', kind: 'fact' });
      const memB = await store.rememberSuper({ text: 'Superseder B', kind: 'fact' });

      // Make memB supersede mA
      await store.updateSuperMemory(memB.id, { supersedes: [memA.id] });
      // mA should now have supersededBy = memB.id
      const afterB = await store.getSuperMemory(memA.id);
      expect(afterB!.supersededBy).toBe(memB.id);

      // Now delete memB
      await store.deleteSuperMemory(memB.id, 'test', { force: true });

      // mA should no longer reference memB
      const afterDeleteB = await store.getSuperMemory(memA.id);
      expect(afterDeleteB!.supersededBy).toBeUndefined();
    });

    it('cascade handles supersedes chain: A→B→C, delete A', async () => {
      const memC = await store.rememberSuper({ text: 'C: latest', kind: 'convention', tags: ['c'] });
      const memB = await store.rememberSuper({ text: 'B: older', kind: 'convention', tags: ['b'] });
      const memA = await store.rememberSuper({ text: 'A: oldest', kind: 'convention', tags: ['a'] });

      // Build chain: A supersedes nothing, B supersedes A, C supersedes B
      await store.updateSuperMemory(memB.id, { supersedes: [memA.id] });
      await store.updateSuperMemory(memC.id, { supersedes: [memB.id] });

      // Verify chain
      expect((await store.getSuperMemory(memA.id))!.supersededBy).toBe(memB.id);
      expect((await store.getSuperMemory(memB.id))!.supersededBy).toBe(memC.id);

      // Delete middle of chain (memB)
      await store.deleteSuperMemory(memB.id, 'test', { force: true });

      // C should no longer reference B
      const afterC = await store.getSuperMemory(memC.id);
      expect(afterC!.supersedes).not.toContain(memB.id);

      // A should no longer reference B
      const afterA = await store.getSuperMemory(memA.id);
      expect(afterA!.supersededBy).toBeUndefined();

      // A should still have its original text
      expect(afterA!.text).toBe('A: oldest');
    });

    it('cascade does not touch unrelated memories', async () => {
      const memA = await store.rememberSuper({ text: 'Delete target', kind: 'fact', tags: ['a'] });
      const memB = await store.rememberSuper({ text: 'Unrelated fact', kind: 'fact', tags: ['b'] });

      await store.deleteSuperMemory(memA.id, 'test', { force: true });

      // memB should be untouched
      const refB = await store.getSuperMemory(memB.id);
      expect(refB).not.toBeNull();
      expect(refB!.status).toBe('active');
      expect(refB!.text).toBe('Unrelated fact');
      expect(refB!.supersedes).toBeUndefined();
      expect(refB!.contradicts).toBeUndefined();
    });

    it('cascade handles mixed supersedes and contradicts on same memory', async () => {
      // memB both supersedes AND contradicts memA
      const memA = await store.rememberSuper({ text: 'Original', kind: 'fact' });
      const memB = await store.rememberSuper({ text: 'Better version', kind: 'fact' });

      await store.updateSuperMemory(memB.id, {
        supersedes: [memA.id],
        contradicts: [memA.id],
      });

      // Delete memB
      await store.deleteSuperMemory(memB.id, 'test', { force: true });

      // memA should have both references cleaned
      const afterA = await store.getSuperMemory(memA.id);
      expect(afterA!.supersededBy).toBeUndefined();
    });

    it('cascade removes all graph edges for a memory with multiple anchors', async () => {
      const mem = await store.rememberSuper({
        text: 'Multi-anchor memory',
        kind: 'fact',
        anchors: [
          { type: 'file', path: 'src/main.ts' },
          { type: 'file', path: 'src/utils.ts' },
          { type: 'symbol', path: 'src/main.ts', symbol: 'runApp' },
        ],
      });

      // Verify edges were created for all anchors
      const beforeEdges = await store.graphFor(mem.id);
      expect(beforeEdges.length).toBeGreaterThanOrEqual(3);

      // Delete
      await store.deleteSuperMemory(mem.id, 'test', { force: true });

      // All edges should be gone
      const afterEdges = await store.graphFor(mem.id);
      expect(afterEdges.length).toBe(0);

      // Also verify via graph.list() that the edges are soft-deleted
      const graphModule = await import('../src/graph/graph.js');
      const graph = new graphModule.SuperMemoryGraph(store.paths.edgesLog);
      const allEdges = await graph.list();
      // None of the remaining edges should reference this memory
      for (const edge of allEdges) {
        expect(edge.from).not.toBe(`mem:${mem.id}`);
        expect(edge.to).not.toBe(`mem:${mem.id}`);
      }
    });
  });

  it('mutates the original tool result even when downstream middleware clones the payload', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Cloned pipeline payloads still receive memory.',
      importance: 0.95,
      anchors: [{ type: 'file', path: 'source.ts' }],
    });
    const middleware = createSuperMemoryToolCallMiddleware({ memory: store });
    const payload = {
      toolUse: { type: 'tool_use' as const, id: 'clone-1', name: 'read', input: { path: 'source.ts' } },
      result: { type: 'tool_result' as const, tool_use_id: 'clone-1', name: 'read', content: 'original' },
      ctx: { projectRoot: tempDir, cwd: tempDir, session: { id: 'clone-session' } },
    };

    await middleware.handler(payload as never, async (value) => {
      const cloned = value as unknown as typeof payload;
      return { ...cloned, result: { ...cloned.result } } as never;
    });
    expect(payload.result.content).toContain('Cloned pipeline payloads still receive memory');
  });
});
