import * as path from 'node:path';
import type { Context, SessionStore, SessionWriter } from '@wrongstack/core';
import { DefaultSessionStore } from '@wrongstack/core/storage';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5m of Issue #30: session ws-handlers.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * These manage the on-disk session lifecycle: list, new, delete, save,
 * resume, and checkpoint listing / rewind.
 *
 * The handlers must read the host's mutable session state at call time
 * (a project switch reassigns `opts.sessionStore` and re-roots
 * `agentCtx`), so the host builds a fresh `SessionContext` per call via a
 * small factory rather than capturing a stale store.
 */

export interface SessionContext extends WsCommon {
  /** Wired session store (real ~/.wrongstack/projects/<hash>/sessions location); may be absent. */
  sessionStore: SessionStore | undefined;
  /** Live agent context — its `session` writer is swapped on new/resume. */
  agentCtx: Context;
  /** Startup session writer — id fallback, and the rewind fallback target. */
  startupSession: SessionWriter;
  /** Current project root (`opts.projectRoot ?? agentCtx.projectRoot`). */
  projectRoot: string;
  /** Explicit sessions dir override (rewinder root); falls back to `<projectRoot>/.wrongstack/sessions`. */
  sessionsDir: string | undefined;
  /** Let the host re-point crash-recovery state at the swapped writer. */
  onSessionSwapped?: ((id: string) => void) | undefined;
  /** Build a session.start payload for broadcasts. */
  buildSessionStart: (overrides: {
    reset?: boolean;
    clearedSessionId?: string;
    replayMessages?: unknown[];
    replayUsage?: unknown;
  }) => Promise<unknown>;
}

/** Send a success/failure result message (mirrors the host `sendResult`). */
function sendResult(ctx: WsCommon, ws: WebSocket, success: boolean, message: string): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

/** The wired store, or a legacy transient `<projectRoot>/.wrongstack/sessions` fallback. */
function storeFor(ctx: SessionContext): SessionStore {
  return (
    ctx.sessionStore ??
    new DefaultSessionStore({
      dir: path.join(ctx.projectRoot, '.wrongstack', 'sessions'),
    })
  );
}

/** The current live session id (live writer after an in-app resume, else startup). */
function liveSessionId(ctx: SessionContext): string {
  return ctx.agentCtx.session?.id ?? ctx.startupSession.id;
}

export async function handleSessionsList(
  ctx: SessionContext,
  ws: WebSocket,
  limit: number,
): Promise<void> {
  try {
    const list = await storeFor(ctx).list(limit);
    const currentId = liveSessionId(ctx);
    ctx.send(ws, {
      type: 'sessions.list',
      payload: {
        sessions: list.map((s) => ({
          id: s.id,
          title: s.title,
          startedAt: s.startedAt,
          model: s.model,
          provider: s.provider,
          tokenTotal: s.tokenTotal,
          isCurrent: s.id === currentId,
        })),
      },
    });
  } catch (err) {
    ctx.send(ws, {
      type: 'sessions.list',
      payload: { sessions: [], error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function handleSessionNew(ctx: SessionContext, _ws: WebSocket): Promise<void> {
  // Full new session when the SessionStore is wired (the normal case):
  // finalize the current writer (session_end + close → summary sidecar)
  // and swap in a fresh on-disk session.
  const agentCtx = ctx.agentCtx;
  const oldId = agentCtx.session?.id ?? ctx.startupSession.id;
  if (ctx.sessionStore) {
    try {
      const oldWriter = agentCtx.session;
      const oldUsage = agentCtx.tokenCounter.total();
      if (oldWriter) {
        void (async () => {
          await oldWriter
            .append({ type: 'session_end', ts: new Date().toISOString(), usage: oldUsage })
            .catch(() => undefined);
          await oldWriter.close().catch(() => undefined);
        })();
      }
      const fresh = await ctx.sessionStore.create({
        id: '',
        title: '',
        model: agentCtx.model,
        provider: (agentCtx.provider as { id?: string }).id ?? '',
      });
      agentCtx.session = fresh;
      ctx.onSessionSwapped?.(fresh.id);
      agentCtx.tokenCounter.reset();
    } catch (err) {
      // Store failure degrades to the in-memory reset below.
      ctx.log(
        JSON.stringify({
          level: 'warn',
          event: 'webui.session_new_store_failed',
          message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }
  agentCtx.state.replaceMessages([]);
  agentCtx.state.replaceTodos([]);
  agentCtx.readFiles.clear();
  agentCtx.fileMtimes.clear();
  const sessNewP = await ctx.buildSessionStart({ reset: true, clearedSessionId: oldId });
  ctx.broadcast({ type: 'session.start', payload: sessNewP });
}

export async function handleSessionDelete(
  ctx: SessionContext,
  ws: WebSocket,
  id: string,
): Promise<void> {
  // Guard against the CURRENT writer — after an in-app resume the active
  // session is agentCtx.session, not the startup one.
  if (id === liveSessionId(ctx)) {
    sendResult(ctx, ws, false, 'Cannot delete the active session');
    return;
  }
  try {
    await storeFor(ctx).delete(id);
    sendResult(ctx, ws, true, `Session ${id} deleted`);
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}

export function handleSessionSave(ctx: SessionContext, ws: WebSocket): void {
  // SessionWriter auto-flushes — confirm for UI habit parity.
  sendResult(ctx, ws, true, `Session ${ctx.startupSession.id} is auto-saved`);
}

export async function handleSessionResume(
  ctx: SessionContext,
  ws: WebSocket,
  id: string,
): Promise<void> {
  if (!ctx.sessionStore) {
    sendResult(ctx, ws, false, 'Session store not available');
    return;
  }
  try {
    const agentCtx = ctx.agentCtx;
    // Compare against the CURRENT writer — after a prior in-app resume the
    // active session is agentCtx.session, not the startup one.
    if (id === liveSessionId(ctx)) {
      sendResult(ctx, ws, false, 'Session is already active');
      return;
    }
    const resumed = await ctx.sessionStore.resume(id);
    // Finalize the writer we are leaving, then swap the context to the
    // resumed writer so all new events land in the resumed session's JSONL.
    const oldWriter = agentCtx.session;
    if (oldWriter && oldWriter !== resumed.writer) {
      const oldUsage = agentCtx.tokenCounter.total();
      void (async () => {
        await oldWriter
          .append({ type: 'session_end', ts: new Date().toISOString(), usage: oldUsage })
          .catch(() => undefined);
        await oldWriter.close().catch(() => undefined);
      })();
    }
    agentCtx.session = resumed.writer;
    // Let the host re-point crash-recovery state at the session now written.
    ctx.onSessionSwapped?.(resumed.writer.id);
    // Hydrate the context with the old session's messages.
    agentCtx.state.replaceMessages(resumed.data.messages);
    agentCtx.state.replaceTodos([]);
    agentCtx.readFiles.clear();
    agentCtx.fileMtimes.clear();
    agentCtx.tokenCounter.reset();
    // Replay usage so the topbar shows accurate totals.
    agentCtx.tokenCounter.account(resumed.data.usage, agentCtx.model);
    const resumeP = await ctx.buildSessionStart({
      reset: true,
      replayMessages: resumed.data.messages,
      replayUsage: resumed.data.usage,
    });
    ctx.broadcast({ type: 'session.start', payload: resumeP });
    sendResult(ctx, ws, true, `Resumed session ${id}`);
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}

export async function handleSessionCheckpoints(ctx: SessionContext, ws: WebSocket): Promise<void> {
  try {
    const { DefaultSessionRewinder } = await import('@wrongstack/core');
    const rewinder = new DefaultSessionRewinder(
      ctx.sessionsDir ?? path.join(ctx.projectRoot, '.wrongstack', 'sessions'),
      ctx.projectRoot,
    );
    // Use the LIVE writer's id — after an in-app resume the active session
    // is agentCtx.session, not the startup one.
    const checkpoints = await rewinder.listCheckpoints(liveSessionId(ctx));
    ctx.send(ws, { type: 'session.checkpoints', payload: { checkpoints } });
  } catch {
    ctx.send(ws, { type: 'session.checkpoints', payload: { checkpoints: [] } });
  }
}

export async function handleSessionRewind(
  ctx: SessionContext,
  ws: WebSocket,
  checkpointIndex: number,
): Promise<void> {
  try {
    const { DefaultSessionRewinder } = await import('@wrongstack/core');
    const rewinder = new DefaultSessionRewinder(
      ctx.sessionsDir ?? path.join(ctx.projectRoot, '.wrongstack', 'sessions'),
      ctx.projectRoot,
    );
    // Rewind the LIVE session — both the file reverts (rewinder) and the
    // JSONL truncation (writer) must target the same session.
    const liveSession = ctx.agentCtx.session ?? ctx.startupSession;
    await rewinder.rewindToCheckpoint(liveSession.id, checkpointIndex);
    await liveSession.truncateToCheckpoint(checkpointIndex);
    sendResult(ctx, ws, true, `Rewound to checkpoint ${checkpointIndex}`);
    const rewindP = await ctx.buildSessionStart({ reset: true });
    ctx.broadcast({ type: 'session.start', payload: rewindP });
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}
