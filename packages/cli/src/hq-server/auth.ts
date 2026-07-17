/**
 * HQ server — authentication, cookie management, and security headers.
 *
 * @module hq-server/auth
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type * as http from 'node:http';

// ── Cookie / session constants ─────────────────────────────────────────────

export const HQ_SESSION_COOKIE = 'hq.session';
export const HQ_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────────────

export interface HqBrowserAuthContext {
  kind: 'token';
  token: string;
  id: string;
  capabilities?: string[];
}

export type HqBrowserAuthResult = HqBrowserAuthContext | 'cookie' | undefined;

// ── Security headers ───────────────────────────────────────────────────────

/**
 * The HQ dashboard is a self-contained HTML document (`hq-dashboard-html.ts`)
 * that loads React + React Flow via dynamic `import()` from `esm.sh` CDN.
 * The inline `<script>` blocks define the full SPA logic, so `'unsafe-inline'`
 * is required — we cannot use hashes because the HTML template injects
 * variable source (tool-input summarizer, tool-diff viewer) at build time.
 *
 * CSP trade-offs:
 * - `script-src 'unsafe-inline'` — unavoidable given the single-file design;
 *   mitigations: the page is served on loopback only, and `connect-src` is
 *   locked to `'self'` so an injected inline script cannot exfiltrate data
 *   via WebSocket to an attacker-controlled server.
 * - CDN URLs are pinned to specific package@version paths rather than bare
 *   origin wildcards, limiting the blast radius if esm.sh is compromised.
 * - `cdn.jsdelivr.net` was previously allowed but is not loaded by HQ.
 */
export function setHqSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Inline scripts required (see comment above). CDN URLs are pinned to
      // specific package@version paths — esm.sh redirects internally to
      // version-locked subpaths so the pinned paths remain stable.
      "script-src 'self' 'unsafe-inline' https://esm.sh/react@18.3.1 https://esm.sh/react-dom@18.3.1 https://esm.sh/reactflow@11.11.4 https://esm.sh/dagre@0.8.5",
      "style-src 'self' 'unsafe-inline' https://esm.sh/reactflow@11.11.4",
      "font-src 'self' data:",
      "img-src 'self' data:",
      // Locked to same-origin: prevents inline scripts from opening
      // WebSockets to attacker-controlled servers (data exfiltration).
      "connect-src 'self'",
    ].join('; '),
  );
}

// ── CORS / origin guard ────────────────────────────────────────────────────

export function hasTrustedBrowserOrigin(
  req: http.IncomingMessage,
  _boundHost?: string,
  boundPort?: number,
): boolean {
  const origin = req.headers.origin;
  // Note: we do NOT accept origin === 'null' here (sandboxed iframes produce
  // 'null' and would bypass the port check). The `file:` check below handles
  // file:// origins, which some browsers report as 'null'.
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    // Loopback and local origins are trusted only when the port matches the
    // bound port. A malicious app on localhost:8888 must not be able to reuse
    // a password cookie set for HQ on localhost:34827.
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') {
      if (boundPort !== undefined) {
        return parsed.port === String(boundPort);
      }
      // No bound port provided (legacy callers) — accept any port.
      return true;
    }
    // File:// origins (the HQ dashboard served from a local file for
    // air-gapped use) are also trusted.
    if (parsed.protocol === 'file:') return true;
  } catch {
    // Unparseable origin → reject.
    return false;
  }
  return false;
}

// ── Session cookie helpers ──────────────────────────────────────────────────

export function signHqSession(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('hex');
}

export function serializeHqSessionCookie(sessionId: string, secret: string): string {
  return `${sessionId}.${signHqSession(sessionId, secret)}`;
}

export function parseHqSessionCookie(value: string, secret: string): string | undefined {
  const dot = value.indexOf('.');
  if (dot === -1) return undefined;
  const sessionId = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!sessionId || !sig) return undefined;
  const expected = signHqSession(sessionId, secret);
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  } catch {
    return undefined;
  }
  return sessionId;
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        // Malformed percent-encoding (e.g. %ZZ, %FF without valid UTF-8)
        // throws URIError. Return the raw value rather than crashing.
        out[key] = value;
      }
    }
  }
  return out;
}

export function setHqSessionCookie(res: http.ServerResponse, value: string, secure?: boolean): void {
  const parts = [
    `${HQ_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(HQ_SESSION_MAX_AGE_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearHqSessionCookie(res: http.ServerResponse, secure?: boolean): void {
  const parts = [
    `${HQ_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ── Auth result helpers ─────────────────────────────────────────────────────

export function isTokenAuth(auth: HqBrowserAuthResult): auth is HqBrowserAuthContext {
  return auth !== undefined && auth !== 'cookie';
}

// ── Request auth ───────────────────────────────────────────────────────────

export function extractBrowserToken(req: http.IncomingMessage, url: URL): string | undefined {
  const queryToken = url.searchParams.get('token');
  if (queryToken) {
    // Tokens in URL query strings can leak through browser history, server
    // access logs, and Referer headers. On loopback this risk is low, but
    // operators exposing HQ beyond localhost should use the Authorization
    // header instead. The built React dashboard uses the header; the inline
    // fallback and manual curl access use the query param.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'hq.token_from_query_param',
        message:
          'Browser token accepted from URL query parameter — token can leak through browser history, server access logs, and Referer headers.',
        timestamp: new Date().toISOString(),
      }),
    );
    return queryToken;
  }

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return undefined;
}

export function authenticateBrowserRequest(
  req: http.IncomingMessage,
  url: URL,
  mutableAuth: {
    browserTokens: Set<string>;
    browserTokenObjs: Map<string, { id: string; capabilities?: string[] }>;
    passwordHash?: string | undefined;
    cookieSecret?: string | undefined;
  },
  sessions: Map<string, { createdAt: number }>,
): HqBrowserAuthResult {
  const token = extractBrowserToken(req, url);
  if (token) {
    // Timing-safe token comparison: iterate the token set and compare each
    // candidate with timingSafeEqual instead of relying on Set.has(), which
    // uses a hash lookup that can leak token length/prefix via timing.
    let matchedToken: string | undefined;
    for (const candidate of mutableAuth.browserTokens) {
      const a = Buffer.from(candidate);
      const b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) {
        matchedToken = candidate;
        break;
      }
    }
    if (matchedToken) {
      const obj = mutableAuth.browserTokenObjs.get(matchedToken);
      const ctx: HqBrowserAuthContext = { kind: 'token', token: matchedToken, id: obj?.id ?? 'unknown' };
      if (obj?.capabilities !== undefined) ctx.capabilities = obj.capabilities;
      return ctx;
    }
  }
  if (mutableAuth.passwordHash && mutableAuth.cookieSecret) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const raw = cookies[HQ_SESSION_COOKIE];
    if (raw) {
      const sessionId = parseHqSessionCookie(raw, mutableAuth.cookieSecret);
      // Server-side session expiry: reject and evict entries past Max-Age
      // even if the periodic cleanup timer hasn't run yet.
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (session && Date.now() - session.createdAt < HQ_SESSION_MAX_AGE_MS) {
          return 'cookie';
        }
        // Stale session — evict so a replayed cookie doesn't linger.
        if (session) sessions.delete(sessionId);
      }
    }
  }
  return undefined;
}
