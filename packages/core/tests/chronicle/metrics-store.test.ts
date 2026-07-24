import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChronicleJournal,
  ChronicleMetricsStore,
  isChronicleMetricsAvailable,
} from '../../src/chronicle/index.js';
import type { ChronicleEventInput } from '../../src/chronicle/types.js';

const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);

const scope = { installationId: 'i', machineId: 'm', projectId: 'p', sessionId: 'sess-1' };
const correlation = { traceId: 't', spanId: 'sp' };

function input(
  partial: Partial<ChronicleEventInput> & Pick<ChronicleEventInput, 'eventType'>,
): ChronicleEventInput {
  return { scope, correlation, occurredAt: '2026-07-24T10:00:00.000Z', ...partial };
}

describe.skipIf(!isChronicleMetricsAvailable())('ChronicleMetricsStore', () => {
  it('ingests provider, task, file, and cost aggregates incrementally and idempotently', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-metrics-'));
    dirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, '2026-07-24.events.jsonl') });
    const runtime = { providerId: 'openai', modelId: 'model-a' };
    await Promise.all([
      journal.append(input({ eventType: 'provider.attempt.started', runtime, outcome: 'started' })),
      journal.append(
        input({
          eventType: 'provider.attempt.failed',
          runtime,
          outcome: 'failure',
          durationNs: '1000000000',
          attributes: { retryScheduled: true },
        }),
      ),
      journal.append(input({ eventType: 'provider.attempt.started', runtime, outcome: 'started' })),
      journal.append(
        input({
          eventType: 'provider.attempt.completed',
          runtime,
          outcome: 'success',
          durationNs: '2000000000',
          attributes: { usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 3 } },
        }),
      ),
      journal.append(
        input({ eventType: 'token.accounted', attributes: { cost: { total: 0.25 } } }),
      ),
      journal.append(
        input({
          eventType: 'token.accounted',
          occurredAt: '2026-07-24T11:00:00.000Z',
          attributes: { cost: { total: 0.75 } },
        }),
      ),
      journal.append(
        input({
          eventType: 'sdd.task.started',
          scope: { ...scope, taskId: 'task-1', agentId: 'worker-1' },
          attributes: { runId: 'run-1' },
        }),
      ),
      journal.append(
        input({
          eventType: 'sdd.task.completed',
          occurredAt: '2026-07-24T10:05:00.000Z',
          scope: { ...scope, taskId: 'task-1' },
          attributes: { runId: 'run-1', durationMs: 300000 },
        }),
      ),
      journal.append(
        input({
          eventType: 'file.event',
          scope: { ...scope, taskId: 'task-1', kanbanBoardId: 'board-1', agentId: 'worker-1' },
          resource: { kind: 'file', id: 'path:src/app.ts', path: 'src/app.ts' },
          attributes: {
            operation: 'update',
            toolName: 'edit',
            provider: 'openai',
            model: 'model-a',
            runId: 'run-1',
            source: 'tool',
          },
        }),
      ),
      journal.append(
        input({
          eventType: 'file.event',
          scope: { ...scope, taskId: 'task-1' },
          resource: { kind: 'file', id: 'path:src/app.ts', path: 'src/app.ts' },
          attributes: { operation: 'read', toolName: 'read' },
        }),
      ),
    ]);
    await journal.flush();

    const store = ChronicleMetricsStore.open(dir);
    try {
      const first = await store.refresh();
      expect(first.ingestedEvents).toBe(10);
      expect(first.invalidLines).toBe(0);

      const providers = store.providerDaily();
      expect(providers).toHaveLength(1);
      expect(providers[0]).toMatchObject({
        day: '2026-07-24',
        providerId: 'openai',
        modelId: 'model-a',
        attempts: 2,
        completed: 1,
        failed: 1,
        retries: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        avgDurationMs: 1500,
        maxDurationMs: 2000,
      });

      const tasks = store.taskOutcomes();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        taskId: 'task-1',
        runId: 'run-1',
        sessionId: 'sess-1',
        agentId: 'worker-1',
        status: 'completed',
        durationMs: 300000,
        filesTouched: 1,
      });

      // Reads are excluded from lineage; the mutation carries full attribution.
      // Path lookup is case-normalized (Windows), yet display path is original.
      const lineage = store.fileLineage({ path: 'SRC/App.ts' });
      expect(lineage).toHaveLength(1);
      expect(lineage[0]).toMatchObject({
        path: 'src/app.ts',
        operation: 'update',
        sessionId: 'sess-1',
        agentId: 'worker-1',
        taskId: 'task-1',
        boardId: 'board-1',
        runId: 'run-1',
        toolName: 'edit',
        providerId: 'openai',
        modelId: 'model-a',
        source: 'tool',
      });

      // token.accounted is cumulative — latest snapshot per scope wins.
      expect(store.summary()).toMatchObject({
        providers: { attempts: 2, completed: 1, failed: 1, successRate: 0.5 },
        tasks: { completed: 1 },
        files: { mutations: 1, uniquePaths: 1 },
        estimatedCostUsd: 0.75,
      });

      // Idempotent: nothing new on disk means nothing re-ingested.
      const second = await store.refresh();
      expect(second.ingestedEvents).toBe(0);
      expect(store.summary().providers.attempts).toBe(2);

      // Incremental: appended events are picked up from the stored offset.
      await journal.append(
        input({ eventType: 'provider.attempt.started', runtime, outcome: 'started' }),
      );
      await journal.flush();
      const third = await store.refresh();
      expect(third.ingestedEvents).toBe(1);
      expect(store.summary().providers.attempts).toBe(3);
    } finally {
      store.close();
    }
  });

  it('attributes fallbacks to the from-provider and never manufactures a blank provider row', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-metrics-fb-'));
    dirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, '2026-07-24.events.jsonl') });
    await Promise.all([
      journal.append(
        input({
          eventType: 'provider.attempt.started',
          runtime: { providerId: 'openai', modelId: 'gpt' },
          outcome: 'started',
        }),
      ),
      // provider.fallback carries identity only under attributes.from — the
      // domain adapter leaves runtime empty for it.
      journal.append(
        input({
          eventType: 'provider.fallback',
          outcome: 'success',
          attributes: { from: { providerId: 'openai', model: 'gpt' }, to: { providerId: 'anthropic', model: 'claude' }, status: 529 },
        }),
      ),
      // An identity-less provider event must not create a ('', '') row.
      journal.append(input({ eventType: 'provider.fallback', outcome: 'success', attributes: { status: 500 } })),
    ]);
    await journal.flush();

    const store = ChronicleMetricsStore.open(dir);
    try {
      await store.refresh();
      const rows = store.providerDaily();
      // Only the openai/gpt row exists — no blank-identity phantom.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ providerId: 'openai', modelId: 'gpt', attempts: 1, fallbacks: 1 });
      expect(rows.some((row) => row.providerId === '' && row.modelId === '')).toBe(false);
    } finally {
      store.close();
    }
  });

  it('survives reopening and rotated partitions', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-metrics-rot-'));
    dirs.push(dir);
    const journal = new ChronicleJournal({
      filePath: path.join(dir, '2026-07-24.events.jsonl'),
      maxPartitionSizeBytes: 512,
      rotationWindowMs: Number.POSITIVE_INFINITY,
    });
    for (let index = 0; index < 8; index++) {
      await journal.append(
        input({
          eventType: 'provider.attempt.started',
          runtime: { providerId: 'p', modelId: 'm' },
          outcome: 'started',
        }),
      );
      await journal.flush();
    }
    const store = ChronicleMetricsStore.open(dir);
    const first = await store.refresh();
    expect(first.ingestedEvents).toBe(8);
    expect(first.sourceFiles).toBeGreaterThan(1);
    store.close();

    const reopened = ChronicleMetricsStore.open(dir);
    try {
      const again = await reopened.refresh();
      expect(again.ingestedEvents).toBe(0);
      expect(reopened.providerDaily()[0]?.attempts).toBe(8);
    } finally {
      reopened.close();
    }
  });
});
