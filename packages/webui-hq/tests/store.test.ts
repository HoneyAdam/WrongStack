/**
 * Tests for the HQ store (`src/store.ts`) — the React-based global store,
 * API helpers, and command/mailbox-send wrappers.
 *
 * @vitest-environment jsdom
 */
import type { HqAlertMessage, HqEventEnvelope, HqSnapshot } from '@wrongstack/core/hq';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the WS client module so store.ts doesn't try to create a real WS.
vi.mock('../src/lib/hq-ws-client.js', () => ({
  getHqClient: () => ({
    on: vi.fn(() => () => {}),
    onStateChange: vi.fn(() => () => {}),
    close: vi.fn(),
  }),
}));

// ESM top-level await for the imports.
const storeModule = await import('../src/store.js');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  storeModule.useHqStore.setState({
    snapshot: null,
    events: [],
    alerts: [],
    commandStatuses: [],
    activeView: 'cockpit',
    selectedSessionId: null,
    selectedAgentId: null,
    selectedClientId: null,
    connected: false,
    authRequired: false,
  });
});

function snapshot(generatedAt: string): HqSnapshot {
  return {
    generatedAt,
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
      totalCostUsd: 0,
    },
  };
}

function event(id: string): HqEventEnvelope {
  return {
    id,
    type: 'fleet.event',
    schemaVersion: 1,
    timestamp: '2026-07-14T12:00:00.000Z',
    clientId: 'client-1',
    projectId: 'project-1',
    seq: 1,
    payload: {},
  };
}

describe('store state setters', () => {
  it('setActiveView updates the active view without throwing', () => {
    expect(() => storeModule.useHqStore.getState().setActiveView('fleet')).not.toThrow();
    expect(() => storeModule.useHqStore.getState().setActiveView('console')).not.toThrow();
  });

  it('selectSession stores session and optional agent', () => {
    expect(() =>
      storeModule.useHqStore.getState().selectSession('sess-1', 'agent-1'),
    ).not.toThrow();
    expect(() => storeModule.useHqStore.getState().selectSession('sess-2')).not.toThrow();
    expect(() => storeModule.useHqStore.getState().selectSession(null)).not.toThrow();
  });

  it('selectAgent stores session and agent together', () => {
    expect(() => storeModule.useHqStore.getState().selectAgent('sess-1', 'agent-99')).not.toThrow();
  });

  it('selectClient stores client id', () => {
    expect(() => storeModule.useHqStore.getState().selectClient('client-x')).not.toThrow();
    expect(() => storeModule.useHqStore.getState().selectClient(null)).not.toThrow();
  });

  it('markAuthRequired flips authRequired to true (idempotent)', () => {
    expect(() => storeModule.useHqStore.getState().markAuthRequired()).not.toThrow();
    expect(() => storeModule.useHqStore.getState().markAuthRequired()).not.toThrow();
  });
});

describe('live telemetry ingestion', () => {
  it('hydrates the first snapshot without reporting a WebSocket connection', () => {
    const state = storeModule.useHqStore.getState();
    state._hydrateSnapshot(snapshot('http'));

    expect(storeModule.useHqStore.getState().snapshot?.generatedAt).toBe('http');
    expect(storeModule.useHqStore.getState().connected).toBe(false);
  });

  it('does not let a late HTTP response replace a live WebSocket snapshot', () => {
    const state = storeModule.useHqStore.getState();
    state._onSnapshot(snapshot('live'));
    state._hydrateSnapshot(snapshot('stale-http'));

    expect(storeModule.useHqStore.getState().snapshot?.generatedAt).toBe('live');
    expect(storeModule.useHqStore.getState().connected).toBe(true);
  });

  it('deduplicates replayed event envelopes by id', () => {
    const state = storeModule.useHqStore.getState();
    state._onEvent(event('event-1'));
    state._onEvent({ ...event('event-1'), seq: 2 });

    expect(storeModule.useHqStore.getState().events).toHaveLength(1);
  });

  it('bounds the live event ring to the latest 500 envelopes', () => {
    const state = storeModule.useHqStore.getState();
    for (let index = 0; index < 505; index++) state._onEvent(event(`event-${index}`));

    const events = storeModule.useHqStore.getState().events;
    expect(events).toHaveLength(500);
    expect(events[0]?.id).toBe('event-5');
    expect(events.at(-1)?.id).toBe('event-504');
  });

  it('deduplicates identical alert transition frames', () => {
    const alert: HqAlertMessage = {
      type: 'hq.alert',
      severity: 'warn',
      message: 'agent count exceeded',
      timestamp: '2026-07-14T12:00:00.000Z',
    };
    const state = storeModule.useHqStore.getState();
    state._onAlert(alert);
    state._onAlert({ ...alert });

    expect(storeModule.useHqStore.getState().alerts).toHaveLength(1);
  });

  it('folds queued, delivered and acked command lifecycle frames by command id', () => {
    const state = storeModule.useHqStore.getState();
    state._onCommandStatus({
      commandId: 'command-1',
      type: 'steer',
      clientId: 'client-1',
      enqueuedBy: 'operator',
      enqueuedAt: '2026-07-14T12:00:00.000Z',
      status: 'queued',
    });
    state._onCommandStatus({
      commandId: 'command-1',
      type: 'steer',
      clientId: 'client-1',
      enqueuedBy: 'operator',
      enqueuedAt: '2026-07-14T12:00:00.000Z',
      status: 'acked',
      ackStatus: 'completed',
    });

    expect(storeModule.useHqStore.getState().commandStatuses).toEqual([
      expect.objectContaining({
        commandId: 'command-1',
        status: 'acked',
        ackStatus: 'completed',
      }),
    ]);
  });
});

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: 'ok' }), { status: 200 })),
    );
    const result = await storeModule.fetchJson<{ data: string }>('/api/test');
    expect(result).toEqual({ data: 'ok' });
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(storeModule.fetchJson('/api/test')).rejects.toThrow(
      'Network error fetching /api/test',
    );
  });

  it('throws on 401 and calls markAuthRequired', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
        ),
    );
    await expect(storeModule.fetchJson('/api/protected')).rejects.toThrow(
      '401 Unauthorized fetching /api/protected — browser token required',
    );
  });

  it('throws on non-ok status', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('Not Found', { status: 404, statusText: 'Not Found' })),
    );
    await expect(storeModule.fetchJson('/api/missing')).rejects.toThrow('404 Not Found');
  });

  it('throws on invalid JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-json', { status: 200, statusText: 'OK' })),
    );
    await expect(storeModule.fetchJson('/api/bad-json')).rejects.toThrow(
      'Invalid JSON response from /api/bad-json: 200',
    );
  });
});

describe('postMailboxSend', () => {
  it('sends a mailbox message and returns the result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ delivered: true, messageId: 'm-1', to: '*', type: 'steer' }),
            { status: 200 },
          ),
        ),
    );
    const result = await storeModule.postMailboxSend({ type: 'steer', body: 'hello', to: '*' });
    expect(result.delivered).toBe(true);
    expect(result.messageId).toBe('m-1');
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(storeModule.postMailboxSend({ type: 'btw', body: 'hi' })).rejects.toThrow(
      'Network error sending mailbox message',
    );
  });

  it('throws on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
        ),
    );
    await expect(storeModule.postMailboxSend({ type: 'queue', body: 'x' })).rejects.toThrow(
      '401 Unauthorized — browser token required',
    );
  });

  it('throws with server error body on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'rate limited' }), {
          status: 429,
          statusText: 'Too Many Requests',
        }),
      ),
    );
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow(
      'rate limited',
    );
  });

  it('throws with status text when error body is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('', { status: 500, statusText: 'Internal Server Error' })),
    );
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow(
      'Internal Server Error',
    );
  });

  it('throws on invalid JSON in successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-json', { status: 200, statusText: 'OK' })),
    );
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow(
      'Invalid JSON response from mailbox-send API',
    );
  });
});

describe('postCommand', () => {
  it('sends a command and returns the result', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ commandId: 'cmd-1', queued: true }), { status: 200 }),
        ),
    );
    const result = await storeModule.postCommand('client-1', 'abort', { target: 'leader' });
    expect(result.commandId).toBe('cmd-1');
    expect(result.queued).toBe(true);
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow(
      'Network error sending command',
    );
  });

  it('throws on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
        ),
    );
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow(
      '401 Unauthorized — browser token required',
    );
  });

  it('throws with server error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid client' }), {
          status: 400,
          statusText: 'Bad Request',
        }),
      ),
    );
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow('invalid client');
  });

  it('throws with status text when error body is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('', { status: 409, statusText: 'Conflict' })),
    );
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow('Conflict');
  });

  it('throws on invalid JSON in successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not-json', { status: 200, statusText: 'OK' })),
    );
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow(
      'Invalid JSON response from command API',
    );
  });
});
