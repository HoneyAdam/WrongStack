import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleJournal, ChronicleQueryEngine, createChronicleContext } from '../../src/chronicle/index.js';

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('ChronicleQueryEngine', () => {
  it('queries partitions by causal, runtime, resource and nested attribute fields', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-query-'));
    tempDirs.push(dir);
    const partition = path.join(dir, 'chronicle', '2026-07-18.events.jsonl');
    const journal = new ChronicleJournal({ filePath: partition });
    const context = createChronicleContext({ installationId: 'i', machineId: 'm', projectId: 'p', sessionId: 's' }, 'trace');
    await journal.append({ eventType: 'tool.executed', scope: context.scope,
      correlation: { ...context.correlation, toolCallId: 'tc-1' }, runtime: { providerId: 'openai', modelId: 'gpt-x' },
      resource: { kind: 'file', id: 'file:a', path: 'src/a.ts', lineStart: 10, lineEnd: 20 },
      outcome: 'success', occurredAt: '2026-07-18T10:00:00.000Z', attributes: { tool: { name: 'read' } } });
    await journal.append({ eventType: 'provider.attempt.failed', scope: context.scope,
      correlation: { ...context.correlation, attemptId: 'a-1' }, runtime: { providerId: 'openai', modelId: 'gpt-x' },
      outcome: 'failure', occurredAt: '2026-07-18T10:01:00.000Z' });
    await mkdir(path.join(dir, 'bad'), { recursive: true });
    await writeFile(path.join(dir, 'bad', '2026-07-17.events.jsonl'), '{bad}\n', 'utf8');

    const engine = await ChronicleQueryEngine.fromDirectory(dir);
    const result = engine.query({ path: 'SRC\\A.TS', line: 15, attributes: { 'tool.name': 'read' } });

    expect(result.events.map((event) => event.eventType)).toEqual(['tool.executed']);
    expect(result).toMatchObject({ total: 1, scannedEvents: 2, sourceFiles: 2, invalidLines: 1 });
    expect(engine.facet('eventType')).toEqual([
      { value: 'provider.attempt.failed', count: 1 },
      { value: 'tool.executed', count: 1 },
    ]);
  });

  it('supports deterministic order and cursor pagination', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-page-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, '2026-07-18.events.jsonl') });
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    for (let index = 0; index < 3; index++) await journal.append({ eventType: `e${index}`, scope: context.scope,
      correlation: context.correlation, occurredAt: `2026-07-18T10:0${index}:00.000Z` });
    const engine = await ChronicleQueryEngine.fromDirectory(dir);
    const first = engine.query({ order: 'asc', limit: 2 });
    const second = engine.query({ order: 'asc', limit: 2, cursor: first.nextCursor });
    expect(first.events.map((event) => event.eventType)).toEqual(['e0', 'e1']);
    expect(second.events.map((event) => event.eventType)).toEqual(['e2']);
  });

  it('derives operation metrics from all matches without double-counting retries or cumulative cost snapshots', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-summary-')); tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.events.jsonl') });
    const context = createChronicleContext({ installationId: 'i', machineId: 'm', projectId: 'p', sessionId: 's' }, 'trace');
    const base = { scope: context.scope, occurredAt: '2026-07-18T10:00:00.000Z' };
    await journal.append({ ...base, eventType: 'provider.attempt.started', correlation: { ...context.correlation, logicalRequestId: 'r1', attemptId: 'a1' }, runtime: { providerId: 'p1', modelId: 'm1' } });
    await journal.append({ ...base, eventType: 'provider.attempt.failed', outcome: 'failure', durationNs: '100000000', correlation: { ...context.correlation, logicalRequestId: 'r1', attemptId: 'a1' }, runtime: { providerId: 'p1', modelId: 'm1' }, attributes: { retryScheduled: true } });
    await journal.append({ ...base, eventType: 'provider.attempt.started', correlation: { ...context.correlation, logicalRequestId: 'r1', attemptId: 'a2' }, runtime: { providerId: 'p1', modelId: 'm1' } });
    await journal.append({ ...base, eventType: 'provider.attempt.completed', outcome: 'success', durationNs: '300000000', correlation: { ...context.correlation, logicalRequestId: 'r1', attemptId: 'a2' }, runtime: { providerId: 'p1', modelId: 'm1' }, attributes: { usage: { input: 100, output: 20, cacheRead: 50 } } });
    await journal.append({ ...base, eventType: 'token.accounted', correlation: context.correlation, attributes: { cost: { total: 0.01 } } });
    await journal.append({ ...base, eventType: 'token.accounted', correlation: context.correlation, occurredAt: '2026-07-18T10:01:00.000Z', attributes: { cost: { total: 0.02 } } });
    await journal.append({ ...base, eventType: 'tool.failed', outcome: 'failure', correlation: { ...context.correlation, toolCallId: 't1' } });
    await journal.append({ ...base, eventType: 'tool.executed', outcome: 'failure', correlation: { ...context.correlation, toolCallId: 't1' } });
    const result = (await ChronicleQueryEngine.fromDirectory(dir)).query({ limit: 1 });
    expect(result.events).toHaveLength(1);
    expect(result.summary).toMatchObject({ logicalRequests: 1, modelAttempts: 2, completedAttempts: 1,
      failedAttempts: 1, scheduledRetries: 1, inputTokens: 100, outputTokens: 20,
      cacheReadTokens: 50, estimatedCostUsd: 0.02, failedTools: 1, failures: 1,
      providerAvgDurationMs: 200, providerP95DurationMs: 300 });
  });

  it('builds typed causal edges without using timestamp proximity', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-graph-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, '2026-07-18.events.jsonl') });
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace-a');
    await journal.append({ eventType: 'decision.requested', scope: context.scope, correlation: context.correlation,
      attributes: { decisionId: 'decision-1' }, occurredAt: '2026-07-18T10:00:00.000Z' });
    await journal.append({ eventType: 'tool.executed', scope: context.scope,
      correlation: { ...context.correlation, toolCallId: 'tool-1' }, attributes: { decisionId: 'decision-1' },
      resource: { kind: 'file', id: 'file:a', path: 'a.ts' }, occurredAt: '2026-07-18T10:00:01.000Z' });
    await journal.append({ eventType: 'file.edited', scope: context.scope,
      correlation: { ...context.correlation, toolCallId: 'tool-1' }, resource: { kind: 'file', id: 'file:a', path: 'a.ts' },
      occurredAt: '2026-07-18T10:00:02.000Z' });
    const engine = await ChronicleQueryEngine.fromDirectory(dir);
    const graph = engine.graph({ eventTypes: ['decision.requested'] });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'decision', confidence: 'explicit' }),
      expect.objectContaining({ kind: 'tool_call', confidence: 'explicit' }),
      expect.objectContaining({ kind: 'resource_lineage', confidence: 'inferred' }),
    ]));
  });
});
