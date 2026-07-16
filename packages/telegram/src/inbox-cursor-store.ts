// ---------------------------------------------------------------------------
// P1.7 — safe inbox cursor persistence.
//
// Replaces the global `message_id` ack with an inbox-scoped cursor
// store: each chat_id gets its own persisted offset, so one chat's
// commit / crash / restart cannot affect another chat's replay
// boundary.
//
// Atomic writes (temp + fsync + rename) match `OffsetStore` so a crash
// mid-write never leaves a corrupt or partial file. Reads handle missing,
// empty, and malformed files transparently. The default path is
// `<globalRoot>/telegram/inbox-<tokenHash>-<chatId>.json`; the raw
// token never appears in any path or persisted content.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { wstackGlobalRoot } from '@wrongstack/core/utils';

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

/** Default inbox cursor path. */
export function inboxCursorPath(
  token: string,
  chatId: string | number,
  globalRoot = wstackGlobalRoot(),
): string {
  return join(globalRoot, 'telegram', `inbox-${tokenHash(token)}-${chatId}.json`);
}

export interface InboxCursorStoreOptions {
  /** Bot token — derives a token-scoped default path. Never persisted. */
  token?: string | undefined;
  /** Explicit file path override. An empty string disables persistence. */
  path?: string | undefined;
  /** Base directory for token-scoped derivation. */
  globalRoot?: string | undefined;
}

export class InboxCursorStore {
  private readonly path: string;

  constructor(opts: InboxCursorStoreOptions = {}) {
    if (opts.path !== undefined) {
      this.path = opts.path;
    } else if (opts.token) {
      this.path = inboxCursorPath(opts.token, '<inbox>', opts.globalRoot);
    } else {
      this.path = '';
    }
  }

  get storePath(): string {
    return this.path;
  }

  /**
   * Read the persisted offset. Returns null when the file is missing,
   * empty, or contains a value that is not a valid non-negative integer.
   */
  read(): number | null {
    if (!this.path) return null;
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8').trim();
    } catch {
      return null;
    }
    if (raw.length === 0) return null;
    try {
      const parsed = JSON.parse(raw);
      if (
        typeof parsed !== 'number' ||
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        parsed % 1 !== 0
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Persist an offset using an atomic write (temp + fsync + rename).
   * Creates the parent directory on first call.
   *
   * P1.6 semantics: commit only on progress. offset = 0 means "never
   * advanced past the initial state", so writing 0 would re-play the
   * entire inbox on the next poll — we no-op it.
   */
  write(offset: number): void {
    if (!this.path || offset <= 0) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, JSON.stringify(offset));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      renameSync(tmp, this.path);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

/**
 * Per-inbox cursor map: chatId -> PersistedInboxCursor.
 *
 * The map is built by passing an `inboxId` to each operation, so a single
 * store instance can drive an arbitrary number of inboxes; each one is
 * isolated on disk and on the wire (the Telegram long-poll returns all
 * messages globally, so the bot must also commit per-inbox deltas to
 * maintain the replay boundary).
 */
export class PerInboxCursorMap {
  private readonly basePath: string;
  private readonly stores: Map<string, InboxCursorStore> = new Map();

  constructor(token: string, globalRoot = wstackGlobalRoot()) {
    if (!token) {
      this.basePath = '';
    } else {
      this.basePath = join(globalRoot, 'telegram');
    }
    this.token = token;
  }

  private readonly token: string;

  private storeFor(inboxId: string): InboxCursorStore {
    const existing = this.stores.get(inboxId);
    if (existing) return existing;
    if (!this.basePath) {
      const fresh = new InboxCursorStore({ path: '' });
      this.stores.set(inboxId, fresh);
      return fresh;
    }
    const fresh = new InboxCursorStore({
      path: join(this.basePath, `inbox-${tokenHash(this.token)}-${inboxId}.json`),
    });
    this.stores.set(inboxId, fresh);
    return fresh;
  }

  /** Read the offset for `inboxId`. Returns null when no offset is persisted. */
  read(inboxId: string): number | null {
    return this.storeFor(inboxId).read();
  }

  /** Persist the offset for `inboxId`. */
  write(inboxId: string, offset: number): void {
    this.storeFor(inboxId).write(offset);
  }

  /** Drop the cached store for `inboxId` (next read/write will reload from disk). */
  invalidate(inboxId: string): void {
    this.stores.delete(inboxId);
  }

  /** Drop all cached stores. */
  clear(): void {
    this.stores.clear();
  }
}
