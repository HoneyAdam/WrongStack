import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HqEventLog,
  HqSnapshotStore,
  HqTimeseriesStore,
  createHqPersistence,
} from '../../src/hq/persistence.js';
import type { HqEventEnvelope, HqSnapshot } from '../../src/hq/protocol.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-persist-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function makeEvent(seq: number, type = 'session.usage'): HqEventEnvelope {
  return {
    id: `evt-${seq}`,
    type,
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    clientId: 'c1',
    projectId: 'p1',
    seq,
    payload: { costUsd: 0.01 * seq },
  };
}

describe('HqEventLog', () => {
  it('appends events and reads them back newest-first', async () => {
    const log = new HqEventLog({ dataDir });
    log.append(makeEvent(1));
    log.append(makeEvent(2));
    log.append(makeEvent(3));
    await log.drain();
    const recent = await log.recent(10);
    expect(recent).toHaveLength(3);
    expect(recent[0]!.seq).toBe(3); // newest first
    expect(recent[2]!.seq).toBe(1);
  });

  it('filters by event type', async () => {
    const log = new HqEventLog({ dataDir });
    log.append(makeEvent(1, 'session.usage'));
    log.append(makeEvent(2, 'brain.event'));
    log.append(makeEvent(3, 'session.usage'));
    await log.drain();
    const usage = await log.recent(10, 'session.usage');
    expect(usage).toHaveLength(2);
    expect(usage.every((e) => e.type === 'session.usage')).toBe(true);
  });

  it('rotates when exceeding maxLines', async () => {
    const log = new HqEventLog({ dataDir, maxLines: 5, rotateKeep: 2 });
    // Append exactly maxLines events — rotation fires on the last append.
    for (let i = 1; i <= 5; i++) log.append(makeEvent(i));
    await log.drain();
    const recent = await log.recent(10);
    // After rotation only the last rotateKeep (2) are retained.
    expect(recent.length).toBeLessThanOrEqual(2);
    expect(recent[0]!.seq).toBe(5);
  });

  it('hydrate seeds the line count from disk', async () => {
    const log = new HqEventLog({ dataDir });
    log.append(makeEvent(1));
    log.append(makeEvent(2));
    await log.drain();
    const log2 = new HqEventLog({ dataDir });
    await log2.hydrate();
    const recent = await log2.recent(10);
    expect(recent).toHaveLength(2);
  });

  it('never rejects — a failed append resolves the chain', async () => {
    // Point at a path inside a file (not a dir) to force append failure.
    const blocker = path.join(dataDir, 'blocker');
    await fs.writeFile(blocker, 'x');
    const log = new HqEventLog({ dataDir: blocker });
    log.append(makeEvent(1));
    log.append(makeEvent(2)); // must not throw synchronously
    await log.drain();
  });
});

describe('HqSnapshotStore', () => {
  it('saves and loads a snapshot', async () => {
    const store = new HqSnapshotStore({ dataDir });
    const snap = {
      generatedAt: '2026-07-02T00:00:00Z',
      clients: [],
      projects: [],
      sessions: [],
      fleets: [],
      mailboxes: [],
      totals: { activeProjects: 0, activeClients: 0, activeSessions: 0, activeSubagents: 0, unreadMailboxMessages: 0, incompleteMailboxMessages: 0, totalCostUsd: 0 },
    } as HqSnapshot;
    store.save(snap);
    await store.drain();
    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.generatedAt).toBe('2026-07-02T00:00:00Z');
  });

  it('load returns null when no snapshot exists', async () => {
    const store = new HqSnapshotStore({ dataDir });
    expect(await store.load()).toBeNull();
  });
});

describe('HqTimeseriesStore', () => {
  it('records signals into time buckets', async () => {
    const store = new HqTimeseriesStore({ dataDir, bucketMs: 1000 });
    const now = 10_000;
    store.record({ ts: now, costUsd: 0.01, inputTokens: 100 });
    store.record({ ts: now + 100, costUsd: 0.02, outputTokens: 50 });
    store.record({ ts: now + 2000, costUsd: 0.05, toolCalls: 3 });
    const samples = await store.read();
    expect(samples).toHaveLength(2); // two distinct buckets
    const first = samples.find((s) => s.ts === Math.floor(now / 1000) * 1000);
    expect(first!.costUsd).toBeCloseTo(0.03, 5);
    expect(first!.inputTokens).toBe(100);
    expect(first!.outputTokens).toBe(50);
    const second = samples.find((s) => s.ts === Math.floor((now + 2000) / 1000) * 1000);
    expect(second!.toolCalls).toBe(3);
  });

  it('flush persists and load rehydrates', async () => {
    const store = new HqTimeseriesStore({ dataDir, bucketMs: 1000 });
    store.record({ ts: 10_000, costUsd: 0.5 });
    store.record({ ts: 11_000, costUsd: 0.3 });
    store.flush();
    await store.drain();
    const store2 = new HqTimeseriesStore({ dataDir, bucketMs: 1000 });
    await store2.load();
    const samples = await store2.read();
    expect(samples.length).toBeGreaterThanOrEqual(2);
  });

  it('prunes to maxBuckets on record', async () => {
    const store = new HqTimeseriesStore({ dataDir, bucketMs: 1, maxBuckets: 3 });
    for (let i = 0; i < 10; i++) store.record({ ts: i * 10, costUsd: 0.01 });
    // record() prunes in-memory as it goes, so the map never exceeds maxBuckets.
    expect((store as unknown as { buckets: Map<number, unknown> }).buckets.size).toBeLessThanOrEqual(3);
  });
});

describe('createHqPersistence facade', () => {
  it('wires all three stores to the same dataDir', () => {
    const p = createHqPersistence(dataDir);
    expect(p.eventLog).toBeInstanceOf(HqEventLog);
    expect(p.snapshotStore).toBeInstanceOf(HqSnapshotStore);
    expect(p.timeseries).toBeInstanceOf(HqTimeseriesStore);
  });
});
