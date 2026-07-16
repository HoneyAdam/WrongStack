import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { MailboxEventEmitter } from './mailbox-events.js';
import type {
  AgentHeartbeatInput,
  AgentRegistrationInput,
  ClientHeartbeatInput,
  ClientRegistrationInput,
  Mailbox,
  MailboxAckBatchInput,
  MailboxAckInput,
  MailboxMessage,
  MailboxQuery,
  MailboxSendInput,
} from './mailbox-types.js';

export const MAILBOX_HTTP_MAX_BODY_BYTES = 256 * 1024;
export const MAILBOX_HTTP_RATE_LIMIT_PER_MINUTE = 120;
export const MAILBOX_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;

export type MailboxHttpAccessDecision =
  | { allowed: true; rateLimitKey?: string }
  | { allowed: false; status?: number; body?: unknown };

export interface MailboxHttpRouterOptions {
  mailbox: Mailbox;
  eventEmitter?: MailboxEventEmitter;
  authorize?: (
    request: IncomingMessage,
  ) => MailboxHttpAccessDecision | Promise<MailboxHttpAccessDecision>;
  rateLimiter?: MailboxHttpRateLimiter;
  maxBodyBytes?: number;
}

export function authorizeMailboxBearerToken(
  request: IncomingMessage,
  expectedToken: string,
): MailboxHttpAccessDecision {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return { allowed: false };
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match === null) return { allowed: false };
  const presented = Buffer.from(match[1] ?? '', 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { allowed: false };
  }
  return { allowed: true, rateLimitKey: expectedToken };
}

export interface MailboxHttpRouter {
  /**
   * Handle one canonical mailbox HTTP request. `routePath` lets a host mount
   * the protocol below another prefix while preserving the public
   * `/mailbox/*` route contract internally.
   */
  handle(
    request: IncomingMessage,
    response: ServerResponse,
    routePath?: string,
  ): Promise<void>;
  /** Close every active SSE stream owned by this router. Idempotent. */
  close(): void;
}

/** Sliding-window request limiter shared by every mailbox HTTP host. */
export class MailboxHttpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit = MAILBOX_HTTP_RATE_LIMIT_PER_MINUTE,
    readonly windowMs = MAILBOX_HTTP_RATE_LIMIT_WINDOW_MS,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const fresh = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (fresh.length >= this.limit) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }

  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const fresh = timestamps.filter((timestamp) => timestamp > cutoff);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }
  }
}

export function createMailboxHttpRouter(options: MailboxHttpRouterOptions): MailboxHttpRouter {
  const maxBodyBytes = options.maxBodyBytes ?? MAILBOX_HTTP_MAX_BODY_BYTES;
  const closeSseStreams = new Set<() => void>();

  return {
    async handle(request, response, routePath): Promise<void> {
      try {
        const url = routePath ?? request.url ?? '/';
        const method = request.method ?? 'GET';

        // Health probes deliberately bypass auth and rate limiting. The route
        // reveals only process liveness and remains compatible with the
        // standalone bridge's lock-file probe.
        if (method === 'GET' && url === '/healthz') {
          writeJson(response, 200, { ok: true });
          return;
        }

        const access: MailboxHttpAccessDecision = options.authorize
          ? await options.authorize(request)
          : { allowed: true };
        if (!access.allowed) {
          writeJson(
            response,
            access.status ?? 401,
            access.body ?? {
              error: { code: 'UNAUTHORIZED', message: 'invalid or missing bearer token' },
            },
          );
          return;
        }

        if (
          options.rateLimiter &&
          access.rateLimitKey !== undefined &&
          !options.rateLimiter.allow(access.rateLimitKey)
        ) {
          writeJson(response, 429, {
            error: {
              code: 'RATE_LIMITED',
              message: `rate limit exceeded: max ${options.rateLimiter.limit} requests per ${options.rateLimiter.windowMs / 1000}s`,
            },
          });
          return;
        }

        await dispatchMailboxRoute(
          options.mailbox,
          options.eventEmitter,
          request,
          response,
          method,
          url,
          maxBodyBytes,
          closeSseStreams,
        );
      } catch (error) {
        const code = error instanceof MailboxHttpValidationError
          ? 'VALIDATION_ERROR'
          : 'INTERNAL_ERROR';
        const status = code === 'VALIDATION_ERROR' ? 400 : 500;
        writeJson(response, status, {
          error: {
            code,
            message: error instanceof Error ? error.message : 'unknown error',
          },
        });
      }
    },
    close(): void {
      for (const close of [...closeSseStreams]) close();
      closeSseStreams.clear();
    },
  };
}

async function dispatchMailboxRoute(
  mailbox: Mailbox,
  eventEmitter: MailboxEventEmitter | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  url: string,
  maxBodyBytes: number,
  closeSseStreams: Set<() => void>,
): Promise<void> {
  if (method === 'POST' && url === '/mailbox/send') {
    const input = validateSend(await readJsonBody(request, maxBodyBytes));
    writeJson(response, 201, await mailbox.send(input));
    return;
  }
  if (method === 'POST' && url === '/mailbox/query') {
    const messages = await mailbox.query(validateQuery(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { data: messages, count: messages.length });
    return;
  }
  if (method === 'POST' && url === '/mailbox/check') {
    const result = await checkMailbox(
      mailbox,
      validateCheck(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, result);
    return;
  }
  if (method === 'POST' && url === '/mailbox/ack') {
    const updated = await mailbox.ack(validateAck(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { updated });
    return;
  }
  if (method === 'POST' && url === '/mailbox/ack-many') {
    const updated = await mailbox.ackMany(
      validateAckMany(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, { updated, count: updated.length });
    return;
  }
  if (method === 'POST' && url === '/mailbox/unread-count') {
    const body = await readJsonBody(request, maxBodyBytes);
    writeJson(response, 200, { count: await mailbox.unreadCount(requireString(body, 'forAgentId')) });
    return;
  }
  if (method === 'POST' && url === '/mailbox/agents/register') {
    await mailbox.registerAgent(validateAgentRegistration(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && url === '/mailbox/agents/heartbeat') {
    await mailbox.heartbeat(validateAgentHeartbeat(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && url === '/mailbox/register-client') {
    await mailbox.registerClient(validateClientRegistration(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && url === '/mailbox/heartbeat') {
    await mailbox.clientHeartbeat(validateClientHeartbeat(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && url === '/mailbox/purge-clients') {
    writeJson(response, 200, { ok: true, purged: await mailbox.purgeClients() });
    return;
  }
  if (method === 'GET' && url === '/mailbox/agents') {
    const agents = await mailbox.getAgentStatuses();
    writeJson(response, 200, { data: agents, count: agents.length });
    return;
  }
  if (method === 'GET' && url === '/mailbox/agents/online') {
    const agents = await mailbox.getOnlineAgents();
    writeJson(response, 200, { data: agents, count: agents.length });
    return;
  }
  if (method === 'GET' && url === '/mailbox/events' && eventEmitter) {
    handleSse(request, response, eventEmitter, closeSseStreams);
    return;
  }

  writeJson(response, 404, {
    error: { code: 'NOT_FOUND', message: `no route for ${method} ${url}` },
  });
}

function handleSse(
  request: IncomingMessage,
  response: ServerResponse,
  eventEmitter: MailboxEventEmitter,
  closeSseStreams: Set<() => void>,
): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write(': connected\n\n');

  const unsubscribe = eventEmitter.subscribe((event) => {
    try {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      unsubscribe();
    }
  });
  const keepAlive = setInterval(() => {
    try {
      response.write(': keepalive\n\n');
    } catch {
      clearInterval(keepAlive);
    }
  }, 15_000);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    unsubscribe();
    closeSseStreams.delete(close);
    try {
      response.end();
    } catch {
      // The client already closed the stream.
    }
  };
  closeSseStreams.add(close);
  request.once('close', close);
}

async function readJsonBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const lengthHeader = request.headers['content-length'];
  if (typeof lengthHeader === 'string') {
    const declared = Number.parseInt(lengthHeader, 10);
    if (Number.isInteger(declared) && declared > maxBodyBytes) {
      throw validationError(`request body too large: ${declared} bytes (max ${maxBodyBytes})`);
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > maxBodyBytes) {
      throw validationError(`request body too large: > ${maxBodyBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (total === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    throw validationError(
      `invalid JSON body: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

class MailboxHttpValidationError extends Error {}

function validationError(message: string): MailboxHttpValidationError {
  return new MailboxHttpValidationError(message);
}

function requireString(object: unknown, key: string): string {
  if (typeof object !== 'object' || object === null) {
    throw validationError('expected JSON object body');
  }
  const value = (object as Record<string, unknown>)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw validationError(`field "${key}" is required (string)`);
  }
  return value;
}

function requireNumber(object: unknown, key: string): number {
  if (typeof object !== 'object' || object === null) {
    throw validationError('expected JSON object body');
  }
  const value = (object as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw validationError(`field "${key}" is required (integer)`);
  }
  return value;
}

function optionalString(object: unknown, key: string): string | undefined {
  if (typeof object !== 'object' || object === null) return undefined;
  const value = (object as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw validationError(`field "${key}" must be a string when present`);
  }
  return value;
}

function optionalNumber(object: unknown, key: string): number | undefined {
  if (typeof object !== 'object' || object === null) return undefined;
  const value = (object as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') {
    throw validationError(`field "${key}" must be a number when present`);
  }
  return value;
}

function optionalBoolean(object: unknown, key: string): boolean | undefined {
  if (typeof object !== 'object' || object === null) return undefined;
  const value = (object as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw validationError(`field "${key}" must be a boolean when present`);
  }
  return value;
}

const VALID_TYPES = new Set([
  'note',
  'ask',
  'assign',
  'steer',
  'btw',
  'broadcast',
  'status',
  'result',
  'review',
  'control',
]);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);
const RESERVED_FROM_IDS = new Set([
  'leader',
  'fleet',
  'hq',
  'mailbox-bridge',
  'mailbox-bridge-watchdog',
  'tech-stack-consumer',
  '*',
]);
const RESERVED_READER_IDS = new Set([
  'leader',
  'fleet',
  'hq',
  'mailbox-bridge',
  'mailbox-bridge-watchdog',
  'tech-stack-consumer',
]);

function validateReaderId(id: string): void {
  const base = id.split('@')[0]!.toLowerCase();
  if (RESERVED_READER_IDS.has(base)) {
    throw validationError(`"readerId" must not use reserved internal agent id "${base}"`);
  }
}

function validateSend(body: unknown): MailboxSendInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const type = requireString(object, 'type');
  if (!VALID_TYPES.has(type)) {
    throw validationError(`field "type" must be one of ${[...VALID_TYPES].join(', ')}`);
  }
  const priority = optionalString(object, 'priority');
  if (priority !== undefined && !VALID_PRIORITIES.has(priority)) {
    throw validationError(`field "priority" must be one of ${[...VALID_PRIORITIES].join(', ')}`);
  }
  const from = requireString(object, 'from');
  const fromBase = from.split('@')[0]!.toLowerCase();
  if (RESERVED_FROM_IDS.has(fromBase)) {
    throw validationError(
      `field "from" must not use reserved internal agent id "${fromBase}" — external agents must use their own identity`,
    );
  }

  const result: MailboxSendInput = {
    from,
    to: requireString(object, 'to'),
    type: type as MailboxSendInput['type'],
    subject: requireString(object, 'subject'),
    body: requireString(object, 'body'),
    priority: priority as MailboxSendInput['priority'],
  };
  const replyTo = optionalString(object, 'replyTo');
  if (replyTo !== undefined) result.replyTo = replyTo;
  const ttlMs = optionalNumber(object, 'ttlMs');
  if (ttlMs !== undefined) result.ttlMs = ttlMs;
  return result;
}

function validateQuery(body: unknown): MailboxQuery {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const result: MailboxQuery = {};
  const to = optionalString(object, 'to');
  const from = optionalString(object, 'from');
  const unreadBy = optionalString(object, 'unreadBy');
  const type = optionalString(object, 'type');
  const minPriority = optionalString(object, 'minPriority');
  const since = optionalString(object, 'since');
  const limit = optionalNumber(object, 'limit');
  const incompleteOnly = optionalBoolean(object, 'incompleteOnly');
  if (to !== undefined) result.to = to;
  if (from !== undefined) result.from = from;
  if (unreadBy !== undefined) result.unreadBy = unreadBy;
  if (type !== undefined) {
    if (!VALID_TYPES.has(type)) {
      throw validationError(`field "type" must be one of ${[...VALID_TYPES].join(', ')}`);
    }
    result.type = type as MailboxQuery['type'];
  }
  if (minPriority !== undefined) {
    if (!VALID_PRIORITIES.has(minPriority)) {
      throw validationError(
        `field "minPriority" must be one of ${[...VALID_PRIORITIES].join(', ')}`,
      );
    }
    result.minPriority = minPriority as MailboxQuery['minPriority'];
  }
  if (since !== undefined) result.since = since;
  if (limit !== undefined) result.limit = limit;
  if (incompleteOnly !== undefined) result.incompleteOnly = incompleteOnly;
  return result;
}

interface MailboxCheckInput {
  agentId: string;
  baseId?: string;
  limit?: number;
  markRead?: boolean;
  completed?: boolean;
  outcome?: string;
}

async function checkMailbox(
  mailbox: Mailbox,
  input: MailboxCheckInput,
): Promise<{ data: MailboxMessage[]; count: number }> {
  const limit = input.limit ?? 20;
  const markRead = input.markRead ?? true;
  const completed = input.completed ?? false;
  const targets = input.baseId !== undefined && input.baseId !== input.agentId
    ? [input.agentId, input.baseId]
    : [input.agentId];
  const batches = await Promise.all(
    targets.map((to) => mailbox.query({ to, unreadBy: input.agentId, limit })),
  );
  const seen = new Set<string>();
  const messages = batches
    .flat()
    .filter((message) => {
      if (seen.has(message.id) || message.from === input.agentId) return false;
      seen.add(message.id);
      return true;
    })
    .slice(0, limit);
  const data = markRead || completed
    ? await mailbox.ackMany({
        acks: messages.map((message) => ({
          messageId: message.id,
          readerId: input.agentId,
          read: markRead,
          completed,
          outcome: completed ? input.outcome : undefined,
        })),
      })
    : messages;
  return { data, count: data.length };
}

function validateCheck(body: unknown): MailboxCheckInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const result: MailboxCheckInput = { agentId: requireString(object, 'agentId') };
  const baseId = optionalString(object, 'baseId');
  const limit = optionalNumber(object, 'limit');
  const markRead = optionalBoolean(object, 'markRead');
  const completed = optionalBoolean(object, 'completed');
  const outcome = optionalString(object, 'outcome');
  if (baseId !== undefined) result.baseId = baseId;
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw validationError('field "limit" must be a positive integer when present');
    }
    result.limit = limit;
  }
  if (markRead !== undefined) result.markRead = markRead;
  if (completed !== undefined) result.completed = completed;
  if (outcome !== undefined) result.outcome = outcome;
  return result;
}

function validateAck(body: unknown): MailboxAckInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const readerId = requireString(object, 'readerId');
  validateReaderId(readerId);
  const result: MailboxAckInput = {
    messageId: requireString(object, 'messageId'),
    readerId,
  };
  const read = optionalBoolean(object, 'read');
  const completed = optionalBoolean(object, 'completed');
  const outcome = optionalString(object, 'outcome');
  if (read !== undefined) result.read = read;
  if (completed !== undefined) result.completed = completed;
  if (outcome !== undefined) result.outcome = outcome;
  return result;
}

function validateAckMany(body: unknown): MailboxAckBatchInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const raw = (body as Record<string, unknown>)['acks'];
  if (!Array.isArray(raw)) throw validationError('field "acks" is required (array)');
  return { acks: raw.map((entry) => validateAck(entry)) };
}

function validateAgentRegistration(body: unknown): AgentRegistrationInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const agentId = requireString(object, 'agentId');
  validateReaderId(agentId);
  const result: AgentRegistrationInput = {
    agentId,
    sessionId: optionalString(object, 'sessionId') ?? 'external',
    name: requireString(object, 'name'),
    pid: requireNumber(object, 'pid'),
    source: 'http',
  };
  const role = optionalString(object, 'role');
  if (role !== undefined) result.role = role;
  return result;
}

function validateAgentHeartbeat(body: unknown): AgentHeartbeatInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const result: AgentHeartbeatInput = { agentId: requireString(object, 'agentId') };
  const status = optionalString(object, 'status');
  const currentTool = optionalString(object, 'currentTool');
  const currentTask = optionalString(object, 'currentTask');
  const iterations = optionalNumber(object, 'iterations');
  const toolCalls = optionalNumber(object, 'toolCalls');
  if (status !== undefined) result.status = status as AgentHeartbeatInput['status'];
  if (currentTool !== undefined) result.currentTool = currentTool;
  if (currentTask !== undefined) result.currentTask = currentTask;
  if (iterations !== undefined) result.iterations = iterations;
  if (toolCalls !== undefined) result.toolCalls = toolCalls;
  return result;
}

function validateClientRegistration(body: unknown): ClientRegistrationInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  return {
    clientId: requireString(object, 'clientId'),
    sessionId: optionalString(object, 'sessionId') ?? 'external',
    name: requireString(object, 'name'),
    source: 'http',
    pid: requireNumber(object, 'pid'),
  };
}

function validateClientHeartbeat(body: unknown): ClientHeartbeatInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const clientId = requireString(object, 'clientId');
  const sessionId = optionalString(object, 'sessionId');
  return sessionId ? { clientId, sessionId } : { clientId };
}
