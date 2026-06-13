import type { Context } from '@wrongstack/core';
import {
  DEFAULT_CONTEXT_WINDOW_MODE_ID,
  repairToolUseAdjacency,
  resolveContextWindowPolicy,
} from '@wrongstack/core';
import type { CustomModeStore } from '@wrongstack/webui/server';
import type { WebSocket } from 'ws';
import {
  estimateContextBreakdown,
  type MessageLike,
  type PromptBlock,
  type ToolLike,
} from '../context-breakdown.js';
import type { WsCommon } from './index.js';

/**
 * PR 5n of Issue #30: context ws-handlers.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * These manage the agent's context window: in-memory clear, per-section
 * token breakdown, compaction, orphan-block repair, and the custom
 * context-mode CRUD.
 *
 * The host-owned seams (compactor resolution from the agent container,
 * the lazily-created custom-mode store, and the session.start payload
 * builder) are passed as callbacks so the handlers carry no hidden
 * captures and stay unit-testable.
 */

/** Minimal compactor surface used by context.compact. */
export interface CompactorLike {
  compact: (
    ctx: Context,
    opts: { aggressive: boolean },
  ) => Promise<{ reductions?: unknown[]; repaired?: boolean }>;
}

export interface ContextOpsContext extends WsCommon {
  /** Live agent context. */
  agentCtx: Context;
  /** Current tool list (for the debug token breakdown). */
  listTools: () => unknown[];
  /** Resolve the compactor from the agent container (TOKENS.Compactor), or undefined. */
  resolveCompactor: () => CompactorLike | undefined;
  /** Lazily-built custom context-mode store (file-backed). */
  getModeStore: () => Promise<CustomModeStore>;
  /** Build a session.start payload for the reset broadcast. */
  buildSessionStart: (overrides: { reset?: boolean }) => Promise<unknown>;
}

/** Send a success/failure result message (mirrors the host `sendResult`). */
function sendResult(ctx: WsCommon, ws: WebSocket, success: boolean, message: string): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

export async function handleContextClear(ctx: ContextOpsContext, ws: WebSocket): Promise<void> {
  // In-memory wipe — same as session.new but reuses the current session.
  const agentCtx = ctx.agentCtx;
  agentCtx.state.replaceMessages([]);
  agentCtx.state.replaceTodos([]);
  agentCtx.readFiles.clear();
  agentCtx.fileMtimes.clear();
  sendResult(ctx, ws, true, 'Context cleared');
  const ctxClearP = await ctx.buildSessionStart({ reset: true });
  ctx.broadcast({ type: 'session.start', payload: ctxClearP });
}

export function handleContextDebug(ctx: ContextOpsContext, ws: WebSocket): void {
  // Per-section token estimate so users can see what's eating the window.
  const agentCtx = ctx.agentCtx;
  const breakdown = estimateContextBreakdown({
    systemPrompt: agentCtx.systemPrompt as ReadonlyArray<PromptBlock>,
    tools: ctx.listTools() as ReadonlyArray<ToolLike>,
    messages: agentCtx.messages as ReadonlyArray<MessageLike>,
  });
  ctx.send(ws, {
    type: 'context.debug',
    payload: {
      ...breakdown,
      mode: (agentCtx.meta['contextWindowMode'] as string) ?? DEFAULT_CONTEXT_WINDOW_MODE_ID,
      policy: agentCtx.meta['contextWindowPolicy'] ?? null,
    },
  });
}

export async function handleContextCompact(
  ctx: ContextOpsContext,
  ws: WebSocket,
  aggressive: boolean,
): Promise<void> {
  try {
    const compactor = ctx.resolveCompactor();
    if (!compactor) {
      sendResult(ctx, ws, false, 'Compactor not available');
      return;
    }
    const agentCtx = ctx.agentCtx;
    const before = agentCtx.tokenCounter.total();
    const report = await compactor.compact(agentCtx, { aggressive });
    const after = agentCtx.tokenCounter.total();
    ctx.send(ws, {
      type: 'context.compacted',
      payload: {
        before: before.input + before.output,
        after: after.input + after.output,
        saved: Math.max(0, before.input + before.output - after.input - after.output),
        reductions: report.reductions ?? [],
        repaired: report.repaired ?? false,
      },
    });
    sendResult(
      ctx,
      ws,
      true,
      `Compacted: ${before.input + before.output} → ${after.input + after.output} tokens`,
    );
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}

export function handleContextRepair(ctx: ContextOpsContext, ws: WebSocket): void {
  const agentCtx = ctx.agentCtx;
  const beforeMessages = agentCtx.messages.length;
  const repaired = repairToolUseAdjacency(agentCtx.messages);
  if (repaired.report.changed) {
    agentCtx.state.replaceMessages(repaired.messages);
  }
  const payload = {
    removedToolUses: repaired.report.removedToolUses,
    removedToolResults: repaired.report.removedToolResults,
    removedMessages: repaired.report.removedMessages,
    beforeMessages,
    afterMessages: agentCtx.messages.length,
  };
  ctx.broadcast({ type: 'context.repaired', payload });
  const removed =
    payload.removedToolUses.length + payload.removedToolResults.length + payload.removedMessages;
  sendResult(
    ctx,
    ws,
    true,
    removed > 0
      ? `Context repaired: removed ${removed} orphan protocol item(s)`
      : 'Context repair found no orphan protocol blocks',
  );
}

export async function handleContextModesList(ctx: ContextOpsContext, ws: WebSocket): Promise<void> {
  // Built-ins + file-backed custom modes (store.list() merges both).
  const active = String(ctx.agentCtx.meta['contextWindowMode'] ?? DEFAULT_CONTEXT_WINDOW_MODE_ID);
  const modeStore = await ctx.getModeStore();
  ctx.send(ws, {
    type: 'context.modes.list',
    payload: {
      activeId: active,
      modes: modeStore.list().map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        isActive: m.id === active,
        thresholds: m.thresholds,
        preserveK: m.preserveK,
        eliseThreshold: m.eliseThreshold,
        custom: m.custom === true,
      })),
    },
  });
}

export async function handleContextModeSwitch(
  ctx: ContextOpsContext,
  ws: WebSocket,
  id: string,
): Promise<void> {
  // Built-in first, then custom.
  let policy = resolveContextWindowPolicy({}, id);
  if (policy.id !== id) {
    const modeStore = await ctx.getModeStore();
    const custom = modeStore.list().find((m) => m.custom === true && m.id === id);
    if (!custom) {
      sendResult(ctx, ws, false, `Unknown context mode "${id}"`);
      return;
    }
    policy = custom as unknown as typeof policy;
  }
  ctx.agentCtx.meta['contextWindowMode'] = policy.id;
  ctx.agentCtx.meta['contextWindowPolicy'] = policy;
  sendResult(ctx, ws, true, `Context mode switched to ${policy.id}`);
  ctx.broadcast({
    type: 'context.mode.changed',
    payload: { id: policy.id, name: policy.name, policy },
  });
}

export async function handleContextModeCreate(
  ctx: ContextOpsContext,
  ws: WebSocket,
  payload: {
    id: string;
    name: string;
    description: string;
    thresholds: { warn: number; soft: number; hard: number };
    preserveK: number;
    eliseThreshold: number;
  },
): Promise<void> {
  const modeStore = await ctx.getModeStore();
  const result = modeStore.create({
    id: payload.id,
    name: payload.name,
    description: payload.description,
    thresholds: payload.thresholds,
    preserveK: payload.preserveK,
    eliseThreshold: payload.eliseThreshold,
    custom: true,
    aggressiveOn: 'soft',
    targetLoad: 0.65,
  });
  if (result.ok) await modeStore.save().catch(() => undefined); /* best-effort: user preferences */
  sendResult(ctx, ws, result.ok, result.error ?? `Mode "${payload.id}" created`);
}

export async function handleContextModeUpdate(
  ctx: ContextOpsContext,
  ws: WebSocket,
  payload: {
    id: string;
    name?: string | undefined;
    description?: string | undefined;
    thresholds?:
      | { warn?: number | undefined; soft?: number | undefined; hard?: number | undefined }
      | undefined;
    preserveK?: number | undefined;
    eliseThreshold?: number | undefined;
  },
): Promise<void> {
  const modeStore = await ctx.getModeStore();
  // Build the patch without explicit-undefined keys (exactOptionalPropertyTypes).
  const result = modeStore.update(payload.id, {
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.thresholds
      ? {
          thresholds: {
            warn: payload.thresholds.warn ?? 0.6,
            soft: payload.thresholds.soft ?? 0.75,
            hard: payload.thresholds.hard ?? 0.9,
          },
        }
      : {}),
    ...(payload.preserveK !== undefined ? { preserveK: payload.preserveK } : {}),
    ...(payload.eliseThreshold !== undefined ? { eliseThreshold: payload.eliseThreshold } : {}),
  });
  if (result.ok) await modeStore.save().catch(() => undefined); /* best-effort: user preferences */
  sendResult(ctx, ws, result.ok, result.error ?? `Mode "${payload.id}" updated`);
}

export async function handleContextModeDelete(
  ctx: ContextOpsContext,
  ws: WebSocket,
  id: string,
): Promise<void> {
  const agentCtx = ctx.agentCtx;
  // If the active mode is being deleted, fall back to the default.
  if (String(agentCtx.meta['contextWindowMode'] ?? '') === id) {
    agentCtx.meta['contextWindowMode'] = DEFAULT_CONTEXT_WINDOW_MODE_ID;
    agentCtx.meta['contextWindowPolicy'] = resolveContextWindowPolicy(
      {},
      DEFAULT_CONTEXT_WINDOW_MODE_ID,
    );
  }
  const modeStore = await ctx.getModeStore();
  const result = modeStore.remove(id);
  if (result.ok) await modeStore.save().catch(() => undefined); /* best-effort: user preferences */
  sendResult(ctx, ws, result.ok, result.error ?? `Mode "${id}" deleted`);
}
