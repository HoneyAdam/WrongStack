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
import { send, sendResult, errMessage } from './ws-utils.js';

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

// ── Legacy handlers (existing) ───────────────────────────────────────

/**
 * List all memory entries across all scopes.
 * Responds with `{ type: 'memory.list', payload: { text } }`.
 */
export async function handleMemoryList(
  ws: WebSocket,
  memoryStore: MemoryStore,
): Promise<void> {
  try {
    const text = await memoryStore.readAll();
    send(ws, { type: 'memory.list', payload: { text } });
  } catch (err) {
    send(ws, {
      type: 'memory.list',
      payload: { text: '', error: errMessage(err) },
    });
  }
}

/**
 * Persist a new memory entry.
 * Responds with `{ type: 'key.operation_result', payload: { success, message } }`.
 */
export async function handleMemoryRemember(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  const { text, scope } = (
    msg as {
      payload: {
        text: string;
        scope?: 'project-agents' | 'project-memory' | 'user-memory' | undefined;
      };
    }
  ).payload;
  try {
    await memoryStore.remember(text, scope ?? 'project-memory');
    sendResult(ws, true, 'Saved to memory');
  } catch (err) {
    sendResult(ws, false, errMessage(err));
  }
}

/**
 * Remove memory entries matching the given text.
 * Responds with `{ type: 'key.operation_result', payload: { success, message } }`.
 */
export async function handleMemoryForget(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  const { text, scope } = (
    msg as {
      payload: {
        text: string;
        scope?: 'project-agents' | 'project-memory' | 'user-memory' | undefined;
      };
    }
  ).payload;
  try {
    const removed = await memoryStore.forget(text, scope ?? 'project-memory');
    sendResult(
      ws,
      removed > 0,
      removed > 0
        ? `Removed ${removed} entr${removed === 1 ? 'y' : 'ies'}`
        : 'No matching entries',
    );
  } catch (err) {
    sendResult(ws, false, errMessage(err));
  }
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
 * Delete a SuperMemory entry (soft-delete with cascade cleanup).
 * Request:  { type: 'memory.super.delete', payload: { id, reason? } }
 * Response: { type: 'key.operation_result', payload: { success, message } }
 */
export async function handleSuperMemoryDelete(
  ws: WebSocket,
  msg: unknown,
  memoryStore: MemoryStore,
): Promise<void> {
  if (!isSuperMemoryStore(memoryStore)) {
    sendResult(ws, false, requiresSuperMemory('memory.super.delete'));
    return;
  }
  const { id, reason } = (msg as { payload: { id: string; reason?: string | undefined } }).payload;
  if (!id) {
    sendResult(ws, false, 'id is required');
    return;
  }
  try {
    await memoryStore.deleteSuperMemory(id, reason);
    sendResult(ws, true, `Deleted memory "${id}".`);
  } catch (err) {
    sendResult(ws, false, errMessage(err));
  }
}
