/**
 * LiveConsole view — full chat transcript for the selected session, rendered
 * as a WebUI-grade conversation: user / assistant bubbles with real markdown,
 * collapsed thinking cards, collapsible tool cards with real result views
 * (diffs, terminal output, numbered reads, JSON, todos), and subtle
 * system/error lines.
 *
 * Data flow: an initial `/api/sessions/:id/events` fetch (merged history),
 * then live `session.transcript` batches folded in exactly once via
 * `lib/transcript-store` (per-batch keys + toolUseId result merging + content
 * dedup). The list is virtualized with virtua and stays pinned to the newest
 * turn while the user is at the bottom.
 */

import type { HqTranscriptAppendPayload, HqTranscriptEntry } from '@wrongstack/core';
import { ArrowDownToLine, History, MessageSquareText } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VList, type VListHandle } from 'virtua';
import {
  applyFetch,
  applyLiveBatch,
  createTranscriptState,
  isToolRunning,
  type TranscriptState,
} from '../lib/transcript-store.js';
import { fetchJson, selectSession, useHqStore } from '../store.js';
import { TranscriptTurn } from './transcript-turn.js';

interface TranscriptResponse {
  sessionId: string;
  source?: 'disk' | 'stream';
  projectName?: string;
  total: number;
  entries: HqTranscriptEntry[];
}

/** Stable key for a turn — index + identity fields keep React from thrashing. */
function turnKey(entry: HqTranscriptEntry, i: number): string {
  return `${i}:${entry.ts}:${entry.role}:${entry.toolUseId ?? ''}`;
}

function shortSessionId(id: string): string {
  return id.length > 28 ? `…${id.slice(-24)}` : id;
}

export function LiveConsoleView(): React.ReactElement {
  const state = useHqStore(['events', 'selectedSessionId', 'snapshot']);
  const sessionId = state.selectedSessionId;
  const [transcript, setTranscript] = useState<TranscriptState>(createTranscriptState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [meta, setMeta] = useState<{ source?: string; projectName?: string; total: number }>({
    total: 0,
  });
  const listRef = useRef<VListHandle | null>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const setPin = (v: boolean) => {
    pinnedRef.current = v;
    setPinned(v);
  };
  // How many store events we already folded in (the ring is append-only up to
  // its cap; batch keys inside the store make re-scans harmless anyway).
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;

  const sessions = state.snapshot?.liveSessions ?? [];

  // ── Initial (re)fetch ──────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    pinnedRef.current = true;
    setPinned(true);
    const qs = full ? 'full=1' : 'limit=1000';
    fetchJson<TranscriptResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/events?${qs}`)
      .then((data) => {
        if (cancelled) return;
        setTranscript((prev) => applyFetch(prev, data.entries));
        setMeta({ source: data.source, projectName: data.projectName, total: data.total });
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, full]);

  // Reset when switching sessions.
  useEffect(() => {
    setTranscript(createTranscriptState());
    setMeta({ total: 0 });
    setFull(false);
  }, [sessionId]);

  // ── Live appends ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (sessionId === null) return;
    let next = transcriptRef.current;
    for (const e of state.events) {
      if (e.type !== 'session.transcript' || e.sessionId !== sessionId) continue;
      const payload = e.payload as HqTranscriptAppendPayload;
      if (!Array.isArray(payload.entries)) continue;
      next = applyLiveBatch(next, payload.fromSeq, payload.entries);
    }
    if (next !== transcriptRef.current) setTranscript(next);
  }, [state.events, sessionId]);

  // ── Follow the newest turn while pinned ───────────────────────────────────
  const entries = transcript.entries;
  useEffect(() => {
    if (pinnedRef.current && entries.length > 0) {
      listRef.current?.scrollToIndex(entries.length - 1, { align: 'end' });
    }
  }, [entries.length, transcript.rev]);

  const onScroll = () => {
    const h = listRef.current;
    if (!h) return;
    setPin(h.scrollSize - h.scrollOffset - h.viewportSize < 80);
  };

  // A result-less tool only counts as "running" near the tail — an old call
  // that never recorded a result is dead, not in flight.
  const runningFrom = Math.max(0, entries.length - 8);
  const isRunningAt = (e: HqTranscriptEntry, i: number) => isToolRunning(e) && i >= runningFrom;

  const stats = useMemo(() => {
    let tools = 0;
    let errors = 0;
    let running = 0;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      if (e.tool !== undefined) tools++;
      if (e.role === 'error' || e.isError) errors++;
      if (isToolRunning(e) && i >= runningFrom) running++;
    }
    return { turns: entries.length, tools, errors, running };
  }, [entries, runningFrom]);

  const picker = (
    <select
      className="hq-select hq-chat-picker"
      value={sessionId ?? ''}
      onChange={(ev) => selectSession(ev.target.value === '' ? null : ev.target.value)}
    >
      <option value="">— select a session —</option>
      {sessions.map((s) => (
        <option key={s.sessionId} value={s.sessionId}>
          {s.projectName} · {s.clientKind} · {s.status} · {shortSessionId(s.sessionId)}
        </option>
      ))}
      {sessionId !== null && !sessions.some((s) => s.sessionId === sessionId) && (
        <option value={sessionId}>{shortSessionId(sessionId)} (ended)</option>
      )}
    </select>
  );

  return (
    <div className="hq-console">
      <div className="hq-chat-header">
        <MessageSquareText size={15} className="hq-chat-header-icon" />
        <span className="hq-card-title" style={{ margin: 0 }}>
          Console
        </span>
        {picker}
        {meta.projectName !== undefined && <span className="hq-pill">{meta.projectName}</span>}
        {meta.source !== undefined && (
          <span className="hq-pill" title="disk = full replay, stream = live ring">
            {meta.source}
          </span>
        )}
        <span className="hq-chat-counts">
          <span className="hq-pill">{stats.turns} turns</span>
          <span className="hq-pill">{stats.tools} tools</span>
          {stats.running > 0 && <span className="hq-pill running">{stats.running} running</span>}
          {stats.errors > 0 && <span className="hq-pill error">{stats.errors} err</span>}
          {!full && meta.total > entries.length && (
            <button
              type="button"
              className="hq-btn secondary hq-chat-fullbtn"
              onClick={() => setFull(true)}
              title={`History is truncated — load all ${meta.total} turns`}
            >
              <History size={12} /> load all {meta.total}
            </button>
          )}
        </span>
      </div>

      {sessionId === null ? (
        <div className="hq-empty">Select a session above (or click one in the Fleet view).</div>
      ) : loading && entries.length === 0 ? (
        <div className="hq-empty">Loading transcript…</div>
      ) : error !== null ? (
        <div className="hq-empty">Error: {error}</div>
      ) : (
        <div className="hq-chat-scroll">
          {entries.length === 0 ? (
            <div className="hq-empty">No transcript entries yet.</div>
          ) : (
            <VList ref={listRef} onScroll={onScroll} className="hq-chat-vlist">
              {entries.map((entry, i) => (
                <div key={turnKey(entry, i)} className="hq-chat-rowpad">
                  <TranscriptTurn entry={entry} running={isRunningAt(entry, i)} />
                </div>
              ))}
            </VList>
          )}
          {!pinned && entries.length > 0 && (
            <button
              type="button"
              className="hq-chat-jump"
              onClick={() => {
                setPin(true);
                listRef.current?.scrollToIndex(entries.length - 1, { align: 'end' });
              }}
              title="Jump to latest"
            >
              <ArrowDownToLine size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
