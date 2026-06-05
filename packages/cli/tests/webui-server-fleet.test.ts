import { EventBus } from '@wrongstack/core/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWebUI } from '../src/webui-server.js';
import { openWs } from './_ws-client.js';

const ports = { next: 45_640 };
const nextPort = (): number => ports.next++;

describe('runWebUI subagent fleet bridge', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  it('flattens subagent.* host events into a kind-tagged subagent.event stream', async () => {
    const port = nextPort();
    const httpPort = nextPort();
    const events = new EventBus();
    let signalReady: (() => void) | undefined;
    const listening = new Promise<void>((r) => {
      signalReady = r;
    });
    const serverDone = runWebUI({
      port,
      httpPort,
      onListening: () => signalReady?.(),
      events,
      session: { id: 'test-session' } as any,
      agent: {
        ctx: { model: 'test-model', provider: { id: 'test-provider' } },
        run: vi.fn(),
      } as any,
    });

    await listening;
    const { ws, waitForMessage } = await openWs(`ws://127.0.0.1:${port}`);
    await waitForMessage('session.start');

    // spawn → expect a 'spawned' subagent.event carrying the nickname/model.
    events.emit('subagent.spawned', {
      subagentId: 'sub-1',
      taskId: 'task-1',
      name: 'Von Neumann',
      provider: 'anthropic',
      model: 'claude-x',
      description: 'analyze the kernel',
    });
    const spawned = await waitForMessage('subagent.event', (m) => m.payload.kind === 'spawned');
    expect(spawned.payload.subagentId).toBe('sub-1');
    expect(spawned.payload.name).toBe('Von Neumann');
    expect(spawned.payload.model).toBe('claude-x');

    // periodic summary → counters forwarded verbatim.
    events.emit('subagent.iteration_summary', {
      subagentId: 'sub-1',
      iteration: 25,
      toolCalls: 47,
      costUsd: 0.023,
      currentTool: 'grep',
    });
    const summary = await waitForMessage(
      'subagent.event',
      (m) => m.payload.kind === 'iteration_summary',
    );
    expect(summary.payload.iteration).toBe(25);
    expect(summary.payload.toolCalls).toBe(47);
    expect(summary.payload.currentTool).toBe('grep');

    // completion → status + structured error flattened to {kind,message}.
    events.emit('subagent.task_completed', {
      subagentId: 'sub-1',
      taskId: 'task-1',
      status: 'failed',
      iterations: 30,
      toolCalls: 50,
      durationMs: 1000,
      error: { kind: 'rate_limit', message: '429 slow down', retryable: true },
    });
    const done = await waitForMessage('subagent.event', (m) => m.payload.kind === 'task_completed');
    expect(done.payload.status).toBe('failed');
    expect(done.payload.error).toEqual({ kind: 'rate_limit', message: '429 slow down' });
    // retryable/durationMs are intentionally not forwarded — keep the wire lean.
    expect(done.payload.error.retryable).toBeUndefined();

    ws.close();
    process.emit('SIGTERM');
    await serverDone;
  });
});
