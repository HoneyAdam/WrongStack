import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { childChronicleContext, ChronicleJournal, createChronicleContext } from '../../src/chronicle/index.js';

const tempDirs: string[] = [];

async function makeJournal(): Promise<ChronicleJournal> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wrongstack-chronicle-'));
  tempDirs.push(dir);
  let id = 0;
  return new ChronicleJournal({
    filePath: path.join(dir, 'events.jsonl'),
    now: () => new Date('2026-07-17T20:42:18.381Z'),
    monotonicNow: () => 42n,
    idFactory: () => `event-${++id}`,
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('ChronicleJournal', () => {
  it('persists ordered, hash-chained project events', async () => {
    const journal = await makeJournal();
    const context = createChronicleContext({
      installationId: 'install-1',
      machineId: 'machine-1',
      projectId: 'project-1',
      sessionId: 'session-1',
    }, 'trace-1');

    const first = await journal.append({
      eventType: 'provider.attempt.started',
      ...context,
      outcome: 'started',
      runtime: { providerId: 'openai', modelId: 'model-a' },
    });
    const second = await journal.append({
      eventType: 'file.read.completed',
      ...childChronicleContext(context, { correlation: { toolCallId: 'tool-1' } }),
      outcome: 'success',
      resource: { kind: 'file', id: 'file-1', path: 'src/auth.ts', lineStart: 40, lineEnd: 120 },
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(second.scope.projectId).toBe('project-1');
    expect(second.correlation.parentSpanId).toBe(context.correlation.spanId);
    await expect(journal.verify()).resolves.toMatchObject({ ok: true, entries: 2, lastSequence: 2 });
  });

  it('serializes concurrent appends without losing sequence numbers', async () => {
    const journal = await makeJournal();
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => journal.append({
        eventType: 'tool.progress',
        ...context,
        attributes: { index },
      })),
    );
    const entries = await journal.readAll();
    expect(entries.map((entry) => entry.sequence)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    expect(journal.stats()).toMatchObject({
      acceptedEvents: 12,
      persistedEvents: 12,
      batches: 1,
      largestBatch: 12,
      pendingEvents: 0,
    });
    await expect(journal.verify()).resolves.toMatchObject({ ok: true, entries: 12 });
  });

  it('applies bounded backpressure without blocking the caller thread', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wrongstack-chronicle-pressure-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl'), maxPending: 2, batchWindowMs: 25 });
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    const first = journal.append({ eventType: 'one', ...context });
    const second = journal.append({ eventType: 'two', ...context });
    await expect(journal.append({ eventType: 'three', ...context })).rejects.toThrow('backpressure limit');
    await Promise.all([first, second]);
    expect(journal.stats()).toMatchObject({ acceptedEvents: 2, persistedEvents: 2, rejectedEvents: 1 });
  });

  it('detects post-hoc payload tampering', async () => {
    const journal = await makeJournal();
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    await journal.append({ eventType: 'tool.completed', ...context, attributes: { output: 'safe' } });

    const raw = await readFile(journal.path, 'utf8');
    await writeFile(journal.path, raw.replace('safe', 'tampered'), 'utf8');

    await expect(journal.verify()).resolves.toMatchObject({ ok: false, brokenAt: 0, reason: 'entry hash mismatch' });
  });
});
