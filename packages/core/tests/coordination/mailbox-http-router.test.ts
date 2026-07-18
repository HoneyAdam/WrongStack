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

  it.each(['all', ' ALL ', ' * '])(
    'canonicalizes project broadcast recipient %j before forwarding',
    async (to) => {
      const stub = makeMailbox();
      const response = await handle({
        mailbox: stub.mailbox,
        request: makeRequest({
          method: 'POST',
          url: '/mailbox/send',
          body: {
            from: 'external-bot',
            to,
            type: 'broadcast',
            subject: 'broadcast',
            body: 'hello',
          },
        }),
      });

      expect(response.status).toBe(201);
      expect(stub.send).toHaveBeenCalledWith(expect.objectContaining({ to: '*' }));
    },
  );

  it.each([
    ['assign', 'all'],
    ['assign', ' ALL '],
    ['assign', ' * '],
    ['assign', '@session:session-1'],
    ['steer', 'all'],
    ['steer', '@session:session-1'],
  ] as const)(
    'rejects %s sent to multi-recipient target %j',
    async (type, to) => {
      const stub = makeMailbox();
      const response = await handle({
        mailbox: stub.mailbox,
        request: makeRequest({
          method: 'POST',
          url: '/mailbox/send',
          body: {
            from: 'external-bot',
            to,
            type,
            subject: 'action',
            body: 'do this',
          },
        }),
      });

      expect(response.status).toBe(400);
      expect(response.json()).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          message: expect.stringContaining('requires a specific recipient'),
        },
      });
      expect(stub.send).not.toHaveBeenCalled();
    },
  );

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

describe('mailbox HTTP router — validator mutation matrix', () => {
  // Each row starts from a known-valid body, alters **one** field
  // (delete it, replace it with the wrong type, or use an out-of-domain
  // value), and asserts that the router returns a 400 VALIDATION_ERROR
  // **before** any Mailbox method is invoked.

  interface Result400 {
    error: { code: string; message: string };
  }
  function errorEnvelope(body: unknown): { code: string; message: string } | null {
    if (!body || typeof body !== 'object') return null;
    const candidate = body as { error?: { code?: unknown; message?: unknown } };
    if (!candidate.error || typeof candidate.error !== 'object') return null;
    if (typeof candidate.error.code !== 'string') return null;
    if (typeof candidate.error.message !== 'string') return null;
    return { code: candidate.error.code, message: candidate.error.message };
  }

  async function expectMutationRejected(input: {
    method?: string;
    route: string;
    validBody: object;
    mutate: (body: Record<string, unknown>) => void;
    rejectContains: string;
    assertNoCall?: keyof ReturnType<typeof makeMailbox>;
  }): Promise<void> {
    const stub = makeMailbox();
    const body: Record<string, unknown> = JSON.parse(JSON.stringify(input.validBody));
    input.mutate(body);
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: input.method ?? 'POST',
        url: input.route,
        body,
      }),
    });
    expect(response.status).toBe(400);
    const envelope = errorEnvelope(response.json());
    expect(envelope).not.toBeNull();
    expect(envelope?.code).toBe('VALIDATION_ERROR');
    expect(envelope?.message).toContain(input.rejectContains);
    if (input.assertNoCall) {
      expect(stub[input.assertNoCall]).not.toHaveBeenCalled();
    }
  }

  it.each(['string', 'number', 'true', 'null', 'array'])(
    'rejects non-object body (sent as %s) on /mailbox/send',
    async (kind) => {
      const stub = makeMailbox();
      const scalar: unknown =
        kind === 'number' ? 1 : kind === 'true' ? true : kind === 'array' ? [] : kind;
      const response = await handle({
        mailbox: stub.mailbox,
        request: makeRequest({ method: 'POST', url: '/mailbox/send', body: scalar }),
      });
      expect(response.status).toBe(400);
      const envelope = errorEnvelope(response.json());
      expect(envelope?.code).toBe('VALIDATION_ERROR');
      expect(stub.send).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/mailbox/send',
    '/mailbox/query',
    '/mailbox/check',
    '/mailbox/ack',
    '/mailbox/ack-many',
    '/mailbox/unread-count',
    '/mailbox/agents/register',
    '/mailbox/agents/heartbeat',
    '/mailbox/register-client',
    '/mailbox/heartbeat',
  ])('rejects raw invalid JSON on %s', async (route) => {
    const response = await handle({
      request: makeRequest({ method: 'POST', url: route, rawBody: '{broken' }),
    });
    expect(response.status).toBe(400);
    const envelope = errorEnvelope(response.json());
    expect(envelope?.code).toBe('VALIDATION_ERROR');
  });

  it.each([0, -1, 1.5, '60', false, []])(
    'rejects invalid ttlMs (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/send',
        validBody: {
          from: 'external-a',
          to: 'agent-b',
          type: 'note',
          subject: 'subject',
          body: 'body',
          priority: 'normal',
        },
        mutate: (body) => {
          body.ttlMs = value;
        },
        rejectContains: 'field "ttlMs"',
        assertNoCall: 'send',
      });
    },
  );

  it.each([0, -1, 1.5, '20'])(
    'rejects invalid query limit (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/query',
        validBody: {},
        mutate: (body) => {
          body.limit = value;
        },
        rejectContains: 'field "limit"',
        assertNoCall: 'query',
      });
    },
  );

  it.each([0, -1, 1.5, '10'])(
    'rejects invalid check limit (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/check',
        validBody: { agentId: 'agent-b' },
        mutate: (body) => {
          body.limit = value;
        },
        rejectContains: 'field "limit"',
        assertNoCall: 'query',
      });
    },
  );

  it.each(['urgent', true, 1])(
    'rejects invalid priority (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/send',
        validBody: {
          from: 'external-a',
          to: 'agent-b',
          type: 'note',
          subject: 'subject',
          body: 'body',
        },
        mutate: (body) => {
          body.priority = value as never;
        },
        rejectContains: 'priority',
        assertNoCall: 'send',
      });
    },
  );

  it('rejects priority of null (must-not-be-null guard)', async () => {
    // null is explicitly rejected by the `optionalString` body. The
    // validator fails with a `must not be null` message before the
    // enum check would have been consulted.
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/send',
        body: {
          from: 'external-a',
          to: 'agent-b',
          type: 'note',
          subject: 's',
          body: 'b',
          priority: null,
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('"priority" must not be null'),
      },
    });
    expect(stub.send).not.toHaveBeenCalled();
  });

  it.each(['sms', 1, true])(
    'rejects invalid message type (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/send',
        validBody: {
          from: 'external-a',
          to: 'agent-b',
          type: 'note',
          subject: 'subject',
          body: 'body',
        },
        mutate: (body) => {
          body.type = value as never;
        },
        rejectContains: 'type',
        assertNoCall: 'send',
      });
    },
  );

  it('rejects message type of null (required-string guard)', async () => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/send',
        body: {
          from: 'external-a',
          to: 'agent-b',
          type: null,
          subject: 's',
          body: 'b',
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('type') },
    });
    expect(stub.send).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5])(
    'rejects invalid agent pid (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/agents/register',
        validBody: { agentId: 'agent-b', name: 'Agent', pid: 123 },
        mutate: (body) => {
          body.pid = value;
        },
        rejectContains: 'pid',
        assertNoCall: 'registerAgent',
      });
    },
  );

  it('rejects client pid value of 5 (string not allowed)', async () => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/register-client',
        body: { clientId: 'tui-1', name: 'TUI', pid: '5' },
      }),
    });
    expect(response.status).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: expect.stringContaining('pid') },
    });
    expect(stub.registerClient).not.toHaveBeenCalled();
  });

  it.each([0, -1, 0.5])(
    'rejects invalid client pid (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/register-client',
        validBody: { clientId: 'tui-1', name: 'TUI', pid: 456 },
        mutate: (body) => {
          body.pid = value;
        },
        rejectContains: 'pid',
        assertNoCall: 'registerClient',
      });
    },
  );

  it.each([-1, 0.5, '3'])(
    'rejects invalid iterations counter (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/agents/heartbeat',
        validBody: { agentId: 'agent-b' },
        mutate: (body) => {
          body.iterations = value;
        },
        rejectContains: 'iterations',
        assertNoCall: 'heartbeat',
      });
    },
  );

  it('accepts iterations counter at zero (valid non-negative integer)', async () => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/agents/heartbeat',
        body: { agentId: 'agent-b', iterations: 0 },
      }),
    });
    expect(response.status).toBe(200);
    expect(stub.heartbeat).toHaveBeenCalledOnce();
  });

  it.each([-1, 0.5, '3'])(
    'rejects invalid toolCalls counter (sent as %s)',
    async (value) => {
      await expectMutationRejected({
        route: '/mailbox/agents/heartbeat',
        validBody: { agentId: 'agent-b' },
        mutate: (body) => {
          body.toolCalls = value;
        },
        rejectContains: 'toolCalls',
        assertNoCall: 'heartbeat',
      });
    },
  );

  it('accepts toolCalls counter at zero (valid non-negative integer)', async () => {
    const stub = makeMailbox();
    const response = await handle({
      mailbox: stub.mailbox,
      request: makeRequest({
        method: 'POST',
        url: '/mailbox/agents/heartbeat',
        body: { agentId: 'agent-b', toolCalls: 0 },
      }),
    });
    expect(response.status).toBe(200);
    expect(stub.heartbeat).toHaveBeenCalledOnce();
  });

  // Type filter accepts any declared message-type literal string; non-string
  // values are rejected at the type guard, not the enum check.
  it('rejects non-string type filter in /mailbox/query', async () => {
    await expectMutationRejected({
      route: '/mailbox/query',
      validBody: {},
      mutate: (body) => {
        body.type = 1 as never;
      },
      rejectContains: 'field "type"',
      assertNoCall: 'query',
    });
  });


  it.each([
    'leader',
    'fleet',
    'hq',
    'mailbox-bridge',
    'mailbox-bridge-watchdog',
    'tech-stack-consumer',
  ])('rejects reserved sender identity "%s"', async (id) => {
    await expectMutationRejected({
      route: '/mailbox/send',
      validBody: {
        from: 'external-a',
        to: 'agent-b',
        type: 'note',
        subject: 'subject',
        body: 'body',
      },
      mutate: (body) => {
        body.from = `${id}@peer`;
      },
      rejectContains: `reserved internal agent id "${id}"`,
      assertNoCall: 'send',
    });
  });

  it.each([
    'leader',
    'fleet',
    'hq',
    'mailbox-bridge',
    'mailbox-bridge-watchdog',
    'tech-stack-consumer',
  ])('rejects reserved readerId "%s"', async (id) => {
    await expectMutationRejected({
      route: '/mailbox/ack',
      validBody: { messageId: 'msg-1', readerId: 'agent-b' },
      mutate: (body) => {
        body.readerId = `${id}@peer`;
      },
      rejectContains: `reserved internal agent id "${id}"`,
      assertNoCall: 'ack',
    });
  });

  it('rejects missing required fields on /mailbox/ack', async () => {
    for (const remove of ['messageId', 'readerId'] as const) {
      await expectMutationRejected({
        route: '/mailbox/ack',
        validBody: { messageId: 'msg-1', readerId: 'agent-b' },
        mutate: (body) => {
          delete body[remove];
        },
        rejectContains: `field "${remove}" is required`,
        assertNoCall: 'ack',
      });
    }
  });

  it('rejects malformed entry inside /mailbox/ack-many acks array', async () => {
    await expectMutationRejected({
      route: '/mailbox/ack-many',
      validBody: { acks: [{ messageId: 'msg-1', readerId: 'agent-b' }] },
      mutate: (body) => {
        const list = body.acks as Array<Record<string, unknown>>;
        list[0]!.readerId = '';
      },
      rejectContains: 'field "readerId" is required',
      assertNoCall: 'ackMany',
    });
  });

  it('rejects non-array acks on /mailbox/ack-many', async () => {
    await expectMutationRejected({
      route: '/mailbox/ack-many',
      validBody: { acks: [] },
      mutate: (body) => {
        body.acks = 'not-an-array';
      },
      rejectContains: 'field "acks" is required (array)',
      assertNoCall: 'ackMany',
    });
  });

  it('rejects empty list acks on /mailbox/ack-many by passing null', async () => {
    await expectMutationRejected({
      route: '/mailbox/ack-many',
      validBody: { acks: [] },
      mutate: (body) => {
        body.acks = null;
      },
      rejectContains: 'field "acks" is required (array)',
      assertNoCall: 'ackMany',
    });
  });

  it('rejects missing forAgentId on /mailbox/unread-count', async () => {
    await expectMutationRejected({
      route: '/mailbox/unread-count',
      validBody: { forAgentId: 'agent-b' },
      mutate: (body) => {
        delete body.forAgentId;
      },
      rejectContains: 'forAgentId',
      assertNoCall: 'unreadCount',
    });
  });

  it('rejects non-boolean incompleteOnly on /mailbox/query', async () => {
    await expectMutationRejected({
      route: '/mailbox/query',
      validBody: {},
      mutate: (body) => {
        body.incompleteOnly = 'true';
      },
      rejectContains: 'incompleteOnly',
      assertNoCall: 'query',
    });
  });

  it('rejects unknown minPriority on /mailbox/query', async () => {
    await expectMutationRejected({
      route: '/mailbox/query',
      validBody: {},
      mutate: (body) => {
        body.minPriority = 'urgent';
      },
      rejectContains: 'field "minPriority" must be one of',
      assertNoCall: 'query',
    });
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
