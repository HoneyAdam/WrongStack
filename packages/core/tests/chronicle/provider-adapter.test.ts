import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChronicleJournal,
  createChronicleContext,
  wireProviderAttemptsToChronicle,
} from '../../src/chronicle/index.js';
import { EventBus } from '../../src/kernel/events.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('wireProviderAttemptsToChronicle', () => {
  it('persists one correlated timeline across failed and successful attempts', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-provider-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl') });
    const events = new EventBus();
    const context = createChronicleContext({
      installationId: 'install',
      machineId: 'machine',
      projectId: 'project',
      sessionId: 'session',
    }, 'trace');
    const unsubscribe = wireProviderAttemptsToChronicle({ events, journal, context });

    events.emit('provider.attempt.started', {
      sessionId: 'session',
      agentId: 'leader',
      logicalRequestId: 'request-1',
      attemptId: 'attempt-1',
      attempt: 0,
      providerId: 'openai',
      model: 'model-a',
      streaming: true,
      messageCount: 4,
      toolCount: 12,
      startedAt: '2026-07-18T00:00:00.000Z',
    });
    events.emit('provider.attempt.failed', {
      sessionId: 'session',
      agentId: 'leader',
      logicalRequestId: 'request-1',
      attemptId: 'attempt-1',
      attempt: 0,
      providerId: 'openai',
      model: 'model-a',
      startedAt: '2026-07-18T00:00:00.000Z',
      endedAt: '2026-07-18T00:00:01.000Z',
      durationMs: 1000,
      status: 429,
      failureKind: 'rate_limit',
      description: 'rate limited',
      retryable: true,
      retryScheduled: true,
      retryDelayMs: 2000,
    });
    events.emit('provider.attempt.completed', {
      sessionId: 'session',
      agentId: 'leader',
      logicalRequestId: 'request-1',
      attemptId: 'attempt-2',
      attempt: 1,
      providerId: 'openai',
      model: 'model-a',
      startedAt: '2026-07-18T00:00:03.000Z',
      endedAt: '2026-07-18T00:00:04.500Z',
      durationMs: 1500,
      stopReason: 'end_turn',
      usage: { input: 100, output: 20 },
    });

    // EventBus persistence is intentionally non-blocking; readAll waits for
    // the journal's serialized append tail.
    const recorded = await journal.readAll();
    unsubscribe();

    expect(recorded.map((event) => event.eventType)).toEqual([
      'provider.attempt.started',
      'provider.attempt.failed',
      'provider.attempt.completed',
    ]);
    expect(recorded.every((event) => event.correlation.logicalRequestId === 'request-1')).toBe(true);
    expect(recorded[1]?.attributes).toMatchObject({ failureKind: 'rate_limit', retryDelayMs: 2000 });
    expect(recorded[2]?.durationNs).toBe('1500000000');
    expect(recorded[2]?.runtime).toEqual({ providerId: 'openai', modelId: 'model-a' });
    await expect(journal.verify()).resolves.toMatchObject({ ok: true, entries: 3 });
  });
});
