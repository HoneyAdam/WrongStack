/**
 * Tests for the HQ browser auth layer (`src/lib/auth.ts`) — the single
 * source of truth for the dashboard token. Regression net for the "every
 * /api/* fetch 401s in token mode" bug: bare `fetch` calls carried no token
 * even though the server has been token-mode-by-default since first-run
 * auth landed.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __test__,
  authHeaders,
  authorizedFetch,
  clearHqToken,
  resolveHqToken,
  scrubTokenFromUrl,
  setHqToken,
} from '../src/lib/auth.js';

function setUrl(pathAndQuery: string): void {
  window.history.replaceState(null, '', pathAndQuery);
}

afterEach(() => {
  clearHqToken();
  setUrl('/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resolveHqToken', () => {
  it('returns null in open mode (no ?token=, nothing stored)', () => {
    expect(resolveHqToken()).toBeNull();
  });

  it('reads ?token= from the URL and persists it to sessionStorage', () => {
    setUrl('/?token=tok-from-url');
    expect(resolveHqToken()).toBe('tok-from-url');
    expect(window.sessionStorage.getItem(__test__.STORAGE_KEY)).toBe('tok-from-url');
  });

  it('falls back to the persisted token when the URL carries no query', () => {
    setHqToken('tok-persisted');
    expect(resolveHqToken()).toBe('tok-persisted');
  });

  it('URL token wins over a previously persisted one and replaces it', () => {
    setHqToken('tok-old');
    setUrl('/?token=tok-new');
    expect(resolveHqToken()).toBe('tok-new');
    expect(window.sessionStorage.getItem(__test__.STORAGE_KEY)).toBe('tok-new');
  });

  it('ignores an empty ?token= value', () => {
    setUrl('/?token=');
    expect(resolveHqToken()).toBeNull();
  });

  it('clearHqToken drops the persisted token', () => {
    setHqToken('tok-gone');
    clearHqToken();
    expect(resolveHqToken()).toBeNull();
  });
});

describe('scrubTokenFromUrl', () => {
  it('persists the URL token, then strips it from the address bar', () => {
    setUrl('/?token=tok-scrub&view=fleet#frag');
    scrubTokenFromUrl();
    expect(window.sessionStorage.getItem(__test__.STORAGE_KEY)).toBe('tok-scrub');
    expect(window.location.search).toBe('?view=fleet');
    expect(window.location.hash).toBe('#frag');
    expect(resolveHqToken()).toBe('tok-scrub');
  });

  it('is a no-op when the URL carries no token', () => {
    setUrl('/?view=fleet');
    scrubTokenFromUrl();
    expect(window.location.search).toBe('?view=fleet');
    expect(window.sessionStorage.getItem(__test__.STORAGE_KEY)).toBeNull();
  });

  it('keeps the token in the URL when sessionStorage is unavailable', () => {
    setUrl('/?token=tok-keep');
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    try {
      scrubTokenFromUrl();
      // The URL is the only surviving token source — it must NOT be stripped.
      expect(window.location.search).toBe('?token=tok-keep');
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});

describe('authHeaders', () => {
  it('is empty in open mode', () => {
    expect(authHeaders()).toEqual({});
  });

  it('carries Authorization: Bearer when a token is active', () => {
    setHqToken('tok-h');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer tok-h' });
  });
});

describe('authorizedFetch', () => {
  it('attaches the Authorization header to the request', async () => {
    setHqToken('tok-f');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authorizedFetch('/api/snapshot');

    expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', {
      headers: { Authorization: 'Bearer tok-f' },
    });
  });

  it('merges with caller-supplied init/headers without dropping them', async () => {
    setHqToken('tok-m');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await authorizedFetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"x":1}',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok-m' },
      body: '{"x":1}',
    });
  });

  it('sends no Authorization header in open mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await authorizedFetch('/api/snapshot');

    expect(fetchMock).toHaveBeenCalledWith('/api/snapshot', { headers: {} });
  });
});
