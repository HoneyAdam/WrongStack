/**
 * mailbox-attach — composition glue for the agent-loop mailbox checker.
 *
 * Lives at the src root (composition layer) because it constructs the
 * concrete GlobalMailbox from coordination/ and hands the resulting
 * checker to core/ — core/ itself may only depend on the Mailbox
 * interface (architecture Rule 3, see tests/architecture/
 * package-boundaries.test.ts).
 *
 * @module mailbox-attach
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { GlobalMailbox, resolveProjectDir } from './coordination/global-mailbox.js';
import type { Mailbox, MailboxMessage } from './coordination/mailbox-types.js';
import type { AgentInternals } from './core/agent-internals.js';
import { createMailboxChecker } from './core/mailbox-loop.js';

export function attachMailboxChecker(
  a: AgentInternals,
  source?: 'cli' | 'webui',
): () => Promise<MailboxMessage[]> {
  // Mailbox integration is best-effort — it must NEVER be the reason Agent
  // construction fails. Ephemeral/test contexts without a projectRoot get a
  // no-op checker, and any setup error degrades to the same.
  if (!a.ctx.projectRoot) {
    return async () => [];
  }
  try {
    return attachMailboxCheckerInner(a, source);
  } catch {
    return async () => [];
  }
}

function attachMailboxCheckerInner(
  a: AgentInternals,
  source?: 'cli' | 'webui',
): () => Promise<MailboxMessage[]> {
  const home = os.homedir();
  const projectDir = resolveProjectDir(a.ctx.projectRoot, path.join(home, '.wrongstack'));
  // Pass the agent's EventBus so GlobalMailbox can emit real-time events
  // (agent_registered, agent_heartbeat, etc.) for TUI/WebUI display.
  const mailbox: Mailbox = new GlobalMailbox(projectDir, a.events);
  // Identity: ctx.meta override → Context field (subagents carry their
  // name there) → 'leader'. Without the field fallback, every fleet
  // subagent collapsed onto the host's 'leader' base id.
  const fieldId =
    a.ctx.agentId && a.ctx.agentId !== 'unknown' ? a.ctx.agentId : undefined;
  const baseId = (a.ctx.meta['agentId'] as string | undefined) ?? fieldId ?? 'leader';
  const fieldName =
    a.ctx.agentName && a.ctx.agentName !== 'Unknown Agent' ? a.ctx.agentName : undefined;
  const agentName = (a.ctx.meta['agentName'] as string | undefined) ?? fieldName ?? 'Agent';
  const sessionId = a.ctx.session.id;
  const surface = source ?? ((a.ctx.meta['source'] as 'cli' | 'webui' | undefined) ?? 'cli');

  // Globally unique identity: multiple terminals/WebUIs on the same project
  // ALL run an agent whose base id is 'leader' — registering with the bare
  // id makes them overwrite each other in the shared registry and consume
  // each other's read receipts. The pid suffix keeps every process distinct
  // while the base id stays addressable as an alias (checker below).
  const globalAgentId = `${baseId}#${process.pid}`;
  a.ctx.meta['globalAgentId'] = globalAgentId;
  if (!a.ctx.meta['source']) a.ctx.meta['source'] = surface;

  // Auto-register this agent to the shared mailbox system
  mailbox.registerAgent({
    agentId: globalAgentId,
    name: `${agentName} [${surface}]`,
    sessionId,
    pid: process.pid,
    source: surface,
  }).catch((err: unknown) => {
    // Log but don't fail - registration errors shouldn't crash the agent
    console.debug(`[mailbox] Failed to register agent ${globalAgentId}: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Start heartbeat timer to keep registration alive (every 30 seconds)
  const HEARTBEAT_INTERVAL_MS = 30_000;
  const heartbeatTimer = setInterval(() => {
    mailbox.heartbeat({ agentId: globalAgentId }).catch(() => {
      // Silently ignore - heartbeat failures are expected during shutdown
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Register cleanup to stop heartbeat on abort. Note: there's no unregisterAgent
  // method - agents are considered offline after their heartbeat expires (60s timeout).
  a.ctx.registerAbortHook(() => {
    clearInterval(heartbeatTimer);
  });

  // Receive on the unique id AND the bare base id (plus '*' broadcasts) —
  // "send to leader" reaches every live leader process on the project.
  return createMailboxChecker({ mailbox, agentId: globalAgentId, aliases: [baseId] });
}
