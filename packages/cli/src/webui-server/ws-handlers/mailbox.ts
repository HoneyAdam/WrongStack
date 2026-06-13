import { GlobalMailbox, resolveProjectDir } from '@wrongstack/core';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5k of Issue #30: mailbox ws-handlers.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * These back the project-level inter-agent messaging panel (messages
 * list, agent presence, clear). The per-project mailbox directory is
 * resolved via `resolveProjectDir(projectRoot, globalRoot)` — the single
 * source of truth that the inline slug this replaced used to drift from.
 *
 * `projectRoot` / `globalRoot` are passed as plain fields built inline in
 * the switch (like `goal.get`) so a project switch re-roots them at call
 * time rather than capturing a stale root.
 */

export interface MailboxContext extends WsCommon {
  /** Current project root (`opts.projectRoot ?? agentCtx.projectRoot`). */
  projectRoot: string;
  /** Global config root (`dirname(globalConfigPath)`), empty if unavailable. */
  globalRoot: string;
}

/** True iff both roots are present; otherwise emits the standard error reply. */
function rootsMissing(
  ctx: MailboxContext,
  ws: WebSocket,
  errorType: string,
  emptyPayload: Record<string, unknown>,
): boolean {
  if (ctx.projectRoot && ctx.globalRoot) return false;
  ctx.send(ws, {
    type: errorType,
    payload: { ...emptyPayload, error: 'No project root available' },
  });
  return true;
}

export async function handleMailboxMessages(
  ctx: MailboxContext,
  ws: WebSocket,
  payload: { limit?: number; agentId?: string; unreadOnly?: boolean } | undefined,
): Promise<void> {
  if (rootsMissing(ctx, ws, 'mailbox.messages', { messages: [] })) return;
  try {
    const mbDir = resolveProjectDir(ctx.projectRoot, ctx.globalRoot);
    const mb = new GlobalMailbox(mbDir);
    const messages = await mb.query({
      limit: payload?.limit ?? 30,
      to: payload?.agentId,
      unreadBy: payload?.unreadOnly ? payload.agentId : undefined,
    });
    ctx.send(ws, {
      type: 'mailbox.messages',
      payload: {
        messages: messages.map((m) => ({
          id: m.id,
          from: m.from,
          to: m.to,
          type: m.type,
          subject: m.subject,
          body: m.body,
          priority: m.priority,
          readBy: m.readBy,
          readByCount: Object.keys(m.readBy).length,
          completed: m.completed,
          completedBy: m.completedBy,
          outcome: m.outcome,
          timestamp: m.timestamp,
          replyTo: m.replyTo,
          senderSessionId: m.senderSessionId,
        })),
      },
    });
  } catch (err) {
    ctx.send(ws, {
      type: 'mailbox.messages',
      payload: { messages: [], error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function handleMailboxAgents(
  ctx: MailboxContext,
  ws: WebSocket,
  payload: { onlineOnly?: boolean } | undefined,
): Promise<void> {
  if (rootsMissing(ctx, ws, 'mailbox.agents', { agents: [] })) return;
  try {
    const mbDir = resolveProjectDir(ctx.projectRoot, ctx.globalRoot);
    const mb = new GlobalMailbox(mbDir);
    const agents = payload?.onlineOnly ? await mb.getOnlineAgents() : await mb.getAgentStatuses();
    ctx.send(ws, {
      type: 'mailbox.agents',
      payload: {
        agents: agents.map((a) => ({
          agentId: a.agentId,
          name: a.name,
          role: a.role,
          sessionId: a.sessionId,
          status: a.status,
          currentTool: a.currentTool,
          currentTask: a.currentTask,
          iterations: a.iterations,
          toolCalls: a.toolCalls,
          lastSeenAt: a.lastSeenAt,
          online: a.online,
          pid: a.pid,
          source: a.source,
        })),
      },
    });
  } catch (err) {
    ctx.send(ws, {
      type: 'mailbox.agents',
      payload: { agents: [], error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function handleMailboxClear(ctx: MailboxContext, ws: WebSocket): Promise<void> {
  if (rootsMissing(ctx, ws, 'mailbox.cleared', {})) return;
  try {
    const mbDir = resolveProjectDir(ctx.projectRoot, ctx.globalRoot);
    const mb = new GlobalMailbox(mbDir);
    await mb.clearAll();
    ctx.send(ws, { type: 'mailbox.cleared', payload: {} });
  } catch (err) {
    ctx.send(ws, {
      type: 'mailbox.cleared',
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
