/**
 * Mailbox view — cross-project mailbox summaries (unread/incomplete/high-priority).
 */
import React from 'react';
import { useHqStore } from '../store.js';

export function MailboxView(): React.ReactElement {
  const state = useHqStore();
  const mailboxes = state.snapshot?.mailboxes ?? [];

  if (mailboxes.length === 0) {
    return <div className="hq-empty">No mailbox activity reported by connected clients.</div>;
  }

  return (
    <div>
      <div className="hq-card-title">Mailboxes ({mailboxes.length})</div>
      {mailboxes.map((m) => (
        <div key={m.mailboxId} className="hq-card">
          <div className="hq-row">
            <span style={{ fontWeight: 700 }}>{m.mailboxId}</span>
            <span className="hq-pill info">{m.scope}</span>
            <span className="hq-mono" style={{ color: 'var(--dim)' }}>{m.projectId}</span>
          </div>
          <div className="hq-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginTop: 8 }}>
            <Count label="messages" value={m.messageCount} />
            <Count label="unread" value={m.unreadCount} accent={m.unreadCount > 0 ? 'amber' : undefined} />
            <Count label="incomplete" value={m.incompleteCount} accent={m.incompleteCount > 0 ? 'red' : undefined} />
            <Count label="high-priority" value={m.highPriorityCount} accent={m.highPriorityCount > 0 ? 'red' : undefined} />
          </div>
          <div className="hq-row" style={{ marginTop: 6 }}>
            <span className="hq-pill active">{m.onlineAgentCount} online agents</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Count({ label, value, accent }: { label: string; value: number; accent?: string }): React.ReactElement {
  const color = accent === 'amber' ? 'var(--amber)' : accent === 'red' ? 'var(--red)' : 'var(--text)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="hq-stat-num" style={{ color }}>{value}</div>
      <div className="hq-stat-label">{label}</div>
    </div>
  );
}
