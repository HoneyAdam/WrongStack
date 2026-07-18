/**
 * mailbox-loop — Agent-loop integration for mailbox checking.
 *
 * Integrates the inter-agent mailbox into the agent's iteration cycle.
 * Before each LLM call, checks for unread messages from subagents and other
 * agents. Normal surfaces inject message content inline. Minimal surfaces may
 * use background delivery: routine chatter remains telemetry-only, while
 * actionable asks/results/steers still reach the agent.
 *
 * Uses the project-level GlobalMailbox for cross-session communication.
 *
 * ## Type-based dispatch
 *
 * The dispatch logic in this file is the **receive-side** of the type
 * semantics contract (the send-side lives in `mailbox-message-codec.ts`).
 *
 * Every type must have explicit handling. The contract is enforced by
 * `MAILBOX_TYPE_PROPERTIES` in mailbox-types.ts: adding a new type to the
 * `MailboxMessageType` union requires a corresponding entry.
 *
 * @module mailbox-loop
 */

import type { Mailbox, MailboxMessage } from '../coordination/mailbox-types.js';
import {
  ACTIONABLE_BACKGROUND_TYPES,
  MAILBOX_TYPE_PROPERTIES,
  type MailboxMessageType,
} from '../coordination/mailbox-types.js';
import { toErrorMessage } from '../utils/error.js';

export interface MailboxLoopOptions {
  /**
   * The mailbox instance, or a getter that returns the current mailbox.
   * A getter is used when the agent may switch projects at runtime —
   * the mailbox resolves from the current `ctx.projectRoot` on each
   * check rather than being captured at construction time.
   */
  mailbox: Mailbox | (() => Mailbox);
  /**
   * The agent's globally unique mailbox identity (e.g. `leader@a1b2c3d4`,
   * session-bound). Read receipts are recorded under this id, so two
   * sessions whose leaders share a base name never consume each other's
   * receipts. Pass a GETTER when the identity can change at runtime (an
   * in-process session swap moves the leader onto a new session tag).
   */
  agentId: string | (() => string);
  /**
   * Additional addresses this agent also answers to — typically the bare
   * base id (`leader`). Lets other agents (and humans) address "leader"
   * without knowing the session tag; every live leader session receives it.
   */
  aliases?: string[] | undefined;
  /** Optional delivery predicate applied before dedup/read receipts. */
  include?: ((message: MailboxMessage) => boolean) | undefined;
  /**
   * Current session id. When provided, mail addressed to `@session:<id>` is
   * delivered alongside direct, alias, and project-broadcast mail.
   */
  sessionId?: string | (() => string) | undefined;
  /** Mark returned messages as read. Defaults to true for normal delivery. */
  ack?: boolean | undefined;
}

export function createMailboxChecker(
  opts: MailboxLoopOptions,
): () => Promise<MailboxMessage[]> {
  const getMailbox = typeof opts.mailbox === 'function' ? opts.mailbox : () => opts.mailbox as Mailbox;
  const currentId = typeof opts.agentId === 'function' ? opts.agentId : () => opts.agentId as string;
  const currentSessionId =
    typeof opts.sessionId === 'function' ? opts.sessionId : () => opts.sessionId;

  const injectedIds = new Set<string>();

  return async (): Promise<MailboxMessage[]> => {
    try {
      const mailbox = getMailbox();
      const agentId = currentId();
      const sessionId = currentSessionId();
      const targets = [
        agentId,
        ...(opts.aliases ?? []).filter((al) => al && al !== agentId),
        ...(sessionId ? [`@session:${sessionId}`] : []),
      ];
      // Query ALL unread messages across every address this agent answers
      // to (unique id, base-id aliases, session scope; '*' broadcasts match
      // each query and are deduped below). Receipts always use the unique id.
      const batches = await Promise.all(
        targets.map((to) =>
          mailbox.query({ to, unreadBy: agentId, limit: 10 }).catch(() => [] as MailboxMessage[]),
        ),
      );
      const seen = new Set<string>();
      const messages: MailboxMessage[] = [];
      for (const batch of batches) {
        for (const m of batch) {
          if (seen.has(m.id)) continue;
          if (opts.include && !opts.include(m)) continue;
          seen.add(m.id);
          messages.push(m);
        }
      }

      // Filter out already-injected and completed messages
      const fresh = messages.filter(
        (m) => !injectedIds.has(m.id) && !m.completed,
      );

      // Track as injected
      for (const m of fresh) {
        injectedIds.add(m.id);
      }

      // Auto-read all fresh messages (adds read receipt) in a single batched
      // call. The previous per-message ack() did a full read-modify-rewrite
      // of the mailbox file for every fresh message — N fresh messages
      // meant N full-file rewrites in a row on every iteration.
      if (fresh.length > 0 && opts.ack !== false) {
        void mailbox
          .ackMany({
            acks: fresh.map((m) => ({
              messageId: m.id,
              readerId: agentId,
              read: true,
            })),
          })
          .catch(() => {});
      }

      // GC
      if (injectedIds.size > 1000) {
        const recent = new Set([...injectedIds].slice(-500));
        injectedIds.clear();
        for (const id of recent) injectedIds.add(id);
      }

      return fresh;
    } catch {
      return [];
    }
  };
}

/**
 * Human-readable emoji prefix for each message type. Types not in this map
 * fall through to a generic `📨 <TYPE>` prefix so a newly-added MailboxMessageType
 * still renders sensibly without needing an immediate code change here.
 */
const TYPE_LABEL: Partial<Record<MailboxMessage['type'], string>> = {
  steer: '🔄 STEER',
  btw: '💬 BTW',
  ask: '❓ ASK',
  assign: '📋 ASSIGN',
  result: '✅ RESULT',
  review: '🔍 REVIEW',
  status: '📨 STATUS',
  note: '📝 NOTE',
  broadcast: '📢 BROADCAST',
  control: '⚙ CONTROL',
};

/**
 * Lookup table: maps each MailboxMessageType to the guidance text appended
 * after the message body in `buildMailboxBlock()`. Every type gets explicit
 * guidance — no fallthrough to an empty string.
 */
const TYPE_GUIDANCE: Record<MailboxMessageType, string> = {
  steer: 'After your current operation reaches a stopping point, adjust your approach per the instruction above.',
  ask: 'This agent is waiting for your answer. Reply directly or use `mail_send` to respond.',
  assign: 'This is a task assignment. Act on it when your current operation allows.',
  result: 'A subagent has completed its work. Factor this result into your next decision.',
  btw: 'FYI only — absorb the information and stay on your current task; no reply needed.',
  status: 'Peer status update — use it to avoid duplicate or conflicting work; no reply needed.',
  review: 'This is a review request. Inspect the referenced code/doc/PR when convenient; an immediate reply is not required.',
  note: 'Read for context; no reply needed.',
  broadcast: 'Broadcast message. Read for context; no reply needed.',
  control: '', // control never reaches this rendering path — see injectPendingMailboxMessages
};

export function buildMailboxBtwAwarenessBlock(messages: MailboxMessage[]): { type: 'text'; text: string } {
  if (messages.length === 0) throw new Error('buildMailboxBtwAwarenessBlock called with empty messages');

  const parts: string[] = [];
  parts.push('[MAILBOX BTW] Mailbox awareness update:');
  parts.push('');
  parts.push(
    'Disclaimer: an agent just sent mail to everyone or to you. Do not stop your current work to look at it; this is only for awareness. This notification came from the WrongStack mailbox system.',
  );
  parts.push('');

  for (const m of messages) {
    const typeLabel = TYPE_LABEL[m.type] ?? `📨 ${m.type.toUpperCase()}`;
    const scope = m.to === '*' ? 'broadcast to everyone' : `addressed to ${m.to}`;
    parts.push(`--- ${typeLabel} from ${m.from} (${scope}) ---`);
    parts.push(`Subject: ${m.subject}`);
    parts.push('');
    parts.push(m.body);
    parts.push('');
  }

  parts.push('[END MAILBOX BTW]');
  return { type: 'text', text: parts.join('\n') };
}

export function buildMailboxBlock(messages: MailboxMessage[]): { type: 'text'; text: string } {
  if (messages.length === 0) throw new Error('buildMailboxBlock called with empty messages');

  const parts: string[] = [];
  parts.push('[MAILBOX] New message(s) from other agents:');
  parts.push('');

  // Use the canonical type properties table to detect messages requiring action.
  // `requiresAction` types are those that need a substantive response or
  // action from the recipient — distinct from `expectsReply` (e.g. review
  // expects no reply but still requires action).
  const hasActionable = messages.some(
    (m) => MAILBOX_TYPE_PROPERTIES[m.type]?.requiresAction ?? false,
  );

  // Steer messages always come first — they are mid-task behavior changes
  // and the model must see them before any other action items, otherwise
  // it can finish an ask/assign/result before adjusting course. We do NOT
  // mutate `messages` itself (the caller still owns it for dedup) — we
  // build a local render order via a single-pass partition.
  const steers: MailboxMessage[] = [];
  const rest: MailboxMessage[] = [];
  for (const m of messages) {
    if (m.type === 'steer') steers.push(m);
    else rest.push(m);
  }
  const ordered = [...steers, ...rest];

  for (const m of ordered) {
    const typeLabel = TYPE_LABEL[m.type] ?? `📨 ${m.type.toUpperCase()}`;
    parts.push(`--- ${typeLabel} from ${m.from} ---`);
    parts.push(`Subject: ${m.subject}`);
    parts.push('');
    parts.push(m.body);
    parts.push('');
    // Every type gets explicit guidance via the TYPE_GUIDANCE lookup.
    // control messages never reach this path (filtered upstream).
    const guidance = TYPE_GUIDANCE[m.type];
    if (guidance) {
      parts.push(`${guidance}`);
      parts.push('');
    }
  }

  if (hasActionable) {
    parts.push('Action required: address the items above. When done, use `mailbox action=ack messageId=<id> completed=true` to mark them complete.');
    parts.push('');
  }

  parts.push('[END MAILBOX]');
  return { type: 'text', text: parts.join('\n') };
}

// ── Integration hooks ────────────────────────────────────────────────────
// attachMailboxChecker (which constructs the concrete GlobalMailbox) lives
// in ../mailbox-attach.ts — the composition layer — so this file stays free
// of runtime coordination/ imports (architecture Rule 3).

/** Result of an inject pass — signals an out-of-band control request. */
interface MailboxInjectResult {
  /** A fresh `control:interrupt` message asked this agent to stop. */
  interrupt: boolean;
  /** Operator-supplied reason for the interrupt, if any. */
  interruptReason?: string | undefined;
}

export type MailboxDeliveryMode = 'inline' | 'background';

export async function injectPendingMailboxMessages(
  checkMailbox: () => Promise<MailboxMessage[]>,
  foldFn: (block: { type: 'text'; text: string }) => void,
  a: { events: { emit: (type: string, payload: unknown) => void }; logger: { debug?: (...args: unknown[]) => void } },
  deliveryMode: MailboxDeliveryMode = 'inline',
): Promise<MailboxInjectResult> {
  let messages: MailboxMessage[];
  try {
    messages = await checkMailbox();
  } catch {
    return { interrupt: false };
  }

  // Emit events for all found messages
  for (const m of messages) {
    a.events.emit('mailbox.received', {
      messageId: m.id,
      from: m.from,
      to: m.to,
      type: m.type,
      subject: m.subject,
    });
  }

  if (messages.length === 0) return { interrupt: false };

  // out-of-band messages (e.g. `control`) are out-of-band signals handled
  // by the runtime, NOT conversation content — keep them out of the folded
  // block so they never pollute the transcript. The canonical
  // MAILBOX_TYPE_PROPERTIES.outOfBand flag drives this decision so any
  // newly-added out-of-band type is automatically excluded.
  const outOfBand = messages.filter((m) => MAILBOX_TYPE_PROPERTIES[m.type]?.outOfBand ?? false);
  const content = messages.filter((m) => !(MAILBOX_TYPE_PROPERTIES[m.type]?.outOfBand ?? false));
  const deliveredContent =
    deliveryMode === 'background'
      ? content.filter((message) => ACTIONABLE_BACKGROUND_TYPES.has(message.type))
      : content;

  if (deliveredContent.length > 0) {
    try { foldFn(buildMailboxBlock(deliveredContent)); } catch (err) {
      (a.logger.debug ?? console.debug)?.(
        `mailbox: failed to fold messages: ${toErrorMessage(err)}`,
      );
    }
  }

  // An interrupt control message (subject/body naming a stop) asks the loop to
  // halt cooperatively at the next iteration boundary.
  const interruptMsg = outOfBand.find(
    (m) => /\b(interrupt|stop|halt|abort|cancel)\b/i.test(`${m.subject} ${m.body}`),
  );
  return interruptMsg
    ? { interrupt: true, interruptReason: interruptMsg.body || interruptMsg.subject || 'operator interrupt' }
    : { interrupt: false };
}
