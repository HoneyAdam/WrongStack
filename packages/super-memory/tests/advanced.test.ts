import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SuperMemoryStore,
  createSuperMemoryTools,
  createSuperMemoryTurnMiddleware,
  resolveSuperMemoryPaths,
} from '../src/index.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-super-memory-advanced-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('Super Memory graph and verification', () => {
  it('refuses storage paths outside the project root', () => {
    expect(() => resolveSuperMemoryPaths(tempDir, '../escape')).toThrow(/project root/i);
    expect(() => resolveSuperMemoryPaths(tempDir, path.resolve(tempDir, 'absolute'))).toThrow(/project-relative/i);
  });
  it('creates anchor graph edges and traverses them from a path', async () => {
    const file = 'src/session.ts';
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(tempDir, file), 'export class SessionStore {}\n');
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const memory = await store.rememberSuper({
      text: 'SessionStore writes are serialized.',
      kind: 'decision',
      anchors: [{ type: 'symbol', path: file, symbol: 'SessionStore' }],
    });

    const edges = await store.graphFor(file);
    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `mem:${memory.id}`, relation: 'about_symbol' }),
    ]));
  });

  it('maps memories through shared file nodes for related-memory retrieval', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Session writes use a FIFO queue.',
      anchors: [{ type: 'file', path: 'src/session.ts' }],
    });
    await store.rememberSuper({
      text: 'Session close waits for pending writes.',
      anchors: [{ type: 'file', path: 'src/session.ts' }],
    });

    const related = await store.findRelated('FIFO queue', 'project-memory', 5);
    expect(related.map((entry) => entry.text)).toContain('Session close waits for pending writes.');
  });

  it('verifies symbols and marks memory stale when an anchored file disappears', async () => {
    const file = path.join(tempDir, 'source.ts');
    await fs.writeFile(file, 'export function usefulSymbol() {}\n');
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const memory = await store.rememberSuper({
      text: 'usefulSymbol is the supported entry point.',
      anchors: [{ type: 'symbol', path: 'source.ts', symbol: 'usefulSymbol' }],
    });

    expect((await store.verify(memory.id))[0]?.status).toBe('verified');
    await fs.rm(file);
    expect((await store.verify(memory.id))[0]?.status).toBe('stale');
    expect((await store.listSuper(['stale']))[0]?.id).toBe(memory.id);
  });

  it('keeps direct-file retrieval distinct from ancestor-directory retrieval', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Storage changes require lifecycle tests.',
      anchors: [{ type: 'directory', path: 'src/storage' }],
    });

    expect(await store.retrieveForPath({
      path: 'src/storage/session.ts',
      includeAncestors: false,
    })).toEqual([]);
    expect(await store.retrieveForPath({
      path: 'src/storage/session.ts',
      includeAncestors: true,
    })).toHaveLength(1);
  });

  it('verifies package directories and rejects anchors outside the project', async () => {
    await fs.mkdir(path.join(tempDir, 'packages', 'demo'), { recursive: true });
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const memory = await store.rememberSuper({
      text: 'The demo package owns this behavior.',
      anchors: [{ type: 'package', path: 'packages/demo' }],
    });

    expect((await store.verify(memory.id))[0]?.status).toBe('verified');
    await expect(store.rememberSuper({
      text: 'Invalid external anchor.',
      anchors: [{ type: 'file', path: '../outside.ts' }],
    })).rejects.toThrow(/inside the project root/i);
  });
});

describe('Super Memory hygiene and consolidation', () => {
  it('deduplicates at write time and preserves merged metadata', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const first = await store.rememberSuper({ text: 'Use pnpm build.', tags: ['pnpm'], importance: 0.7 });
    const second = await store.rememberSuper({ text: 'Use  pnpm   build.', tags: ['build'], importance: 0.9 });

    const report = await store.hygiene({ verify: false });
    expect(second.id).toBe(first.id);
    expect(report.deduplicated).toBe(0);
    const active = await store.listSuper(['active']);
    expect(active).toHaveLength(1);
    expect(active[0]?.tags).toEqual(expect.arrayContaining(['pnpm', 'build']));
    expect(await store.listSuper(['superseded'])).toHaveLength(0);
  });

  it('coordinates concurrent stores and refreshes cross-process-style caches', async () => {
    const firstStore = new SuperMemoryStore({ projectRoot: tempDir });
    const secondStore = new SuperMemoryStore({ projectRoot: tempDir });
    await firstStore.listSuper(); // warm the first instance cache

    const [first, second] = await Promise.all([
      firstStore.rememberSuper({ text: 'One canonical invariant.', tags: ['first'] }),
      secondStore.rememberSuper({ text: 'One canonical invariant!', tags: ['second'] }),
    ]);

    expect(first.id).toBe(second.id);
    const visible = await firstStore.listSuper(['active']);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.tags).toEqual(expect.arrayContaining(['first', 'second']));
  });

  it('does not manufacture relevance for unrelated high-quality memories', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Always use pnpm for workspace builds.',
      importance: 1,
      confidence: 1,
    });

    expect(await store.searchSuper('unrelated database migration')).toEqual([]);
  });

  it('creates session candidates and auto-accepts only high-quality facts', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const result = await store.consolidateSession({
      sessionId: 'session-1',
      facts: [
        { text: 'High value invariant.', confidence: 0.95, importance: 0.95 },
        { text: 'Tentative observation.', confidence: 0.4, importance: 0.4 },
      ],
    });

    expect(result).toMatchObject({ candidates: 2, accepted: 1 });
    expect(await store.listCandidates()).toHaveLength(1);
    expect((await store.searchSuper('High value invariant'))[0]?.text).toBe('High value invariant.');
  });

  it('does not create duplicate pending candidates in one or later consolidations', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    const first = await store.consolidateSession({
      sessionId: 'session-1',
      facts: [
        { text: 'Tentative observation.', confidence: 0.4, importance: 0.4 },
        { text: 'Tentative observation!', confidence: 0.4, importance: 0.4 },
      ],
    });
    const second = await store.consolidateSession({
      sessionId: 'session-2',
      facts: [{ text: 'Tentative observation', confidence: 0.4, importance: 0.4 }],
    });

    expect(first).toMatchObject({ candidates: 1, duplicate: 1 });
    expect(second).toMatchObject({ candidates: 0, duplicate: 1 });
    expect(await store.listCandidates()).toHaveLength(1);
  });

  it('imports legacy markdown without importing duplicates twice', async () => {
    const legacy = path.join(tempDir, 'memory.md');
    await fs.writeFile(legacy, [
      '# Project memory',
      '- [2026-01-01T00:00:00.000Z] [convention|high] Use pnpm for builds. #pnpm',
    ].join('\n'));
    const store = new SuperMemoryStore({ projectRoot: tempDir });

    expect(await store.importLegacy(legacy)).toMatchObject({ imported: 1, skipped: 0, files: 1 });
    expect(await store.importLegacy(legacy)).toMatchObject({ imported: 0, skipped: 1, files: 1 });
  });
});

describe('Super Memory integration surfaces', () => {
  it('injects turn-level memory without mutating the original request', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({ text: 'Always run session lifecycle tests.', importance: 0.95, tags: ['session'] });
    const middleware = createSuperMemoryTurnMiddleware({ memory: store });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Change the session lifecycle.' }],
      system: [{ type: 'text' as const, text: 'Base prompt' }],
    };

    const result = await middleware.handler(request, async (next) => next);
    expect(result.system).toHaveLength(2);
    expect(result.system?.[1]?.text).toContain('Always run session lifecycle tests');
    expect(request.system).toHaveLength(1);
    expect((await store.listSuper(['active']))[0]?.lastAccessedAt).toBeDefined();
  });

  it('does not duplicate memory already present in the base system prompt', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({
      text: 'Always run session lifecycle tests.',
      importance: 0.95,
      tags: ['session'],
    });
    const middleware = createSuperMemoryTurnMiddleware({ memory: store });
    const request = {
      model: 'test',
      messages: [{ role: 'user' as const, content: 'Change the session lifecycle.' }],
      system: [{ type: 'text' as const, text: '# Relevant Memory\n- Always run session lifecycle tests.' }],
    };

    const result = await middleware.handler(request, async (next) => next);
    expect(result.system).toHaveLength(1);
  });

  it('publishes the complete rich memory tool set', () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    expect(createSuperMemoryTools(store).map((tool) => tool.name)).toEqual([
      'memory_for_file',
      'memory_for_path',
      'memory_search',
      'memory_graph',
      'memory_verify',
      'memory_hygiene',
      'memory_candidates',
    ]);
  });

  it('quarantines corrupt JSONL lines in the audit log while replaying valid records', async () => {
    const store = new SuperMemoryStore({ projectRoot: tempDir });
    await store.rememberSuper({ text: 'Valid memory survives corruption.' });
    await fs.appendFile(store.paths.memoriesLog, '{broken-json\n');
    const reloaded = new SuperMemoryStore({ projectRoot: tempDir });

    expect(await reloaded.searchSuper('Valid memory')).toHaveLength(1);
    expect(await reloaded.readAudit()).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'memory.corrupt_line' }),
    ]));
  });
});
