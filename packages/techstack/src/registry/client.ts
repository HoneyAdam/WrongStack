/**
 * TechStack — Registry metadata HTTP client.
 *
 * Per-ecosystem registry API clients built on Node's built-in https module.
 * Features: in-memory cache with ETag/TTL, per-host concurrency limit (max 3),
 * exponential backoff on 429/5xx responses.
 *
 * @see docs/specs/techstack-sdd.md §5, §6
 */

import { get as httpsGet, RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { get as httpGet } from 'node:http';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RegistryEntry {
  readonly latestStable?: string | undefined;
  readonly license?: string | undefined;
  readonly deprecated?: boolean | undefined;
  readonly yanked?: boolean | undefined;
  readonly retrievedAt: string;
  readonly source: string;
}

export interface CacheEntry {
  readonly data: RegistryEntry;
  readonly etag?: string | undefined;
  readonly expiresAt: number;
}

export interface HostConcurrency {
  active: number;
  readonly queue: Array<() => void>;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONCURRENCY_PER_HOST = 3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

// ── In-memory cache ────────────────────────────────────────────────────────

const registryCache = new Map<string, CacheEntry>();
const hostConcurrency = new Map<string, HostConcurrency>();

function getCacheKey(host: string, path: string): string {
  return `${host}${path}`;
}

function getCached(key: string): RegistryEntry | undefined {
  const entry = registryCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    registryCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCache(
  key: string,
  data: RegistryEntry,
  etag?: string,
  ttlMs = DEFAULT_TTL_MS,
): void {
  registryCache.set(key, {
    data,
    etag,
    expiresAt: Date.now() + ttlMs,
  });
}

// ── Concurrency limiter ────────────────────────────────────────────────────

function acquireHostSlot(host: string): Promise<void> {
  let concurrency = hostConcurrency.get(host);
  if (!concurrency) {
    concurrency = { active: 0, queue: [] };
    hostConcurrency.set(host, concurrency);
  }

  if (concurrency.active < MAX_CONCURRENCY_PER_HOST) {
    concurrency.active++;
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    concurrency!.queue.push(resolve);
  });
}

function releaseHostSlot(host: string): void {
  const concurrency = hostConcurrency.get(host);
  if (!concurrency) return;

  concurrency.active--;

  if (concurrency.queue.length > 0) {
    const next = concurrency.queue.shift();
    if (next) {
      concurrency.active++;
      next();
    }
  }
}

// ── Backoff helper ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number, statusCode: number): number {
  const base = statusCode === 429 ? BASE_BACKOFF_MS * 2 : BASE_BACKOFF_MS;
  return base * Math.pow(2, attempt) + Math.random() * 500;
}

// ── HTTPS/HTTP fetch wrapper ───────────────────────────────────────────────

interface FetchResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  readonly isFromCache: boolean;
}

function httpsFetch(
  hostname: string,
  path: string,
  etag?: string,
  signal?: AbortSignal,
): Promise<FetchResponse> {
  return new Promise((resolve, reject) => {
    const options: RequestOptions = {
      hostname,
      path,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WrongStack-TechStack/1.0',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
      signal,
      timeout: 15000,
    };

    const mod = hostname === 'localhost' || hostname === '127.0.0.1' ? httpGet : httpsGet;

    const req = mod(options, (res: IncomingMessage) => {
      const statusCode = res.statusCode ?? 0;
      const responseHeaders = res.headers as Record<string, string | string[] | undefined>;

      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode,
          headers: responseHeaders,
          body,
          isFromCache: false,
        });
      });
    });

    req.on('error', (err: Error) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout for ${hostname}${path}`));
    });

    req.end();
  });
}

// ── Registry metadata response parser ──────────────────────────────────────

interface EcosystemFetcher {
  readonly host: string;
  readonly path: (name: string) => string;
  readonly parser: (json: Record<string, unknown>, name: string, ecosystem: string) => RegistryEntry | undefined;
}

// ── Per-ecosystem fetcher definitions ──────────────────────────────────────

const ECOSYSTEM_FETCHERS: Readonly<Record<string, EcosystemFetcher>> = {
  npm: {
    host: 'registry.npmjs.org',
    path: (name: string) => {
      // Scoped packages: /@scope%2Fname
      const encoded = name.startsWith('@') ? name.replace('/', '%2F') : name;
      return `/${encoded}`;
    },
    parser: (json: Record<string, unknown>, name: string): RegistryEntry => {
      const latestVersion = ((json['dist-tags'] as Record<string, string> | undefined)?.['latest']);
      // Check deprecation
      let deprecated: boolean | undefined;
      if (json.versions && typeof json.versions === 'object') {
        const versions = json.versions as Record<string, Record<string, unknown>>;
        if (latestVersion && versions[latestVersion]) {
          deprecated = versions[latestVersion]!.deprecated ? true : undefined;
        }
        // Also check if ANY version is deprecated
        if (!deprecated) {
          for (const ver of Object.values(versions)) {
            if (ver.deprecated) {
              deprecated = true;
              break;
            }
          }
        }
      }
      // npm doesn't have a standard "yanked" field in registry metadata
      return {
        latestStable: latestVersion,
        license: (json.license as string) ?? undefined,
        deprecated: deprecated ?? undefined,
        yanked: undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://registry.npmjs.org/${name}`,
      };
    },
  },

  python: {
    host: 'pypi.org',
    path: (name: string) => `/pypi/${name}/json`,
    parser: (json: Record<string, unknown>): RegistryEntry => {
      const info = json.info as Record<string, unknown> | undefined;
      return {
        latestStable: (info?.version as string) ?? undefined,
        license: (info?.license as string) ?? undefined,
        deprecated: (info?.deprecated as boolean) ?? undefined,
        yanked: undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://pypi.org/pypi/${info?.name ?? ''}/json`,
      };
    },
  },

  cargo: {
    host: 'crates.io',
    path: (name: string) => `/api/v1/crates/${name}`,
    parser: (json: Record<string, unknown>): RegistryEntry => {
      const crate = json.crate as Record<string, unknown> | undefined;
      return {
        latestStable: (crate?.max_stable_version as string) ?? (crate?.max_version as string) ?? undefined,
        license: (crate?.license as string) ?? undefined,
        deprecated: undefined, // crates.io doesn't have deprecation
        yanked: undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://crates.io/api/v1/crates/${crate?.name ?? ''}`,
      };
    },
  },

  golang: {
    host: 'proxy.golang.org',
    path: (module: string) => `/${module}/@latest`,
    parser: (json: Record<string, unknown>, module: string): RegistryEntry => {
      return {
        latestStable: (json.Version as string) ?? undefined,
        license: undefined, // Go proxy doesn't provide license
        deprecated: undefined,
        yanked: undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://proxy.golang.org/${module}/@latest`,
      };
    },
  },

  nuget: {
    host: 'api.nuget.org',
    path: (name: string) => {
      const lower = name.toLowerCase();
      return `/v3/registration5-semver1/${lower}/index.json`;
    },
    parser: (json: Record<string, unknown>, name: string): RegistryEntry => {
      // NuGet V3 registration index has items with catalog entries
      const items = json.items as Array<Record<string, unknown>> | undefined;
      let latestStable: string | undefined;

      if (items && items.length > 0) {
        // Items are ordered; look through all items for the latest stable version
        for (const item of items) {
          const itemItems = item.items as Array<Record<string, unknown>> | undefined;
          if (itemItems && Array.isArray(itemItems)) {
            for (const entry of itemItems) {
              const catalogEntry = entry.catalogEntry as Record<string, unknown> | undefined;
              if (catalogEntry?.version) {
                const ver = catalogEntry.version as string;
                // Prefer non-prerelease
                if (!latestStable || (!ver.includes('-') && latestStable.includes('-'))) {
                  latestStable = ver;
                } else if (!ver.includes('-') && !latestStable.includes('-')) {
                  // Both stable — take greater
                  if (ver > latestStable) latestStable = ver;
                }
              }
            }
          }
        }
      }

      return {
        latestStable,
        license: undefined, // License requires per-version catalog entry
        deprecated: undefined,
        yanked: undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://api.nuget.org/v3/registration5-semver1/${name.toLowerCase()}/index.json`,
      };
    },
  },

  composer: {
    host: 'repo.packagist.org',
    path: (name: string) => `/p2/${name}.json`,
    parser: (json: Record<string, unknown>, name: string): RegistryEntry => {
      const packages = json.packages as Record<string, Array<Record<string, unknown>>> | undefined;
      const versions = packages?.[name];
      if (!versions || versions.length === 0) {
        return { retrievedAt: new Date().toISOString(), source: 'packagist' };
      }

      // Find the latest stable version
      let latestStable: string | undefined;
      for (const ver of versions) {
        const version = ver.version as string;
        if (version && !version.includes('dev') && !version.includes('alpha') && !version.includes('beta') && !version.includes('RC') && !version.includes('rc')) {
          if (!latestStable || version > latestStable) {
            latestStable = version;
          }
        }
      }

      // Use the latest version entry for license info
      const latest = versions[0]!;

      return {
        latestStable,
        license: latest.license as string ?? undefined,
        deprecated: (latest.deprecated as boolean) ?? undefined,
        yanked: (latest.abandoned as boolean) ?? undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://repo.packagist.org/p2/${name}.json`,
      };
    },
  },

  pub: {
    host: 'pub.dev',
    path: (name: string) => `/api/packages/${name}`,
    parser: (json: Record<string, unknown>): RegistryEntry => {
      const latest = json.latest as Record<string, unknown> | undefined;
      return {
        latestStable: (json.latestVersion as string) ?? (latest?.version as string) ?? (json.version as string) ?? undefined,
        license: (latest?.license as string) ?? undefined,
        deprecated: (json.isDiscontinued as boolean) ?? undefined,
        yanked: (json.isRetracted as boolean) ?? undefined,
        retrievedAt: new Date().toISOString(),
        source: `https://pub.dev/api/packages/${(json.name as string) ?? ''}`,
      };
    },
  },
};

// ── Public API ─────────────────────────────────────────────────────────────

export interface RegistryLookupOptions {
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal | undefined;
  /** Bypass cache and force a fresh lookup. */
  readonly force?: boolean | undefined;
}

/**
 * Look up registry metadata for a package in a given ecosystem.
 *
 * Returns `undefined` on 404/401 (private/unresolved package).
 * Throws on network errors (timeout, DNS failure).
 */
export async function lookupRegistry(
  ecosystem: string,
  name: string,
  options: RegistryLookupOptions = {},
): Promise<RegistryEntry | undefined> {
  const fetcher = ECOSYSTEM_FETCHERS[ecosystem];
  if (!fetcher) {
    throw new Error(`Unsupported ecosystem for registry lookup: ${ecosystem}`);
  }

  const path = fetcher.path(name);
  const cacheKey = getCacheKey(fetcher.host, path);

  // Check cache (unless force refresh)
  if (!options.force) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  // Acquire concurrency slot
  await acquireHostSlot(fetcher.host);
  try {
    // Get cached ETag
    const existingEntry = registryCache.get(cacheKey);
    const etag = existingEntry?.etag;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await httpsFetch(fetcher.host, path, etag, options.signal);

        // 304 Not Modified — use cached data and extend TTL
        if (response.statusCode === 304 && existingEntry) {
          setCache(cacheKey, existingEntry.data, existingEntry.etag, DEFAULT_TTL_MS);
          return existingEntry.data;
        }

        // 401/403/404 — private or unresolved package
        if (response.statusCode === 401 || response.statusCode === 403 || response.statusCode === 404) {
          return undefined;
        }

        // 429/5xx — retry with backoff
        if (response.statusCode === 429 || response.statusCode >= 500) {
          if (attempt < MAX_RETRIES - 1) {
            const backoff = computeBackoff(attempt, response.statusCode);
            await sleep(backoff);
            continue;
          }
          throw new Error(`Registry ${fetcher.host} returned ${response.statusCode} after ${MAX_RETRIES} attempts`);
        }

        // Success (2xx)
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(response.body) as Record<string, unknown>;
        } catch {
          throw new Error(`Invalid JSON response from ${fetcher.host}${path}`);
        }

        const parsed = fetcher.parser(json, name, ecosystem);
        if (!parsed) {
          // Parser returned nothing — package exists but no metadata
          return undefined;
        }

        // Cache with ETag
        const responseEtag = response.headers['etag'] as string | undefined;
        setCache(cacheKey, parsed, responseEtag, DEFAULT_TTL_MS);

        return parsed;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          const isRateLimit = err instanceof Error && err.message.includes('429');
          const backoff = computeBackoff(attempt, isRateLimit ? 429 : 500);
          await sleep(backoff);
        }
      }
    }

    throw lastError ?? new Error(`Failed to look up ${ecosystem}:${name}`);
  } finally {
    releaseHostSlot(fetcher.host);
  }
}

/**
 * Look up registry metadata for multiple packages in the same ecosystem.
 * Uses the same per-host concurrency limit for the batch.
 */
export async function lookupRegistryBatch(
  ecosystem: string,
  names: readonly string[],
  options: RegistryLookupOptions = {},
): Promise<Map<string, RegistryEntry | undefined>> {
  const results = new Map<string, RegistryEntry | undefined>();

  // Process in parallel respecting concurrency limits
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const entry = await lookupRegistry(ecosystem, name, options);
        return { name, entry } as const;
      } catch {
        return { name, entry: undefined } as const;
      }
    }),
  );

  for (const { name, entry } of entries) {
    results.set(name, entry);
  }

  return results;
}

/**
 * Get the list of supported ecosystem IDs for registry lookups.
 */
export function supportedRegistryEcosystems(): string[] {
  return Object.keys(ECOSYSTEM_FETCHERS);
}

/**
 * Clear the in-memory registry cache.
 * Useful for testing and when force-refreshing.
 */
export function clearRegistryCache(): void {
  registryCache.clear();
  hostConcurrency.clear();
}
