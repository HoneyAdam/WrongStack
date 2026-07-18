import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChronicleJournal,
  createChronicleContext,
  wireToolsToChronicle,
} from '../../src/chronicle/index.js';
import { EventBus } from '../../src/kernel/events.js';

const tempDirs: string[] = [];
const scrubber = { scrub: (value: string) => value.replaceAll('SECRET', '[REDACTED]') };

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('wireToolsToChronicle', () => {
  it('records scrubbed lifecycle data and file/symbol/process resource edges', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-tool-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl') });
    const events = new EventBus();
    const context = createChronicleContext({
      installationId: 'install',
      machineId: 'machine',
      projectId: 'project',
      sessionId: 'session',
    }, 'trace');
    const unsubscribe = wireToolsToChronicle({ events, journal, context, scrubber });

    events.emit('tool.started', {
      sessionId: 'session',
      traceId: 'trace',
      agentId: 'leader',
      name: 'read',
      id: 'tool-1',
      input: { path: 'src/auth.ts', token: 'SECRET' },
    });
    events.emit('tool.progress', {
      sessionId: 'session',
      traceId: 'trace',
      agentId: 'leader',
      name: 'edit',
      id: 'tool-1',
      event: { type: 'file_changed', path: 'src/auth.ts', operation: 'edit', line: 72, endLine: 91 },
    });
    events.emit('tool.executed', {
      sessionId: 'session',
      traceId: 'trace',
      agentId: 'leader',
      id: 'tool-1',
      name: 'read',
      durationMs: 12.5,
      ok: true,
      output: 'result SECRET',
      outputBytes: 20,
      outputTokens: 5,
      outputLines: 2,
      metadata: {
        toolUseId: 'tool-1',
        toolName: 'read',
        ok: true,
        summary: 'read auth',
        files: ['src/auth.ts'],
        symbols: ['AuthService.login'],
        commands: ['rg SECRET src'],
        errors: [],
        status: 'seen',
        referenceCount: 0,
        seenAt: 1,
      },
    });

    const recorded = await journal.readAll();
    unsubscribe();

    expect(recorded.map((event) => event.eventType)).toEqual([
      'tool.started',
      'file.mutation.observed',
      'tool.executed',
      'tool.resource.observed',
      'tool.resource.observed',
      'tool.resource.observed',
    ]);
    expect(recorded[0]?.attributes?.['input']).toContain('[REDACTED]');
    expect(recorded[2]?.attributes?.['outputPreview']).toBe('result [REDACTED]');
    expect(recorded[1]?.resource).toMatchObject({
      kind: 'file',
      path: 'src/auth.ts',
      lineStart: 72,
      lineEnd: 91,
    });
    expect(recorded.slice(3).map((event) => event.resource?.kind)).toEqual(['file', 'symbol', 'process']);
    expect(recorded.every((event) => event.correlation.toolCallId === 'tool-1')).toBe(true);
    await expect(journal.verify()).resolves.toMatchObject({ ok: true, entries: 6 });
  });

  it('records executor failures separately from model-facing tool results', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-tool-failure-'));
    tempDirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl') });
    const events = new EventBus();
    const context = createChronicleContext({ installationId: 'i', machineId: 'm' }, 'trace');
    wireToolsToChronicle({ events, journal, context, scrubber });

    events.emit('tool.failed', {
      name: 'bash',
      id: 'tool-fail',
      sessionId: 'session',
      agentId: 'leader',
      durationMs: 300,
      category: 'timeout',
      retryable: true,
      detail: 'timed out',
    });

    const recorded = await journal.readAll();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ eventType: 'tool.failed', outcome: 'failure', durationNs: '300000000' });
    expect(recorded[0]?.attributes).toMatchObject({ toolName: 'bash', category: 'timeout', retryable: true });
  });
});
