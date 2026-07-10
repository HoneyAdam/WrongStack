/**
 * HQ browser auth — single source of truth for the dashboard token.
 *
 * The browser token arrives once via `?token=` on the startup URL printed by
 * `wstack --hq`. Every other consumer (SPA fetches, the WS client, reloads)
 * reads it through {@link resolveHqToken}, which persists a URL-supplied
 * token to `sessionStorage` so the dashboard keeps working after the query
 * string is lost (navigation, copy/paste of a bare URL, reload).
 *
 * HTTP requests attach it as `Authorization: Bearer` via
 * {@link authorizedFetch}; the WS client appends it as `?token=` because the
 * browser `WebSocket` constructor cannot set headers.
 *
 * sessionStorage (not localStorage) on purpose: the token is a live
 * credential and should not outlive the tab.
 */

const STORAGE_KEY = 'wrongstack.hq.token.v1';

function readUrlToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = new URLSearchParams(window.location.search).get('token');
    return token !== null && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * sessionStorage, or null when unavailable. Even ACCESSING the property can
 * throw (SecurityError with storage disabled / strict private modes), so the
 * read itself is guarded — not just the getItem/setItem calls.
 */
function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readStoredToken(): string | null {
  try {
    const token = storage()?.getItem(STORAGE_KEY) ?? null;
    return token !== null && token.length > 0 ? token : null;
  } catch {
    return null; // private mode / storage disabled
  }
}

/** Persist a token so later fetches and reloads survive without `?token=`. */
export function setHqToken(token: string): void {
  try {
    storage()?.setItem(STORAGE_KEY, token);
  } catch {
    /* best-effort: quota / private mode */
  }
}

export function clearHqToken(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Resolve the active browser token: `?token=` wins (and is persisted for
 * later), else the persisted one. `null` means open mode — or a token gate.
 */
export function resolveHqToken(): string | null {
  const fromUrl = readUrlToken();
  if (fromUrl !== null) {
    setHqToken(fromUrl);
    return fromUrl;
  }
  return readStoredToken();
}

/**
 * Persist a URL-supplied token, then remove `?token=` from the address bar
 * (history.replaceState) so the credential stops living in browser history,
 * screenshots, and copied links. Deliberately a no-op when the token cannot
 * be read back from sessionStorage (private mode / storage disabled) — in
 * that case the URL is the only place the token survives a re-render.
 */
export function scrubTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const urlToken = readUrlToken();
  if (urlToken === null) return;
  setHqToken(urlToken);
  if (readStoredToken() !== urlToken) return; // storage unavailable — keep it in the URL
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* best-effort */
  }
}

/** Authorization headers for the active token, `{}` in open mode. */
export function authHeaders(): Record<string, string> {
  const token = resolveHqToken();
  return token !== null ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * `fetch` with the HQ token attached. All dashboard HTTP calls must go
 * through this — a bare `fetch('/api/…')` 401s whenever the server runs in
 * browser-token mode, which is the default since first-run auth.
 */
export function authorizedFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
    ...authHeaders(),
  };
  return fetch(input, { ...init, headers });
}

export const __test__ = { STORAGE_KEY };
