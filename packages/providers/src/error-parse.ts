import type { ProviderErrorBody } from '@wrongstack/core';
import { classifyProviderError, isRetryableKind, ProviderError } from '@wrongstack/core';
import { isPlainObject } from './object-utils.js';

/**
 * Provider HTTP error bodies come in three or four shapes depending on
 * vendor. Rather than dump the raw JSON into the error message (which is
 * what was shipped to the user log before this module existed), we parse
 * out the fields we care about — `type`, `message`, `requestId` — and put
 * them on `ProviderError.body` for `describe()` and downstream rendering.
 *
 * The function is intentionally tolerant: anything we can't parse falls
 * back to a truncated raw string, never throws.
 */
export function parseProviderHttpError(
  providerId: string,
  status: number,
  rawText: string,
  headers?: HeadersLike,
): ProviderError {
  const body = parseBody(rawText);
  const retryAfterMs = retryAfterMsFromHeaders(headers);
  if (retryAfterMs !== undefined) body.retryAfterMs = retryAfterMs;
  const kind = classifyProviderError(status, body);
  const message = `${providerId} HTTP ${status}`;
  return new ProviderError(message, status, isRetryableKind(kind), providerId, { body, kind });
}

/** Structural subset of the Fetch `Headers` interface, easy to fake in tests. */
export interface HeadersLike {
  get(name: string): string | null;
}

/**
 * Parse a Retry-After hint from HTTP response headers into milliseconds.
 *
 * Handles the three shapes seen in the wild:
 *  - `retry-after-ms: 1500` — milliseconds (Anthropic, some OpenAI-compatibles)
 *  - `retry-after: 12` — delta-seconds (RFC 9110)
 *  - `retry-after: Wed, 21 Oct 2026 07:28:00 GMT` — HTTP-date
 *
 * Returns `undefined` for missing/unparseable/non-positive values so callers
 * fall through to their exponential backoff schedule.
 */
export function retryAfterMsFromHeaders(headers?: HeadersLike): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get('retry-after-ms');
  if (ms) {
    const n = Number(ms);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  const ra = headers.get('retry-after');
  if (!ra) return undefined;
  const secs = Number(ra);
  if (Number.isFinite(secs) && secs > 0) return Math.round(secs * 1000);
  const date = Date.parse(ra);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    if (delta > 0) return delta;
  }
  return undefined;
}

const RAW_TRUNCATE_AT = 2000;

function parseBody(rawText: string): ProviderErrorBody {
  const raw = rawText.slice(0, RAW_TRUNCATE_AT);
  // Surface truncation so downstream renderers (CLI error formatter, log
  // exporter) can show a "(truncated, N more bytes)" suffix instead of
  // silently dropping the rest of the provider's error tail.
  const body: ProviderErrorBody =
    rawText.length > RAW_TRUNCATE_AT
      ? { raw, truncated: true, rawLength: rawText.length }
      : { raw };
  if (!rawText.trim()) return body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return body;
  }
  if (!isPlainObject(parsed)) return body;

  // Anthropic / MiniMax / Kimi: { type: "error", error: { type, message }, request_id }
  // OpenAI / OpenAI-compatible: { error: { message, type, code, param } }
  // Google: { error: { code, message, status } }
  const errField = parsed['error'];
  if (isPlainObject(errField)) {
    const t = stringOf(errField['type']) ?? stringOf(errField['status']);
    const m = stringOf(errField['message']);
    if (t) body.type = t;
    if (m) body.message = m;
  } else if (typeof errField === 'string') {
    body.message = errField;
  }
  // Top-level fields some providers use directly
  if (!body.type) {
    const t = stringOf(parsed['type']);
    if (t && t !== 'error') body.type = t;
  }
  if (!body.message) {
    const m = stringOf(parsed['message']);
    if (m) body.message = m;
  }

  // request_id (Anthropic), id (some compatible providers)
  const reqId =
    stringOf(parsed['request_id']) ?? stringOf(parsed['requestId']) ?? stringOf(parsed['id']);
  if (reqId) body.requestId = reqId;

  return body;
}

function stringOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
