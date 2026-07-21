/**
 * Process-registry WebSocket handlers for the WebUI server, extracted from the
 * `handleMessage` switch in `index.ts` as part of splitting that file (#31).
 *
 *   case 'process.list':    return handleProcessList(ws);
 *   case 'process.kill':    return handleProcessKill(ws, msg.payload);
 *   case 'process.killAll': return handleProcessKillAll(ws);
 *
 * Registry failures never escape the handler; they are reported over the
 * socket using the existing protocol envelopes.
 */

import type { Logger } from '@wrongstack/core';
import { createCompatibilityTrustBoundary, type TrustBoundary } from '@wrongstack/core/security';
import { getProcessRegistry } from '@wrongstack/tools';
import type { WebSocket } from 'ws';
import { authorizeWebUIAction, type WebUIPrivilegedAction } from './privileged-actions.js';
import { validateProcessKillPayload } from './ws-payload-validation.js';
import { errMessage, send, sendResult } from './ws-utils.js';

/** Broadcast the tracked-process list; an empty list on any registry failure. */
export function handleProcessList(ws: WebSocket): void {
  try {
    const procs = getProcessRegistry().list();
    send(ws, {
      type: 'process.list',
      payload: {
        processes: procs.map((p) => ({
          pid: p.pid,
          command: p.command,
          tool: p.name,
          startedAt: p.startedAt,
          status: p.killed ? ('killed' as const) : ('running' as const),
          protected: p.protected,
        })),
      },
    });
  } catch {
    send(ws, { type: 'process.list', payload: { processes: [] } });
  }
}

/** Kill one tracked PID. Rejects invalid payloads and protected processes. */
export async function handleProcessKill(
  ws: WebSocket,
  payload: unknown,
  trustBoundary: TrustBoundary = createCompatibilityTrustBoundary({
    policyId: 'webui-process-compat-v1',
  }),
  logger?: Logger | undefined,
  metadata?: WebUIPrivilegedAction['metadata'] | undefined,
): Promise<void> {
  const parsed = validateProcessKillPayload(payload);
  if (!parsed.ok) {
    sendResult(ws, false, parsed.message);
    return;
  }
  const { pid } = parsed.value;
  const authorization = await authorizeWebUIAction(
    trustBoundary,
    {
      capability: 'process.terminate',
      subject: { kind: 'process', id: String(pid), attributes: { operation: 'kill' } },
      risk: 'high',
      metadata: { transport: 'websocket', ...(metadata ?? {}) },
    },
    logger,
  );
  if (!authorization.allowed) {
    sendResult(ws, false, `Process termination denied: ${authorization.reason}`);
    return;
  }
  try {
    const proc = getProcessRegistry().get(pid);
    if (proc?.protected) {
      sendResult(ws, false, `Cannot kill protected process (PID ${pid})`);
      return;
    }
    getProcessRegistry().kill(pid);
    sendResult(ws, true, `Killed PID ${pid}`);
  } catch (err) {
    sendResult(ws, false, errMessage(err));
  }
}

/** Kill every tracked process. */
export async function handleProcessKillAll(
  ws: WebSocket,
  trustBoundary: TrustBoundary = createCompatibilityTrustBoundary({
    policyId: 'webui-process-compat-v1',
  }),
  logger?: Logger | undefined,
  metadata?: WebUIPrivilegedAction['metadata'] | undefined,
): Promise<void> {
  const authorization = await authorizeWebUIAction(
    trustBoundary,
    {
      capability: 'process.terminate-all',
      subject: { kind: 'resource', id: 'tracked-process-registry' },
      risk: 'critical',
      metadata: { transport: 'websocket', ...(metadata ?? {}) },
    },
    logger,
  );
  if (!authorization.allowed) {
    sendResult(ws, false, `Process termination denied: ${authorization.reason}`);
    return;
  }
  try {
    getProcessRegistry().killAll();
    sendResult(ws, true, 'All processes killed');
  } catch (err) {
    sendResult(ws, false, errMessage(err));
  }
}
