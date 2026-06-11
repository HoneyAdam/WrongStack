import { create } from 'zustand';

// ============================================
// Mailbox Store
// ============================================
// Central cache of mailbox messages + agent roster. Populated by the
// ws-handlers ('mailbox.messages' / 'mailbox.agents' responses) so the
// ActivityBar unread badge works even while MailboxPanel is unmounted.

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  subject: string;
  body: string;
  priority: string;
  readBy: Record<string, string>;
  readByCount: number;
  completed: boolean;
  completedBy?: string;
  outcome?: string;
  timestamp: string;
  senderSessionId?: string;
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
}

interface MailboxState {
  messages: MailboxMessage[];
  agents: MailboxAgent[];
  setMessages: (messages: MailboxMessage[]) => void;
  setAgents: (agents: MailboxAgent[]) => void;
}

export const useMailboxStore = create<MailboxState>()((set) => ({
  messages: [],
  agents: [],
  setMessages: (messages) => set({ messages }),
  setAgents: (agents) => set({ agents }),
}));

/** Messages nobody has read yet — drives the ActivityBar badge. */
export function selectUnreadCount(s: MailboxState): number {
  return s.messages.filter((m) => m.readByCount === 0 && !m.completed).length;
}
