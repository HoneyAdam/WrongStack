/**
 * Shared memory-operation WebSocket handlers for both the standalone WebUI
 * server and the CLI's `--webui` embedded server.
 *
 * Each function handles the full request→response cycle for one message
 * type. Callers drop them into their switch statement:
 *
 *   case 'memory.list': return handleMemoryList(ws, memoryStore);
 *
 * SuperMemory handlers use duck-typing to detect the store capability:
 *
 *   case 'memory.super.list': return handleSuperMemoryList(ws, memoryStore);
 */

import type { WebSocket } from 'ws';
import type { MemoryStore } from '@wrongstack/core';
import { send, errMessage } from './ws-utils.js';

// ── SuperMemory duck-type interface (local, mirrors @wrongstack/super-memory) ──

interface SuperMemoryLike {
  id: string;
  kind: string;
  status: string;
  text: string;
  tags: string[];
  anchors: Array<{ type: string; path?: string; symbol?: string; command?: string }>;
  audience?: { roles?: string[]; taskTypes?: string[]; modes?: string[] } | undefined;
  createdAt: string;
  updatedAt: string;
  importance: number;
  confidence: number;
  revision: number;
}

interface SuperMemoryStatsLike {
  total: number;
  byStatus: Record<string, number>;
  byKind: Partial<Record<string, number>>;
  edges: number;
}

interface UpdateSuperMemoryInput {
  text?: string | undefined;
  tags?: string[] | undefined;
  kind?: string | undefined;
  status?: string | undefined;
  importance?: number | undefined;
  confidence?: number | undefined;
  freshness?: number | undefined;
  anchors?: Array<{ type: string; path?: string; symbol?: string; command?: string }> | undefined;
  audience?: { roles?: string[]; taskTypes?: string[]; modes?: string[] } | undefined;
  supersedes?: string[] | undefined;
  contradicts?: string[] | undefined;
}

interface ListSuperPageResultLike {
  memories: SuperMemoryLike[];
  nextCursor: string | null;
  total: number;
  statusCounts: Record<string, number>;
}

interface SuperMemoryStoreLike {
  stats(): Promise<SuperMemoryStatsLike>;
  listSuper(statuses?: string[]): Promise<SuperMemoryLike[]>;
  listSuperPage?(options: {
    statuses?: string[] | undefined;
    kind?: string | undefined;
    query?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined;
  }): Promise<ListSuperPageResultLike>;
  getSuperMemory(id: string): Promise<SuperMemoryLike | null>;
  updateSuperMemory(id: string, patch: UpdateSuperMemoryInput): Promise<SuperMemoryLike>;
  deleteSuperMemory(id: string, reason?: string, options?: { neverInject?: boolean }): Promise<void>;
  rememberSuper(input: {
    text: string;
    kind?: string | undefined;
    scope?: string | undefined;
    tags?: string[] | undefined;
    anchors?: Array<{ type: string; path?: string; symbol?: string; command?: string }> | undefined;
    importance?: number | undefined;
    confidence?: number | undefined;
    freshness?: number | undefined;
    audience?: { roles?: string[]; taskTypes?: string[]; modes?: string[] } | undefined;
    supersedes?: string[] | undefined;
    contradicts?: string[] | undefined;
  }): Promise<SuperMemoryLike>;
  // PR #1: restore a `deleted` memory to active status (or return head-of-chain for superseded).
  recoverSuperMemory(id: string, reason?: string): Promise<SuperMemoryLike>;
  // PR #1: resolve a hygiene review candidate (accept|reject).
  acceptCandidate(candidateId: string): Promise<{ id: string; status: string } | undefined>;
  rejectCandidate(candidateId: string, reason: string): Promise<boolean>;
  // PR #3: scan `deleted` records + create fresh active versions (dryRun default).
  backfillRecoverable(opts: {
    apply?: boolean;
    filter?: {
      kinds?: string[];
      scopes?: string[];
      updatedAfter?: string;
      updatedBefore?: string;
    };
  }): Promise<{
    examined: number;
    recovered: number;
    recoverable: number;
  }>;
  // PR #4: rich file-drawer query — 3 buckets (primary/symbol/related).
  findMemoriesForFile(filePath: string, options?: {
    lineStart?: number;
    lineEnd?: number;
    limit?: number;
    includeDeleted?: boolean;
  }): Promise<Record<string, unknown>>;
}

function isSuperMemoryStore(store: MemoryStore): store is MemoryStore & SuperMemoryStoreLike {
  const s = store as unknown as Record<string, unknown>;
  return (
    typeof s.stats === 'function' &&
    typeof s.listSuper === 'function' &&
    typeof s.getSuperMemory === 'function' &&
    typeof s.updateSuperMemory === 'function' &&
    typeof s.deleteSuperMemory === 'function' &&
    typeof s.acceptCandidate === 'function' &&
    typeof s.rejectCandidate === 'function'
  );
}

function requiresSuperMemory(command: string): string {
  return `\`${command}\` requires the Super Memory backend (superMemory.enabled).`;
}

// ── Memory list (chat `/memory`) — renders the single Super Memory store ──

/**
 * List memory for the chat `/memory` command. When the backend is Super Memory
 * (always, in practice) this renders the rich structured view — the same one
 * surface as the MemoryManager panel and the CLI/TUI `/memory show`. Falls back
 * to `readAll()` text only for a non-super store.
 * Responds with `{ type: 'memory.list', payload: { text } }`.
 */
export async function handleMemoryList(
  ws: WebSocket,
  memoryStore: MemoryStore,
): Promise<void> {
  try {
    if (isSuperMemoryStore(memoryStore)) {
      const [stats, memories] = await Promise.all([
        memoryStore.stats(),
        memoryStore.listSuper(),
      ]);
      const text = memories.length === 0
        ? '🧠 Super Memory is empty.'
        : formatSuperMemoryText(stats, memories);
      send(ws, { type: 'memory.list', payload: { text } });
      return;
    }
    const text = await memoryStore.readAll();
    send(ws, { type: 'memory.list', payload: { text } });
  } catch (err) {
    send(ws, {
      type: 'memory.list',
      payload: { text: '', error: errMessage(err) },
    });
  }
}

/** Render the Super Memory list as markdown for the chat `/memory` view. */
function formatSuperMemoryText(stats: SuperMemoryStatsLike, memories: SuperMemoryLike[]): string {
  const active = stats.byStatus['active'] ?? 0;
  const stale = stats.byStatus['stale'] ?? 0;
  const archived = stats.byStatus['archived'] ?? 0;
  const lines: string[] = [
    '## 🧠 Super Memory',
    '',
    `**Total:** ${stats.total} · 🟢 ${active} active · 🟡 ${stale} stale · 🔵 ${archived} archived · **edges:** ${stats.edges}`,
    '',
  ];
  for (const m of memories) {
    const tags = m.tags.length > 0 ? ` \`${m.tags.slice(0, 3).join('` `')}\`` : '';
    const icon = m.status === 'active' ? '🟢' : m.status === 'stale' ? '🟡' : m.status === 'archived' ? '🔵' : '⚪';
    const preview = m.text.replace(/\s+/g, ' ').trim().slice(0, 140);
    lines.push(`- ${icon} \`${m.id.slice(0, 12)}…\` [${m.kind}] ${preview}${tags}`);
  }
  return lines.join('\n');
}

// ── SuperMemory handlers ─────────────────────────────────────────────

/**
 * List all SuperMemory entries with stats.
 * Request:  { type: 'memory.super.list' }
 * Response: { type: 'memory.super.list', payload: { memories, stats } }
 */
export async function handleSuperMemoryList(
  ws: WebSocket,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.list', payload: { error: requiresSuperMemory('memory.super.list') } });
    return;
  }
  try {
    const [stats, memories] = await Promise.all([
      memoryStore.stats(),
      memoryStore.listSuper(),
    ]);
    send(ws, { type: 'memory.super.list', payload: { memories, stats } });
  } catch (err) {
    send(ws, { type: 'memory.super.list', payload: { error: errMessage(err) } });
  }
}

/**
 * Paginated, status-filtered SuperMemory listing. Preferred over
 * `memory.super.list` for the MemoryManager: it returns a bounded page plus a
 * cursor so the WebUI never loads thousands of soft-deleted records at once.
 *
 * Request:  { type: 'memory.super.listPage', payload: { statuses?, kind?, query?, limit?, cursor? } }
 * Response: { type: 'memory.super.listPage', payload: { memories, nextCursor, total, statusCounts } }
 *
 * `statuses` defaults (backend-side) to every status EXCEPT `deleted`. Pass
 * `statuses: ['deleted']` for the WebUI "Deleted" tab. Falls back gracefully to
 * a full `listSuper()` for stores that predate `listSuperPage`.
 */
export async function handleSuperMemoryListPage(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.listPage', payload: { error: requiresSuperMemory('memory.super.listPage') } });
    return;
  }
  try {
    const payload = (msg as { payload?: Record<string, unknown> }).payload ?? {};
    const options = {
      statuses: Array.isArray(payload['statuses'])
        ? (payload['statuses'] as unknown[]).filter((s): s is string => typeof s === 'string')
        : undefined,
      kind: typeof payload['kind'] === 'string' ? (payload['kind'] as string) : undefined,
      query: typeof payload['query'] === 'string' ? (payload['query'] as string) : undefined,
      limit: typeof payload['limit'] === 'number' ? (payload['limit'] as number) : undefined,
      cursor: typeof payload['cursor'] === 'string' ? (payload['cursor'] as string) : undefined,
    };

    if (typeof memoryStore.listSuperPage === 'function') {
      const page = await memoryStore.listSuperPage(options);
      send(ws, { type: 'memory.super.listPage', payload: page });
      return;
    }

    // Backend without native pagination: emulate by loading + slicing in-memory.
    const allowed = options.statuses && options.statuses.length > 0
      ? new Set(options.statuses)
      : undefined; // undefined => every status; deleted filtered below
    const everything = await memoryStore.listSuper();
    const statusCounts: Record<string, number> = {};
    for (const m of everything) statusCounts[m.status] = (statusCounts[m.status] ?? 0) + 1;
    const kind = options.kind && options.kind !== 'all' ? options.kind : undefined;
    const q = options.query?.trim().toLowerCase();
    const filtered = everything.filter((m) => {
      if (allowed) return allowed.has(m.status);
      return m.status !== 'deleted';
    }).filter((m) => !kind || m.kind === kind)
      .filter((m) => !q || m.text.toLowerCase().includes(q));
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 50)));
    send(ws, {
      type: 'memory.super.listPage',
      payload: { memories: filtered.slice(0, limit), nextCursor: null, total: filtered.length, statusCounts },
    });
  } catch (err) {
    send(ws, { type: 'memory.super.listPage', payload: { error: errMessage(err) } });
  }
}

/**
 * Get a single SuperMemory entry by ID.
 * Request:  { type: 'memory.super.get', payload: { id } }
 * Response: { type: 'memory.super.get', payload: { memory } }
 */
export async function handleSuperMemoryGet(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.get', payload: { error: requiresSuperMemory('memory.super.get') } });
    return;
  }
  const { id } = (msg as { payload: { id: string } }).payload;
  if (!id) {
    send(ws, { type: 'memory.super.get', payload: { error: 'id is required' } });
    return;
  }
  try {
    const memory = await memoryStore.getSuperMemory(id);
    if (!memory) {
      send(ws, { type: 'memory.super.get', payload: { error: `Memory "${id}" not found.` } });
      return;
    }
    send(ws, { type: 'memory.super.get', payload: { memory } });
  } catch (err) {
    send(ws, { type: 'memory.super.get', payload: { error: errMessage(err) } });
  }
}

/**
 * Update a SuperMemory entry.
 * Request:  { type: 'memory.super.update', payload: { id, ...patch } }
 * Response: { type: 'memory.super.update', payload: { memory } }
 * On error: { type: 'memory.super.update', payload: { error } }
 */
export async function handleSuperMemoryUpdate(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.update', payload: { error: requiresSuperMemory('memory.super.update') } });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload;
  const id = payload['id'] as string | undefined;
  if (!id) {
    send(ws, { type: 'memory.super.update', payload: { error: 'id is required' } });
    return;
  }

  // Extract patch fields (everything except id)
  const patch: Record<string, unknown> = { ...payload };
  delete patch['id'];

  if (Object.keys(patch).length === 0) {
    send(ws, { type: 'memory.super.update', payload: { error: 'No fields to update.' } });
    return;
  }

  try {
    const memory = await memoryStore.updateSuperMemory(id, patch as UpdateSuperMemoryInput);
    send(ws, { type: 'memory.super.update', payload: { memory } });
  } catch (err) {
    send(ws, { type: 'memory.super.update', payload: { error: errMessage(err) } });
  }
}

/**
 * Create a new SuperMemory entry with full metadata.
 * Request:  { type: 'memory.super.remember', payload: { text, kind?, scope?, tags?, anchors?, importance?, confidence?, freshness?, supersedes?, contradicts? } }
 * Response: { type: 'memory.super.remember', payload: { memory } }
 * On error: { type: 'memory.super.remember', payload: { error } }
 */
export async function handleSuperMemoryRemember(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.remember', payload: { error: requiresSuperMemory('memory.super.remember') } });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload;
  const text = payload['text'] as string | undefined;
  if (!text || !text.trim()) {
    send(ws, { type: 'memory.super.remember', payload: { error: 'text is required' } });
    return;
  }
  try {
    const memory = await memoryStore.rememberSuper({
      text: text.trim(),
      kind: payload['kind'] as string | undefined,
      scope: payload['scope'] as string | undefined,
      tags: payload['tags'] as string[] | undefined,
      anchors: payload['anchors'] as Array<{ type: string; path?: string; symbol?: string; command?: string }> | undefined,
      importance: payload['importance'] as number | undefined,
      confidence: payload['confidence'] as number | undefined,
      freshness: payload['freshness'] as number | undefined,
      audience: payload['audience'] as { roles?: string[]; taskTypes?: string[]; modes?: string[] } | undefined,
      supersedes: payload['supersedes'] as string[] | undefined,
      contradicts: payload['contradicts'] as string[] | undefined,
    });
    send(ws, { type: 'memory.super.remember', payload: { memory } });
  } catch (err) {
    send(ws, { type: 'memory.super.remember', payload: { error: errMessage(err) } });
  }
}

/**
 * Delete a SuperMemory entry (soft-delete with cascade cleanup).
 * Request:  { type: 'memory.super.delete', payload: { id, reason? } }
 * Response: { type: 'memory.super.delete', payload: { success, message } }
 *
 * Uses an operation-specific response type (not the generic
 * `key.operation_result`) so the client can correlate the response
 * to this specific action without matching unrelated broadcast events.
 */
export async function handleSuperMemoryDelete(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.delete', payload: { success: false, message: requiresSuperMemory('memory.super.delete') } });
    return;
  }
  const { id, reason, neverInject } = (msg as { payload: { id: string; reason?: string | undefined; neverInject?: boolean | undefined } }).payload;
  if (!id) {
    send(ws, { type: 'memory.super.delete', payload: { success: false, message: 'id is required' } });
    return;
  }
  try {
    if (neverInject === true) await memoryStore.deleteSuperMemory(id, reason, { neverInject: true });
    else await memoryStore.deleteSuperMemory(id, reason);
    send(ws, { type: 'memory.super.delete', payload: { success: true, message: `Deleted memory "${id}".` } });
  } catch (err) {
    send(ws, { type: 'memory.super.delete', payload: { success: false, message: errMessage(err) } });
  }
}

/**
 * Restore a deleted Super Memory entry to active status (PR #1).
 * Request:  { type: 'memory.super.recover', payload: { id, reason? } }
 * Response: { type: 'memory.super.recover', payload: { memory?, noop?, activeId? } }
 *
 * - `noop: true` when the id was already active (no write happened)
 * - `activeId: <id>` when the id was superseded — returns the head of the chain
 * - otherwise returns the freshly-restored memory
 */
export async function handleSuperMemoryRecover(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, { type: 'memory.super.recover', payload: { error: requiresSuperMemory('memory.super.recover') } });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload;
  const id = payload['id'] as string | undefined;
  if (!id) {
    send(ws, { type: 'memory.super.recover', payload: { error: 'id is required' } });
    return;
  }
  const reason = payload['reason'] as string | undefined;
  try {
    const preExisting = await memoryStore.getSuperMemory(id);
    if (!preExisting) {
      send(ws, { type: 'memory.super.recover', payload: { error: `Super Memory "${id}" not found.` } });
      return;
    }
    // Already active: no-op — return the existing record without calling recover.
    if (preExisting.status === 'active') {
      send(ws, { type: 'memory.super.recover', payload: { recovered: true, memory: preExisting, noop: true } });
      return;
    }
    // Deleted or superseded: call recover to get the actual result.
    const memory = await memoryStore.recoverSuperMemory(id, reason);
    // Superseded: the store returns the chain head (different id).
    const noop = memory.id !== id;
    const response: Record<string, unknown> = { recovered: true, memory };
    if (noop) {
      response['activeId'] = memory.id;
      response['noop'] = true;
    }
    send(ws, { type: 'memory.super.recover', payload: response });
  } catch (err) {
    send(ws, { type: 'memory.super.recover', payload: { error: errMessage(err) } });
  }
}

/**
 * Resolve a pending hygiene review candidate (PR #1).
 * Request:  { type: 'memory.super.candidateResolve', payload: { candidateId, action: 'accept'|'reject', reason? } }
 * Response: { type: 'memory.super.candidateResolve', payload: { candidate, resolvedAction } }
 *
 * The store handles audit + status mutation; the handler just relays the
 * payload. If the candidate id is unknown, the store returns null and we
 * surface a structured error.
 */
export async function handleSuperMemoryCandidateResolve(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, {
      type: 'memory.super.candidateResolve',
      payload: { error: requiresSuperMemory('memory.super.candidateResolve') },
    });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload;
  const candidateId = payload['candidateId'] as string | undefined;
  const action = payload['action'] as 'accept' | 'reject' | undefined;
  if (!candidateId) {
    send(ws, {
      type: 'memory.super.candidateResolve',
      payload: { error: 'candidateId is required' },
    });
    return;
  }
  if (action !== 'accept' && action !== 'reject') {
    send(ws, {
      type: 'memory.super.candidateResolve',
      payload: { error: 'action must be "accept" or "reject"' },
    });
    return;
  }
  const reason = payload['reason'] as string | undefined;
  try {
    let candidate: { id: string; status: string } | undefined;
    if (action === 'accept') {
      const accepted = await memoryStore.acceptCandidate(candidateId);
      candidate = accepted ? { id: accepted.id, status: accepted.status ?? 'active' } : undefined;
    } else {
      const rejected = await memoryStore.rejectCandidate(
        candidateId,
        reason ?? 'Rejected via WebUI',
      );
      candidate = rejected ? { id: candidateId, status: 'rejected' } : undefined;
    }
    if (!candidate) {
      send(ws, {
        type: 'memory.super.candidateResolve',
        payload: { error: `Candidate "${candidateId}" not found` },
      });
      return;
    }
    send(ws, {
      type: 'memory.super.candidateResolve',
      payload: { candidate, resolvedAction: action },
    });
  } catch (err) {
    send(ws, {
      type: 'memory.super.candidateResolve',
      payload: { error: errMessage(err) },
    });
  }
}

/**
 * Scan deleted records and either preview (dry-run) or apply a backfill
 * that creates fresh active versions for recoverable entries (PR #3).
 *
 * Request:  { type: 'memory.super.backfillRecoverable', payload: { apply, filter? } }
 * Response: { type: 'memory.super.backfillRecoverable', payload: { examined, recovered, recoverable, dryRun } }
 *
 * `apply` defaults to false (dry-run preview). When true, the store writes
 * new active versions and links them to the original `deleted` records via
 * `supersedes`. The report count fields are forwarded for dashboard / UI use.
 */
export async function handleSuperMemoryBackfillRecoverable(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, {
      type: 'memory.super.backfillRecoverable',
      payload: { error: requiresSuperMemory('memory.super.backfillRecoverable') },
    });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload ?? {};
  const apply = payload['apply'] === true;
  // Filter passthrough is permissive: the store validates per-field. We
  // only pass fields that are present so absent fields stay absent (the
  // store defaults its own omission to "no filter").
  const rawFilter = (payload['filter'] ?? {}) as Record<string, unknown>;
  const filter: {
    kinds?: string[];
    scopes?: string[];
    updatedAfter?: string;
    updatedBefore?: string;
  } = {};
  if (Array.isArray(rawFilter['kinds'])) filter.kinds = rawFilter['kinds'] as string[];
  if (Array.isArray(rawFilter['scopes'])) filter.scopes = rawFilter['scopes'] as string[];
  if (typeof rawFilter['updatedAfter'] === 'string') filter.updatedAfter = rawFilter['updatedAfter'];
  if (typeof rawFilter['updatedBefore'] === 'string') filter.updatedBefore = rawFilter['updatedBefore'];
  try {
    const report = await memoryStore.backfillRecoverable({
      apply,
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
    send(ws, {
      type: 'memory.super.backfillRecoverable',
      payload: {
        examined: report.examined,
        recovered: report.recovered,
        recoverable: report.recoverable,
        dryRun: !apply,
      },
    });
  } catch (err) {
    send(ws, {
      type: 'memory.super.backfillRecoverable',
      payload: { error: errMessage(err) },
    });
  }
}

/**
 * Rich file-drawer query — returns 3 buckets (primary/symbol/related)
 * with matchedVia, matchStrength, supersededByActiveId, pendingReview (PR #4).
 */
export async function handleSuperMemoryForFile(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    send(ws, {
      type: 'memory.super.forFile',
      payload: { error: requiresSuperMemory('memory.super.forFile') },
    });
    return;
  }
  const payload = (msg as { payload: Record<string, unknown> }).payload ?? {};
  const filePath = payload['filePath'] as string | undefined;
  if (!filePath) {
    send(ws, { type: 'memory.super.forFile', payload: { error: 'filePath is required' } });
    return;
  }
  try {
    const response = await memoryStore.findMemoriesForFile(filePath, {
      ...(typeof payload['lineStart'] === 'number' ? { lineStart: payload['lineStart'] as number } : {}),
      ...(typeof payload['lineEnd'] === 'number' ? { lineEnd: payload['lineEnd'] as number } : {}),
      ...(typeof payload['limit'] === 'number' ? { limit: payload['limit'] as number } : {}),
      ...(payload['includeDeleted'] === true ? { includeDeleted: true } : {}),
    });
    send(ws, { type: 'memory.super.forFile', payload: response });
  } catch (err) {
    send(ws, { type: 'memory.super.forFile', payload: { error: errMessage(err) } });
  }
}
