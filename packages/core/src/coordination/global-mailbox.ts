/**
 * GlobalMailbox — project-level inter-agent mailbox with cross-session support.
 *
 * Stores messages at `~/.wrongstack/projects/<slug>/_mailbox.jsonl` so all
 * sessions (terminals, WebUIs) working on the same project share one inbox.
 *
 * Features:
 * - Agent registration + heartbeat (agents go stale after 60s without heartbeat)
 * - Per-recipient read receipts (readBy[agentId] = ISO8601)
 * - Atomic file-locking for concurrent multi-process writes
 * - Unread count for new-mail notifications
 * - Online agent list
 *
 * @module GlobalMailbox
 */

import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';

import * as path from 'node:path';
import type { HqPublisher } from '../hq/publisher.js';
import type { EventBus } from '../kernel/events.js';
import { withFileLock } from '../utils/atomic-write.js';
import { projectSlug } from '../utils/wstack-paths.js';
import type {
  AgentHeartbeatInput,
  AgentRegistrationInput,
  ClientHeartbeatInput,
  ClientRegistrationInput,
  ClientStatus,
  Mailbox,
  MailboxAckBatchInput,
  MailboxAckInput,
  MailboxAgentStatus,
  MailboxMessage,
  MailboxQuery,
  MailboxSendInput,
  AutoCompactOptions,
  AutoCompactResult,
  PurgeOptions,
  PurgeResult,
  RegisteredAgent,
  RegisteredClient,
} from './mailbox-types.js';
import { normalizeRecipient } from './mailbox-types.js';
import {
  AGENT_PURGE_MS,
  AGENT_STALE_MS,
  AUTO_COMPACT_DEFAULT_TTL_MS,
  AUTO_COMPACT_INTERVAL_MS,
  AUTO_COMPACT_READ_MAX_AGE_MS,
  CLIENT_STALE_MS,
  HEARTBEAT_THROTTLE_MS,
  LINE_SEPARATOR,
  MESSAGE_CACHE_MAX_ENTRIES,
  REGISTRY_CACHE_TTL_MS,
} from './mailbox-constants.js';

// ── Constants ────────────────────────────────────────────────────────────

const MAILBOX_FILE = '_mailbox.jsonl';
const CLIENT_REGISTRY_FILE = '_mailbox.clients.json';

type HqPublisherRef = HqPublisher | (() => HqPublisher | undefined);

/**
 * Derive the project-level mailbox directory path.
 *
 * Delegates to the CANONICAL `projectSlug()` from wstack-paths so every
 * surface (CLI, TUI, WebUI, mailbox tool, loop checker) lands in the exact
 * same `~/.wrongstack/projects/<slug>/` directory. A previous inline copy
 * skipped the leading/trailing-hyphen strip, which silently split agents
 * working on projects with non-alphanumeric name edges into TWO mailboxes.
 *
 * @param projectRoot  — absolute path to the project root
 * @param globalRoot   — `~/.wrongstack` (or custom global root)
 */
export function resolveProjectDir(projectRoot: string, globalRoot: string): string {
  return path.join(globalRoot, 'projects', projectSlug(projectRoot));
}

// ── Singleton factory ────────────────────────────────────────────────────

/**
 * Process-wide registry of GlobalMailbox instances, keyed by projectDir.
 *
 * Without this, `attachMailboxChecker` and `attachFleetPulse` each created
 * a SEPARATE GlobalMailbox for the same project directory — two independent
 * mtime caches, two read chains, two sets of heartbeat timers. The factory
 * ensures that within a single process there is at most one instance per
 * project directory, so cache hit ratio is maximized and I/O is minimized.
 *
 * Cross-process sharing still works as before (the JSONL file + file lock
 * is the source of truth); this is purely an in-process optimization.
 *
 * Pass `forceNew: true` to bypass the cache (used by tests that need an
 * isolated tmpdir instance without polluting the singleton).
 */
const _mailboxInstances = new Map<string, GlobalMailbox>();

export function getSharedMailbox(
  projectDir: string,
  events?: EventBus,
  hqPublisher?: HqPublisherRef,
  opts?: { forceNew?: boolean },
): GlobalMailbox {
  if (opts?.forceNew) {
    return new GlobalMailbox(projectDir, events, hqPublisher);
  }
  const existing = _mailboxInstances.get(projectDir);
  if (existing !== undefined) return existing;
  const mb = new GlobalMailbox(projectDir, events, hqPublisher);
  _mailboxInstances.set(projectDir, mb);
  return mb;
}

/** Clear the singleton registry — used by tests to avoid cross-test leakage. */
export function _clearMailboxSingletons(): void {
  _mailboxInstances.clear();
}

// ── GlobalMailbox ────────────────────────────────────────────────────────

export class GlobalMailbox implements Mailbox {
  /** Path to the JSONL message file. */
  readonly messagePath: string;
  /** Path to the JSON agent registry file. */
  readonly registryPath: string;
  /** Path to the JSON client registry file. */
  readonly clientRegistryPath: string;
  /** Optional event bus for emitting agent registration/heartbeat events. */
  private readonly _events?: EventBus | undefined;
  /** Optional HQ publisher for cross-project command-center telemetry. */
  private readonly _hqPublisher?: HqPublisherRef | undefined;
  /**
   * Local cache of the agent registry to avoid re-reading on every call.
   * Time-bounded: the registry file is shared ACROSS PROCESSES (that's the
   * whole point of GlobalMailbox), so a cache served forever would never see
   * agents registered by other sessions. Writers always bypass it.
   */
  private _registryCache: Map<string, RegisteredAgent> | null = null;
  /** When the registry cache was last refreshed from disk (epoch ms). */
  private _registryCacheAt = 0;
  /**
   * Local cache of the client registry to avoid re-reading on every call.
   * Same reasoning as agent registry cache.
   */
  private _clientRegistryCache: Map<string, RegisteredClient> | null = null;
  /** When the client registry cache was last refreshed from disk (epoch ms). */
  private _clientRegistryCacheAt = 0;
  /** Last time each local agent sent a heartbeat (throttle). */
  private _lastHeartbeat = new Map<string, number>();
  /** Last time each local client sent a heartbeat (throttle). */
  private _lastClientHeartbeat = new Map<string, number>();
  /**
   * In-memory mirror of the JSONL message file. The mailbox is shared
   * ACROSS PROCESSES, so reads cannot trust the cache blindly — we pair it
   * with an mtime check. The file lock serializes every write, so a
   * changed mtimeMs is a definitive signal that another process (or this
   * one) wrote; an unchanged mtimeMs guarantees no write happened and the
   * cache is current. This collapses the per-iteration `query()` cost from
   * O(file_size) disk + parse to O(messages) in memory.
   */
  private _messageCache: MailboxMessage[] | null = null;
  /** mtimeMs of the file when `_messageCache` was populated. */
  private _messageCacheMtime = -1;
  /** Size of the file when `_messageCache` was populated (extra guard). */
  private _messageCacheSize = -1;
  /**
   * Serializes reads of the message file so overlapping concurrent
   * `_readMessagesCached()` calls don't both enter the incremental "file
   * only grew" branch against the same stale `_messageCacheSize` and
   * each push the same tail bytes onto the cache (duplicating every
   * appended message). The chain runs each read to completion before
   * the next starts, in issue order — readers are read-only and never
   * conflict with each other on content, only on the cache mutation
   * that follows the read. Pattern mirrors `DefaultMemoryStore.runSerialized`.
   */
  private _readChain: Promise<MailboxMessage[]> = Promise.resolve([] as MailboxMessage[]);

  /**
   * Recipient → Set of indices into `_messageCache`. Maintained alongside
   * the cache so `query({ to })` and `unreadCount(agentId)` can skip the
   * O(N) full scan and iterate only the messages addressed to the target
   * recipient (plus broadcasts `*`).
   *
   * The index is rebuilt whenever the cache array is replaced
   * (`_setMessageCache`), extended when new messages are pushed
   * (`_pushToCache`, `_readNewMessagesOnly`), and cleared on `close()`.
   * It is `null` when the cache itself is null (> MESSAGE_CACHE_MAX_ENTRIES
   * or never populated).
   *
   * Safety: array indices are valid only as long as the cache array
   * reference hasn't changed. Since we rebuild the index in the same
   * synchronous step that replaces the cache, a reader that calls
   * `_readMessagesCached()` either gets the old array + old index, or
   * the new array + new index — never a mismatch.
   */
  private _recipientIndex: Map<string, Set<number>> | null = null;

  /**
   * @param projectDir — `~/.wrongstack/projects/<slug>/`
   * @param events — optional EventBus for real-time TUI/WebUI notifications
   * @param hqPublisher — optional HQ publisher, or getter, for cross-project telemetry
   */
  constructor(projectDir: string, events?: EventBus, hqPublisher?: HqPublisherRef) {
    this.messagePath = path.join(projectDir, MAILBOX_FILE);
    this.registryPath = path.join(projectDir, '_mailbox.registry.json');
    this.clientRegistryPath = path.join(projectDir, CLIENT_REGISTRY_FILE);
    this._events = events;
    this._hqPublisher = hqPublisher;
  }

  private get hqMailboxId(): string {
    return `${path.basename(path.dirname(this.messagePath))}:mailbox`;
  }

  private get hqPublisher(): HqPublisher | undefined {
    return typeof this._hqPublisher === 'function' ? this._hqPublisher() : this._hqPublisher;
  }

  private publishHqMailboxEvent(input: Parameters<HqPublisher['publishMailboxEvent']>[0]): void {
    try {
      this.hqPublisher?.publishMailboxEvent(input);
    } catch {
      // HQ telemetry is best-effort and must never affect mailbox behavior.
    }
  }

  private publishHqMailboxSnapshot(): void {
    const publisher = this.hqPublisher;
    if (publisher === undefined) return;
    void publisher.publishMailboxSnapshot(this, { mailboxId: this.hqMailboxId }).catch(() => {
      // HQ telemetry is best-effort and must never affect mailbox behavior.
    });
  }

  // ── Messages ────────────────────────────────────────────────────────────

  async send(input: MailboxSendInput): Promise<MailboxMessage> {
    const now = new Date().toISOString();
    const msg: MailboxMessage = {
      id: randomUUID(),
      from: input.from,
      // "all" is an accepted spelling of the broadcast address — canonical
      // form on disk is '*' so every query/checker matches it.
      to: normalizeRecipient(input.to),
      type: input.type,
      subject: input.subject,
      body: input.body,
      priority: input.priority ?? 'normal',
      readBy: {},
      completed: false,
      timestamp: now,
      replyTo: input.replyTo,
      taskContext: input.taskContext,
      expiresAt: input.ttlMs !== undefined
        ? new Date(Date.now() + input.ttlMs).toISOString()
        : undefined,
    };

    const line = JSON.stringify(msg) + LINE_SEPARATOR;
    await fsp.mkdir(path.dirname(this.messagePath), { recursive: true });
    // The append must hold the same lock ack() rewrites under: an unlocked
    // append racing ack's read→rewrite gets silently erased when the rewrite
    // lands. This file is shared ACROSS PROCESSES, so the window is real.
    await withFileLock(this.messagePath, async () => {
      await fsp.appendFile(this.messagePath, line, 'utf8');
      // Capture the post-append stat INSIDE the lock so the cache trackers
      // advance with the pushed content. A concurrent reader that lands
      // after we release but before a future stat would otherwise see the
      // file grew and re-append the just-sent tail, duplicating it.
      const { mtimeMs, size } = await this._statMessageFile();
      // Refresh the in-memory cache from the message we just appended —
      // cheaper than re-reading the whole file, and correct because we
      // held the lock so nothing else changed underneath us.
      this._pushToCache(msg, mtimeMs, size);
    });

    this.publishHqMailboxEvent({
      mailboxId: this.hqMailboxId,
      action: 'message.sent',
      message: msg,
    });
    this.publishHqMailboxSnapshot();

    // In-process push notification: same-process mailbox consumers (the
    // awareness poller, fleet pulse, TUI/WebUI) can listen on this event
    // to get real-time updates instead of polling on every iteration.
    this._events?.emitCustom('mailbox.message_sent', {
      messageId: msg.id,
      from: msg.from,
      to: msg.to,
      type: msg.type,
      subject: msg.subject,
    });

    return msg;
  }

  async query(q: MailboxQuery): Promise<MailboxMessage[]> {
    const all = await this._readMessagesCached();
    const limit = q.limit ?? 50;

    // Single-pass filter — previously 7 chained .filter() allocations each
    // producing a fresh array. Predicates are independent, so we can AND
    // them in one walk and short-circuit per element.
    const order = q.minPriority !== undefined ? ({ low: 0, normal: 1, high: 2 } as const) : null;
    const minPriorityRank = order && q.minPriority !== undefined ? order[q.minPriority] : 0;
    const out: MailboxMessage[] = [];

    // Recipient index fast-path: when the query filters by `to` AND no
    // other broad filter (from, type, etc.) would benefit from the index,
    // iterate only the messages addressed to the target recipient (plus
    // broadcasts `*`) instead of scanning the full cache. Falls back to
    // the full scan when the index is unavailable or when multiple
    // non-recipient filters are present (the index doesn't help there).
    let candidates: Iterable<MailboxMessage>;
    if (
      q.to !== undefined &&
      this._recipientIndex !== null &&
      q.from === undefined &&
      q.type === undefined &&
      q.minPriority === undefined
    ) {
      // Collect candidate indices: messages addressed to `q.to` + broadcasts.
      const indices = new Set<number>();
      const direct = this._recipientIndex.get(q.to);
      if (direct !== undefined) for (const i of direct) indices.add(i);
      const broadcasts = this._recipientIndex.get('*');
      if (broadcasts !== undefined) for (const i of broadcasts) indices.add(i);
      candidates = [...indices].sort((a, b) => a - b).map((i) => all[i]!);
    } else {
      candidates = all;
    }

    for (const m of candidates) {
      if (q.to !== undefined && m.to !== q.to && m.to !== '*') continue;
      if (q.from !== undefined && m.from !== q.from) continue;
      if (q.unreadBy !== undefined && q.unreadBy in m.readBy) continue;
      if (q.incompleteOnly && m.completed) continue;
      if (q.type !== undefined && m.type !== q.type) continue;
      if (order !== null && (order[m.priority as keyof typeof order] ?? 1) < minPriorityRank!) {
        continue;
      }
      if (q.since !== undefined && m.timestamp <= q.since) continue;
      // Default behavior: soft-deleted messages are hidden unless the
      // caller explicitly opts in via `includeDeleted: true` (used by
      // the WebUI's "trash" view).
      if (!q.includeDeleted && m.deletedAt !== undefined) continue;
      out.push(m);
    }

    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    // Return defensive shallow copies so callers cannot mutate the shared
    // cache entries. Only the returned slice is copied — O(limit), not O(N).
    return out.slice(0, limit).map((m) => ({ ...m, readBy: { ...m.readBy } }));
  }

  async ack(input: MailboxAckInput): Promise<MailboxMessage | null> {
    const updated = await this.ackMany({ acks: [input] });
    return updated.length > 0 ? updated[0]! : null;
  }

  async ackMany(input: MailboxAckBatchInput): Promise<MailboxMessage[]> {
    // One lock acquisition + one file rewrite for the whole batch. The
    // previous per-message ack() did a full read-modify-rewrite for every
    // single ack — N fresh messages meant N full-file rewrites in a row.
    if (input.acks.length === 0) return [];

    const updated: MailboxMessage[] = [];
    const byId = new Map<string, MailboxAckInput>();
    for (const a of input.acks) {
      // Last-write-wins within the batch for the same messageId — matches
      // the prior sequential semantics where later acks overrode earlier.
      byId.set(a.messageId, a);
    }

    await withFileLock(this.messagePath, async () => {
      // Read fresh under the lock — the cache may be stale relative to
      // other processes that wrote since our last read.
      const all = await this._readMessagesFresh();
      const now = new Date().toISOString();
      let changed = false;

      for (const msg of all) {
        const a = byId.get(msg.id);
        if (!a) continue;
        // Preserve prior semantics: return the message as long as it was
        // found, even if the ack was a no-op (e.g. already read).
        updated.push(msg);
        if (a.read !== false && !(a.readerId in msg.readBy)) {
          msg.readBy[a.readerId] = now;
          changed = true;
        }
        if (a.completed && !msg.completed) {
          msg.completed = true;
          msg.completedBy = a.readerId;
          msg.completedAt = now;
          changed = true;
        }
        if (a.outcome !== undefined && msg.outcome !== a.outcome) {
          msg.outcome = a.outcome;
          changed = true;
        }
      }

      // Only rewrite the file if at least one ack actually mutated state —
      // a re-ack of an already-read message is now a no-op on disk, where
      // previously it was a full rewrite.
      if (changed) {
        const serialized = all.map((m) => JSON.stringify(m)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
        await fsp.writeFile(this.messagePath, serialized, 'utf8');
      }
      // Promote the cache INSIDE the lock with the post-write (or
      // post-read when unchanged) stat so the mtime/size trackers are set
      // synchronously with the content — no race window where a concurrent
      // reader sees fresh content but stale trackers and misclassifies a
      // rewrite as a "file only grew" append.
      const { mtimeMs, size } = await this._statMessageFile();
      this._setMessageCache(all, mtimeMs, size);
    });

    for (const message of updated) {
      this.publishHqMailboxEvent({
        mailboxId: this.hqMailboxId,
        action: message.completed ? 'message.completed' : 'message.read',
        message,
      });
    }
    if (updated.length > 0) this.publishHqMailboxSnapshot();
    return updated;
  }

  async unreadCount(forAgentId: string): Promise<number> {
    const all = await this._readMessagesCached();
    let count = 0;

    // Recipient index fast-path: iterate only messages addressed to this
    // agent + broadcasts, instead of the full cache.
    if (this._recipientIndex !== null) {
      const indices = new Set<number>();
      const direct = this._recipientIndex.get(forAgentId);
      if (direct !== undefined) for (const i of direct) indices.add(i);
      const broadcasts = this._recipientIndex.get('*');
      if (broadcasts !== undefined) for (const i of broadcasts) indices.add(i);
      for (const i of indices) {
        const m = all[i]!;
        if (!(forAgentId in m.readBy) && !m.completed) count++;
      }
    } else {
      for (let i = 0; i < all.length; i++) {
        const m = all[i]!;
        if ((m.to === forAgentId || m.to === '*') && !(forAgentId in m.readBy) && !m.completed) {
          count++;
        }
      }
    }
    return count;
  }

  async softDelete(mailId: string, by: string): Promise<MailboxMessage | null> {
    // Single-message soft delete. Acquires the file lock and writes
    // the file with the matched message's `deletedAt` set. No-op if
    // the message does not exist or is already soft-deleted (the
    // second case is a successful no-op: returns the message with
    // `deletedAt` unchanged).
    let updated: MailboxMessage | null = null;
    await withFileLock(this.messagePath, async () => {
      const all = await this._readMessagesFresh();
      const now = new Date().toISOString();
      let changed = false;
      for (const m of all) {
        if (m.id !== mailId) continue;
        if (m.deletedAt !== undefined) {
          // Already soft-deleted — return the existing record so the
          // caller can no-op cleanly. No event is published.
          updated = m;
          continue;
        }
        m.deletedAt = now;
        m.deletedBy = by;
        updated = m;
        changed = true;
      }
      // Only rewrite the file if the soft-delete actually mutated state —
      // a re-delete of an already-deleted message is a no-op on disk.
      if (changed) {
        const serialized = all.map((m) => JSON.stringify(m)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
        await fsp.writeFile(this.messagePath, serialized, 'utf8');
      }
      // Promote the cache inside the lock with the post-write stat so the
      // mtime/size trackers are set synchronously with the content.
      const { mtimeMs, size } = await this._statMessageFile();
      this._setMessageCache(all, mtimeMs, size);
    });
    if (updated !== null) {
      this.publishHqMailboxEvent({
        mailboxId: this.hqMailboxId,
        action: 'message.updated',
        message: updated,
      });
      this.publishHqMailboxSnapshot();
    }
    return updated;
  }

  async restore(mailId: string): Promise<MailboxMessage | null> {
    // Inverse of `softDelete`. Clears `deletedAt` + `deletedBy` so the
    // message reappears in the default `query()` result. No-op when
    // the message exists but is not currently soft-deleted. Emits an
    // event unconditionally so the WebUI can re-fetch the message
    // (the duplicate-event cost is acceptable: the WebUI dedupes by
    // `mailId`).
    let updated: MailboxMessage | null = null;
    await withFileLock(this.messagePath, async () => {
      const all = await this._readMessagesFresh();
      let changed = false;
      for (const m of all) {
        if (m.id !== mailId) continue;
        if (m.deletedAt === undefined && m.deletedBy === undefined) {
          // Not soft-deleted — no-op, return the message as-is.
          updated = m;
          continue;
        }
        delete m.deletedAt;
        delete m.deletedBy;
        updated = m;
        changed = true;
      }
      if (changed) {
        const serialized = all.map((m) => JSON.stringify(m)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
        await fsp.writeFile(this.messagePath, serialized, 'utf8');
      }
      // Promote the cache inside the lock with the post-write stat so the
      // mtime/size trackers are set synchronously with the content.
      const { mtimeMs, size } = await this._statMessageFile();
      this._setMessageCache(all, mtimeMs, size);
    });
    if (updated !== null) {
      this.publishHqMailboxEvent({
        mailboxId: this.hqMailboxId,
        action: 'message.updated',
        message: updated,
      });
      this.publishHqMailboxSnapshot();
    }
    return updated;
  }

  // ── Agent registry ──────────────────────────────────────────────────────

  async registerAgent(input: AgentRegistrationInput): Promise<void> {
    await this._ensureRegistry();
    const now = new Date().toISOString();
    const agent: RegisteredAgent = {
      agentId: input.agentId,
      sessionId: input.sessionId,
      name: input.name,
      role: input.role,
      status: 'idle',
      currentTool: undefined,
      currentTask: undefined,
      iterations: 0,
      toolCalls: 0,
      registeredAt: now,
      lastSeenAt: now,
      pid: input.pid,
      source: input.source,
    };

    await withFileLock(this.registryPath, async () => {
      // fresh: read-modify-write must start from the on-disk state, not the
      // cache — other processes may have registered agents since.
      const registry = await this._readRegistry({ fresh: true });
      // Prune stale agents
      this._pruneStaleInPlace(registry);
      // Upsert
      registry.set(input.agentId, agent);
      // Update cache
      this._registryCache = registry;
      this._registryCacheAt = Date.now();
      await this._writeRegistry(registry);
    });

    // Emit event for TUI/WebUI to update online agent count
    this._events?.emitCustom('mailbox.agent_registered', {
      agentId: input.agentId,
      sessionId: input.sessionId,
      name: input.name,
      role: input.role,
      source: input.source,
    });
    this.publishHqMailboxEvent({
      mailboxId: this.hqMailboxId,
      action: 'agent.registered',
      agent: {
        agentId: input.agentId,
        name: input.name,
        ...(input.role !== undefined ? { role: input.role } : {}),
        sessionId: input.sessionId,
        status: 'idle',
        iterations: 0,
        toolCalls: 0,
        lastActivityAt: now,
        lastSeenAt: now,
        online: true,
        pid: input.pid,
        ...(input.source !== undefined ? { source: input.source } : {}),
      },
    });
    this.publishHqMailboxSnapshot();
  }

  async deregisterAgent(agentId: string): Promise<void> {
    await this._ensureRegistry();
    let removed: RegisteredAgent | undefined;
    await withFileLock(this.registryPath, async () => {
      const registry = await this._readRegistry({ fresh: true });
      this._pruneStaleInPlace(registry);
      // Capture the record before deletion so HQ telemetry can emit a full,
      // well-typed agent summary rather than a bare id.
      removed = registry.get(agentId);
      registry.delete(agentId);
      this._registryCache = registry;
      this._registryCacheAt = Date.now();
      await this._writeRegistry(registry);
    });
    this._events?.emitCustom('mailbox.agent_deregistered', {
      agentId,
    });
    this.publishHqMailboxEvent({
      mailboxId: this.hqMailboxId,
      action: 'agent.deregistered',
      agent: {
        agentId,
        name: removed?.name ?? agentId,
        ...(removed?.role !== undefined ? { role: removed.role } : {}),
        sessionId: removed?.sessionId ?? '',
        status: 'offline',
        ...(removed?.currentTool !== undefined ? { currentTool: removed.currentTool } : {}),
        ...(removed?.currentTask !== undefined ? { currentTask: removed.currentTask } : {}),
        iterations: removed?.iterations ?? 0,
        toolCalls: removed?.toolCalls ?? 0,
        lastActivityAt: removed?.lastSeenAt ?? new Date().toISOString(),
        lastSeenAt: removed?.lastSeenAt ?? new Date().toISOString(),
        online: false,
        pid: removed?.pid ?? 0,
        ...(removed?.source !== undefined ? { source: removed.source } : {}),
      },
    });
    this.publishHqMailboxSnapshot();
  }

  async heartbeat(input: AgentHeartbeatInput): Promise<void> {
    // Throttle: at most one heartbeat per agent per HEARTBEAT_THROTTLE_MS
    const last = this._lastHeartbeat.get(input.agentId) ?? 0;
    const now = Date.now();
    if (now - last < HEARTBEAT_THROTTLE_MS) return;

    this._lastHeartbeat.set(input.agentId, now);

    await this._ensureRegistry();

    await withFileLock(this.registryPath, async () => {
      // fresh: see registerAgent — never read-modify-write from the cache.
      const registry = await this._readRegistry({ fresh: true });
      this._pruneStaleInPlace(registry);

      const agent = registry.get(input.agentId);
      if (agent) {
        const iso = new Date().toISOString();
        agent.lastSeenAt = iso;
        if (input.status !== undefined) agent.status = input.status;
        if (input.currentTool !== undefined) agent.currentTool = input.currentTool;
        if (input.currentTask !== undefined) agent.currentTask = input.currentTask;
        if (input.iterations !== undefined) agent.iterations = input.iterations;
        if (input.toolCalls !== undefined) agent.toolCalls = input.toolCalls;
      }
      // If agent not registered yet, silently skip — registerAgent first

      this._registryCache = registry;
      this._registryCacheAt = Date.now();
      await this._writeRegistry(registry);
    });

    // Emit event so TUI/WebUI can track online agents in real time
    this._events?.emitCustom('mailbox.agent_heartbeat', {
      agentId: input.agentId,
      status: input.status,
      currentTool: input.currentTool,
      currentTask: input.currentTask,
    });
    this.publishHqMailboxEvent({
      mailboxId: this.hqMailboxId,
      action: 'agent.heartbeat',
      summary: input.agentId,
    });
    this.publishHqMailboxSnapshot();
  }

  async getAgentStatuses(): Promise<MailboxAgentStatus[]> {
    await this._ensureRegistry();
    const registry = await this._readRegistry();
    this._pruneStaleInPlace(registry);

    const now = Date.now();
    return Array.from(registry.values())
      .map((a) => ({
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        sessionId: a.sessionId,
        status: a.status,
        currentTool: a.currentTool,
        currentTask: a.currentTask,
        iterations: a.iterations,
        toolCalls: a.toolCalls,
        lastActivityAt: a.lastSeenAt,
        lastSeenAt: a.lastSeenAt,
        online: now - new Date(a.lastSeenAt).getTime() < AGENT_STALE_MS,
        pid: a.pid,
        source: a.source,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  async getOnlineAgents(): Promise<MailboxAgentStatus[]> {
    const all = await this.getAgentStatuses();
    return all.filter((a) => a.online);
  }

  // ── Client registry ─────────────────────────────────────────────────────

  async registerClient(input: ClientRegistrationInput): Promise<void> {
    await this._ensureClientRegistry();
    const now = new Date().toISOString();
    const client: RegisteredClient = {
      clientId: input.clientId,
      sessionId: input.sessionId,
      name: input.name,
      source: input.source,
      registeredAt: now,
      lastSeenAt: now,
      pid: input.pid,
    };

    await withFileLock(this.clientRegistryPath, async () => {
      const registry = await this._readClientRegistry({ fresh: true });
      this._pruneStaleClientsInPlace(registry);
      registry.set(input.clientId, client);
      this._clientRegistryCache = registry;
      this._clientRegistryCacheAt = Date.now();
      await this._writeClientRegistry(registry);
    });

    // Emit event for TUI/WebUI to update online client count
    this._events?.emitCustom('mailbox.client_registered', {
      clientId: input.clientId,
      sessionId: input.sessionId,
      name: input.name,
      source: input.source,
    });
    this.publishHqMailboxSnapshot();
  }

  async clientHeartbeat(input: ClientHeartbeatInput): Promise<void> {
    // Throttle: at most one heartbeat per client per HEARTBEAT_THROTTLE_MS
    const last = this._lastClientHeartbeat.get(input.clientId) ?? 0;
    const now = Date.now();
    if (now - last < HEARTBEAT_THROTTLE_MS) return;

    this._lastClientHeartbeat.set(input.clientId, now);

    await this._ensureClientRegistry();

    await withFileLock(this.clientRegistryPath, async () => {
      const registry = await this._readClientRegistry({ fresh: true });
      this._pruneStaleClientsInPlace(registry);

      const client = registry.get(input.clientId);
      if (client) {
        client.lastSeenAt = new Date().toISOString();
        if (typeof input.sessionId === 'string' && input.sessionId.length > 0) {
          client.sessionId = input.sessionId;
        }
      }

      this._clientRegistryCache = registry;
      this._clientRegistryCacheAt = Date.now();
      await this._writeClientRegistry(registry);
    });

    // Emit event so TUI/WebUI can track online clients in real time
    this._events?.emitCustom('mailbox.client_heartbeat', {
      clientId: input.clientId,
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    });
    this.publishHqMailboxSnapshot();
  }

  async getClientStatuses(): Promise<ClientStatus[]> {
    await this._ensureClientRegistry();
    const registry = await this._readClientRegistry();
    this._pruneStaleClientsInPlace(registry);

    const now = Date.now();
    return Array.from(registry.values())
      .map((c) => ({
        clientId: c.clientId,
        name: c.name,
        source: c.source,
        sessionId: c.sessionId,
        lastSeenAt: c.lastSeenAt,
        online: now - new Date(c.lastSeenAt).getTime() < CLIENT_STALE_MS,
        pid: c.pid,
      }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  async close(): Promise<void> {
    // JSONL append-only — no flush needed
    this._registryCache = null;
    this._clientRegistryCache = null;
    this._messageCache = null;
    this._messageCacheMtime = -1;
    this._messageCacheSize = -1;
    this._recipientIndex = null;
  }

  async clearAll(): Promise<void> {
    // Truncate the mailbox file and promote the empty cache under the same
    // lock, with the post-truncate stat captured synchronously so a
    // concurrent reader doesn't misclassify the shrink as a "file only
    // grew" append.
    await withFileLock(this.messagePath, async () => {
      await fsp.writeFile(this.messagePath, '', 'utf8');
      const { mtimeMs, size } = await this._statMessageFile();
      this._setMessageCache([], mtimeMs, size);
    });
  }

  async purgeStale(opts?: PurgeOptions): Promise<PurgeResult> {
    const COMPLETED_MAX_AGE_MS = opts?.completedMaxAgeMs ?? 86_400_000; // 1 day
    const INCOMPLETE_MAX_AGE_MS = opts?.incompleteMaxAgeMs ?? 604_800_000; // 7 days

    let completedPurged = 0;
    let incompletePurged = 0;
    let remaining = 0;

    // Read-modify-write under the lock — same pattern as ack().
    await withFileLock(this.messagePath, async () => {
      const all = await this._readMessagesFresh();
      const now = Date.now();
      const cutoffCompleted = now - COMPLETED_MAX_AGE_MS;
      const cutoffIncomplete = now - INCOMPLETE_MAX_AGE_MS;

      const kept: MailboxMessage[] = [];

      for (const msg of all) {
        const msgTime = new Date(msg.timestamp).getTime();
        const completedTime = msg.completedAt ? new Date(msg.completedAt).getTime() : 0;

        if (msg.completed && completedTime < cutoffCompleted) {
          completedPurged++;
          continue; // drop
        }
        if (!msg.completed && msgTime < cutoffIncomplete) {
          incompletePurged++;
          continue; // drop
        }

        kept.push(msg);
      }
      remaining = kept.length;

      // Rewrite only if something changed
      if (kept.length < all.length) {
        const content = kept.map((m) => JSON.stringify(m)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
        await fsp.writeFile(this.messagePath, content, 'utf8');
      }
      // Capture the post-write (or post-read when nothing purged) stat
      // inside the lock so the cache trackers match the on-disk state.
      const { mtimeMs, size } = await this._statMessageFile();
      // Either way we just read fresh under the lock, so adopt the kept
      // snapshot (== all when nothing was purged) as the cache.
      this._setMessageCache(kept, mtimeMs, size);
    });

    return {
      completedPurged,
      incompletePurged,
      totalPurged: completedPurged + incompletePurged,
      remaining,
    };
  }

  // ── Auto-compaction ─────────────────────────────────────────────────────

  private _autoCompactTimer: NodeJS.Timeout | null = null;

  async autoCompact(opts?: AutoCompactOptions): Promise<AutoCompactResult> {
    const readMaxAgeMs = opts?.readMaxAgeMs ?? AUTO_COMPACT_READ_MAX_AGE_MS;
    const defaultTtlMs = opts?.defaultTtlMs ?? AUTO_COMPACT_DEFAULT_TTL_MS;
    const completedMaxAgeMs = opts?.completedMaxAgeMs ?? 86_400_000; // 1 day
    const incompleteMaxAgeMs = opts?.incompleteMaxAgeMs ?? 604_800_000; // 7 days

    let expiredPurged = 0;
    let readByAllPurged = 0;
    let completedPurged = 0;
    let incompletePurged = 0;
    let remaining = 0;

    // Resolve the set of currently-online agent ids so we can check
    // "has every online agent read this?" without a second file read.
    // Online set is advisory — if the registry is temporarily empty we
    // skip the read-by-all pass rather than purging everything.
    let onlineAgentIds: Set<string> | null = null;
    try {
      const statuses = await this.getAgentStatuses();
      const online = statuses.filter((s) => s.online);
      onlineAgentIds = online.length > 0 ? new Set(online.map((s) => s.agentId)) : null;
    } catch {
      onlineAgentIds = null;
    }

    await withFileLock(this.messagePath, async () => {
      const all = await this._readMessagesFresh();
      const now = Date.now();
      const cutoffReadAge = now - readMaxAgeMs;
      const cutoffCompleted = now - completedMaxAgeMs;
      const cutoffIncomplete = now - incompleteMaxAgeMs;
      const cutoffDefaultTtl = now - defaultTtlMs;

      const kept: MailboxMessage[] = [];

      for (const msg of all) {
        const msgTime = new Date(msg.timestamp).getTime();

        // Pass 1: Explicit expiry.
        if (msg.expiresAt !== undefined) {
          if (new Date(msg.expiresAt).getTime() < now) {
            expiredPurged++;
            continue;
          }
        } else if (msgTime < cutoffDefaultTtl) {
          // No explicit expiry; use default TTL from send time.
          expiredPurged++;
          continue;
        }

        // Pass 2: Read by ALL currently-online agents.
        if (onlineAgentIds !== null && !msg.completed) {
          const readByAll =
            onlineAgentIds.size > 0 &&
            [...onlineAgentIds].every((id) => id in msg.readBy);
          if (readByAll) {
            // Check age of the most recent read receipt.
            const readTimes = Object.values(msg.readBy).map((t) => new Date(t).getTime());
            const latestRead = Math.max(...readTimes);
            if (latestRead < cutoffReadAge) {
              readByAllPurged++;
              continue;
            }
          }
        }

        // Pass 3: Standard purge-stale logic.
        const completedTime = msg.completedAt ? new Date(msg.completedAt).getTime() : 0;
        if (msg.completed && completedTime < cutoffCompleted) {
          completedPurged++;
          continue;
        }
        if (!msg.completed && msgTime < cutoffIncomplete) {
          incompletePurged++;
          continue;
        }

        kept.push(msg);
      }
      remaining = kept.length;

      if (kept.length < all.length) {
        const content = kept.map((m) => JSON.stringify(m)).join(LINE_SEPARATOR) + LINE_SEPARATOR;
        await fsp.writeFile(this.messagePath, content, 'utf8');
      }
      const { mtimeMs, size } = await this._statMessageFile();
      this._setMessageCache(kept, mtimeMs, size);
    });

    const totalRemoved = expiredPurged + readByAllPurged + completedPurged + incompletePurged;
    return {
      expiredRemoved: expiredPurged,
      readByAllRemoved: readByAllPurged,
      stalePurged: completedPurged + incompletePurged,
      totalRemoved,
      remaining,
    };
  }

  startAutoCompactTimer(opts?: AutoCompactOptions): () => void {
    // Replace any prior timer.
    if (this._autoCompactTimer !== null) {
      clearInterval(this._autoCompactTimer);
    }
    const intervalMs = opts?.intervalMs ?? AUTO_COMPACT_INTERVAL_MS;
    const timer = setInterval(() => {
      this.autoCompact(opts).catch(() => {
        // Best-effort — background compaction must never crash the process.
      });
    }, intervalMs);
    timer.unref?.();
    this._autoCompactTimer = timer;
    return () => {
      clearInterval(timer);
      this._autoCompactTimer = null;
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /**
   * Read all messages from the JSONL file. Always reads + parses the file.
   * Callers that can tolerate a stale-by-mtime view should use
   * {@link _readMessagesCached}; writers that need the post-lock truth
   * should call this directly (it's what {@link _readMessagesFresh} aliases).
   */
  private async _readMessages(): Promise<MailboxMessage[]> {
    try {
      const raw = await fsp.readFile(this.messagePath, 'utf8');
      return this._parseLines(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Read only newly-appended bytes from the file and append them to the
   * in-memory cache. This avoids re-reading and re-parsing the entire file
   * when another process appended messages since our last read.
   *
   * Only safe when the file grew in size (messages are append-only). When
   * the file was rewritten (ack/purge changed existing content), callers
   * must fall back to {@link _readMessages}.
   *
   * @returns The (now up-to-date) message cache.
   */
  private async _readNewMessagesOnly(
    fd: fsp.FileHandle,
    oldSize: number,
    newSize: number,
  ): Promise<MailboxMessage[]> {
    const tailLen = newSize - oldSize;
    const buf = Buffer.alloc(tailLen);
    await fd.read(buf, 0, tailLen, oldSize);
    const tail = buf.toString('utf8');

    // Guard against a half-written tail: if another process is mid-append,
    // the tail may not end with the LINE_SEPARATOR. Parsing a partial JSON
    // line would throw (caught below), but worse: the NEXT incremental read
    // would skip that same line because the size tracker already advanced.
    // If the tail doesn't end with LINE_SEPARATOR, the last segment is a
    // partial write — return the cache as-is WITHOUT advancing trackers so
    // the next read retries from the same offset.
    if (!tail.endsWith(LINE_SEPARATOR)) {
      // Check if there are complete lines before the partial one.
      // We can safely parse complete lines and leave the partial for next read.
      const lastSeparatorIdx = tail.lastIndexOf(LINE_SEPARATOR);
      if (lastSeparatorIdx === -1) {
        // Entire tail is a partial line — don't advance, let caller fall
        // through to a full re-read on the next call.
        return this._messageCache!;
      }
      // Parse only the complete portion; leave trackers un-advanced so the
      // partial tail is re-read next time.
      const completeTail = tail.slice(0, lastSeparatorIdx + 1);
      for (const line of completeTail.split(LINE_SEPARATOR)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!parsed['readBy']) {
            const readBy: Record<string, string> = {};
            if (parsed['read'] && parsed['readAt']) {
              readBy[parsed['to'] as string] = parsed['readAt'] as string;
            }
            parsed['readBy'] = readBy;
            delete parsed['read'];
            delete parsed['readAt'];
          }
          this._messageCache!.push(parsed as never as MailboxMessage);
        } catch {
          // Skip malformed lines
        }
      }
      // Signal to the caller that trackers should NOT advance past newSize
      // by returning early. The caller checks the return value.
      return this._messageCache!;
    }

    // Normal path: tail ends with LINE_SEPARATOR, all lines are complete.
    for (const line of tail.split(LINE_SEPARATOR)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // Migrate old `read: boolean` + `readAt` to new `readBy`
        if (!parsed['readBy']) {
          const readBy: Record<string, string> = {};
          if (parsed['read'] && parsed['readAt']) {
            readBy[parsed['to'] as string] = parsed['readAt'] as string;
          }
          parsed['readBy'] = readBy;
          delete parsed['read'];
          delete parsed['readAt'];
        }
        this._messageCache!.push(parsed as never as MailboxMessage);
        // Update recipient index for the newly appended message.
        if (this._recipientIndex !== null) {
          const idx = this._messageCache!.length - 1;
          const to = (parsed as { to: string }).to;
          let set = this._recipientIndex.get(to);
          if (set === undefined) { set = new Set(); this._recipientIndex.set(to, set); }
          set.add(idx);
        }
      } catch {
        // Skip malformed lines
      }
    }
    return this._messageCache!;
  }

  /** Parse a JSONL string into MailboxMessage[], including migration. */
  private _parseLines(raw: string): MailboxMessage[] {
    const lines = raw.split(LINE_SEPARATOR).filter((l) => l.trim().length > 0);
    const messages: MailboxMessage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // Migrate old `read: boolean` + `readAt` to new `readBy`
        if (!parsed['readBy']) {
          const readBy: Record<string, unknown> = {};
          if (parsed['read'] && parsed['readAt']) {
            readBy[parsed['to'] as string] = parsed['readAt'];
          }
          parsed['readBy'] = readBy;
          delete parsed['read'];
          delete parsed['readAt'];
        }
        messages.push(parsed as never as MailboxMessage);
      } catch {
        // Skip malformed lines
      }
    }
    return messages;
  }

  /**
   * Read messages, then adopt the result as the in-memory cache. Use this
   * from writers that just took the file lock — the read reflects the
   * authoritative post-lock state and should be served to subsequent
   * queries without re-reading.
   *
   * The mtime/size are captured from the stat at read time so the cache
   * trackers match exactly what was parsed. Writers that subsequently
   * rewrite the file MUST re-stat after the write and re-promote with the
   * post-write values (see ackMany / softDelete / restore / purgeStale /
   * clearAll) — otherwise a concurrent reader misclassifies the rewrite
   * as a "file only grew" append and corrupts the cache.
   */
  private async _readMessagesFresh(): Promise<MailboxMessage[]> {
    const all = await this._readMessages();
    const { mtimeMs, size } = await this._statMessageFile();
    this._setMessageCache(all, mtimeMs, size);
    return all;
  }

  /**
   * Stat the message file, returning its mtimeMs and size. Returns
   * `-1/-1` when the file does not yet exist (ENOENT) so callers can
   * still promote a cache snapshot — the next read will re-stat and
   * fall through to a full re-read. Call from inside the file lock so
   * the result reflects the post-write on-disk state, not a later
   * intermediate state from another process.
   */
  private async _statMessageFile(): Promise<{ mtimeMs: number; size: number }> {
    try {
      const st = await fsp.stat(this.messagePath);
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { mtimeMs: -1, size: -1 };
      }
      throw err;
    }
  }

  /**
   * Read messages, consulting the mtime-bounded in-memory cache first,
   * serialized so concurrent callers don't both mutate the cache.
   *
   * The mailbox file is shared across processes; every `send`/`ack`/
   * `clearAll`/`purgeStale` takes the file lock, so writes are serialized
   * and a changed mtimeMs is a definitive freshness signal. When the
   * stat matches the cached mtime+size we return the cached array — no
   * file read and no JSON.parse — collapsing the per-iteration query
   * cost on the mailbox-loop hot path.
   *
   * When the file only grew (new messages appended by another process),
   * we read and parse just the tail bytes instead of the entire file.
   * This avoids re-parsing the full 10K-message history on every check.
   *
   * SERIALIZATION: the actual work is chained onto `_readChain` so two
   * overlapping calls can't both pass the `st.size > _messageCacheSize`
   * incremental check against the same stale tracker and each push the
   * same tail bytes onto the cache (duplicating every appended message).
   * Readers don't conflict on file content — only on the cache mutation
   * that follows the read — so we run them one at a time in issue order.
   * Errors in the chain are swallowed so a failed read never poisons
   * subsequent reads; each caller observes and re-throws its own error.
   */
  private _readMessagesCached(): Promise<MailboxMessage[]> {
    // Chain this read after the prior one settles. Catch-and-swallow the
    // prior's error so the chain stays alive for this call regardless.
    const run = this._readChain
      .catch(() => undefined as unknown as MailboxMessage[])
      .then(() => this._readMessagesCachedWork());
    this._readChain = run.catch(() => [] as MailboxMessage[]);
    return run;
  }

  /**
   * The un-serialized body of {@link _readMessagesCached}. Reads the
   * message file with the mtime-bounded cache + incremental-tail
   * optimization. Must only be called from `_readMessagesCached` so the
   * cache mutations here don't race a sibling read.
   */
  private async _readMessagesCachedWork(): Promise<MailboxMessage[]> {
    try {
      const st = await fsp.stat(this.messagePath);

      // Fast path: cache is current — no disk I/O beyond stat.
      if (
        this._messageCache !== null &&
        this._messageCacheMtime === st.mtimeMs &&
        this._messageCacheSize === st.size
      ) {
        return this._messageCache;
      }

      // Incremental path: cache exists and the file only grew (appends).
      // No ack/purge/clear rewrote the file, so we only need to parse
      // the newly-appended bytes.
      if (
        this._messageCache !== null &&
        this._messageCacheSize >= 0 &&
        st.size > this._messageCacheSize
      ) {
        const fd = await fsp.open(this.messagePath, 'r');
        try {
          const updated = await this._readNewMessagesOnly(fd, this._messageCacheSize, st.size);
          this._messageCacheMtime = st.mtimeMs;
          this._messageCacheSize = st.size;
          return updated;
        } finally {
          await fd.close();
        }
      }

      // Full re-read: cache empty, file was rewritten (ack/purge), or
      // this is the first read.
      const all = await this._readMessages();
      this._setMessageCache(all, st.mtimeMs, st.size);
      return all;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this._setMessageCache([], -1, -1);
        return [];
      }
      throw err;
    }
  }

  /**
   * Replace the in-memory cache, setting the mtime/size trackers
   * synchronously in the same step. Callers MUST pass the stat of the
   * on-disk file state that produced `messages`.
   *
   * Why both are required (not fire-and-forget): `_readMessagesCached()`
   * validates the cache against a fresh stat using these two trackers.
   * If the cache array is updated but the trackers lag behind (e.g. via
   * a deferred `stat().then(...)`), a concurrent reader landing in that
   * window sees a mismatched mtime and falls into the incremental
   * "file only grew" branch — parsing rewritten bytes as an appended
   * tail and corrupting the cache with duplicates/garbage. So both
   * values are captured under the file lock and applied synchronously
   * here, matching the fix already shipped in DefaultMailbox.
   */
  private _setMessageCache(messages: MailboxMessage[], mtime: number, size: number): void {
    // Bound the cache so a runaway mailbox can't balloon memory. The cap
    // is high enough that any realistic project mailbox fits; if it ever
    // exceeds the cap we just refuse to cache and the next read goes to
    // disk (the unoptimized but correct behavior).
    if (messages.length > MESSAGE_CACHE_MAX_ENTRIES) {
      this._messageCache = null;
      this._messageCacheMtime = -1;
      this._messageCacheSize = -1;
      this._recipientIndex = null;
      return;
    }
    this._messageCache = messages;
    this._messageCacheMtime = mtime;
    this._messageCacheSize = size;
    this._rebuildRecipientIndex();
  }

  /**
   * Build the recipient index from the current `_messageCache` contents.
   * Called only from `_setMessageCache` so the index is always in sync
   * with a freshly-replaced cache array.
   */
  private _rebuildRecipientIndex(): void {
    const cache = this._messageCache;
    if (cache === null) {
      this._recipientIndex = null;
      return;
    }
    const idx = new Map<string, Set<number>>();
    for (let i = 0; i < cache.length; i++) {
      const to = cache[i]!.to;
      let set = idx.get(to);
      if (set === undefined) { set = new Set(); idx.set(to, set); }
      set.add(i);
    }
    this._recipientIndex = idx;
  }

  /**
   * Append a single just-sent message to the in-memory cache without
   * re-reading the file. The caller must hold the file lock (or have
   * just released it after a successful append) and MUST pass the
   * post-append stat so the mtime/size trackers advance in lock-step
   * with the pushed content.
   *
   * Why the stat is required here: without it, `_messageCacheSize`
   * stays at the pre-append value. A concurrent `_readMessagesCached()`
   * then sees `st.size > _messageCacheSize` (the file did grow), takes
   * the incremental branch, and re-reads the just-appended tail —
   * pushing the same message onto the cache a second time. Setting the
   * trackers here closes that window for the local-process append path.
   */
  private _pushToCache(msg: MailboxMessage, mtime: number, size: number): void {
    if (this._messageCache === null) {
      // No cache to extend — leave trackers at -1 so the next read does
      // a full re-read and rebuilds the cache from disk.
      return;
    }
    if (this._messageCache.length >= MESSAGE_CACHE_MAX_ENTRIES) {
      this._messageCache = null;
      this._messageCacheMtime = -1;
      this._messageCacheSize = -1;
      return;
    }
    // The cache holds shared message objects; we mirror the on-disk line
    // by storing the same reference. Callers of `query()` get defensive
    // copies, so this shared reference is safe.
    this._messageCache.push(msg);
    // Update the recipient index with the new message's position.
    const newIdx = this._messageCache.length - 1;
    if (this._recipientIndex !== null) {
      let set = this._recipientIndex.get(msg.to);
      if (set === undefined) { set = new Set(); this._recipientIndex.set(msg.to, set); }
      set.add(newIdx);
    }
    // Advance the trackers synchronously with the content push so a
    // concurrent reader does not re-append this same message.
    this._messageCacheMtime = mtime;
    this._messageCacheSize = size;
  }

  private async _ensureRegistry(): Promise<void> {
    await fsp.mkdir(path.dirname(this.registryPath), { recursive: true });
  }

  private async _readRegistry(opts?: { fresh?: boolean }): Promise<Map<string, RegisteredAgent>> {
    // The registry file is shared across processes. Reads may use a short
    // TTL cache; writers (under the file lock) MUST pass { fresh: true } —
    // a read-modify-write from a stale cache would silently erase agents
    // registered by other sessions.
    if (
      !opts?.fresh &&
      this._registryCache &&
      Date.now() - this._registryCacheAt < REGISTRY_CACHE_TTL_MS
    ) {
      return new Map(this._registryCache);
    }

    try {
      const raw = await fsp.readFile(this.registryPath, 'utf8');
      const data = JSON.parse(raw) as Record<string, RegisteredAgent>;
      // Parse lastSeenAt strings back into objects
      const map = new Map<string, RegisteredAgent>();
      for (const [id, agent] of Object.entries(data)) {
        map.set(id, agent as RegisteredAgent);
      }
      this._registryCache = map;
      this._registryCacheAt = Date.now();
      return new Map(map);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const empty = new Map<string, RegisteredAgent>();
        this._registryCache = empty;
        this._registryCacheAt = Date.now();
        return empty;
      }
      throw err;
    }
  }

  private _pruneStaleInPlace(registry: Map<string, RegisteredAgent>): void {
    const staleCutoff = Date.now() - AGENT_STALE_MS;
    const purgeCutoff = Date.now() - AGENT_PURGE_MS;
    const toDelete: string[] = [];
    for (const [id, agent] of registry) {
      const lastSeen = new Date(agent.lastSeenAt).getTime();
      // Delete entries past the purge threshold entirely
      if (lastSeen < purgeCutoff) {
        toDelete.push(id);
        continue;
      }
      // Mark stale agents as idle. Online/offline is a derived view built in
      // getAgentStatuses() from lastSeenAt freshness — RegisteredAgent has no
      // `online` field, so we only normalize the persisted status here.
      if (lastSeen < staleCutoff) {
        agent.status = 'idle';
      }
    }
    for (const id of toDelete) {
      registry.delete(id);
    }
  }

  private async _writeRegistry(registry: Map<string, RegisteredAgent>): Promise<void> {
    const obj: Record<string, RegisteredAgent> = {};
    for (const [id, agent] of registry) {
      obj[id] = agent;
    }
    const tmp = `${this.registryPath}.${randomUUID().slice(0, 8)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
    await fsp.rename(tmp, this.registryPath);
  }

  // ── Client registry internals ───────────────────────────────────────────

  private async _ensureClientRegistry(): Promise<void> {
    await fsp.mkdir(path.dirname(this.clientRegistryPath), { recursive: true });
  }

  private async _readClientRegistry(opts?: {
    fresh?: boolean;
  }): Promise<Map<string, RegisteredClient>> {
    if (
      !opts?.fresh &&
      this._clientRegistryCache &&
      Date.now() - this._clientRegistryCacheAt < REGISTRY_CACHE_TTL_MS
    ) {
      return new Map(this._clientRegistryCache);
    }

    try {
      const raw = await fsp.readFile(this.clientRegistryPath, 'utf8');
      const data = JSON.parse(raw) as Record<string, RegisteredClient>;
      const map = new Map<string, RegisteredClient>();
      for (const [id, client] of Object.entries(data)) {
        map.set(id, client as RegisteredClient);
      }
      this._clientRegistryCache = map;
      this._clientRegistryCacheAt = Date.now();
      return new Map(map);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        const empty = new Map<string, RegisteredClient>();
        this._clientRegistryCache = empty;
        this._clientRegistryCacheAt = Date.now();
        return empty;
      }
      throw err;
    }
  }

  private _pruneStaleClientsInPlace(registry: Map<string, RegisteredClient>): void {
    // Remove clients whose heartbeat expired past the stale threshold.
    // This mirrors the agent registry's prune logic (delete past stale
    // threshold). The previous implementation OVERWROTE lastSeenAt with
    // the cutoff timestamp — destroying the real last-seen data and
    // causing clients to appear fresher than they were.
    const cutoff = Date.now() - CLIENT_STALE_MS;
    const toDelete: string[] = [];
    for (const [id, client] of registry) {
      if (new Date(client.lastSeenAt).getTime() < cutoff) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      registry.delete(id);
    }
  }

  private async _writeClientRegistry(registry: Map<string, RegisteredClient>): Promise<void> {
    const obj: Record<string, RegisteredClient> = {};
    for (const [id, client] of registry) {
      obj[id] = client;
    }
    const tmp = `${this.clientRegistryPath}.${randomUUID().slice(0, 8)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(obj), 'utf8');
    await fsp.rename(tmp, this.clientRegistryPath);
  }
}
