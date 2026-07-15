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
  supersedes?: string[] | undefined;
  contradicts?: string[] | undefined;
}

interface SuperMemoryStoreLike {
  stats(): Promise<SuperMemoryStatsLike>;
  listSuper(statuses?: string[]): Promise<SuperMemoryLike[]>;
  getSuperMemory(id: string): Promise<SuperMemoryLike | null>;
  updateSuperMemory(id: string, patch: UpdateSuperMemoryInput): Promise<SuperMemoryLike>;
  deleteSuperMemory(id: string, reason?: string): Promise<void>;
  rememberSuper(input: {
    text: string;
    kind?: string | undefined;
    scope?: string | undefined;
    tags?: string[] | undefined;
    anchors?: Array<{ type: string; path?: string; symbol?: string; command?: string }> | undefined;
    importance?: number | undefined;
    confidence?: number | undefined;
    freshness?: number | undefined;
    supersedes?: string[] | undefined;
    contradicts?: string[] | undefined;
  }): Promise<SuperMemoryLike>;
}

function isSuperMemoryStore(store: MemoryStore): store is MemoryStore & SuperMemoryStoreLike {
  const s = store as unknown as Record<string, unknown>;
  return (
    typeof s.stats === 'function' &&
    typeof s.listSuper === 'function' &&
    typeof s.getSuperMemory === 'function' &&
    typeof s.updateSuperMemory === 'function' &&
    typeof s.deleteSuperMemory === 'function'
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
  const { id, reason } = (msg as { payload: { id: string; reason?: string | undefined } }).payload;
  if (!id) {
    send(ws, { type: 'memory.super.delete', payload: { success: false, message: 'id is required' } });
    return;
  }
  try {
    await memoryStore.deleteSuperMemory(id, reason);
    send(ws, { type: 'memory.super.delete', payload: { success: true, message: `Deleted memory "${id}".` } });
  } catch (err) {
    send(ws, { type: 'memory.super.delete', payload: { success: false, message: errMessage(err) } });
  }
}
