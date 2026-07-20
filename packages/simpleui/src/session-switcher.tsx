import { ChevronDown, History, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { relativeSessionTime, sessionDisplayName } from './lib/session-model.js';
import type { SessionInfo, SimpleSessionSummary } from './types.js';

export interface SessionSwitcherProps {
  session: SessionInfo | null;
  sessions: SimpleSessionSummary[];
  running: boolean;
  /** Called the first time the dropdown opens in this session (triggers
   *  `sessions.list` from the server). */
  onRefreshSessions: () => void;
  onCreateSession: () => void;
  onResumeSession: (id: string) => void;
}

export function SessionSwitcher(props: SessionSwitcherProps): React.JSX.Element {
  const { session, sessions, running, onRefreshSessions, onCreateSession, onResumeSession } = props;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const refreshedRef = useRef(false);

  const currentSummary = useMemo(() => sessions.find((item) => item.isCurrent), [sessions]);
  const currentName = sessionDisplayName(currentSummary, session?.id ?? undefined);

  // Outside-click closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);

  // Request sessions.list on first open only.
  const handleTriggerClick = () => {
    if (!open && session) {
      if (!refreshedRef.current) {
        refreshedRef.current = true;
        onRefreshSessions();
      }
    }
    setOpen((current) => !current);
  };

  const handleCreate = () => {
    setOpen(false);
    onCreateSession();
  };

  const handleResume = (id: string) => {
    setOpen(false);
    onResumeSession(id);
  };

  return (
    <div className="session-switcher" ref={containerRef}>
      <button
        type="button"
        className="session-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        disabled={!session || running}
        onClick={handleTriggerClick}
        title={session ? currentName : 'Connecting…'}
      >
        <History size={14} aria-hidden="true" />
        <span>{session ? currentName : 'Connecting…'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="session-dropdown" role="menu">
          <button type="button" disabled={running} onClick={handleCreate} role="menuitem">
            <Plus size={14} aria-hidden="true" />
            New session
          </button>
          {sessions.length === 0 ? (
            <p className="session-empty">No saved sessions yet</p>
          ) : (
            <ul className="session-list">
              {sessions.map((item) => {
                const active = item.id === session?.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={active || running}
                      onClick={() => handleResume(item.id)}
                      aria-current={active ? 'page' : undefined}
                      role="menuitem"
                    >
                      <b>{sessionDisplayName(item)}</b>
                      <span className="session-meta">{item.model}</span>
                      <span className="session-time">{relativeSessionTime(item.startedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
