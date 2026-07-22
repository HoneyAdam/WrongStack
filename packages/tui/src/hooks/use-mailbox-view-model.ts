import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import type { AppProps } from '../app-props.js';
import type {
  MailboxAgentEntry,
  MailboxMessageEntry,
} from '../components/mailbox-panel.js';
import type { MailboxStatus } from '../components/status-bar.js';

/** Owns mailbox status subscriptions and the lightweight panel projection. */
export function useMailboxViewModel(events: AppProps['events']): {
  mailboxStatus: MailboxStatus;
  mailboxPanelOpen: boolean;
  setMailboxPanelOpen: Dispatch<SetStateAction<boolean>>;
  mailboxMessages: MailboxMessageEntry[];
  mailboxAgents: MailboxAgentEntry[];
} {
  const [mailboxStatus, setMailboxStatus] = useState<MailboxStatus>({
    unread: 0,
    onlineAgents: 0,
    onlineClients: { tui: 0, webui: 0, repl: 0 },
  });
  const [mailboxPanelOpen, setMailboxPanelOpen] = useState(false);
  const [mailboxMessages, setMailboxMessages] = useState<MailboxMessageEntry[]>([]);
  const [mailboxAgents, setMailboxAgents] = useState<MailboxAgentEntry[]>([]);

  useEffect(() => {
    const seenAgents = new Set<string>();
    const unsubUnread = events.onPattern('mailbox.unread_count', (_event, payload) => {
      const data = payload as { count: number } | undefined;
      setMailboxStatus((previous) => ({ ...previous, unread: data?.count ?? 0 }));
    });
    const unsubReceived = events.onPattern('mailbox.received', (_event, payload) => {
      const data = payload as { subject?: string; from?: string } | undefined;
      setMailboxStatus((previous) => ({
        ...previous,
        lastSubject: data?.subject ?? previous.lastSubject,
        lastFrom: data?.from ?? previous.lastFrom,
      }));
    });
    const updateAgentCount = (payload: unknown) => {
      const data = payload as { agentId?: string } | undefined;
      if (data?.agentId) seenAgents.add(data.agentId);
      setMailboxStatus((previous) => ({ ...previous, onlineAgents: seenAgents.size }));
    };
    const unsubRegistered = events.onPattern('mailbox.agent_registered', (_event, payload) => {
      updateAgentCount(payload);
    });
    const unsubHeartbeat = events.onPattern('mailbox.agent_heartbeat', (_event, payload) => {
      updateAgentCount(payload);
    });
    const unsubClients = events.onPattern('mailbox.sync_clients', (_event, payload) => {
      const data = payload as { tui?: number; webui?: number; repl?: number } | undefined;
      if (!data) return;
      setMailboxStatus((previous) => ({
        ...previous,
        onlineClients: {
          tui: data.tui ?? 0,
          webui: data.webui ?? 0,
          repl: data.repl ?? 0,
        },
      }));
    });
    return () => {
      unsubUnread();
      unsubReceived();
      unsubRegistered();
      unsubHeartbeat();
      unsubClients();
    };
  }, [events]);

  useEffect(() => {
    const unsubMessage = events.onPattern('mailbox.received', (_event, payload) => {
      const data = payload as
        | {
            messageId?: string;
            from?: string;
            subject?: string;
            type?: string;
            audience?: 'all' | 'leaders';
          }
        | undefined;
      if (!data?.messageId) return;
      const messageId = data.messageId;
      setMailboxMessages((previous) => {
        if (previous.some((message) => message.id === messageId)) return previous;
        return [
          {
            id: messageId,
            from: data.from ?? 'unknown',
            to: '*',
            type: data.type ?? 'note',
            audience: data.audience ?? 'all',
            subject: data.subject ?? '',
            body: '',
            priority: 'normal',
            timestamp: new Date().toISOString(),
            readByCount: 0,
            readByMe: false,
            completed: false,
          },
          ...previous,
        ].slice(0, 50);
      });
    });
    const unsubAgent = events.onPattern('mailbox.agent_registered', (_event, payload) => {
      const data = payload as
        | { agentId?: string; name?: string; role?: string; sessionId?: string; source?: string }
        | undefined;
      if (!data?.agentId) return;
      const agentId = data.agentId;
      setMailboxAgents((previous) => {
        if (previous.some((agent) => agent.agentId === agentId)) return previous;
        return [
          ...previous,
          {
            agentId,
            name: data.name ?? agentId,
            role: data.role,
            sessionId: data.sessionId ?? '?',
            status: 'idle',
            lastSeenAt: new Date().toISOString(),
            online: true,
            source: data.source,
          },
        ].slice(0, 30);
      });
    });
    return () => {
      unsubMessage();
      unsubAgent();
    };
  }, [events]);

  return {
    mailboxStatus,
    mailboxPanelOpen,
    setMailboxPanelOpen,
    mailboxMessages,
    mailboxAgents,
  };
}
