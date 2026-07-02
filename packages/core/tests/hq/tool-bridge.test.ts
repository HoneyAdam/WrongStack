import { describe, expect, it, vi } from 'vitest';
import type { HqToolCompletedPayload, HqToolStartedPayload } from '../../src/hq/protocol.js';
import type { HqPublisher } from '../../src/hq/publisher.js';
import { startToolTelemetryBridge } from '../../src/hq/tool-bridge.js';
import { EventBus } from '../../src/kernel/events.js';

function fakePublisher(spy: ReturnType<typeof vi.fn>): HqPublisher {
  return {
    publishEvent: (o: { type: string; payload: unknown }) => {
      spy(o);
      return {} as never;
    },
  } as unknown as HqPublisher;
}

describe('startToolTelemetryBridge', () => {
  it('forwards tool.started with summarized input', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    const stop = startToolTelemetryBridge({ events, publisher, projectRoot: '/proj', sessionId: 's1' });
    events.emit('tool.started', {
      name: 'bash',
      id: 'toolu_1',
      input: { command: 'echo hello', cwd: '/proj' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]![0];
    expect(call.type).toBe('tool.started');
    const payload: HqToolStartedPayload = call.payload;
    expect(payload.toolName).toBe('bash');
    expect(payload.inputSummary).toBeDefined();
    expect(typeof payload.inputSummary).toBe('object');
    stop();
  });

  it('forwards tool.started without input (no inputSummary)', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    startToolTelemetryBridge({ events, publisher });
    events.emit('tool.started', { name: 'read', id: 'toolu_2' });
    const payload: HqToolStartedPayload = spy.mock.calls[0]![0].payload;
    expect(payload.toolName).toBe('read');
    expect(payload.inputSummary).toBeUndefined();
  });

  it('forwards tool.executed as tool.completed', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    startToolTelemetryBridge({ events, publisher });
    events.emit('tool.executed', {
      name: 'bash',
      id: 'toolu_1',
      durationMs: 150,
      ok: true,
      output: 'hello\n',
    });
    const call = spy.mock.calls[0]![0];
    expect(call.type).toBe('tool.completed');
    const payload: HqToolCompletedPayload = call.payload;
    expect(payload.toolName).toBe('bash');
    expect(payload.status).toBe('success');
    expect(payload.durationMs).toBe(150);
  });

  it('marks failed tool.executed as error status', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    startToolTelemetryBridge({ events, publisher });
    events.emit('tool.executed', { name: 'bash', durationMs: 50, ok: false });
    const payload: HqToolCompletedPayload = spy.mock.calls[0]![0].payload;
    expect(payload.status).toBe('error');
  });

  it('redacts sensitive keys in tool input', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    startToolTelemetryBridge({ events, publisher });
    events.emit('tool.started', {
      name: 'http',
      id: 'toolu_3',
      input: { apiKey: 'sk-secret-123', url: 'https://example.com' },
    });
    const payload: HqToolStartedPayload = spy.mock.calls[0]![0].payload;
    const summary = payload.inputSummary as Record<string, unknown>;
    expect(summary.apiKey).toBe('[REDACTED:hq_sensitive_field]');
  });

  it('disposer unsubscribes both listeners', () => {
    const events = new EventBus();
    const spy = vi.fn();
    const publisher = fakePublisher(spy);
    const stop = startToolTelemetryBridge({ events, publisher });
    stop();
    events.emit('tool.started', { name: 'read', id: 'x' });
    events.emit('tool.executed', { name: 'read', durationMs: 1, ok: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('never throws on publisher failure', () => {
    const events = new EventBus();
    const publisher = {
      publishEvent: () => {
        throw new Error('boom');
      },
    } as unknown as HqPublisher;
    const stop = startToolTelemetryBridge({ events, publisher });
    expect(() => events.emit('tool.started', { name: 'read', id: 'x' })).not.toThrow();
    stop();
  });
});
