import { create } from 'zustand';

// ============================================
// Mailbox Store
// ============================================
// Central cache of mailbox messages + agent roster. Populated by the
// ws-handlers ('mailbox.messages' / 'mailbox.agents' responses) so the
// ActivityBar unread badge works even while MailboxPanel is unmounted.

/** Mirrors HQ/HqMailboxMessageScope. Derived server-side, but always revalidated client-side. */
export type MailboxMessageScope = 'project' | 'session' | 'agent';

const SESSION_RECIPIENT_PREFIX = '@session:';

/**
 * Classify a mailbox recipient address for UI labeling. Mirrors the
 * server-side helper in `@wrongstack/core/hq/mailbox-mapper` so the
 * WebUI can color messages consistently even when the server payload is
 * stale or missing the scope field.
 */
export function classifyMailboxRecipient(to: string): { scope: MailboxMessageScope; recipientSessionId?: string } {
  if (to === '*' || to === 'all') return { scope: 'project' };
  if (to.startsWith(SESSION_RECIPIENT_PREFIX)) {
    const recipientSessionId = to.slice(SESSION_RECIPIENT_PREFIX.length);
    if (recipientSessionId.length === 0) return { scope: 'agent' };
    return { scope: 'session', recipientSessionId };
  }
  return { scope: 'agent' };
}

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  /** Server-derived delivery scope. Re-classified client-side as a fallback. */
  scope?: MailboxMessageScope;
  /** Session id from `to` when `scope === 'session'`. */
  recipientSessionId?: string;
  type: string;
  /** Agent delivery audience; `leaders` is not consumed by subagents. */
  audience?: 'all' | 'leaders';
  subject: string;
  body: string;
  priority: string;
  readBy: Record<string, string>;
  /** Count of agents who have marked this message as read. */
  readByCount: number;
  completed: boolean;
  completedBy?: string;
  completedAt?: string;
  outcome?: string;
  timestamp: string;
  senderSessionId?: string;
  /** ID of the message this is a reply to, if any. */
  replyTo?: string;
  /** Free-form task context attached to the message by the sender. */
  taskContext?: string;
}

export interface MailboxAgent {
  agentId: string;
  name: string;
  role?: string;
  sessionId: string;
  status: string;
  currentTool?: string;
  currentTask?: string;
  lastSeenAt: string;
  online: boolean;
  source?: string;
  /** Process ID of the agent subprocess, if tracked. */
  pid?: number;
  /** Number of iterations the agent has run. */
  iterations?: number;
  /** Number of tool calls the agent has made in the current iteration. */
  toolCalls?: number;
}

export interface MailboxCompactionResult {
  readByAllRemoved: number;
  expiredRemoved: number;
  stalePurged: number;
  totalRemoved: number;
  remaining: number;
}

interface MailboxState {
  messages: MailboxMessage[];
  agents: MailboxAgent[];
  /** Result of the last auto-compact operation, if any. */
  lastCompaction: MailboxCompactionResult | null;
  setMessages: (messages: MailboxMessage[]) => void;
  setAgents: (agents: MailboxAgent[]) => void;
  setLastCompaction: (result: MailboxCompactionResult | null) => void;
}

export const useMailboxStore = create<MailboxState>()((set) => ({
  messages: [],
  agents: [],
  lastCompaction: null,
  setMessages: (messages) =>
    set({
      // Re-classify any message that lacks a server-derived scope, so the
      // UI can render chips consistently across server versions and stale
      // WS replies. The server value still wins when present.
      messages: messages.map((m) => {
        if (m.scope !== undefined) return m;
        const classified = classifyMailboxRecipient(m.to);
        return { ...m, ...classified };
      }),
    }),
  setAgents: (agents) => set({ agents }),
  setLastCompaction: (lastCompaction) => set({ lastCompaction }),
}));

/** Incomplete messages where no agent has acted yet (readByCount === 0).
 *  Driven by `incompleteOnly: true` query — the server filters to active
 *  messages, so anything with readByCount === 0 is genuinely unread. */
export function selectUnreadCount(s: MailboxState): number {
  return s.messages.filter((m) => !m.completed && (m.readByCount ?? 0) === 0).length;
}
