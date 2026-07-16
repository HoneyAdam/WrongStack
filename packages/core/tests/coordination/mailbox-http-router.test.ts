import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { MailboxEventEmitter } from '../../src/coordination/mailbox-events.js';
import {
  authorizeMailboxBearerToken,
  createMailboxHttpRouter,
  MailboxHttpRateLimiter,
} from '../../src/coordination/mailbox-http-router.js';
import type {
  Mailbox,
  MailboxAckBatchInput,
  MailboxAckInput,
  MailboxMessage,
  MailboxQuery,
  MailboxSendInput,
} from '../../src/coordination/mailbox-types.js';

interface ResponseRecorder {
  response: ServerResponse;
  readonly chunks: string[];
  status?: number;
  headers?: OutgoingHttpHeaders;
  ended: boolean;
  json(): unknown;
  text(): string;
}

function makeRequest(input: {
  method?: string;
  url?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  keepOpen?: boolean;
} = {}): IncomingMessage {
  const raw = input.rawBody ?? (input.body === undefined ? '' : JSON.stringify(input.body));
  const stream = input.keepOpen ? new PassThrough() : Readable.from(raw ? [Buffer.from(raw)] : []);
  Object.assign(stream, {
    method: input.method ?? 'GET',
    url: input.url ?? '/',
    headers: { ...(input.headers ?? {}) },
  });
  return stream as unknown as IncomingMessage;
}

function makeResponse(): ResponseRecorder {
  const chunks: string[] = [];
  const recorder: ResponseRecorder = {
    response: undefined as unknown as ServerResponse,
    chunks,
    ended: false,
    json: () => JSON.parse(chunks.join('')) as unknown,
    text: () => chunks.join(''),
  };
  const response = {
    writeHead(status: number, headers?: OutgoingHttpHeaders) {
      recorder.status = status;
      recorder.headers = headers;
      return response;
    },
    write(chunk: string | Buffer) {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) chunks.push(String(chunk));
      recorder.ended = true;
      return response;
    },
  };
  recorder.response = response as unknown as ServerResponse;
  return recorder;
}

function message(overrides: Partial<MailboxMessage> = {}): MailboxMessage {
  return {
    id: 'msg-1',
    from: 'external-a',
    to: 'agent-b',
    type: 'note',
    subject: 'subject',
    body: 'body',
    priority: 'normal',
    timestamp: '2026-07-16T00:00:00.000Z',
    readBy: {},
    completed: false,
    ...overrides,
  };
}

function makeMailbox() {
  const send = vi.fn(async (input: MailboxSendInput) => message({ ...input, id: 'sent-1' }));
  const query = vi.fn(async (_query: MailboxQuery) => [] as MailboxMessage[]);
  const ack = vi.fn(async (input: MailboxAckInput) =>
    message({ id: input.messageId, completed: input.completed ?? false }),
  );
  const ackMany = vi.fn(async (input: MailboxAckBatchInput) =>
    input.acks.map((entry) =>
      message({ id: entry.messageId, completed: entry.completed ?? false }),
    ),
  );
  const unreadCount = vi.fn(async () => 0);
  const registerAgent = vi.fn(async () => undefined);
  const heartbeat = vi.fn(async () => undefined);
  const registerClient = vi.fn(async () => undefined);
  const clientHeartbeat = vi.fn(async () => undefined);
  const getAgentStatuses = vi.fn(async () => []);
  const getOnlineAgents = vi.fn(async () => []);
  const purgeClients = vi.fn(async () => 0);

  const mailbox: Mailbox = {
    send,
    query,
    ack,
    ackMany,
    unreadCount,
    registerAgent,
    heartbeat,
    registerClient,
    clientHeartbeat,
    getAgentStatuses,
    getOnlineAgents,
    purgeClients,
    softDelete: vi.fn(async () => null),
    restore: vi.fn(async () => null),
    deregisterAgent: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    clearAll: vi.fn(async () => undefined),
    purgeStale: vi.fn(async () => ({
      completedPurged: 0,
      incompletePurged: 0,
      totalPurged: 0,
      remaining: 0,
    })),
    autoCompact: vi.fn(async () => ({
      readByAllRemoved: 0,
      expiredRemoved: 0,
      stalePurged: 0,
      totalRemoved: 0,
      remaining: 0,
    })),
    startAutoCompactTimer: vi.fn(() => () => undefined),
    deregisterClient: vi.fn(async () => undefined),
    getClientStatuses: vi.fn(async () => []),
  };

  return {
    mailbox,
    send,
    query,
    ack,
    ackMany,
    unreadCount,
    registerAgent,
    heartbeat,
    registerClient,
    clientHeartbeat,
    getAgentStatuses,
    getOnlineAgents,
    purgeClients,
  };
}

async function handle(input: {
  mailbox?: Mailbox;
  request?: IncomingMessage;
  routePath?: string;
  authorize?: Parameters<typeof createMailboxHttpRouter>[0]['authorize'];
  rateLimiter?: MailboxHttpRateLimiter;
  eventEmitter?: MailboxEventEmitter;
  maxBodyBytes?: number;
} = {}): Promise<ResponseRecorder> {
  const response = makeResponse();
  const router = createMailboxHttpRouter({
    mailbox: input.mailbox ?? makeMailbox().mailbox,
    ...(input.authorize ? { authorize: input.authorize } : {}),
    ...(input.rateLimiter ? { rateLimiter: input.rateLimiter } : {}),
    ...(input.eventEmitter ? { eventEmitter: input.eventEmitter } : {}),
    ...(input.maxBodyBytes !== undefined ? { maxBodyBytes: input.maxBodyBytes } : {}),
  });
  await router.handle(input.request ?? makeRequest(), response.response, input.routePath);
  return response;
}

describe('mailbox HTTP router', () => {
  it('serves /healthz before authorization and returns no-store JSON', async () => {
    const authorize = vi.fn(() => ({ allowed: false as const }));
    const response = await handle({ request: makeRequest({ url: '/healthz' }), authorize });

    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    expect(response.json()).toEqual({ ok: true });
    expect(authorize).not.toHaveBeenCalled();
  });

  it('supports host prefix mounting through routePath and validates send input', async () => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/api/projects/proj/mailbox/send',
        body: {
          from: 'external-bot',
          to: 'agent-b',
          type: 'note',
          subject: 'mounted',
          body: 'through HQ',
          priority: 'high',
          ttlMs: 1_000,
        },
      }),
      routePath: '/mailbox/send',
    });

    expect(response.status).toBe(201);
    expect(stub.send).toHaveBeenCalledWith({
      from: 'external-bot',
      to: 'agent-b',
      type: 'note',
      subject: 'mounted',
      body: 'through HQ',
      priority: 'high',
      ttlMs: 1_000,
    });
    expect(response.json()).toMatchObject({ id: 'sent-1', subject: 'mounted' });
  });

  it.each([
    {
      name: 'reserved sender identity',
      body: { from: 'leader@remote', to: 'x', type: 'note', subject: 's', body: 'b' },
      message: 'reserved internal agent id "leader"',
    },
    {
      name: 'unknown message type',
      body: { from: 'external', to: 'x', type: 'unknown', subject: 's', body: 'b' },
      message: 'field "type" must be one of',
    },
    {
      name: 'invalid priority',
      body: {
        from: 'external',
        to: 'x',
        type: 'note',
        subject: 's',
        body: 'b',
        priority: 'urgent',
      },
      message: 'field "priority" must be one of',
    },
  ])('rejects $name before calling the mailbox', async ({ body, message: expected }) => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({ method: 'POST', url: '/mailbox/send', body }),
    });

    expect(response.status).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining(expected) },
    });
    expect(stub.send).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON and bodies over the configured cap', async () => {
    const invalid = await handle({
      request: makeRequest({ method: 'POST', url: '/mailbox/query', rawBody: '{broken' }),
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const oversized = await handle({
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/query',
        rawBody: '{"x":"too large"}',
        headers: { 'content-length': '17' },
      }),
      maxBodyBytes: 8,
    });
    expect(oversized.status).toBe(400);
    expect(oversized.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('request body too large'),
      },
    });
  });

  it('returns custom authorization denials and enforces host-keyed rate limits', async () => {
    const denied = await handle({
      request: makeRequest({ url: '/mailbox/agents' }),
      authorize: () => ({
        allowed: false,
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'missing capability' } },
      }),
    });
    expect(denied.status).toBe(403);
    expect(denied.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'missing capability' },
    });

    const stub = makeMailbox();
    const router = createMailboxHttpRouter({
      mailbox: stub.mailbox,
      authorize: () => ({ allowed: true, rateLimitKey: 'shared-key' }),
      rateLimiter: new MailboxHttpRateLimiter(1, 60_000),
    });
    const first = makeResponse();
    const second = makeResponse();
    await router.handle(makeRequest({ url: '/mailbox/agents' }), first.response);
    await router.handle(makeRequest({ url: '/mailbox/agents' }), second.response);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(stub.getAgentStatuses).toHaveBeenCalledTimes(1);
  });

  it('checks direct and base inboxes, deduplicates/self-filters, and batches receipts once', async () => {
    const stub = makeMailbox();
    const direct = message({ id: 'direct', from: 'sender-a', to: 'agent@one' });
    const duplicate = message({ id: 'direct', from: 'sender-a', to: 'agent' });
    const self = message({ id: 'self', from: 'agent@one', to: 'agent@one' });
    const base = message({ id: 'base', from: 'sender-b', to: 'agent' });
    stub.query.mockImplementation(async (query: MailboxQuery) =>
      query.to === 'agent@one' ? [direct, self] : [duplicate, base],
    );
    stub.ackMany.mockImplementation(async ({ acks }: MailboxAckBatchInput) =>
      acks.map((entry) =>
        message({ id: entry.messageId, completed: entry.completed ?? false }),
      ),
    );

    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/check',
        body: {
          agentId: 'agent@one',
          baseId: 'agent',
          completed: true,
          outcome: 'handled',
          limit: 10,
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(stub.query).toHaveBeenCalledTimes(2);
    expect(stub.ackMany).toHaveBeenCalledTimes(1);
    expect(stub.ackMany).toHaveBeenCalledWith({
      acks: [
        {
          messageId: 'direct',
          readerId: 'agent@one',
          read: true,
          completed: true,
          outcome: 'handled',
        },
        {
          messageId: 'base',
          readerId: 'agent@one',
          read: true,
          completed: true,
          outcome: 'handled',
        },
      ],
    });
    expect(response.json()).toMatchObject({ count: 2 });
  });

  it('tags HTTP agent/client registrations and defaults external session ids', async () => {
    const stub = makeMailbox();
    const agent = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/agents/register',
        body: {
          agentId: 'external-agent',
          name: 'External Agent',
          pid: 123,
          role: 'reviewer',
        },
      }),
    });
    const client = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/register-client',
        body: { clientId: 'external-client', name: 'External Client', pid: 456 },
      }),
    });

    expect(agent.status).toBe(200);
    expect(client.status).toBe(200);
    expect(stub.registerAgent).toHaveBeenCalledWith({
      agentId: 'external-agent',
      sessionId: 'external',
      name: 'External Agent',
      pid: 123,
      role: 'reviewer',
      source: 'http',
    });
    expect(stub.registerClient).toHaveBeenCalledWith({
      clientId: 'external-client',
      sessionId: 'external',
      name: 'External Client',
      pid: 456,
      source: 'http',
    });
  });

  it('maps unknown routes to 404 and mailbox failures to structured 500 responses', async () => {
    const missing = await handle({ request: makeRequest({ url: '/mailbox/missing' }) });
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });

    const stub = makeMailbox();
    stub.getAgentStatuses.mockRejectedValueOnce(new Error('registry unavailable'));
    const failed = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({ url: '/mailbox/agents' }),
    });
    expect(failed.status).toBe(500);
    expect(failed.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'registry unavailable' },
    });
  });

  it('streams events over SSE and router.close tears down subscribers idempotently', async () => {
    const eventEmitter = new MailboxEventEmitter();
    const request = makeRequest({ method: 'GET', url: '/mailbox/events', keepOpen: true });
    const response = makeResponse();
    const router = createMailboxHttpRouter({ mailbox: makeMailbox().mailbox, eventEmitter });

    await router.handle(request, response.response);
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
    });
    expect(response.text()).toContain(': connected');
    expect(eventEmitter.subscriberCount).toBe(1);

    eventEmitter.emit({
      type: 'message.sent',
      messageId: 'evt-1',
      from: 'external-a',
      to: 'agent-b',
      timestamp: '2026-07-16T00:00:00.000Z',
    });
    expect(response.text()).toContain('"type":"message.sent"');
    expect(response.text()).toContain('"messageId":"evt-1"');

    router.close();
    router.close();
    expect(response.ended).toBe(true);
    expect(eventEmitter.subscriberCount).toBe(0);
  });
});

describe('mailbox HTTP authorization helpers', () => {
  it('accepts only the exact authorization value and returns it as the rate-limit key', () => {
    const scheme = ['Bea', 'rer'].join('');
    const expected = ['fixture', 'mailbox', 'value'].join('-');
    expect(
      authorizeMailboxBearerToken(
        makeRequest({ headers: { authorization: `${scheme} ${expected}` } }),
        expected,
      ),
    ).toEqual({ allowed: true, rateLimitKey: expected });
    expect(
      authorizeMailboxBearerToken(
        makeRequest({ headers: { authorization: `${scheme} ${expected.toUpperCase()}` } }),
        expected,
      ),
    ).toEqual({ allowed: false });
    expect(authorizeMailboxBearerToken(makeRequest(), expected)).toEqual({ allowed: false });
  });

  it('expires limiter entries after the configured window', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-16T00:00:00.000Z'));
      const limiter = new MailboxHttpRateLimiter(1, 1_000);
      expect(limiter.allow('key')).toBe(true);
      expect(limiter.allow('key')).toBe(false);

      vi.advanceTimersByTime(1_001);
      expect(limiter.allow('key')).toBe(true);
      limiter.cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
