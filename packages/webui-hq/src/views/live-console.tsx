/**
 * LiveConsole view — full chat transcript for the selected session, rendered as
 * a clean WebUI-grade conversation: user / assistant bubbles, collapsible tool
 * cards with real result views (diffs, terminal output, files, JSON), and
 * subtle system/error lines.
 *
 * Fetches /api/sessions/:id/events on selection, then appends live
 * `session.transcript` events for the same session and keeps the view pinned to
 * the newest turn.
 */

import type { HqTranscriptEntry } from '@wrongstack/core';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchJson, useHqStore } from '../store.js';
import { TranscriptTurn } from './transcript-turn.js';

interface TranscriptResponse {
  sessionId: string;
  total: number;
  entries: HqTranscriptEntry[];
}

/** Stable-ish key for a turn — ts + role + tool id keeps React from thrashing. */
function turnKey(entry: HqTranscriptEntry, i: number): string {
  return `${i}:${entry.ts}:${entry.role}:${entry.toolUseId ?? ''}`;
}

export function LiveConsoleView(): React.ReactElement {
  const state = useHqStore(['events', 'selectedSessionId']);
  const sessionId = state.selectedSessionId;
  const [entries, setEntries] = useState<HqTranscriptEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    pinnedRef.current = true;
    fetchJson<TranscriptResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/events?limit=500`)
      .then((data) => {
        if (!cancelled) {
          setEntries(data.entries);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Append live transcript events for this session.
  useEffect(() => {
    if (sessionId === null) return;
    const recent = state.events.filter(
      (e) => e.type === 'session.transcript' && e.sessionId === sessionId,
    );
    if (recent.length === 0) return;
    const newEntries = recent.flatMap(
      (e) => (e.payload as { entries?: HqTranscriptEntry[] }).entries ?? [],
    );
    if (newEntries.length > 0) {
      setEntries((prev) => [...prev, ...newEntries].slice(-1000));
    }
  }, [state.events, sessionId]);

  // Keep the newest turn in view when the user is already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const stats = useMemo(() => {
    let tools = 0;
    let errors = 0;
    for (const e of entries) {
      if (e.role === 'tool') tools++;
      if (e.role === 'error' || e.isError) errors++;
    }
    return { turns: entries.length, tools, errors };
  }, [entries]);

  if (sessionId === null) {
    return (
      <div className="hq-empty">
        Select a terminal from the Fleet view to see its live transcript.
      </div>
    );
  }
  if (loading) return <div className="hq-empty">Loading transcript…</div>;
  if (error !== null) return <div className="hq-empty">Error: {error}</div>;

  return (
    <div>
      <div className="hq-chat-header">
        <span className="hq-card-title" style={{ margin: 0 }}>
          Live Console
        </span>
        <span className="hq-mono hq-chat-sid" title={sessionId}>
          {sessionId}
        </span>
        <span className="hq-chat-counts">
          <span className="hq-pill">{stats.turns} turns</span>
          <span className="hq-pill">{stats.tools} tools</span>
          {stats.errors > 0 && <span className="hq-pill error">{stats.errors} err</span>}
        </span>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="hq-chat-scroll">
        {entries.length === 0 ? (
          <div className="hq-empty">No transcript entries yet.</div>
        ) : (
          <div className="hq-chat-stream">
            {entries.map((entry, i) => (
              <TranscriptTurn key={turnKey(entry, i)} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
