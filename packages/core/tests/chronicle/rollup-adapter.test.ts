import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleJournal, createChronicleContext, wireRollupsToChronicle } from '../../src/chronicle/index.js';
import { EventBus } from '../../src/kernel/events.js';
const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('Chronicle rollups', () => {
  it('turns process chunks and gauges into bounded aggregates and discards raw samples', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-rollup-')); dirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl') });
    const events = new EventBus(); const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    const off = wireRollupsToChronicle({ events, journal, context, windowMs: 60_000 });
    for (const [bytes, hash] of [[10, 'a'], [30, 'b'], [20, 'c']] as const) events.emit('process.output', {
      sessionId: 's', toolCallId: 'tc', toolName: 'bash', parentPid: 1, stream: 'stdout', bytes, chunkHash: hash, at: new Date().toISOString(),
    } as never);
    events.emit('process.completed', { sessionId: 's', toolCallId: 'tc', toolName: 'bash', parentPid: 1, exitCode: 0, durationMs: 10, stdoutBytes: 60, stderrBytes: 0, timedOut: false, endedAt: new Date().toISOString() } as never);
    events.emit('ctx.pct', { sessionId: 's', load: 0.2, tokens: 20, maxContext: 100 });
    events.emit('ctx.pct', { sessionId: 's', load: 0.8, tokens: 80, maxContext: 100 });
    off();
    const recorded = await journal.readAll();
    expect(recorded).toHaveLength(2);
    expect(recorded.every((event) => event.eventType === 'metrics.rollup')).toBe(true);
    expect(recorded[0]).toMatchObject({ attributes: { signal: 'process.output', samples: 3, stats: { bytes: { sum: 60, min: 10, max: 30, avg: 20 } }, rawEventsRetained: false } });
    expect(recorded[1]).toMatchObject({ attributes: { signal: 'ctx.pct', samples: 2, stats: { load: { min: 0.2, max: 0.8, avg: 0.5 }, tokens: { sum: 100, last: 80 } } } });
  });
});
