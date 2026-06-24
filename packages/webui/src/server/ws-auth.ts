/**
 * WebSocket connection authentication for the WebUI server.
 *
 * Three layered defenses, all enforced in {@link verifyClient}:
 *  1. **DNS-rebinding guard** ({@link hostHeaderOk}) — on a loopback bind the
 *     `Host` header must itself be a loopback name, so a rebound attacker page
 *     (`Host: evil.com`) is rejected even though its TCP peer is 127.0.0.1.
 *  2. **Shared-token auth** ({@link tokenMatches}, constant-time) — required for
 *     any non-loopback origin and for non-browser clients reaching a publicly
 *     bound socket. Tokens are accepted via `Cookie: ws_token=…` (preferred;
 *     set by the `/ws-auth` HTTP endpoint with HttpOnly+SameSite=Strict) OR
 *     `?token=…` URL query param (non-browser fallback).
 *  3. **Loopback bootstrap** — same-machine browser origins are allowed without
 *     a token; the Host-header guard above already blocks cross-site pages.
 *
 * Browser clients (those that send an `Origin` header) authenticate via the
 * HttpOnly cookie ONLY — the URL `?token=` path is rejected for them, closing
 * the C-598 (Information Exposure Through Query String) class (token in browser
 * history / referrer / proxy logs). The frontend bootstraps the cookie via
 * `ensureAuthCookie()` (a same-origin `/ws-auth` GET) before its first connect,
 * so the cookie is present on the WS upgrade. Non-browser clients (no `Origin`:
 * curl, scripts, tests) keep the URL-token path for ergonomics — query-string
 * exposure is a browser-only concern.
 *
 * Extracted from `index.ts` as pure functions so the auth contract can be unit
 * tested without standing up a real `http.Server`/`WebSocketServer`. `index.ts`
 * builds a thin closure that pulls the fields below off the incoming request.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

/** A hostname that refers to the local machine. */
export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * Check if an origin is a trusted loopback browser origin.
 * Defense-in-depth: when wsHost=0.0.0.0, only accept explicit localhost origins,
 * not arbitrary loopback hostnames that could be spoofed by local malware.
 */
function isTrustedLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    // Only allow http(s)://localhost(:PORT) and http(s)://127.0.0.1(:PORT)
    // Reject file://, data://, and other schemes even on loopback.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    // Require explicit localhost or 127.0.0.1 (not just any loopback like ::1)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** True when the server is bound to a loopback interface (vs. LAN/0.0.0.0). */
export function isLoopbackBind(wsHost: string): boolean {
  return wsHost === '127.0.0.1' || wsHost === '::1' || wsHost === 'localhost';
}

/**
 * True when the server is bound to a wildcard address that exposes it on every
 * interface — IPv4 `0.0.0.0` OR IPv6 `::` (and its bracketed form). The
 * "LAN exposure = deny" guards below must treat both families identically; a
 * `::` bind is exactly as exposed as `0.0.0.0` and previously slipped past the
 * `wsHost === '0.0.0.0'` string check.
 */
export function isWildcardBind(wsHost: string): boolean {
  return wsHost === '0.0.0.0' || wsHost === '::' || wsHost === '[::]';
}

/**
 * Constant-time comparison of a provided token against the expected one.
 * A length mismatch short-circuits (lengths aren't secret); equal-length
 * inputs are compared with `timingSafeEqual` so the token can't be recovered
 * byte-by-byte via response timing.
 */
export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pull the `token` query param out of a request URL (`/?token=…`). */
export function extractToken(url: string): string | undefined {
  const match = url.match(/[?&]token=([^&]+)/);
  return match ? match[1] : undefined;
}

/**
 * Pull the `ws_token` value out of a Cookie header (`Cookie: ws_token=…`).
 * The WebUI's auth-token cookie is set via `Set-Cookie: ws_token=<token>;
 * HttpOnly; SameSite=Strict; Path=/` from the `/ws-auth` HTTP endpoint. The
 * browser then sends it back automatically on the WS upgrade request —
 * closing the C-598 (Information Exposure Through Query String) class
 * because the token never appears in the URL, browser history, or
 * reverse-proxy access logs.
 *
 * Returns `undefined` if the cookie header is absent or malformed.
 */
export function extractTokenFromCookie(cookieHeader: string | string[] | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const raw = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === 'ws_token') {
      // Cookie values are url-encoded in spec; decode for the constant-time
      // compare downstream. Trim trailing whitespace defensively.
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return undefined;
}

/**
 * DNS-rebinding defense. On a loopback bind, the `Host` header must resolve to
 * a loopback name. When the operator deliberately exposes the socket (wsHost is
 * a LAN/0.0.0.0 address) the Host is legitimately non-loopback, so the guard is
 * skipped and connection auth falls to the token check.
 */
export function hostHeaderOk(input: { hostHeader: string | undefined; wsHost: string }): boolean {
  if (!isLoopbackBind(input.wsHost)) return true; // operator opted into wider exposure
  const hostHeader = (input.hostHeader ?? '').trim();
  if (!hostHeader) return false;
  // Strip the port (handle bare host, host:port, and [::1]:port).
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return isLoopbackHostname(hostname);
}

export interface VerifyClientInput {
  /** Browser `Origin` header, or undefined for non-browser clients. */
  origin?: string | undefined;
  /** Request URL (`req.url`) — carries the `?token=…` query param. */
  url: string;
  /** `Host` header (`req.headers.host`). */
  hostHeader?: string | undefined;
  /** Peer address (`req.socket.remoteAddress`). */
  remoteAddress?: string | undefined;
  /** `Cookie` header (`req.headers.cookie`). Carries `ws_token=…` when the
   *  browser went through `/ws-auth` to set the HttpOnly auth cookie. */
  cookieHeader?: string | string[] | undefined;
  /** Host/interface the WS server is bound to. */
  wsHost: string;
  /** The server's generated auth token. */
  expectedToken: string;
}

/**
 * Decide whether to accept an incoming WebSocket handshake. Pure mirror of the
 * closure previously inlined in `index.ts`; see the module doc for the layered
 * policy. Returns `true` to accept, `false` to reject.
 *
 * Token sources, in priority order:
 *  1. `Cookie: ws_token=…` (browser clients that went through `/ws-auth`)
 *  2. `?token=…` URL query param (non-browser clients: curl, scripts)
 *
 * Browser clients (with an `Origin` header) are restricted to the cookie path —
 * URL token is rejected for them, closing the C-598 query-string token
 * exposure class. Non-browser clients keep the URL-token fallback so curl
 * and tests continue to work.
 */
export function verifyClient(input: VerifyClientInput): boolean {
  const { origin, url, hostHeader, remoteAddress, cookieHeader, wsHost, expectedToken } = input;
  const urlTokenOk = tokenMatches(extractToken(url ?? ''), expectedToken);
  const cookieTokenOk = tokenMatches(extractTokenFromCookie(cookieHeader), expectedToken);

  // DNS-rebinding guard runs first on a loopback bind — independent of token
  // and Origin. Blocks a rebound attacker page (Host = attacker domain) even
  // though the TCP peer is 127.0.0.1.
  if (!hostHeaderOk({ hostHeader, wsHost })) return false;

  if (!origin) {
    // Non-browser clients (curl, scripts): require token unless on loopback.
    // The URL `?token=` path stays valid here for ergonomics (curl/tests have
    // no cookie jar) — query-string token exposure (C-598) is a *browser*
    // history/log concern, which non-browser clients don't have.
    // When wsHost=0.0.0.0 the server accepts connections from any network
    // interface — a non-loopback peer is denied outright.
    const remoteIp = remoteAddress ?? '';
    const isRemoteLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1';
    if (!isRemoteLoopback && isWildcardBind(wsHost)) return false; // LAN exposure = deny
    return urlTokenOk || cookieTokenOk || isLoopbackBind(wsHost);
  }
  try {
    const { hostname } = new URL(origin);
    // Loopback browser origins: allow without token only if the origin is
    // explicitly http://localhost or http://127.0.0.1 (defense-in-depth).
    // Reject file://, data://, and other schemes even on loopback.
    if (isLoopbackHostname(hostname)) {
      // For stricter security on wildcard binds (0.0.0.0 / ::), require a
      // trusted origin scheme.
      if (isWildcardBind(wsHost) && !isTrustedLoopbackOrigin(origin)) {
        return false;
      }
      return true;
    }
    // Non-loopback BROWSER origin: the HttpOnly cookie (set via /ws-auth) is the
    // ONLY accepted credential. The URL `?token=` path is rejected for browser
    // clients — it would leak the token into browser history, referrer headers,
    // and reverse-proxy access logs (CWE-598). The frontend bootstraps the
    // cookie via `ensureAuthCookie()` before its first connect, so the cookie is
    // present on the WS upgrade; the URL token it still appends is simply
    // ignored here.
    return cookieTokenOk;
  } catch {
    return false;
  }
}
