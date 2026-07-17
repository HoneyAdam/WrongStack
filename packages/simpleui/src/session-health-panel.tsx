import { Activity, Clock, Cpu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ContextInfo } from './types.js';

interface SessionHealthPanelProps {
  context: ContextInfo;
  messages: ChatMessage[];
  sessionStart: number | null;
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

export function SessionHealthPanel({ context, messages, sessionStart }: SessionHealthPanelProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { document.removeEventListener('keydown', onKey); clearInterval(timer); };
  }, [open]);

  const uptime = sessionStart ? now - sessionStart : 0;
  const ctxPct = context.maxContext > 0 ? Math.round((context.tokens / context.maxContext) * 100) : 0;
  const userMsgs = messages.filter((m) => m.role === 'user').length;
  const assistantMsgs = messages.filter((m) => m.role === 'assistant').length;
  const thinkingMsgs = messages.filter((m) => m.role === 'thinking').length;

  if (!open) {
    return (
      <button type="button" className="health-panel-trigger" title="Session health"
        aria-label="Open session health panel" onClick={() => setOpen(true)}>
        <Activity size={13} aria-hidden="true" />
        <span className="health-pct">{ctxPct}%</span>
      </button>
    );
  }

  return (
    <>
      <button type="button" className="settings-overlay" tabIndex={-1} onClick={() => setOpen(false)} />
      <aside className="health-panel" role="dialog" aria-modal="true" aria-label="Session health">
        <header className="health-panel-head">
          <span><Activity size={13} aria-hidden="true" /> HEALTH</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" ref={closeRef}><X size={14} /></button>
        </header>
        <div className="health-panel-body">
          <div className="health-stat">
            <Clock size={14} aria-hidden="true" />
            <div>
              <strong>Uptime</strong>
              <span>{formatUptime(uptime)}</span>
            </div>
          </div>
          <div className="health-stat">
            <Cpu size={14} aria-hidden="true" />
            <div>
              <strong>Context</strong>
              <span>{(context.tokens ?? 0).toLocaleString()} / {(context.maxContext ?? 0).toLocaleString()} tokens ({ctxPct}%)</span>
            </div>
          </div>
          <div className="health-stat">
            <Activity size={14} aria-hidden="true" />
            <div>
              <strong>Messages</strong>
              <span>{userMsgs} user · {assistantMsgs} assistant · {thinkingMsgs} thinking</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
