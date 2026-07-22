import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MemoryPort, MemoryStore } from '@wrongstack/core/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSuperMemoryRetrieval,
  getSuperMemoryService,
  getSuperMemorySurface,
  JsonlMemoryPort,
  LegacyMemoryPortAdapter,
  SqliteMemoryPort,
} from '../src/memory-port.js';
import { isSqliteAvailable } from '../src/sqlite-store.js';

function legacyStore(): MemoryStore {
  let entries: Array<{ scope: 'project-memory'; text: string; ts: string }> = [];
  const store: MemoryStore = {
    async readAll() {
      return entries.map((entry) => entry.text).join('\n');
    },
    async read(scope) {
      return entries
        .filter((entry) => entry.scope === scope)
        .map((entry) => entry.text)
        .join('\n');
    },
    async remember(text) {
      entries.push({ scope: 'project-memory', text, ts: new Date().toISOString() });
    },
    async forget(query) {
      const before = entries.length;
      entries = entries.filter((entry) => !entry.text.includes(query));
      return before - entries.length;
    },
    async consolidate() {},
    async clear() {
      entries = [];
    },
    async list() {
      return [...entries];
    },
    async search(query) {
      return entries.filter((entry) => entry.text.includes(query));
    },
    withTraceId() {
      return store;
    },
  };
  return store;
}

describe('MemoryPort conformance', () => {
  let tempDir: string;
  let ports: MemoryPort[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wrongstack-memory-port-'));
    ports = [
      new JsonlMemoryPort({ projectRoot: path.join(tempDir, 'jsonl') }),
      new LegacyMemoryPortAdapter(legacyStore()),
    ];
    if (isSqliteAvailable()) {
      ports.push(new SqliteMemoryPort({ projectRoot: path.join(tempDir, 'sqlite') }));
    }
  });

  afterEach(async () => {
    await Promise.all(ports.map((port) => port.dispose()));
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('runs the same basic lifecycle and query behavior against every adapter', async () => {
    for (const port of ports) {
      await port.initialize();
      expect((await port.health()).status).toBe('ready');
      await port.remember('MemoryPort conformance marker', 'project-memory');
      expect(
        (await port.search('conformance', 'project-memory')).map((entry) => entry.text),
      ).toContain('MemoryPort conformance marker');
      expect(await port.forget('conformance', 'project-memory')).toBe(1);
      expect(await port.search('conformance', 'project-memory')).toEqual([]);
    }
  });

  it('exposes optional behavior only through a typed capability', () => {
    expect(getSuperMemoryService(ports[0]!)).toBe(ports[0]);
    expect(getSuperMemorySurface(ports[0]!)).toBe(ports[0]);
    expect(getSuperMemoryRetrieval(ports[0]!)).toBe(ports[0]);
    expect(getSuperMemoryService(ports[1]!)).toBeUndefined();
    expect(getSuperMemorySurface(ports[1]!)).toBeUndefined();
    expect(getSuperMemoryRetrieval(ports[1]!)).toBeUndefined();
    if (ports[2]) expect(getSuperMemoryService(ports[2])).toBeUndefined();
  });

  it('normalizes canonical path retrieval for every Super Memory backend', async () => {
    for (const port of ports.filter((candidate) => getSuperMemorySurface(candidate))) {
      const surface = getSuperMemorySurface(port)!;
      const retrieval = getSuperMemoryRetrieval(port)!;
      const created = await surface.rememberSuper({
        text: 'Path retrieval contract marker',
        anchors: [{ type: 'file', path: 'src/memory-port.ts' }],
      });

      const matches = await retrieval.retrieveForPath({
        path: 'src/memory-port.ts',
        includeAncestors: true,
      });
      expect(matches.map((memory) => memory.id)).toContain(created.id);
    }
  });
});
