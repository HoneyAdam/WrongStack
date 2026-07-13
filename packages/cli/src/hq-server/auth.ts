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

export function setHqSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data:; img-src 'self' data:; connect-src 'self' ws: wss:",
  );
}

// ── CORS / origin guard ────────────────────────────────────────────────────

export function hasTrustedBrowserOrigin(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    // Loopback and local origins are trusted unconditionally.
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1') return true;
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
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setHqSessionCookie(res: http.ServerResponse, value: string): void {
  const header = `${HQ_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(HQ_SESSION_MAX_AGE_MS / 1000)}`;
  res.setHeader('Set-Cookie', header);
}

export function clearHqSessionCookie(res: http.ServerResponse): void {
  const header = `${HQ_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  res.setHeader('Set-Cookie', header);
}

// ── Auth result helpers ─────────────────────────────────────────────────────

export function isTokenAuth(auth: HqBrowserAuthResult): auth is HqBrowserAuthContext {
  return auth !== undefined && auth !== 'cookie';
}

// ── Request auth ───────────────────────────────────────────────────────────

export function extractBrowserToken(req: http.IncomingMessage, url: URL): string | undefined {
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;

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
  if (token && mutableAuth.browserTokens.has(token)) {
    const obj = mutableAuth.browserTokenObjs.get(token);
    const ctx: HqBrowserAuthContext = { kind: 'token', token, id: obj?.id ?? 'unknown' };
    if (obj?.capabilities !== undefined) ctx.capabilities = obj.capabilities;
    return ctx;
  }
  if (mutableAuth.passwordHash && mutableAuth.cookieSecret) {
    const cookies = parseCookieHeader(req.headers.cookie);
    const raw = cookies[HQ_SESSION_COOKIE];
    if (raw) {
      const sessionId = parseHqSessionCookie(raw, mutableAuth.cookieSecret);
      if (sessionId && sessions.has(sessionId)) return 'cookie';
    }
  }
  return undefined;
}
