/**
 * HQ control-plane command definitions — typed payloads for the commands the
 * HQ dashboard can enqueue to connected machines (Phase 3+ of the HQ command
 * center). These are carried over the existing `HqQueuedCommand` wire shape
 * (`{commandId, type, payload, …}`) whose `type`/`payload` were previously
 * type-erased. This module gives them a discriminated union for type-safe
 * dispatch on the client side (Phase 4).
 *
 * Security model: `run-command` (raw shell) is gated by a per-token
 * `control.execute` capability AND an operator opt-in; the other four commands
 * route through the agent's own decision loop / mailbox and inherit their
 * existing guardrails. See `docs/plans/hq-command-center-2026-07.md`.
 *
 * @module hq/commands
 */
import type { HqQueuedCommand } from './protocol.js';

// ── Command types ───────────────────────────────────────────────────────────

/** HQ_COMMAND_TYPES — the full set of recognized command `type` strings. */
export const HQ_COMMAND_TYPES = [
  'steer',
  'abort',
  'spawn',
  'broadcast',
  'run-command',
] as const;

export type HqCommandType = (typeof HQ_COMMAND_TYPES)[number];

/** Inject a steer text into a target agent's conversation. */
export interface HqSteerCommand {
  type: 'steer';
  /** Target agent address: a unique id (`leader@<tag>`), an alias (`leader`), or `*` for all. */
  to: string;
  subject: string;
  body: string;
  priority?: 'low' | 'normal' | 'high';
}

/** Abort a running agent run or fleet. */
export interface HqAbortCommand {
  type: 'abort';
  /** `'leader'` aborts the session leader; a subagentId aborts one agent; `'fleet'` stops all. */
  target: 'leader' | 'fleet' | string;
}

/** Spawn a subagent of the given role. */
export interface HqSpawnCommand {
  type: 'spawn';
  role: string;
  /** Optional task description for dispatch routing. */
  task?: string;
  maxIterations?: number;
}

/** Broadcast a mailbox message to all agents on the target's project. */
export interface HqBroadcastCommand {
  type: 'broadcast';
  subject: string;
  body: string;
  priority?: 'low' | 'normal' | 'high';
}

/** Run a shell command on the target machine. GATED by `control.execute`. */
export interface HqRunCommandCommand {
  type: 'run-command';
  command: string;
  /** Optional working directory (defaults to the agent's project root). */
  cwd?: string;
}

export type HqCommand =
  | HqSteerCommand
  | HqAbortCommand
  | HqSpawnCommand
  | HqBroadcastCommand
  | HqRunCommandCommand;

// ── Validation ──────────────────────────────────────────────────────────────

const HQ_COMMAND_TYPE_SET = new Set<string>(HQ_COMMAND_TYPES);

/**
 * Validate that an inbound `HqQueuedCommand` has a recognized `type` and a
 * minimally well-formed payload. Returns the narrowed command on success, or
 * `null` when the command should be rejected.
 *
 * This is a shape check, not a security gate — capability enforcement happens
 * at enqueue time (browser token must have `control.enqueue`) and at execute
 * time (`run-command` requires `control.execute`).
 */
export function validateHqCommand(queued: HqQueuedCommand): HqCommand | null {
  if (!HQ_COMMAND_TYPE_SET.has(queued.type)) return null;
  const p = queued.payload as Record<string, unknown>;
  if (p === null || typeof p !== 'object') return null;
  switch (queued.type as HqCommandType) {
    case 'steer': {
      if (typeof p['to'] !== 'string' || typeof p['subject'] !== 'string' || typeof p['body'] !== 'string') {
        return null;
      }
      const result: HqSteerCommand = { type: 'steer', to: p['to'], subject: p['subject'], body: p['body'] };
      if (p['priority'] === 'low' || p['priority'] === 'normal' || p['priority'] === 'high') {
        result.priority = p['priority'];
      }
      return result;
    }
    case 'abort':
      if (typeof p['target'] !== 'string') return null;
      return { type: 'abort', target: p['target'] };
    case 'spawn': {
      if (typeof p['role'] !== 'string') return null;
      const result: HqSpawnCommand = { type: 'spawn', role: p['role'] };
      if (typeof p['task'] === 'string') result.task = p['task'];
      if (typeof p['maxIterations'] === 'number') result.maxIterations = p['maxIterations'];
      return result;
    }
    case 'broadcast': {
      if (typeof p['subject'] !== 'string' || typeof p['body'] !== 'string') return null;
      const result: HqBroadcastCommand = { type: 'broadcast', subject: p['subject'], body: p['body'] };
      if (p['priority'] === 'low' || p['priority'] === 'normal' || p['priority'] === 'high') {
        result.priority = p['priority'];
      }
      return result;
    }
    case 'run-command': {
      if (typeof p['command'] !== 'string') return null;
      const result: HqRunCommandCommand = { type: 'run-command', command: p['command'] };
      if (typeof p['cwd'] === 'string') result.cwd = p['cwd'];
      return result;
    }
    default:
      return null;
  }
}

// ── Audit log ───────────────────────────────────────────────────────────────

export interface HqCommandAuditEntry {
  commandId: string;
  type: HqCommandType;
  clientId: string;
  /** Who enqueued the command (browser token id, or 'anonymous' in open mode). */
  enqueuedBy: string;
  enqueuedAt: string;
  status: 'queued' | 'delivered' | 'acked';
  /** Ack status when the client has responded. */
  ackStatus?: 'accepted' | 'completed' | 'failed' | 'rejected';
  ackMessage?: string;
  ackedAt?: string;
}

/**
 * In-memory command audit ring. Capped; the Phase 2 persistence layer can
 * sink entries to disk when wired (future). For now this gives the server a
 * queryable history for `/api/commands` and snapshot enrichment.
 */
export class HqCommandAuditLog {
  private readonly entries: HqCommandAuditEntry[] = [];
  private readonly max: number;

  constructor(max = 1000) {
    this.max = max;
  }

  record(entry: HqCommandAuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.max) {
      this.entries.splice(0, this.entries.length - this.max);
    }
  }

  update(commandId: string, patch: Partial<HqCommandAuditEntry>): void {
    const entry = this.entries.find((e) => e.commandId === commandId);
    if (entry) Object.assign(entry, patch);
  }

  recent(limit = 200): HqCommandAuditEntry[] {
    return this.entries.slice(-limit);
  }
}
