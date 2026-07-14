/**
 * FleetChatDrawer — the instant chat panel that slides over the Fleet
 * Topology canvas when a terminal or agent node is clicked. Renders the same
 * live transcript pipeline as the full Console (via useSessionTranscript)
 * so the map never has to be left to peek at what an agent is doing.
 */
import { ArrowDownToLine, Bot, ExternalLink, SquareTerminal, X } from 'lucide-react';
import type React from 'react';
import { useEffect, useId, useRef } from 'react';
import { VList } from 'virtua';
import { turnKey, useSessionTranscript } from '../lib/use-session-transcript.js';
import { useHqStore } from '../store.js';
import type { FleetTopologyNode } from './fleet-topology.js';
import { TranscriptTurn } from './transcript-turn.js';

export interface FleetChatTarget {
  sessionId: string;
  agentId: string | null;
  label: string;
  status?: string | undefined;
}

function statusPillClass(status: string | undefined): string {
  if (status === 'active' || status === 'running' || status === 'streaming') return 'active';
  if (status === 'waiting_user') return 'warn';
  if (status === 'error' || status === 'stale' || status === 'closing') return 'error';
  return 'info';
}

/** Build a drawer target from a clicked topology node (terminal or agent). */
export function chatTargetFromNode(node: FleetTopologyNode): FleetChatTarget | null {
  if (node.sessionId === undefined) return null;
  return {
    sessionId: node.sessionId,
    agentId: node.agentId ?? null,
    label: node.label,
    status: node.status,
  };
}

export function FleetChatDrawer({
  target,
  onClose,
}: {
  target: FleetChatTarget;
  onClose: () => void;
}): React.ReactElement {
  const chat = useSessionTranscript(target.sessionId, target.agentId);
  const { entries } = chat;
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="hq-fleet-drawer-layer" data-testid="hq-fleet-chat-drawer">
      <button
        type="button"
        className="hq-fleet-drawer-scrim"
        tabIndex={-1}
        aria-label="Close fleet transcript"
        onClick={onClose}
      />
      <aside className="hq-fleet-drawer" role="dialog" aria-modal="false" aria-labelledby={titleId}>
        <div className="hq-fleet-drawer-header">
          {target.agentId !== null ? (
            <Bot size={14} className="hq-chat-header-icon" />
          ) : (
            <SquareTerminal size={14} className="hq-chat-header-icon" />
          )}
          <span id={titleId} className="hq-fleet-drawer-title" title={target.label}>
            {target.label}
          </span>
          {target.status !== undefined && (
            <span className={`hq-pill ${statusPillClass(target.status)}`}>{target.status}</span>
          )}
          <span className="hq-fleet-drawer-actions">
            <button
              type="button"
              className="hq-btn secondary"
              onClick={() => {
                onClose();
                useHqStore.getState().setActiveView('console');
              }}
              title="Open this conversation in the full Console"
            >
              <ExternalLink size={12} /> Console
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              className="hq-btn secondary"
              onClick={onClose}
              aria-label="Close fleet transcript"
              title="Close (Esc)"
            >
              <X size={13} />
            </button>
          </span>
        </div>
        <div className="hq-fleet-drawer-stats">
          <span className="hq-pill">{chat.stats.turns} turns</span>
          <span className="hq-pill">{chat.stats.tools} tools</span>
          {chat.stats.running > 0 && (
            <span className="hq-pill running">{chat.stats.running} running</span>
          )}
          {chat.stats.errors > 0 && <span className="hq-pill error">{chat.stats.errors} err</span>}
          {chat.meta.source !== undefined && (
            <span
              className="hq-pill"
              title={
                chat.meta.source === 'disk'
                  ? 'full history replayed from this machine'
                  : 'live ring only (remote or not yet persisted)'
              }
            >
              {chat.meta.source === 'disk' ? 'full history' : 'live ring'}
            </span>
          )}
        </div>
        <div className="hq-chat-scroll hq-fleet-drawer-body">
          {chat.loading && entries.length === 0 ? (
            <div className="hq-empty">Loading transcript…</div>
          ) : chat.error !== null ? (
            <div className="hq-empty">Error: {chat.error}</div>
          ) : entries.length === 0 ? (
            <div className="hq-empty">
              {target.agentId !== null
                ? `No messages from ${target.label} yet.`
                : 'No transcript entries yet.'}
            </div>
          ) : (
            <VList ref={chat.listRef} onScroll={chat.onScroll} className="hq-chat-vlist">
              {entries.map((entry, i) => (
                <div key={turnKey(entry, i)} className="hq-chat-rowpad">
                  <TranscriptTurn entry={entry} running={chat.isRunningAt(entry, i)} />
                </div>
              ))}
            </VList>
          )}
          {!chat.pinned && entries.length > 0 && (
            <button
              type="button"
              className="hq-chat-jump"
              onClick={chat.jumpToLatest}
              title="Jump to latest"
            >
              <ArrowDownToLine size={14} />
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
