import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { FetchError } from '@wrongstack/core';

export interface UpdateInfo {
  current: string;
  latest: string;
  outdated: boolean;
  checkFailed: boolean;
}

type HomeDirFn = () => string;
const defaultHomeDir: HomeDirFn = () => os.homedir();

/** npm registry endpoint used for self-update version checks. */
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/wrongstack/latest';

/** Cache file path — homeFn is injectable for testing */
export function cachePath(homeFn: HomeDirFn = defaultHomeDir): string {
  return path.join(homeFn(), '.wrongstack', 'update-cache.json');
}

/** 24-hour TTL */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  timestamp: number;
  latestVersion: string;
  error?: string | undefined;
}

/** Read the current CLI version from package.json */
export function currentVersion(): string {
  const req = createRequire(import.meta.url);
  const candidates = ['../package.json', '../../package.json'];
  for (const rel of candidates) {
    try {
      const pkg = req(rel) as { version?: unknown | undefined };
      if (typeof pkg.version === 'string' && pkg.version.length > 0) return pkg.version;
    } catch {
      // try next
    }
  }
  return 'dev';
}

/** Semver comparison — returns true if a > b */
function isNewer(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0);
  const [ap, bp] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const ai = ap[i] ?? 0;
    const bi = bp[i] ?? 0;
    if (ai > bi) return true;
    if (ai < bi) return false;
  }
  return false;
}

/** Read cache — returns null if expired */
async function readCache(homeFn: HomeDirFn = defaultHomeDir): Promise<CacheEntry | null> {
  try {
    const raw = await fs.readFile(cachePath(homeFn), 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

/** Write cache */
async function writeCache(entry: CacheEntry, homeFn: HomeDirFn = defaultHomeDir): Promise<void> {
  try {
    const dir = path.dirname(cachePath(homeFn));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(cachePath(homeFn), JSON.stringify(entry, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

/** Fetch latest version from npm registry. Exported for testability and for
 *  callers that want to do their own version checks. Throws a structured
 *  `FetchError(status, context: { op: 'checkForUpdate', registry: 'npmjs', url })`
 *  on non-2xx responses so consumers can branch on the structured shape. */
export async function fetchLatestFromNpm(timeoutMs = 3000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    if (!res.ok) {
      throw new FetchError({
        message: `npm registry responded ${res.status}`,
        status: res.status,
        context: { op: 'checkForUpdate', registry: 'npmjs', url: NPM_REGISTRY_URL },
      });
    }
    const data = (await res.json()) as { version?: unknown | undefined };
    if (typeof data.version === 'string') return data.version;
    throw new Error('No version field in npm response');
  } finally {
    clearTimeout(timer);
  }
}

/** Return update info — cache-first, network fallback */
export async function checkForUpdate(
  signal?: AbortSignal | undefined,
  homeFn?: HomeDirFn | undefined,
): Promise<UpdateInfo> {
  const current = currentVersion();
  const aborted = () => signal?.aborted ?? false;
  const hf = homeFn ?? defaultHomeDir;

  // Already aborted before we even start — skip network entirely
  if (aborted()) {
    return { current, latest: current, outdated: false, checkFailed: true };
  }

  // Check cache
  const cached = await readCache(hf);
  if (cached && !cached.error) {
    return {
      current,
      latest: cached.latestVersion,
      outdated: isNewer(cached.latestVersion, current),
      checkFailed: false,
    };
  }

  // Check network
  try {
    const latest = await fetchLatestFromNpm();
    await writeCache({ timestamp: Date.now(), latestVersion: latest }, hf);

    return {
      current,
      latest,
      outdated: isNewer(latest, current),
      checkFailed: false,
    };
  } catch (_err) {
    // Network error — continue silently, don't write to cache
    if (aborted()) {
      return { current, latest: current, outdated: false, checkFailed: true };
    }

    // Use prior cache if available (stale data, but better than nothing)
    if (cached?.latestVersion) {
      return {
        current,
        latest: cached.latestVersion,
        outdated: isNewer(cached.latestVersion, current),
        checkFailed: true,
      };
    }

    return { current, latest: current, outdated: false, checkFailed: true };
  }
}

/** Return update notification string if available, null otherwise */
export async function getUpdateNotification(
  signal?: AbortSignal | undefined,
  homeFn?: HomeDirFn | undefined,
): Promise<string | null> {
  const info = await checkForUpdate(signal, homeFn);
  if (info.outdated) {
    return `Update available: v${info.current} → v${info.latest}`;
  }
  return null;
}
