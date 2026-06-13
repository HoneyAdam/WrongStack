import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WebSocket } from 'ws';
import type { WsCommon } from './index.js';

/**
 * PR 5j of Issue #30: working_dir.set ws-handler.
 *
 * Extracted from the inline `handleMessage` switch in webui-server.ts.
 * Backs the FileExplorer breadcrumb navigation: validates that the
 * requested path stays inside the project root and is a real directory,
 * then re-points the agent context's cwd and broadcasts the change.
 */

export interface WorkingDirContext extends WsCommon {
  /** Live agent context — its `cwd` is mutated, its `projectRoot` is the fallback root. */
  agentCtx: { cwd: string; projectRoot: string };
  /** Preferred project root (re-rooted on project switch); falls back to agentCtx.projectRoot. */
  projectRoot: string | undefined;
}

/** Send a success/failure result message (mirrors the host `sendResult`). */
function sendResult(
  ctx: WorkingDirContext,
  ws: WebSocket,
  success: boolean,
  message: string,
): void {
  ctx.send(ws, { type: 'key.operation_result', payload: { success, message } });
}

export async function handleWorkingDirSet(
  ctx: WorkingDirContext,
  ws: WebSocket,
  newPath: string,
): Promise<void> {
  try {
    const wdRoot = ctx.projectRoot ?? ctx.agentCtx.projectRoot;
    const resolved = path.resolve(wdRoot, newPath);
    // Confine navigation to the project root — never let the breadcrumb
    // escape above it.
    if (!resolved.startsWith(wdRoot + path.sep) && resolved !== wdRoot) {
      sendResult(ctx, ws, false, `Path must stay inside the project root: ${wdRoot}`);
      return;
    }
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory()) {
      sendResult(ctx, ws, false, `Directory not found or not accessible: ${resolved}`);
      return;
    }
    ctx.agentCtx.cwd = resolved;
    ctx.broadcast({
      type: 'working_dir.changed',
      payload: { cwd: resolved, projectRoot: wdRoot },
    });
    sendResult(ctx, ws, true, `Working directory set to ${resolved}`);
  } catch (err) {
    sendResult(ctx, ws, false, err instanceof Error ? err.message : String(err));
  }
}
