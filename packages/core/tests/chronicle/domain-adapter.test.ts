import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleJournal, createChronicleContext, wireDomainEventsToChronicle } from '../../src/chronicle/index.js';
import { EventBus } from '../../src/kernel/events.js';
const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe('domain lifecycle bridge', () => {
  it('captures uncovered domains, scopes identities and redacts prose', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'chronicle-domain-')); dirs.push(dir);
    const journal = new ChronicleJournal({ filePath: path.join(dir, 'events.jsonl') });
    const events = new EventBus();
    const context = createChronicleContext({ installationId: 'i', machineId: 'm', projectId: 'p' }, 'trace');
    const off = wireDomainEventsToChronicle({ events, journal, context });
    events.emit('memory.candidate_rejected', { candidateId: 'memory-1', sessionId: 's', traceId: 'memory-trace', reason: 'private reason' });
    events.emit('sdd.task.retrying', { sessionId: 's', runId: 'run-1', taskId: 'task-1', attempt: 2, maxRetries: 3 });
    events.emit('worktree.committed', { sessionId: 's', handleId: 'wt-1', ownerId: 'agent-1', branch: 'feature', committed: true, insertions: 12, deletions: 2, files: 3, sha: 'abc' });
    // UI/client presence is a derived display concern, not a coding signal.
    events.emit('client.status', { sessionId: 's', clientType: 'webui', clientId: 'c', projectHash: 'p', agentCount: 1, model: 'm', mode: 'code', toolCalls: 2, inputTokens: 10, outputTokens: 4, cacheTokens: 0, costUsd: 0.01, timestamp: Date.now(), projectSlug: 'p' });
    const recorded = await journal.readAll(); off();
    expect(recorded.map((event) => event.eventType)).toEqual(['memory.candidate_rejected', 'sdd.task.retrying', 'worktree.committed']);
    expect(recorded[0]).toMatchObject({ scope: { sessionId: 's' }, correlation: { traceId: 'memory-trace' }, resource: { kind: 'other' } });
    expect(recorded[1]).toMatchObject({ scope: { taskId: 'task-1' }, resource: { kind: 'task' }, outcome: 'started' });
    expect(recorded[2]).toMatchObject({ resource: { kind: 'artifact', id: 'worktreeId:wt-1' }, outcome: 'success' });
    expect(JSON.stringify(recorded)).not.toContain('private reason');
  });
});
