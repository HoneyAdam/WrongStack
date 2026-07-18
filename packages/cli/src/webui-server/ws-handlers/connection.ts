import type { Agent, ContentBlock } from '@wrongstack/core';
import {
  buildUserContentBlocks,
  IncomingImageError,
  type IncomingImagePayload,
  parseIncomingImages,
  toErrorMessage,
} from '@wrongstack/core/utils';
import {
  createToolVisionAdapters,
  ImageInputUnsupportedError,
  routeImagesForModel,
  VisionUrlBlockedError,
} from '@wrongstack/runtime/vision';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5k of Issue #30: the connection-level WebSocket handlers —
 * `user_message` (the agent-run entry), `abort`, `ping`, and
 * `tool.confirm_result`.
 *
 * These are the last cases that lived inline in `runWebUI`'s
 * `handleMessage` switch. Unlike the topic groups, they own per-socket
 * run-loop state: `abortControllers` (one in-flight `AbortController`
 * per socket) and `pendingConfirms` (tool-permission resolvers keyed by
 * confirm id). Both maps are *owned* by `runWebUI` and shared with the
 * connection/close handlers, so they're passed by reference on the
 * context rather than copied — the close handler still aborts/clears the
 * same maps these handlers mutate.
 *
 * `opts` is threaded by reference (read-only here) so `handleUserMessage`
 * calls the live `opts.agent` — after a project switch reassigns it, the
 * next `user_message` runs the new agent.
 */

/** The tool-confirmation decision the client can send back. */
export type ConfirmDecision = 'yes' | 'no' | 'always' | 'deny';

export interface PendingConfirm {
  resolve: (decision: ConfirmDecision) => void;
  decisionSource?: string | undefined;
  riskTier?: 'safe' | 'standard' | 'destructive' | undefined;
  boundaryReason?: string | undefined;
  /** The exact `tool.confirm_needed` broadcast payload, kept so the prompt
   *  can be replayed to clients that connect while the confirm is pending
   *  (e.g. a browser refresh mid-prompt). */
  payload?: Record<string, unknown> | undefined;
}

export function isDestructivePendingConfirm(confirm: PendingConfirm): boolean {
  return confirm.riskTier === 'destructive' || confirm.decisionSource === 'yolo_destructive';
}

export function resolveYoloEligiblePendingConfirms(
  pendingConfirms: Map<string, PendingConfirm>,
): void {
  for (const [id, confirm] of pendingConfirms) {
    if (confirm.boundaryReason) continue;
    pendingConfirms.delete(id);
    confirm.resolve('yes');
  }
}

export function resolveAllPendingConfirms(
  pendingConfirms: Map<string, PendingConfirm>,
  decision: ConfirmDecision,
): void {
  for (const [id, confirm] of pendingConfirms) {
    pendingConfirms.delete(id);
    confirm.resolve(decision);
  }
}

export interface ConnectionOptions {
  agent: Agent;
}

export interface ConnectionContext extends WsCommon {
  opts: ConnectionOptions;
  /** One in-flight run controller per socket; owned by runWebUI. */
  abortControllers: Map<WebSocket, AbortController>;
  /** Pending tool-permission resolvers keyed by confirm id; owned by runWebUI. */
  pendingConfirms: Map<string, PendingConfirm>;
}

function currentSessionId(ctx: ConnectionContext): string {
  return (ctx.opts.agent as { ctx?: { session?: { id?: string } } }).ctx?.session?.id ?? '';
}

function sessionPayload<T extends Record<string, unknown>>(
  ctx: ConnectionContext,
  payload: T,
): T & { sessionId?: string } {
  const sessionId = currentSessionId(ctx);
  const provided = payload['sessionId'];
  const resolved = typeof provided === 'string' && provided.length > 0 ? provided : sessionId;
  return resolved ? { ...payload, sessionId: resolved } : payload;
}

export interface UserMessageAttachments {
  /** Images attached in the WebUI composer (paste / drop / file picker). */
  images?: IncomingImagePayload[] | undefined;
  /** Legacy single-image field older clients sent as a data-URL. */
  imageBase64?: string | undefined;
}

export async function handleUserMessage(
  ctx: ConnectionContext,
  ws: WebSocket,
  content: string,
  requestedSessionId?: string | undefined,
  attachments?: UserMessageAttachments | undefined,
): Promise<void> {
  const liveSessionId = currentSessionId(ctx);
  if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) {
    ctx.send(ws, {
      type: 'error',
      payload: sessionPayload(ctx, {
        phase: 'user_message',
        message: `Request targeted session ${requestedSessionId}, but this WebUI runtime is currently on ${liveSessionId}.`,
        requestedSessionId,
      }),
    });
    return;
  }

  // Guard against overlapping runs on the same Agent instance. Two
  // rapid user messages would otherwise start a second agent.run()
  // before the first one's cleanup settles, corrupting context state.
  // Scoped to the requesting socket via `abortControllers` — a second
  // tab's `user_message` is allowed to start its own run; only an
  // overlapping message from the SAME tab is rejected.
  if (ctx.abortControllers.has(ws)) {
    ctx.send(ws, {
      type: 'error',
      payload: sessionPayload(ctx, { phase: 'agent.run', message: 'A run is already in progress. Abort it first.' }),
    });
    return;
  }

  // Abort any existing run (safety net; the guard above makes this
  // unreachable in the overlapping case, but direct abort requests
  // from the client still need the controller reference).
  const wsAbort = new AbortController();
  ctx.abortControllers.set(ws, wsAbort);

  try {
    // Turn attached images into canonical ImageBlocks so the agent sees the
    // same multimodal input shape the TUI produces, then route them exactly
    // like the TUI does: native for vision models, otherwise through any
    // registered image-understanding tool (zai-vision, minimax-vision, …)
    // which replaces each image with a text description. Only when neither
    // works does the message reject — silently dropping an image the user
    // attached would be worse than an upfront error.
    const agent = ctx.opts.agent;
    let input: string | ContentBlock[] = content;
    const imageBlocks = parseIncomingImages(attachments?.images, attachments?.imageBase64);
    if (imageBlocks.length > 0) {
      const routed = await routeImagesForModel(buildUserContentBlocks(content, imageBlocks), {
        supportsVision: agent.ctx.provider.capabilities.vision,
        adapters: () => createToolVisionAdapters(agent.tools),
        ctx: agent.ctx,
        signal: wsAbort.signal,
        providerId: agent.ctx.provider.id,
        model: agent.ctx.model,
      });
      input = routed.blocks;
    }

    const result = await agent.run(input, {
      signal: wsAbort.signal,
    });

    ctx.send(ws, {
      type: 'run.result',
      payload: sessionPayload(ctx, {
        status: result.status,
        iterations: result.iterations,
        finalText: result.finalText,
        error: result.error
          ? {
              code: result.error.code,
              message: result.error.message,
              recoverable: result.error.recoverable,
            }
          : undefined,
      }),
    });
  } catch (err) {
    // Image-input failures are user_message-phase errors: the run never
    // started, and the message tells the user how to fix it (resend without
    // images, switch model, or enable a vision adapter).
    if (
      err instanceof IncomingImageError ||
      err instanceof ImageInputUnsupportedError ||
      err instanceof VisionUrlBlockedError
    ) {
      ctx.send(ws, {
        type: 'error',
        payload: sessionPayload(ctx, {
          phase: 'user_message',
          ...(err instanceof ImageInputUnsupportedError ? { code: 'vision_unsupported' } : {}),
          message: err.message,
        }),
      });
    } else {
      ctx.send(ws, {
        type: 'error',
        payload: sessionPayload(ctx, {
          phase: 'agent.run',
          message: toErrorMessage(err),
        }),
      });
    }
  } finally {
    ctx.abortControllers.delete(ws);
  }
}

export function handleAbort(
  ctx: ConnectionContext,
  ws: WebSocket,
  requestedSessionId?: string | undefined,
): void {
  const liveSessionId = currentSessionId(ctx);
  if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) {
    ctx.send(ws, {
      type: 'error',
      payload: sessionPayload(ctx, {
        phase: 'abort',
        message: `Request targeted session ${requestedSessionId}, but this WebUI runtime is currently on ${liveSessionId}.`,
        requestedSessionId,
      }),
    });
    return;
  }

  // Scope the abort to the requesting socket. The legacy module-scope
  // `abortController` (project-switch path) is left alone — a
  // `case 'abort'` from one client should not interfere with another
  // client's in-flight run. The error message is sent only to the
  // requesting socket (not broadcast), which is correct: other clients
  // have no idea what just happened.
  const wsController = ctx.abortControllers.get(ws);
  wsController?.abort();
  ctx.send(ws, {
    type: 'error',
    payload: sessionPayload(ctx, { phase: 'abort', message: 'User aborted' }),
  });
}

export function handlePing(ctx: ConnectionContext, ws: WebSocket): void {
  ctx.send(ws, { type: 'pong', payload: {} });
}

export function handleToolConfirmResult(
  ctx: ConnectionContext,
  id: string,
  decision: ConfirmDecision,
  requestedSessionId?: string | undefined,
): void {
  const liveSessionId = currentSessionId(ctx);
  if (requestedSessionId && liveSessionId && requestedSessionId !== liveSessionId) return;
  const confirm = ctx.pendingConfirms.get(id);
  if (confirm) {
    ctx.pendingConfirms.delete(id);
    confirm.resolve(decision);
  }
}
