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
  // Prefer an explicit Retry-After HTTP header (the authoritative wire signal).
  const headerHint = retryAfterMsFromHeaders(headers);
  if (headerHint !== undefined) body.retryAfterMs = headerHint;
  // When no header was present, try to extract a reset time from the body
  // message text. Many Chinese providers (Z.AI, MiniMax, Moonshot) embed
  // "Your limit will reset at YYYY-MM-DD HH:mm:ss" in the JSON body instead
  // of sending an HTTP Retry-After header.
  if (body.retryAfterMs === undefined) {
    const bodyHint = retryAfterMsFromBody(body);
    if (bodyHint !== undefined) body.retryAfterMs = bodyHint;
  }
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

/**
 * Extract a retry-after duration from the provider's error body message text.
 * Called when no HTTP Retry-After header was present. Many providers,
 * particularly in the Chinese ecosystem (Z.AI, MiniMax, Moonshot), embed
 * the reset time in the JSON body message instead of sending a standard
 * `retry-after` header.
 *
 * Handles three patterns:
 *  - "Your limit will reset at YYYY-MM-DD HH:mm:ss" — absolute date-time
 *  - "Usage limit reached for X hour(s)" — relative duration from hours
 *  - "retry after X seconds" / "retry_after X" — relative seconds
 *
 * Returns `undefined` when no well-formed hint is found so callers fall
 * through to their exponential backoff schedule. Never throws.
 */
export function retryAfterMsFromBody(body: ProviderErrorBody): number | undefined {
  const text = [body.message, body.raw].filter(Boolean).join('\n');
  if (!text) return undefined;

  // 1. Absolute date-time: "...reset at YYYY-MM-DD HH:mm:ss..."
  const dateTimeRe =
    /(?:reset|renew|available)(?:s|ed|s)?\s*(?:at|on)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})[T\s](\d{1,2}:\d{2}(?::\d{2})?)/i;
  const dateMatch = dateTimeRe.exec(text);
  if (dateMatch) {
    // Construct ISO 8601 from the matched parts. Use the first date
    // found — the body is typically short enough that there's only one.
    const iso = `${dateMatch[1]}T${dateMatch[2]}`;
    const ms = Date.parse(iso);
    if (!Number.isNaN(ms)) {
      const delta = ms - Date.now();
      if (delta > 0) return delta; // full reset duration, may be hours
    }
  }

  // 2. Relative hours: "...reached for X hour(s)..."
  const hoursRe =
    /(?:usage|quota|rate|limit).{0,20}(?:reached|exceeded|exhausted).{0,20}(?:for|every|per)\s*(\d+)\s*hours?/i;
  const hoursMatch = hoursRe.exec(text);
  if (hoursMatch) {
    const hours = Number.parseInt(hoursMatch[1] ?? '', 10);
    if (hours >= 1 && hours <= 24) return hours * 3_600_000;
  }

  // 3. Relative seconds: "retry after X seconds", "retry_after X"
  const retryRe = /retry[_\s-]*(?:after|in)\s*(\d+)\s*(?:seconds?|secs?|s)?/i;
  const retryMatch = retryRe.exec(text);
  if (retryMatch) {
    const secs = Number.parseInt(retryMatch[1] ?? '', 10);
    if (secs >= 1) return secs * 1_000;
  }

  // 4. Common in 502 / gateway responses: "try again in X seconds",
  //    "please retry in X seconds", "back in X seconds/minutes"
  const tryAgainRe =
    /(?:try|retry|back|wait)\s*(?:again)?\s*(?:in|for|after)\s*(\d+)\s*(seconds?|secs?|s|minutes?|mins?|m)?/i;
  const tryAgainMatch = tryAgainRe.exec(text);
  if (tryAgainMatch) {
    const num = Number.parseInt(tryAgainMatch[1] ?? '', 10);
    const unit = (tryAgainMatch[2] ?? '').toLowerCase();
    if (unit.startsWith('m')) {
      // minutes
      if (num >= 1 && num <= 60) return num * 60_000;
    } else {
      // seconds (default)
      if (num >= 1 && num <= 300) return num * 1_000;
    }
  }

  return undefined;
}

function stringOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
