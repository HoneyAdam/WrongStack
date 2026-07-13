import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { watch as watchDir } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import * as path from 'node:path';

export interface AtomicWriteOptions {
  mode?: number | undefined;
  encoding?: BufferEncoding | undefined;
}

export interface FileLockOptions {
  timeoutMs?: number | undefined;
  staleMs?: number | undefined;
}

/**
 * Minimal FsError — mirrors @wrongstack/core's FsError shape so callers
 * that catch FsError from the core package can also match this one.
 */
export class FsError extends Error {
  override name = 'FsError';
  readonly code: string;
  readonly path?: string | undefined;
  readonly context?: Record<string, unknown> | undefined;

  constructor(opts: {
    message: string;
    code: string;
    path?: string | undefined;
    context?: Record<string, unknown> | undefined;
  }) {
    super(opts.message);
    this.code = opts.code;
    this.path = opts.path;
    this.context = opts.context;
  }
}

export async function atomicWrite(
  targetPath: string,
  content: string | Uint8Array,
  opts: AtomicWriteOptions = {},
): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${randomBytes(6).toString('hex')}.tmp`);

  try {
    if (typeof content === 'string') {
      await fs.writeFile(tmp, content, { flag: 'wx', encoding: opts.encoding ?? 'utf8' });
    } else {
      await fs.writeFile(tmp, content, { flag: 'wx' });
    }
    try {
      const fh = await fs.open(tmp, 'r+');
      try {
        await fh.sync();
      } finally {
        await fh.close();
      }
    } catch {
      // fsync best-effort
    }
    let mode: number | undefined;
    try {
      const stat = await fs.stat(targetPath);
      mode = stat.mode & 0o777;
    } catch {
      mode = opts.mode;
    }
    if (mode !== undefined) {
      await fs.chmod(tmp, mode);
    }
    await renameWithRetry(tmp, targetPath);
    if (mode !== undefined && process.platform === 'win32') {
      try {
        await fs.chmod(targetPath, mode);
      } catch {
        // best-effort
      }
    }
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore cleanup error
    }
    throw err;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  opts: FileLockOptions = {},
): Promise<T> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const lockPath = path.join(dir, `.${path.basename(targetPath)}.lock`);
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const staleMs = opts.staleMs ?? 30_000;
  const started = Date.now();
  let handle: fs.FileHandle | undefined;

  for (;;) {
    try {
      handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(`${process.pid}:${Date.now()}`);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        await fs.mkdir(dir, { recursive: true });
        continue;
      }
      if (code !== 'EEXIST' && code !== 'EPERM') throw err;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      const elapsed = Date.now() - started;
      if (elapsed >= timeoutMs) {
        throw new FsError({
          message: `Timed out waiting for file lock: ${targetPath}`,
          code: 'FS_ATOMIC_WRITE_FAILED',
          path: targetPath,
          context: { timeoutMs },
        });
      }
      await waitForLockRelease(lockPath, timeoutMs - elapsed);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      await handle?.close();
    } catch {
      // ignore
    }
    try {
      await fs.unlink(lockPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Watch a lock file's parent directory for the file being removed (unlinked),
 * which signals that the lock holder has released it. A safety timeout caps
 * the wait so the overall `withFileLock` timeout is always respected.
 *
 * Uses a bounded safety interval (up to 100ms), so even if `fs.watch` is
 * unavailable or misses the event, we never busy-wait at 25ms fixed polling.
 */
async function waitForLockRelease(lockPath: string, remainingMs: number): Promise<void> {
  const parentDir = path.dirname(lockPath);
  const lockName = path.basename(lockPath);
  const intervalMs = Math.min(remainingMs, 100);

  return new Promise<void>((resolve) => {
    let settled = false;
    let watcher: FSWatcher | null = null;

    const timer = setTimeout(() => {
      settled = true;
      watcher?.close();
      resolve();
    }, intervalMs);

    try {
      watcher = watchDir(parentDir, (eventType, filename) => {
        if (settled) return;
        if (filename === lockName && (eventType === 'rename' || eventType === 'change')) {
          settled = true;
          clearTimeout(timer);
          watcher?.close();
          resolve();
        }
      });
    } catch {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        setTimeout(resolve, Math.min(remainingMs, 25));
      }
      return;
    }

    fs.access(lockPath).then(
      () => {},
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          watcher?.close();
          resolve();
        }
      },
    );
  });
}

const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY']);

async function renameWithRetry(from: string, to: string): Promise<void> {
  if (process.platform !== 'win32') {
    await fs.rename(from, to);
    return;
  }
  const delays = [10, 25, 60, 120, 250];
  let lastErr: unknown;
  for (let i = 0; i <= delays.length; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (!code || !TRANSIENT_RENAME_CODES.has(code) || i === delays.length) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[i]));
    }
  }
  throw lastErr;
}
