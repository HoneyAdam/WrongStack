import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { MailboxEventEmitter } from './mailbox-events.js';
import { resolveSendType } from './mailbox-message-codec.js';
import type {
  AgentHeartbeatInput,
  AgentRegistrationInput,
  ClientHeartbeatInput,
  ClientRegistrationInput,
  Mailbox,
  MailboxAckBatchInput,
  MailboxAckInput,
  MailboxAudience,
  MailboxMessage,
  MailboxMessageType,
  MailboxQuery,
  MailboxSendInput,
} from './mailbox-types.js';
import {
  isMailboxMessageVisibleTo,
  MAILBOX_TYPE_PROPERTIES,
  normalizeRecipient,
} from './mailbox-types.js';

export const MAILBOX_HTTP_MAX_BODY_BYTES = 256 * 1024;
export const MAILBOX_HTTP_RATE_LIMIT_PER_MINUTE = 120;
export const MAILBOX_HTTP_RATE_LIMIT_WINDOW_MS = 60_000;

// Filter bounds shipped with the router: `MAILBOX_HTTP_DEFAULT_MAX_AGE_MS`
// is a 1-hour reference default callers may opt into via the `defaultMaxAgeMs`
// option; `MAILBOX_HTTP_MAX_AGE_CEILING_MS` is the per-request look-back
// ceiling at 7 days. The router does NOT enable a look-back automatically —
// leaving `defaultMaxAgeMs` `undefined` returns every retained message; the
// per-request `?sinceMs=0` URL query parameter remains the disable sentinel
// for the URL param.
export const MAILBOX_HTTP_DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
export const MAILBOX_HTTP_MAX_AGE_CEILING_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
  /**
   * Server-default look-back window for mailbox routes that return
   * `MailboxMessage` records (`/mailbox/query`, `/mailbox/check`,
   * `/mailbox/events`).
   *
   * The filter is **opt-in**: leaving `defaultMaxAgeMs` `undefined`
   * (the default) leaves the filter disabled and every retained
   * message is eligible to be returned or streamed. Pass an explicit
   * non-negative integer (e.g. `60 * 60_000` for a 1-hour look-back,
   * or {@link MAILBOX_HTTP_DEFAULT_MAX_AGE_MS}) to activate it.
   *
   * Mail older than the resolved look-back is filtered out of JSON
   * responses and from SSE delivery so polling agents are never
   * flooded with stale mail. The library intentionally does NOT
   * enable a default look-back; host integrators that want the
   * 1-hour server default must opt in explicitly.
   *
   * Per-request override: callers may append `?sinceMs=<ms>` to the
   * request URL (the URL is rewritten by hosts that mount the router
   * below a prefix). `0` opts in to the full retained history (matches
   * the disable semantics of `defaultMaxAgeMs` below) and any positive
   * value above {@link MAILBOX_HTTP_MAX_AGE_CEILING_MS} is silently
   * clamped to that ceiling — this is a soft cap, not a hard rejection.
   *
   * Disabling the filter server-wide: pass `defaultMaxAgeMs` as
   * `undefined` (the default), any negative number (`-1` is the
   * canonical test-suite escape hatch), any non-finite value (`NaN`,
   * `Infinity`, `-Infinity`), or `0`. `0` here is reserved because
   * `now - 0` would otherwise map to the current instant and hide
   * every retained message; `resolveDefault()` therefore treats `0` as
   * equivalent to "disabled" via the same sentinel path as
   * `undefined` / negative / non-finite values. The per-request
   * `?sinceMs=0` URL parameter and the server-side `defaultMaxAgeMs=0`
   * option therefore share identical "no filter" semantics.
   */
  defaultMaxAgeMs?: number;
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
  handle(request: IncomingMessage, response: ServerResponse, routePath?: string): Promise<void>;
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
  // Coerce JSON-spread `null` to `undefined` so the documented "absent
  // means disabled" sentinel path at `resolveDefault()` is the single
  // source of truth — callers that JSON-decode `{ defaultMaxAgeMs: null }`
  // and spread it would otherwise leak `null` through, which `!Number.isFinite`
  // silently treats as a disable but the JSDoc only documents for
  // `undefined` / negative / non-finite / `0`. See JSDoc on
  // `MailboxHttpRouterOptions.defaultMaxAgeMs`.
  const defaultMaxAgeMs = options.defaultMaxAgeMs ?? undefined;
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
          const forwardedFor = request.headers['x-forwarded-for'];
          const clientIp =
            (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() ??
            request.socket?.remoteAddress ??
            'unknown';
          console.warn(
            JSON.stringify({
              level: 'warn',
              event: 'mailbox.http_auth_failure',
              message: `Mailbox HTTP auth rejected for ${request.method ?? '?'} ${request.url ?? '?'} from ${clientIp}`,
              method: request.method,
              url: request.url,
              clientIp,
              timestamp: new Date().toISOString(),
            }),
          );
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
          defaultMaxAgeMs,
          closeSseStreams,
          routePath,
        );
      } catch (error) {
        const code =
          error instanceof MailboxHttpValidationError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
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
  defaultMaxAgeMs: number | undefined,
  closeSseStreams: Set<() => void>,
  routePath?: string,
): Promise<void> {
  // The look-back window is a per-route concern — only the routes that
  // return `MailboxMessage` records (query, check, events) care. We
  // resolve it lazily inside each handler so a malformed `?sinceMs=…`
  // on an unknown route still surfaces as 404 NOT_FOUND rather than
  // being shadowed by a 400 VALIDATION_ERROR.
  //
  // The dispatched `url` may carry a query string (routePath-as-mounted
  // by hosts, or `?sinceMs=…` for the per-request override). Strip the
  // `?…` portion before matching the canonical route table; the full
  // `url` is still available to `parseSinceMs()` and the 404 message.
  //
  // Contract: `routePath` may carry an OPTIONAL per-request query
  // string (e.g. `?sinceMs=0`) — hosts mount the canonical routes at
  // a prefix and the query is forwarded verbatim so the router's
  // `parseSinceMs()` sees the override. Only a literal `?` at position
  // 0 of the resolved URL is rejected: that signals the request URL
  // itself (or the rewritten routePath) starts with a query character,
  // which is always a host-side mistake. Mid-path `?` segments from a
  // sloppy prefix (e.g. `/api?token=…`) would still be misparsed, so
  // hosts must mount the router below a path-only prefix.
  //
  // Note: a `?` in the *resolved* URL is legitimate when the request
  // URL (or the per-request `?sinceMs=…` override) carries one.
  if (routePath !== undefined && routePath.indexOf('?') === 0) {
    throw validationError(`routePath must not start with '?' (got ${JSON.stringify(routePath)})`);
  }
  // Hosts may legitimately append a per-request query (e.g. `?sinceMs=0`)
  // to the rewritten route path. Strip it here so the canonical route
  // table matches the path-only form; the full `url` (path + query) is
  // still passed to `parseSinceMs()` for per-request overrides.
  const queryIndex = url.indexOf('?');
  const path = queryIndex === -1 ? url : url.slice(0, queryIndex);

  if (method === 'POST' && path === '/mailbox/send') {
    const input = validateSend(await readJsonBody(request, maxBodyBytes));
    writeJson(response, 201, await mailbox.send(input));
    return;
  }
  if (method === 'POST' && path === '/mailbox/query') {
    const queryContext = parseSinceMs(url, defaultMaxAgeMs);
    if ('error' in queryContext) {
      writeJson(response, 400, { error: queryContext.error });
      return;
    }
    const messages = await mailbox.query(validateQuery(await readJsonBody(request, maxBodyBytes)));
    const filtered = filterMailboxMessagesByTimestamp(messages, queryContext.minTimestampIso);
    writeJson(response, 200, { data: filtered, count: filtered.length });
    return;
  }
  if (method === 'POST' && path === '/mailbox/check') {
    const queryContext = parseSinceMs(url, defaultMaxAgeMs);
    if ('error' in queryContext) {
      writeJson(response, 400, { error: queryContext.error });
      return;
    }
    const result = await checkMailbox(
      mailbox,
      validateCheck(await readJsonBody(request, maxBodyBytes)),
      queryContext.minTimestampIso,
    );
    writeJson(response, 200, result);
    return;
  }
  if (method === 'POST' && path === '/mailbox/ack') {
    const updated = await mailbox.ack(validateAck(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { updated });
    return;
  }
  if (method === 'POST' && path === '/mailbox/ack-many') {
    const updated = await mailbox.ackMany(
      validateAckMany(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, { updated, count: updated.length });
    return;
  }
  if (method === 'POST' && path === '/mailbox/unread-count') {
    const body = await readJsonBody(request, maxBodyBytes);
    writeJson(response, 200, {
      count: await mailbox.unreadCount(requireString(body, 'forAgentId')),
    });
    return;
  }
  if (method === 'POST' && path === '/mailbox/agents/register') {
    await mailbox.registerAgent(
      validateAgentRegistration(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && path === '/mailbox/agents/heartbeat') {
    await mailbox.heartbeat(validateAgentHeartbeat(await readJsonBody(request, maxBodyBytes)));
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && path === '/mailbox/register-client') {
    await mailbox.registerClient(
      validateClientRegistration(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && path === '/mailbox/heartbeat') {
    await mailbox.clientHeartbeat(
      validateClientHeartbeat(await readJsonBody(request, maxBodyBytes)),
    );
    writeJson(response, 200, { ok: true });
    return;
  }
  if (method === 'POST' && path === '/mailbox/purge-clients') {
    writeJson(response, 200, { ok: true, purged: await mailbox.purgeClients() });
    return;
  }
  if (method === 'GET' && path === '/mailbox/agents') {
    const agents = await mailbox.getAgentStatuses();
    writeJson(response, 200, { data: agents, count: agents.length });
    return;
  }
  if (method === 'GET' && path === '/mailbox/agents/online') {
    const agents = await mailbox.getOnlineAgents();
    writeJson(response, 200, { data: agents, count: agents.length });
    return;
  }
  if (method === 'GET' && path === '/mailbox/events' && eventEmitter) {
    const queryContext = parseSinceMs(url, defaultMaxAgeMs);
    if ('error' in queryContext) {
      writeJson(response, 400, { error: queryContext.error });
      return;
    }
    handleSse(request, response, eventEmitter, queryContext.minTimestampIso, closeSseStreams);
    return;
  }

  writeJson(response, 404, {
    error: { code: 'NOT_FOUND', message: `no route for ${method} ${url}` },
  });
}

/**
 * Pull a timestamp off an SSE event for the staleness-filter check.
 *
 * SSE events arrive in two shapes:
 *   - Top-level `{ timestamp: string, ... }` — produced by
 *     `MailboxEventEmitter` directly when a single mail is forwarded.
 *   - Nested `{ messageSent: { timestamp: string, ... }, ... }` —
 *     produced when a peer bridge forwards a messageSent replay event.
 *
 * `messageSent` and `ackUpdated` are the documented nested shapes today;
 * if new shapes are added, extend the `nestedKeys` set below. Returns
 * `undefined` for any non-object event or when no recognised timestamp
 * field is present, in which case the filter is skipped (preserves the
 * pre-filter behaviour: drop nothing we cannot classify).
 */
function extractEventTimestamp(event: unknown): string | undefined {
  if (event === null || typeof event !== 'object') return undefined;
  const top = (event as { timestamp?: unknown }).timestamp;
  if (typeof top === 'string') return top;
  // Walk one level into known nested shapes.
  const nestedKeys = ['messageSent', 'ackUpdated'] as const;
  for (const key of nestedKeys) {
    const nested = (event as Record<string, unknown>)[key];
    if (nested !== null && typeof nested === 'object') {
      const inner = (nested as { timestamp?: unknown }).timestamp;
      if (typeof inner === 'string') return inner;
    }
  }
  return undefined;
}

function isEventOlderThan(event: unknown, minTimestampIso: string): boolean {
  const eventTimestamp = extractEventTimestamp(event);
  if (eventTimestamp === undefined) return false;
  return eventTimestamp < minTimestampIso;
}

function handleSse(
  request: IncomingMessage,
  response: ServerResponse,
  eventEmitter: MailboxEventEmitter,
  minTimestampIso: string | undefined,
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
      // SSE events carry a `timestamp` field at the top level. Some event
      // shapes (e.g. `messageSent`) wrap the timestamp inside a nested
      // payload — `extractEventTimestamp()` walks one level into the known
      // nested shape so a long-lived SSE subscriber is not flooded by
      // bulk historical mail forwarded by another bridge whose outer
      // timestamp is fresh but whose nested timestamp is stale.
      if (minTimestampIso !== undefined && isEventOlderThan(event, minTimestampIso)) {
        return;
      }
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
  if (value === undefined) return undefined;
  if (value === null) {
    throw validationError(`field "${key}" must not be null when present`);
  }
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

/**
 * Resolves the look-back window for one HTTP request.
 *
 * Behaviour matrix:
 *
 *   - Default disabled (`defaultMaxAgeMs = -1`, the test-suite escape hatch):
 *     filter is off, every message regardless of age is retained.
 *   - Default enabled with no per-request override: filter is `now - defaultMaxAgeMs`.
 *   - Per-request `?sinceMs=N`:
 *       N = 0 → no filter (retain everything currently held).
 *       N > 0 → filter is `now - min(N, MAILBOX_HTTP_MAX_AGE_CEILING_MS)`.
 *       N out of range, NaN, non-integer, or non-numeric → `400 VALIDATION_ERROR`.
 *
 * Returns the resolved cut-off as an ISO-8601 string suitable for
 * lexicographic comparison against `MailboxMessage.timestamp` (every
 * timestamp in the mailbox store is UTC-encoded, so string comparison
 * is monotonic).
 */
type SinceResolution =
  | { minTimestampIso: string | undefined }
  | { error: { code: 'VALIDATION_ERROR'; message: string } };

function parseSinceMs(url: string, defaultMaxAgeMs: number | undefined): SinceResolution {
  // The router dispatches by `url` (which is the rewritten `routePath`
  // when the host mounts the router below a prefix, or the raw
  // `request.url`). Strip the optional query string before scanning for
  // the `sinceMs` parameter.
  //
  // Invariant: `routePath` provided by hosts never contains a literal `?`
  // — the router's canonical `/mailbox/*` routes are fixed strings without
  // query characters. `indexOf('?')` therefore always locates the true
  // query boundary, so any `?`-containing suffix is the entire query
  // string and any `&`-separated pairs belong to the query, not to a
  // forged prefix.
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return resolveDefault(defaultMaxAgeMs, Date.now());
  const params = new URLSearchParams(url.slice(queryStart + 1));
  if (!params.has('sinceMs')) return resolveDefault(defaultMaxAgeMs, Date.now());

  const raw = params.get('sinceMs');
  if (raw === null || raw === undefined || raw === '') {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'query parameter "sinceMs" is required (integer in milliseconds) when present',
      },
    };
  }
  // Only digits are accepted; the URLSearchParams parser already rejects
  // `?sinceMs=abc` (it's string-coerced) but explicit guard prevents
  // accidental floats like `1.5` or padded forms slipping through.
  if (!/^\d+$/.test(raw)) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'query parameter "sinceMs" must be a non-negative integer (milliseconds)',
      },
    };
  }
  const requestedMs = Number(raw);
  if (!Number.isFinite(requestedMs) || requestedMs > Number.MAX_SAFE_INTEGER) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: `query parameter "sinceMs" is out of range (max ${Number.MAX_SAFE_INTEGER})`,
      },
    };
  }
  const now = Date.now();
  if (requestedMs === 0) return { minTimestampIso: undefined };
  const effectiveMs = Math.min(requestedMs, MAILBOX_HTTP_MAX_AGE_CEILING_MS);
  return { minTimestampIso: new Date(now - effectiveMs).toISOString() };
}

function resolveDefault(defaultMaxAgeMs: number | undefined, now: number): SinceResolution {
  // Sentinel values that disable the look-back filter entirely:
  //   - undefined caller (`defaultMaxAgeMs` never assigned)
  //   - any non-finite number (`NaN`, `Infinity`, `-Infinity`)
  //   - any negative number (the test-suite escape hatch, e.g. `-1`)
  //   - exactly `0` — reserved because `now - 0` would otherwise map
  //     to the current instant and hide every retained message; the
  //     JSDoc on `MailboxHttpRouterOptions.defaultMaxAgeMs` calls this
  //     out as equivalent to "disabled".
  if (
    defaultMaxAgeMs === undefined ||
    !Number.isFinite(defaultMaxAgeMs) ||
    defaultMaxAgeMs < 0 ||
    defaultMaxAgeMs === 0
  ) {
    return { minTimestampIso: undefined };
  }
  return { minTimestampIso: new Date(now - defaultMaxAgeMs).toISOString() };
}

function filterMailboxMessagesByTimestamp(
  messages: readonly MailboxMessage[],
  minTimestampIso: string | undefined,
): MailboxMessage[] {
  if (minTimestampIso === undefined) return messages.slice();
  return messages.filter((message) => message.timestamp >= minTimestampIso);
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

/**
 * Valid types derived from the canonical MAILBOX_TYPE_PROPERTIES table.
 * Stays in sync automatically as the type union evolves.
 */
const VALID_TYPES = new Set(Object.keys(MAILBOX_TYPE_PROPERTIES) as MailboxMessageType[]);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);
const VALID_AUDIENCES = new Set<MailboxAudience>(['all', 'leaders']);
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
  if (!VALID_TYPES.has(type as MailboxMessageType)) {
    throw validationError(`field "type" must be one of ${[...VALID_TYPES].join(', ')}`);
  }
  const priority = optionalString(object, 'priority');
  if (priority !== undefined && !VALID_PRIORITIES.has(priority)) {
    throw validationError(`field "priority" must be one of ${[...VALID_PRIORITIES].join(', ')}`);
  }
  const audience = optionalString(object, 'audience');
  if (audience !== undefined && !VALID_AUDIENCES.has(audience as MailboxAudience)) {
    throw validationError(`field "audience" must be one of ${[...VALID_AUDIENCES].join(', ')}`);
  }
  const from = requireString(object, 'from');
  const fromBase = from.split('@')[0]!.toLowerCase();
  if (RESERVED_FROM_IDS.has(fromBase)) {
    throw validationError(
      `field "from" must not use reserved internal agent id "${fromBase}" — external agents must use their own identity`,
    );
  }
  const to = normalizeRecipient(requireString(object, 'to'));

  // Cross-field (type, to) validation must use the same canonical recipient
  // that is forwarded to and persisted by the mailbox.
  try {
    resolveSendType(type as MailboxMessageType, to);
  } catch (err) {
    throw validationError(`field "type" is invalid: ${(err as Error).message}`);
  }

  const result: MailboxSendInput = {
    from,
    to,
    type: type as MailboxSendInput['type'],
    subject: requireString(object, 'subject'),
    body: requireString(object, 'body'),
    priority: priority as MailboxSendInput['priority'],
    ...(audience !== undefined ? { audience: audience as MailboxSendInput['audience'] } : {}),
  };
  const replyTo = optionalString(object, 'replyTo');
  if (replyTo !== undefined) result.replyTo = replyTo;
  const ttlMs = optionalNumber(object, 'ttlMs');
  if (ttlMs !== undefined) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1) {
      throw validationError('field "ttlMs" must be a positive integer when present');
    }
    result.ttlMs = ttlMs;
  }
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
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw validationError('field "limit" must be a positive integer when present');
    }
  }
  const incompleteOnly = optionalBoolean(object, 'incompleteOnly');
  if (to !== undefined) result.to = to;
  if (from !== undefined) result.from = from;
  if (unreadBy !== undefined) result.unreadBy = unreadBy;
  if (type !== undefined) {
    if (!VALID_TYPES.has(type as MailboxMessageType)) {
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
  minTimestampIso: string | undefined,
): Promise<{ data: MailboxMessage[]; count: number }> {
  const limit = input.limit ?? 20;
  const markRead = input.markRead ?? true;
  const completed = input.completed ?? false;
  const targets =
    input.baseId !== undefined && input.baseId !== input.agentId
      ? [input.agentId, input.baseId]
      : [input.agentId];
  const batches = await Promise.all(
    targets.map((to) => mailbox.query({ to, unreadBy: input.agentId, limit })),
  );
  // Apply the staleness filter up-front so a `?sinceMs=0` call cannot
  // ack messages that the filter then drops from the response — the
  // response set and the ack-set must stay in lock-step. The same
  // cut-off is reused by `/mailbox/query` and `/mailbox/events`.
  const withinWindow = filterMailboxMessagesByTimestamp(batches.flat(), minTimestampIso);
  const seen = new Set<string>();
  const messages = withinWindow
    .filter((message) => {
      if (seen.has(message.id) || message.from === input.agentId) return false;
      if (!isMailboxMessageVisibleTo(message, input.agentId)) return false;
      seen.add(message.id);
      return true;
    })
    .slice(0, limit);
  const data =
    markRead || completed
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
  const pid = requireNumber(object, 'pid');
  if (!Number.isInteger(pid) || pid < 1) {
    throw validationError('field "pid" must be a positive integer');
  }
  const result: AgentRegistrationInput = {
    agentId,
    sessionId: optionalString(object, 'sessionId') ?? 'external',
    name: requireString(object, 'name'),
    pid,
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
  if (iterations !== undefined) {
    if (!Number.isInteger(iterations) || iterations < 0) {
      throw validationError('field "iterations" must be a non-negative integer when present');
    }
    result.iterations = iterations;
  }
  if (toolCalls !== undefined) {
    if (!Number.isInteger(toolCalls) || toolCalls < 0) {
      throw validationError('field "toolCalls" must be a non-negative integer when present');
    }
    result.toolCalls = toolCalls;
  }
  return result;
}

function validateClientRegistration(body: unknown): ClientRegistrationInput {
  if (typeof body !== 'object' || body === null) {
    throw validationError('expected JSON object body');
  }
  const object = body as Record<string, unknown>;
  const pid = requireNumber(object, 'pid');
  if (!Number.isInteger(pid) || pid < 1) {
    throw validationError('field "pid" must be a positive integer');
  }
  return {
    clientId: requireString(object, 'clientId'),
    sessionId: optionalString(object, 'sessionId') ?? 'external',
    name: requireString(object, 'name'),
    source: 'http',
    pid,
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
