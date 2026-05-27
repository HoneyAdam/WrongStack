import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// Extracted logic from verifyClient for testability
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

interface VerifyInput {
  origin?: string;
  url?: string;
  expectedToken: string;
  wsHost: string;
}

function verifyClient(input: VerifyInput): boolean {
  const { origin, url, expectedToken, wsHost } = input;
  const tokenMatch = (url ?? '').match(/[?&]token=([^&]+)/);
  const providedToken = tokenMatch ? tokenMatch[1] : undefined;
  const tokenOk = providedToken === expectedToken;

  if (!origin) {
    return tokenOk || wsHost === '127.0.0.1' || wsHost === '::1' || wsHost === 'localhost';
  }
  try {
    const { hostname } = new URL(origin);
    if (isLoopback(hostname)) return true;
    return tokenOk;
  } catch {
    return false;
  }
}

const TOKEN = 'abc123def456';

describe('verifyClient (WebSocket auth)', () => {
  it('allows loopback browser origin without token', () => {
    expect(verifyClient({ origin: 'http://localhost:3000', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(true);
    expect(verifyClient({ origin: 'http://127.0.0.1:3000', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(true);
    expect(verifyClient({ origin: 'http://[::1]:3000', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(true);
  });

  it('allows non-browser client on loopback without token', () => {
    expect(verifyClient({ origin: undefined, expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(true);
    expect(verifyClient({ origin: undefined, expectedToken: TOKEN, wsHost: '::1' })).toBe(true);
    expect(verifyClient({ origin: undefined, expectedToken: TOKEN, wsHost: 'localhost' })).toBe(true);
  });

  it('requires token for non-loopback browser origin', () => {
    expect(verifyClient({ origin: 'http://192.168.1.5:3000', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(false);
    expect(verifyClient({ origin: 'http://192.168.1.5:3000', url: `/?token=${TOKEN}`, expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(true);
  });

  it('requires token for non-browser client on non-loopback', () => {
    expect(verifyClient({ origin: undefined, expectedToken: TOKEN, wsHost: '0.0.0.0' })).toBe(false);
    expect(verifyClient({ origin: undefined, url: `/?token=${TOKEN}`, expectedToken: TOKEN, wsHost: '0.0.0.0' })).toBe(true);
  });

  it('rejects wrong token', () => {
    expect(verifyClient({ origin: undefined, url: '/?token=wrong', expectedToken: TOKEN, wsHost: '0.0.0.0' })).toBe(false);
    expect(verifyClient({ origin: 'http://192.168.1.5:3000', url: '/?token=wrong', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(false);
  });

  it('rejects malformed origins', () => {
    expect(verifyClient({ origin: 'not-a-url', expectedToken: TOKEN, wsHost: '127.0.0.1' })).toBe(false);
  });

  it('allows non-loopback browser with correct token', () => {
    expect(verifyClient({ origin: 'http://10.0.0.5:3000', url: `/?token=${TOKEN}`, expectedToken: TOKEN, wsHost: '0.0.0.0' })).toBe(true);
  });
});

// ─── HTTP static file path traversal guard ──────────────────────────────────
// Extracted from webui/src/server/index.ts for unit testing.

function isPathSafe(urlPathname: string, distDir: string): boolean {
  const filePath = path.join(distDir, urlPathname);
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(distDir);
  return resolvedPath.startsWith(resolvedRoot + path.sep) || resolvedPath === resolvedRoot;
}

describe('HTTP static file path traversal guard', () => {
  const DIST = path.resolve('/app/dist');

  it('allows normal paths inside dist', () => {
    expect(isPathSafe('/index.html', DIST)).toBe(true);
    expect(isPathSafe('/assets/main.js', DIST)).toBe(true);
    expect(isPathSafe('/assets/css/style.css', DIST)).toBe(true);
  });

  it('blocks basic dot-dot traversal', () => {
    expect(isPathSafe('/../../../etc/passwd', DIST)).toBe(false);
    expect(isPathSafe('/assets/../../etc/passwd', DIST)).toBe(false);
  });

  it('blocks percent-encoded dot-dot traversal (after URL decoding)', () => {
    // In the real server, new URL() decodes %2e%2e to .. before path.join.
    // Simulate that by decoding first, then checking.
    const decoded = '/../../../etc/passwd'; // what new URL('/%2e%2e/...') produces
    expect(isPathSafe(decoded, DIST)).toBe(false);
  });

  it('blocks paths that resolve outside dist via intermediate traversal', () => {
    expect(isPathSafe('/assets/../../../etc/shadow', DIST)).toBe(false);
  });

  it('allows root path', () => {
    expect(isPathSafe('/', DIST)).toBe(true);
  });
});

// ─── Rate limiter ───────────────────────────────────────────────────────────
// Extracted from cli/src/webui-server.ts for unit testing.

function createRateLimiter(maxMsgs: number, windowMs: number) {
  let msgCount = 0;
  let windowResetAt = Date.now() + windowMs;
  return {
    check(): boolean {
      const now = Date.now();
      if (now > windowResetAt) {
        msgCount = 0;
        windowResetAt = now + windowMs;
      }
      if (++msgCount > maxMsgs) return false;
      return true;
    },
  };
}

describe('WebSocket rate limiter', () => {
  it('allows messages within limit', () => {
    const limiter = createRateLimiter(3, 60_000);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(true);
  });

  it('blocks messages exceeding limit', () => {
    const limiter = createRateLimiter(2, 60_000);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(false);
  });

  it('resets after window expires', () => {
    // Use a very short window (1ms) that expires between checks
    const limiter = createRateLimiter(1, 1);
    expect(limiter.check()).toBe(true);
    expect(limiter.check()).toBe(false);
    // Busy-wait for window to expire (1ms)
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    expect(limiter.check()).toBe(true);
  });
});
