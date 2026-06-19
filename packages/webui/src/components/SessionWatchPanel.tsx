/**
 * SessionWatchPanel — read-only live view of another process's session.
 *
 * Given a sessionId (a TUI / REPL / WebUI running in the same project), it polls
 * `GET /api/sessions/:id/events` and renders that session's conversation + tool
 * stream, so you can *watch* what another client is doing from the Fleet HQ map
 * without attaching to it. Auto-scrolls while pinned to the bottom; re-fetches
 * every few seconds to tail new activity.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useMonitorStore } from '@/stores/monitor-store';

interface WatchEntry {
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'error';
  text: string;
  tool?: string;
}

interface WatchResponse {
  sessionId: string;
  status: string;
  clientType?: string;
  projectName?: string;
  total: number;
  entries: WatchEntry[];
}

const ROLE_STYLE: Record<WatchEntry['role'], { label: string; color: string }> = {
  user: { label: 'You', color: '#3b82f6' },
  assistant: { label: 'Claude', color: '#a855f7' },
  tool: { label: 'Tool', color: '#eab308' },
  system: { label: 'System', color: '#9ca3af' },
  error: { label: 'Error', color: '#ef4444' },
};

/** A message in the human↔leader mailbox thread (read-receipts + replies). */
interface ThreadMsg {
  id: string;
  from: string;
  to: string;
  type: string;
  subject: string;
  body: string;
  priority: string;
  readByLeader: string | null;
  readByCount: number;
  completed: boolean;
  outcome: string | null;
  timestamp: string;
  fromLeader: boolean;
}

type MsgType = 'steer' | 'ask' | 'assign' | 'note';
const MSG_TYPES: { value: MsgType; label: string; hint: string }[] = [
  { value: 'steer', label: '🔄 Steer', hint: 'Adjust behavior mid-task' },
  { value: 'ask', label: '❓ Ask', hint: 'Question — expects a reply' },
  { value: 'assign', label: '📋 Assign', hint: 'A task to act on' },
  { value: 'note', label: '💬 Note', hint: 'FYI, non-urgent' },
];

const POLL_MS = 2500;

export function SessionWatchPanel({
  sessionId,
  limit = 200,
}: {
  sessionId: string;
  /** How many trailing events to request. The compact node popover uses the
   *  default; the expanded drawer asks for the server max (500) to show the
   *  agent's full operation history. */
  limit?: number;
}) {
  const [data, setData] = useState<WatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<MsgType>('steer');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('high');
  const [thread, setThread] = useState<ThreadMsg[]>([]);
  const [interrupting, setInterrupting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const aliveRef = useRef(true);

  // Registry-derived activity fingerprint for THIS session. It changes only
  // when this session's status or its agents' tool/iteration counters move, so
  // we can refetch the stream the instant the watched process advances
  // (~150ms via the registry watch) instead of waiting on the fallback timer.
  const liveSessions = useMonitorStore((s) => s.liveSessions);
  const targetSession = useMemo(
    () => liveSessions.find((x) => x.sessionId === sessionId),
    [liveSessions, sessionId],
  );
  const activitySig = useMemo(() => {
    const s = targetSession;
    if (!s) return '';
    return `${s.status}|${s.agents
      .map((a) => `${a.id}:${a.status}:${a.toolCalls ?? 0}:${a.iterations ?? 0}`)
      .join(',')}`;
  }, [targetSession]);

  // Real-time "what is it doing right now", straight from the registry snapshot
  // — fresher than the JSONL (which only lands a line per completed step).
  const isRunning =
    targetSession?.status === 'active' ||
    (targetSession?.agents.some(
      (a) => a.status === 'running' || a.status === 'streaming',
    ) ??
      false);
  const nowDoing = useMemo(() => {
    if (!targetSession) return null;
    const busy = targetSession.agents.find(
      (a) => a.status === 'running' || a.status === 'streaming',
    );
    if (busy?.currentTool) return `🔧 ${busy.currentTool}`;
    if (busy) return `${busy.name ?? busy.id} · working`;
    return null;
  }, [targetSession]);

  // Live assistant text streaming in right now (the registry's throttled tail),
  // shown below the finished JSONL turns until the completed turn lands. Carries
  // the agent's name so a streaming subagent is distinguishable from the leader.
  const livePartial = useMemo(() => {
    if (!targetSession) return null;
    const a =
      targetSession.agents.find(
        (x) => x.partialText && (x.status === 'streaming' || x.status === 'running'),
      ) ?? targetSession.agents.find((x) => x.partialText);
    if (!a?.partialText) return null;
    const label = a.id === 'leader' ? ROLE_STYLE.assistant.label : a.name || a.id;
    return { label, text: a.partialText };
  }, [targetSession]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/events?limit=${limit}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as WatchResponse;
      if (aliveRef.current) {
        setData(json);
        setError(null);
      }
    } catch (e) {
      if (aliveRef.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [sessionId, limit]);

  // Poll the human↔leader mailbox thread so read-receipts (✓ leader read it)
  // and the agent's replies surface — the visible half of two-way control.
  const loadThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/mailbox`);
      if (!res.ok) return;
      const json = (await res.json()) as { thread?: ThreadMsg[] };
      if (aliveRef.current && Array.isArray(json.thread)) setThread(json.thread);
    } catch {
      /* best-effort — thread is supplementary */
    }
  }, [sessionId]);

  // Reset on session change + a slow fallback poll (covers idle sessions and
  // any registry-write the activity fingerprint can't see).
  useEffect(() => {
    aliveRef.current = true;
    setData(null);
    setError(null);
    setThread([]);
    void load();
    void loadThread();
    const iv = setInterval(() => void load(), POLL_MS);
    const tv = setInterval(() => void loadThread(), POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(iv);
      clearInterval(tv);
    };
  }, [load, loadThread]);

  // Event-driven: refetch the moment the watched session advances.
  useEffect(() => {
    if (activitySig) void load();
  }, [activitySig, load]);

  // Auto-scroll to the newest line while the user is pinned to the bottom.
  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, livePartial]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSent(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, type: msgType, priority }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraft('');
      setSent(
        isRunning
          ? 'Delivered — the running agent sees it on its next step'
          : 'Delivered — target is idle; appears in its mailbox, read when it next runs',
      );
      void loadThread();
    } catch (e) {
      setSent(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  };

  // Cooperative interrupt — drops a control message; the target halts at its
  // next iteration boundary (not a process kill).
  const interrupt = async () => {
    if (interrupting) return;
    setInterrupting(true);
    setSent(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Operator requested stop from Fleet HQ' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSent('Interrupt sent — agent stops at its next step (not a kill)');
      void loadThread();
    } catch (e) {
      setSent(`Interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInterrupting(false);
    }
  };

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-cyan-400/80">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600',
            )}
          />
          Live stream
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div className="text-[10px] text-gray-500">
              {data.total} event{data.total === 1 ? '' : 's'} · {data.status}
            </div>
          )}
          {isRunning && (
            <button
              type="button"
              onClick={() => void interrupt()}
              disabled={interrupting}
              title="Cooperatively stop this agent at its next step (not a process kill)"
              className="rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 transition-colors"
            >
              {interrupting ? '…' : '⏸ Interrupt'}
            </button>
          )}
        </div>
      </div>
      {nowDoing && (
        <div className="mb-1.5 shrink-0 text-[10px] text-emerald-300/90 truncate">▶ {nowDoing}</div>
      )}
      {error && <div className="text-[11px] text-red-400 mb-1 shrink-0">· {error}</div>}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0"
      >
        {entries.length === 0 && !error && (
          <div className="text-[11px] text-gray-500 italic">Loading session…</div>
        )}
        {entries.map((e, i) => {
          const s = ROLE_STYLE[e.role];
          return (
            <div key={`${e.ts}-${i}`} className="text-[11px] leading-snug">
              <span className="font-semibold mr-1.5" style={{ color: s.color }}>
                {e.role === 'tool' && e.tool ? `🔧 ${e.tool}` : s.label}
              </span>
              {e.text && (
                <span className="text-gray-300 whitespace-pre-wrap break-words">{e.text}</span>
              )}
            </div>
          );
        })}
        {livePartial && (
          <div className="text-[11px] leading-snug">
            <span className="font-semibold mr-1.5" style={{ color: ROLE_STYLE.assistant.color }}>
              {livePartial.label}
            </span>
            <span className="text-gray-300 whitespace-pre-wrap break-words">
              {livePartial.text}
              <span className="animate-pulse text-cyan-400">▋</span>
            </span>
          </div>
        )}
      </div>

      {/* Thread — the two-way loop made visible: what you sent + read-receipts
          + the agent's replies. Last few only, oldest→newest. */}
      {thread.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-700/70 shrink-0 max-h-28 overflow-y-auto space-y-1">
          <div className="text-[9px] uppercase tracking-wide text-gray-500">Messages</div>
          {thread.slice(-6).map((m) => {
            const status = m.completed
              ? '✓✓ done'
              : m.readByLeader
                ? '✓ read'
                : '⏳ delivered';
            return (
              <div key={m.id} className="text-[10px] leading-snug">
                <span
                  className="font-semibold mr-1.5"
                  style={{ color: m.fromLeader ? ROLE_STYLE.assistant.color : ROLE_STYLE.user.color }}
                >
                  {m.fromLeader ? 'Agent' : 'You'}
                </span>
                <span className="text-gray-300 whitespace-pre-wrap break-words">{m.body}</span>
                {!m.fromLeader && (
                  <span
                    className={cn(
                      'ml-1.5 text-[9px]',
                      m.completed
                        ? 'text-emerald-400'
                        : m.readByLeader
                          ? 'text-cyan-400'
                          : 'text-gray-500',
                    )}
                  >
                    {status}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Composer — steer this session from here (two-way). */}
      <div className="mt-2 pt-2 border-t border-slate-700/70 shrink-0">
        <div className="mb-1 flex items-center gap-1.5">
          <select
            value={msgType}
            onChange={(ev) => setMsgType(ev.target.value as MsgType)}
            title={MSG_TYPES.find((t) => t.value === msgType)?.hint}
            className="rounded bg-slate-900/70 border border-slate-700 px-1.5 py-0.5 text-[10px] text-gray-200 focus:outline-none focus:border-cyan-500/50"
          >
            {MSG_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={(ev) => setPriority(ev.target.value as 'low' | 'normal' | 'high')}
            title="Priority"
            className="rounded bg-slate-900/70 border border-slate-700 px-1.5 py-0.5 text-[10px] text-gray-200 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="high">high</option>
            <option value="normal">normal</option>
            <option value="low">low</option>
          </select>
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
                ev.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={`${MSG_TYPES.find((t) => t.value === msgType)?.label ?? 'Send'} → this session…`}
            className="flex-1 resize-none rounded-md bg-slate-900/70 border border-slate-700 px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-cyan-500/50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={sending || !draft.trim()}
            className="shrink-0 rounded-md bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 px-2.5 py-1.5 text-[11px] hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
        {sent && <div className="mt-1 text-[10px] text-gray-500">{sent}</div>}
        <div className="mt-0.5 text-[9px] text-gray-600">⌘/Ctrl+Enter to send · seen on the agent's next iteration</div>
      </div>
    </div>
  );
}
