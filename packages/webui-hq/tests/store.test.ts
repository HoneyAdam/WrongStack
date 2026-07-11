/**
 * Tests for the HQ store (`src/store.ts`) — the React-based global store,
 * API helpers, and command/mailbox-send wrappers.
 *
 * @vitest-environment jsdom
 */
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
});

describe('store state setters', () => {
  it('setActiveView updates the active view without throwing', () => {
    expect(() => storeModule.setActiveView('fleet')).not.toThrow();
    expect(() => storeModule.setActiveView('console')).not.toThrow();
  });

  it('selectSession stores session and optional agent', () => {
    expect(() => storeModule.selectSession('sess-1', 'agent-1')).not.toThrow();
    expect(() => storeModule.selectSession('sess-2')).not.toThrow();
    expect(() => storeModule.selectSession(null)).not.toThrow();
  });

  it('selectAgent stores session and agent together', () => {
    expect(() => storeModule.selectAgent('sess-1', 'agent-99')).not.toThrow();
  });

  it('selectClient stores client id', () => {
    expect(() => storeModule.selectClient('client-x')).not.toThrow();
    expect(() => storeModule.selectClient(null)).not.toThrow();
  });

  it('markAuthRequired flips authRequired to true (idempotent)', () => {
    expect(() => storeModule.markAuthRequired()).not.toThrow();
    expect(() => storeModule.markAuthRequired()).not.toThrow();
  });
});

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: 'ok' }), { status: 200 }),
    ));
    const result = await storeModule.fetchJson<{ data: string }>('/api/test');
    expect(result).toEqual({ data: 'ok' });
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(storeModule.fetchJson('/api/test')).rejects.toThrow('Network error fetching /api/test');
  });

  it('throws on 401 and calls markAuthRequired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    ));
    await expect(storeModule.fetchJson('/api/protected')).rejects.toThrow(
      '401 Unauthorized fetching /api/protected — browser token required',
    );
  });

  it('throws on non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    ));
    await expect(storeModule.fetchJson('/api/missing')).rejects.toThrow('404 Not Found');
  });

  it('throws on invalid JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200, statusText: 'OK' }),
    ));
    await expect(storeModule.fetchJson('/api/bad-json')).rejects.toThrow(
      'Invalid JSON response from /api/bad-json: 200',
    );
  });
});

describe('postMailboxSend', () => {
  it('sends a mailbox message and returns the result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ delivered: true, messageId: 'm-1', to: '*', type: 'steer' }), { status: 200 }),
    ));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    ));
    await expect(storeModule.postMailboxSend({ type: 'queue', body: 'x' })).rejects.toThrow(
      '401 Unauthorized — browser token required',
    );
  });

  it('throws with server error body on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429, statusText: 'Too Many Requests' }),
    ));
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow('rate limited');
  });

  it('throws with status text when error body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 500, statusText: 'Internal Server Error' }),
    ));
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow(
      'Internal Server Error',
    );
  });

  it('throws on invalid JSON in successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200, statusText: 'OK' }),
    ));
    await expect(storeModule.postMailboxSend({ type: 'steer', body: 'hello' })).rejects.toThrow(
      'Invalid JSON response from mailbox-send API',
    );
  });
});

describe('postCommand', () => {
  it('sends a command and returns the result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ commandId: 'cmd-1', queued: true }), { status: 200 }),
    ));
    const result = await storeModule.postCommand('client-1', 'abort', { target: 'leader' });
    expect(result.commandId).toBe('cmd-1');
    expect(result.queued).toBe(true);
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow('Network error sending command');
  });

  it('throws on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    ));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow(
      '401 Unauthorized — browser token required',
    );
  });

  it('throws with server error on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid client' }), { status: 400, statusText: 'Bad Request' }),
    ));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow('invalid client');
  });

  it('throws with status text when error body is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 409, statusText: 'Conflict' }),
    ));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow('Conflict');
  });

  it('throws on invalid JSON in successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200, statusText: 'OK' }),
    ));
    await expect(storeModule.postCommand('c1', 'run', {})).rejects.toThrow(
      'Invalid JSON response from command API',
    );
  });
});
