import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  appendFile: vi.fn(),
  open: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  io.appendFile.mockImplementation(actual.appendFile);
  io.open.mockImplementation(actual.open);
  io.readFile.mockImplementation(actual.readFile);
  io.writeFile.mockImplementation(actual.writeFile);
  return {
    ...actual,
    appendFile: io.appendFile,
    open: io.open,
    readFile: io.readFile,
    writeFile: io.writeFile,
  };
});

import {
  HqEventLog,
  HqSimpleLog,
  HqSnapshotStore,
  HqTimeseriesStore,
} from '../../src/hq/persistence.js';
import type { HqEventEnvelope, HqSnapshot } from '../../src/hq/protocol.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-persist-io-'));
  io.appendFile.mockClear();
  io.open.mockClear();
  io.readFile.mockClear();
  io.writeFile.mockClear();
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

function event(sequence: number): HqEventEnvelope {
  return {
    id: `event-${sequence}`,
    type: 'session.usage',
    schemaVersion: 1,
    timestamp: '2026-07-21T00:00:00.000Z',
    clientId: 'client',
    projectId: 'project',
    seq: sequence,
    payload: { sequence },
  };
}

function snapshot(sequence: number): HqSnapshot {
  return {
    generatedAt: String(sequence),
    clients: [],
    projects: [],
    sessions: [],
    fleets: [],
    mailboxes: [],
    totals: {
      activeProjects: 0,
      activeClients: 0,
      activeSessions: 0,
      activeSubagents: 0,
      unreadMailboxMessages: 0,
      incompleteMailboxMessages: 0,
      totalCostUsd: sequence,
    },
  } as HqSnapshot;
}

describe('HQ persistence I/O batching', () => {
  it('uses one append per synchronous event or audit burst', async () => {
    const events = new HqEventLog({ dataDir });
    const audit = new HqSimpleLog<{ sequence: number }>({ dataDir, filename: 'audit.jsonl' });
    for (let sequence = 0; sequence < 100; sequence++) {
      events.append(event(sequence));
      audit.append({ sequence });
    }

    await Promise.all([events.drain(), audit.drain()]);

    expect(
      io.appendFile.mock.calls.filter(([file]) => String(file).endsWith('events.jsonl')),
    ).toHaveLength(1);
    expect(
      io.appendFile.mock.calls.filter(([file]) => String(file).endsWith('audit.jsonl')),
    ).toHaveLength(1);
    io.readFile.mockClear();
    await expect(events.recent(200)).resolves.toHaveLength(100);
    await expect(audit.readAll()).resolves.toHaveLength(100);
    expect(
      io.readFile.mock.calls.filter(([file]) => String(file).endsWith('events.jsonl')),
    ).toHaveLength(0);
  });

  it('writes only the latest synchronous snapshot and timeseries checkpoint', async () => {
    const snapshots = new HqSnapshotStore({ dataDir });
    const timeseries = new HqTimeseriesStore({ dataDir, bucketMs: 1_000 });
    timeseries.record({ ts: 10_000, costUsd: 1 });
    for (let sequence = 0; sequence < 100; sequence++) {
      snapshots.save(snapshot(sequence));
      timeseries.flush();
    }

    await Promise.all([snapshots.drain(), timeseries.drain()]);

    const snapshotWrites = io.writeFile.mock.calls.filter(([file]) =>
      String(file).includes('.snapshot.json.'),
    );
    expect(snapshotWrites).toHaveLength(1);
    expect(
      io.appendFile.mock.calls.filter(([file]) => String(file).endsWith('timeseries.jsonl')),
    ).toHaveLength(1);
    await expect(snapshots.load()).resolves.toMatchObject({ generatedAt: '99' });
    const timeseriesLines = (await fs.readFile(path.join(dataDir, 'timeseries.jsonl'), 'utf8'))
      .trim()
      .split('\n');
    expect(timeseriesLines).toHaveLength(1);
  });

  it('shares one line-count scan between concurrent hydrate and append', async () => {
    const seed = new HqEventLog({ dataDir });
    for (let sequence = 0; sequence < 100; sequence++) seed.append(event(sequence));
    await seed.drain();

    const reloaded = new HqEventLog({ dataDir });
    io.open.mockClear();
    const hydration = reloaded.hydrate();
    reloaded.append(event(100));
    await Promise.all([hydration, reloaded.drain()]);

    expect(
      io.open.mock.calls.filter(
        ([file, flag]) => String(file).endsWith('events.jsonl') && flag === 'r',
      ),
    ).toHaveLength(1);
  });

  it('rotates from tail blocks without a full-file read', async () => {
    const log = new HqEventLog({ dataDir, maxLines: 100, rotateKeep: 10 });
    await log.hydrate();
    io.readFile.mockClear();
    for (let sequence = 0; sequence < 100; sequence++) log.append(event(sequence));
    await log.drain();

    expect(
      io.readFile.mock.calls.filter(([file]) => String(file).endsWith('events.jsonl')),
    ).toHaveLength(0);
    expect((await log.recent(100)).map((entry) => entry.seq)).toEqual([
      99, 98, 97, 96, 95, 94, 93, 92, 91, 90,
    ]);
  });

  it('bounds simple logs and seeds them through a tail read', async () => {
    const audit = new HqSimpleLog<{ sequence: number }>({
      dataDir,
      filename: 'bounded-audit.jsonl',
      maxLines: 100,
      rotateKeep: 10,
      readLimit: 10,
    });
    for (let sequence = 0; sequence < 100; sequence++) audit.append({ sequence });
    await audit.drain();
    io.readFile.mockClear();

    expect((await audit.readAll()).map((entry) => entry.sequence)).toEqual([
      90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
    ]);
    expect(
      io.readFile.mock.calls.filter(([file]) => String(file).endsWith('bounded-audit.jsonl')),
    ).toHaveLength(0);
  });

  it('counts lines correctly when the file ends with a newline (no trailing empty)', async () => {
    // Regression for countLines() overcount when the last byte is `\n`.
    // Hand-craft the file with 3 well-formed lines plus a trailing newline
    // so the JSONL ends in `\n`. The hydration scan must report 3, not 4.
    const filePath = path.join(dataDir, 'events.jsonl');
    const lines: string[] = [];
    for (let sequence = 0; sequence < 3; sequence++) lines.push(JSON.stringify(event(sequence)));
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const log = new HqEventLog({ dataDir, maxLines: 5, rotateKeep: 2 });
    await log.hydrate();

    // With maxLines=5 and 3 lines on disk, an append to 4 must NOT trigger a
    // rotation. Pre-fix, countLines returned 4 and the rotation check at
    // `lineCount >= maxLines` was off by one.
    log.append(event(3));
    await log.drain();
    const after = (await fs.readFile(filePath, 'utf8')).trim().split('\n');
    expect(after).toHaveLength(4);
  });

  it('counts lines correctly when the file lacks a trailing newline', async () => {
    // Regression for countLines() undercount when the file does NOT end in
    // `\n`. The hydration scan must still report the unterminated line.
    const filePath = path.join(dataDir, 'events.jsonl');
    const lines: string[] = [];
    for (let sequence = 0; sequence < 3; sequence++) lines.push(JSON.stringify(event(sequence)));
    await fs.writeFile(filePath, lines.join('\n'), 'utf8'); // no trailing \n

    const log = new HqEventLog({ dataDir });
    await log.hydrate();
    // 3 lines, even without a trailing newline.
    expect((await log.recent(10)).map((entry) => entry.seq)).toEqual([2, 1, 0]);
  });
});
