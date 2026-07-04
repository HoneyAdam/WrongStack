/**
 * fleet-pulse — pure formatter for the periodic peer-status digest.
 *
 * Every agent on a project (leader and fleet subagents alike) periodically
 * gets a compact "[FLEET PULSE]" block folded into its conversation so it
 * knows what its peers are doing — who is running what task, who went
 * idle, who finished. This is the push half of peer awareness (the pull
 * half is the `fleet_status` tool).
 *
 * This module is data-in/text-out only: it never touches the mailbox or
 * the filesystem, so core/ stays free of runtime coordination/ imports
 * (architecture Rule 3 — same posture as mailbox-loop.ts). The composition
 * glue that feeds it live `MailboxAgentStatus[]` lives in
 * ../mailbox-attach.ts (`attachFleetPulse`).
 *
 * @module fleet-pulse
 */

import type { MailboxAgentStatus } from '../coordination/mailbox-types.js';

export interface FleetPulseOptions {
  /** This agent's own mailbox id — excluded from the digest. */
  selfId: string;
  /** Max peers listed (rest summarized as "+N more"). Default 15. */
  maxAgents?: number | undefined;
  /** Hard cap on total digest characters. Default 900. */
  maxChars?: number | undefined;
}

const DEFAULT_MAX_AGENTS = 15;
const DEFAULT_MAX_CHARS = 900;
const TASK_SNIPPET_CHARS = 60;

/**
 * Stable signature over the fields that matter to a reader — used by the
 * caller to skip re-injection when nothing meaningful changed since the
 * last pulse. Deliberately excludes counters (iterations/toolCalls) and
 * timestamps: those tick constantly and would defeat the dedup.
 */
export function fleetPulseSignature(statuses: MailboxAgentStatus[]): string {
  return statuses
    .map((s) => `${s.agentId}|${s.status}|${s.currentTask ?? ''}`)
    .sort()
    .join('\n');
}

function peerLine(s: MailboxAgentStatus): string {
  const role = s.role && s.role !== s.name ? ` (${s.role})` : '';
  const parts = [`• ${s.name}${role} — ${s.status}`];
  if (s.currentTask) {
    const task =
      s.currentTask.length > TASK_SNIPPET_CHARS
        ? `${s.currentTask.slice(0, TASK_SNIPPET_CHARS)}…`
        : s.currentTask;
    parts.push(`"${task}"`);
  }
  if (s.currentTool) parts.push(`tool: ${s.currentTool}`);
  if (s.toolCalls > 0) parts.push(`${s.toolCalls} tools`);
  return parts.join(' — ');
}

/**
 * Build the digest block, or `null` when there is nothing worth saying
 * (no online peers besides self). The caller owns cadence and dedup.
 */
export function buildFleetPulseBlock(
  statuses: MailboxAgentStatus[],
  opts: FleetPulseOptions,
): { type: 'text'; text: string } | null {
  const maxAgents = opts.maxAgents ?? DEFAULT_MAX_AGENTS;
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const peers = statuses.filter((s) => s.online && s.agentId !== opts.selfId);
  if (peers.length === 0) return null;

  // Running peers first — they are what a reader coordinates around.
  const order: Record<string, number> = { running: 0, streaming: 0, waiting_user: 1, idle: 2, error: 3, offline: 4 };
  const sorted = [...peers].sort(
    (x, y) => (order[x.status] ?? 5) - (order[y.status] ?? 5) || x.name.localeCompare(y.name),
  );
  const shown = sorted.slice(0, maxAgents);
  const hidden = sorted.length - shown.length;

  const parts: string[] = [];
  parts.push(`[FLEET PULSE] ${peers.length} peer${peers.length === 1 ? '' : 's'} online:`);
  for (const s of shown) parts.push(peerLine(s));
  if (hidden > 0) parts.push(`… +${hidden} more`);
  parts.push(
    '[END FLEET PULSE] (FYI — coordinate via mail_send; avoid duplicating peers\' work)',
  );

  let text = parts.join('\n');
  if (text.length > maxChars) {
    // Trim from the peer list, never the header/footer.
    while (parts.length > 3 && parts.join('\n').length > maxChars) {
      parts.splice(parts.length - 2, 1);
    }
    text = parts.join('\n');
    if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  }
  return { type: 'text', text };
}
