/**
 * Mailbox WebSocket handlers (PR 8 of #30).
 *
 * Handles project-level inter-agent messaging for the WebUI:
 * - mailbox.messages — query mailbox messages
 * - mailbox.agents   — query online/stored agent statuses
 * - mailbox.clear    — clear all mailbox messages
 * - mailbox.purge    — purge stale messages by age
 */
import type { WebSocket } from 'ws';
import * as path from 'node:path';
import { GlobalMailbox, resolveProjectDir, type EventBus } from '@wrongstack/core';

export interface MailboxContext {
  /** Live agent reference for project-root access. */
  agent: { ctx: { projectRoot?: string; session?: { id: string } } };
  /** Resolved path to global config (used to derive the mailbox root). */
  globalConfigPath: string;
  /** Event bus for broadcasting mailbox events to all clients. */
  events: EventBus;
  send(ws: WebSocket, msg: Record<string, unknown>): void;
  broadcast(msg: Record<string, unknown>): void;
  log(msg: string): void;
}

/** Cached per-project mailbox instances so the registry/message caches are shared. */
const mailboxCache = new Map<string, GlobalMailbox>();

export function getMailbox(ctx: MailboxContext): GlobalMailbox | null {
  const projectRoot =
    ctx.agent.ctx.projectRoot ?? '';
  const globalRoot = ctx.globalConfigPath ? path.dirname(ctx.globalConfigPath) : '';
  if (!projectRoot || !globalRoot) return null;
  const mbDir = resolveProjectDir(projectRoot, globalRoot);
  let mailbox = mailboxCache.get(mbDir);
  if (!mailbox) {
    mailbox = new GlobalMailbox(mbDir, ctx.events);
    mailboxCache.set(mbDir, mailbox);
  }
  return mailbox;
}

// ── Handler functions ────────────────────────────────────────────────────────

export async function handleMailboxMessages(
  ctx: MailboxContext,
  msg: { payload?: { limit?: number; agentId?: string; unreadOnly?: boolean; incompleteOnly?: boolean } },
  ws: WebSocket,
): Promise<void> {
  const mb = getMailbox(ctx);
  if (!mb) {
    ctx.send(ws, {
      type: 'mailbox.messages',
      payload: { messages: [], error: 'No project root available' },
    });
    return;
  }
  try {
    const messages = await mb.query({
      limit: msg.payload?.limit ?? 30,
      to: msg.payload?.agentId,
      unreadBy: msg.payload?.unreadOnly ? msg.payload.agentId : undefined,
      incompleteOnly: msg.payload?.incompleteOnly,
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
  msg: { payload?: { onlineOnly?: boolean } },
  ws: WebSocket,
): Promise<void> {
  const mb = getMailbox(ctx);
  if (!mb) {
    ctx.send(ws, {
      type: 'mailbox.agents',
      payload: { agents: [], error: 'No project root available' },
    });
    return;
  }
  try {
    const agents = msg.payload?.onlineOnly
      ? await mb.getOnlineAgents()
      : await mb.getAgentStatuses();
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
  const mb = getMailbox(ctx);
  if (!mb) {
    ctx.send(ws, { type: 'mailbox.cleared', payload: { error: 'No project root available' } });
    return;
  }
  try {
    await mb.clearAll();
    ctx.send(ws, { type: 'mailbox.cleared', payload: {} });
  } catch (err) {
    ctx.send(ws, {
      type: 'mailbox.cleared',
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function handleMailboxPurge(
  ctx: MailboxContext,
  msg: { payload?: { completedMaxAgeMs?: number; incompleteMaxAgeMs?: number } },
  ws: WebSocket,
): Promise<void> {
  const mb = getMailbox(ctx);
  if (!mb) {
    ctx.send(ws, { type: 'mailbox.purged', payload: { error: 'No project root available' } });
    return;
  }
  try {
    const result = await mb.purgeStale(msg.payload);
    ctx.send(ws, { type: 'mailbox.purged', payload: result });
  } catch (err) {
    ctx.send(ws, {
      type: 'mailbox.purged',
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
