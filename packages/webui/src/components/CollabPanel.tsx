import {
  Eye,
  LogIn,
  LogOut,
  MessageSquareWarning,
  Pause,
  Play,
  Syringe,
  UserPlus,
  Users,
} from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { getWSClient } from '@/lib/ws-client';
import { useChatStore, useConfigStore } from '@/stores';
import type {
  CollabRole,
  WSCollabAnnotationAdded,
  WSCollabAnnotationResolved,
  WSCollabParticipantJoined,
  WSCollabParticipantLeft,
  WSCollabPauseGranted,
  WSCollabPauseReleased,
  WSCollabState,
  WSError,
  WSServerMessage,
} from '@/types';

export interface CollabPanelProps {
  /** Current session id — the panel joins this session on mount if the user opts in. */
  sessionId: string;
  /** Optional className for layout-level styling. */
  className?: string | undefined;
}

export interface CollabParticipant {
  participantId: string;
  role: CollabRole;
  joinedAt: string;
}

/**
 * CollabPanel — read-only live observer indicator + join/leave control.
 *
 * Phase 1 of idea #13: a second human can join an active agent run and
 * watch a live mirror of kernel events (tool calls, iterations, subagent
 * spawns). The observer cannot modify the agent. Annotation and control
 * hand-off land in Phase 2/3.
 *
 * UX:
 *   - 0 observers → muted "Join as observer" CTA
 *   - 1+ observers → live dot + count + role chips + "Leave" button
 *   - State stays in sync with the 2s server-side broadcast
 */
export function CollabPanel({ sessionId, className }: CollabPanelProps): React.ReactElement {
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);
  const [joined, setJoined] = useState(false);
  const [joinedRole, setJoinedRole] = useState<'observer' | 'annotator' | 'controller' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [openAnnotationCount, setOpenAnnotationCount] = useState(0);
  const [paused, setPaused] = useState(false);
  // Controller-only "inject tool result" form state (Phase 4).
  const [injectOpen, setInjectOpen] = useState(false);
  const [injectToolUseId, setInjectToolUseId] = useState('');
  const [injectContent, setInjectContent] = useState('');
  const [injectIsError, setInjectIsError] = useState(false);
  const [injectReason, setInjectReason] = useState('');
  const wsUrl = useConfigStore((s) => s.wsUrl);
  const client = getWSClient(wsUrl);
  // In-flight tool calls (a `tool` message with no result yet) are the targets
  // a controller can inject a synthetic result for.
  const pendingTools = useChatStore((s) => s.messages).filter(
    (m) => m.role === 'tool' && m.toolResult === undefined && !!m.toolUseId,
  );

  useEffect(() => {
    const offs: Array<() => void> = [];

    // collab.state — full snapshot, sent on connect and every 2s.
    offs.push(
      client.on('collab.state', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabState['payload'];
        if (p.sessionId === sessionId) {
          setParticipants(p.participants ?? []);
        }
      }),
    );

    // collab.participant.joined — incremental add.
    offs.push(
      client.on('collab.participant.joined', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabParticipantJoined['payload'];
        if (p.sessionId !== sessionId) return;
        setParticipants((prev) => {
          if (prev.some((x) => x.participantId === p.participantId)) return prev;
          return [...prev, { participantId: p.participantId, role: p.role, joinedAt: p.joinedAt }];
        });
      }),
    );

    // collab.participant.left — incremental remove.
    offs.push(
      client.on('collab.participant.left', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabParticipantLeft['payload'];
        if (p.sessionId !== sessionId) return;
        const id = p.participantId;
        setParticipants((prev) => prev.filter((p) => p.participantId !== id));
      }),
    );

    // Surface collab-tagged server errors (e.g. role not available).
    offs.push(
      client.on('error', (msg: WSServerMessage) => {
        const p = msg.payload as WSError['payload'];
        if (p.phase === 'collab') {
          setError(p.message);
          // Optimistically mark as not joined so the user can retry.
          setJoined(false);
        }
      }),
    );

    // Annotation count. We just track the local count of
    // unresolved annotations for a quick "X notes" indicator. The
    // full annotation timeline UI is a follow-up; the count gives
    // immediate visibility ("are people reviewing this?").
    offs.push(
      client.on('collab.annotation.added', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabAnnotationAdded['payload'];
        if (p.sessionId !== sessionId) return;
        if (p.annotation?.resolved) return;
        setOpenAnnotationCount((c) => c + 1);
      }),
    );
    offs.push(
      client.on('collab.annotation.resolved', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabAnnotationResolved['payload'];
        if (p.sessionId !== sessionId) return;
        setOpenAnnotationCount((c) => Math.max(0, c - 1));
      }),
    );

    // Phase 3: pause state. We track the local view of the bus
    // state and surface a small "Paused" chip. The actual pause/
    // resume actions are gated to controller participants.
    offs.push(
      client.on('collab.pause.granted', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabPauseGranted['payload'];
        if (p.sessionId !== sessionId) return;
        setPaused(true);
      }),
    );
    offs.push(
      client.on('collab.pause.released', (msg: WSServerMessage) => {
        const p = msg.payload as WSCollabPauseReleased['payload'];
        if (p.sessionId !== sessionId) return;
        setPaused(false);
      }),
    );

    return () => {
      for (const off of offs) off();
    };
  }, [client, sessionId]);

  const handleJoin = (role: 'observer' | 'annotator' | 'controller' = 'observer'): void => {
    setError(null);
    client.send({ type: 'collab.join', payload: { sessionId, role } });
    setJoined(true);
    setJoinedRole(role);
  };

  const handleRequestPause = (): void => {
    client.send({ type: 'collab.request_pause', payload: { sessionId } });
  };

  const handleResume = (): void => {
    client.send({ type: 'collab.resume', payload: { sessionId } });
  };

  const handleLeave = (): void => {
    client.send({ type: 'collab.leave', payload: { sessionId } });
    setJoined(false);
    setParticipants([]);
  };

  // Phase 3: a controller promotes another participant to controller.
  const handleGrantControl = (toParticipant: string): void => {
    client.send({ type: 'collab.grant_control', payload: { sessionId, toParticipant } });
  };

  // Phase 4: a controller queues a synthetic result for an in-flight tool call.
  // The server-side collabInjectMiddleware splices it in when the agent makes
  // that tool call. Reason is required by the server; default if left blank.
  const handleInjectTool = (): void => {
    if (!injectToolUseId) return;
    client.send({
      type: 'collab.inject_tool',
      payload: {
        sessionId,
        toolUseId: injectToolUseId,
        content: injectContent,
        isError: injectIsError,
        reason: injectReason.trim() || 'controller injection',
      },
    });
    setInjectOpen(false);
    setInjectToolUseId('');
    setInjectContent('');
    setInjectIsError(false);
    setInjectReason('');
  };

  const isController = joined && joinedRole === 'controller';

  // Empty state: nobody watching, no errors.
  if (participants.length === 0 && !error) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md border border-dashed border-border bg-card/40',
          className,
        )}
      >
        <Users className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">No live observers</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleJoin('observer')}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            title="Join as a read-only observer (Phase 1)"
          >
            <LogIn className="w-3 h-3" />
            observer
          </button>
          <button
            type="button"
            onClick={() => handleJoin('annotator')}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
            title="Join as an annotator — leave inline notes on tool calls (Phase 2)"
          >
            <MessageSquareWarning className="w-3 h-3" />
            annotator
          </button>
          <button
            type="button"
            onClick={() => handleJoin('controller')}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 transition-colors"
            title="Join as a controller — can pause the agent loop (Phase 3)"
          >
            <Pause className="w-3 h-3" />
            controller
          </button>
        </div>
      </div>
    );
  }

  // Error state: surface server's reason and let user retry.
  if (error) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-md border border-destructive/50 bg-destructive/10',
          className,
        )}
        role="alert"
      >
        <span className="text-xs text-destructive">Collab: {error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setJoined(false);
          }}
          className="ml-auto text-xs underline text-destructive"
        >
          dismiss
        </button>
      </div>
    );
  }

  // Live state: at least one participant. Show count, live dot, role chips.
  return (
    <div
      className={cn(
        'relative flex items-center gap-2 px-3 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/5',
        className,
      )}
    >
      <span className="relative flex h-2 w-2" aria-label="Live">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <Users className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
        {participants.length} {participants.length === 1 ? 'observer' : 'observers'}
      </span>
      {openAnnotationCount > 0 && (
        <span
          title={`${openAnnotationCount} open annotation(s) — annotators reviewing this session`}
          className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
        >
          <MessageSquareWarning className="w-3 h-3" />
          {openAnnotationCount} note{openAnnotationCount === 1 ? '' : 's'}
        </span>
      )}
      {paused && (
        <span
          title="Agent loop is paused — a controller is reviewing"
          className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40"
        >
          <Pause className="w-3 h-3" />
          paused
        </span>
      )}
      <div className="flex items-center gap-1 ml-2">
        {participants.slice(0, 3).map((p) => (
          <span
            key={p.participantId}
            title={`Joined ${new Date(p.joinedAt).toLocaleTimeString()}`}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          >
            <Eye className="w-3 h-3" />
            {p.role}
            {/* A controller can promote any non-controller participant. */}
            {isController && p.role !== 'controller' && (
              <button
                type="button"
                onClick={() => handleGrantControl(p.participantId)}
                title="Grant control — promote this participant to controller"
                className="ml-0.5 inline-flex items-center rounded hover:bg-emerald-500/20 transition-colors"
              >
                <UserPlus className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {participants.length > 3 && (
          <span className="text-[10px] text-muted-foreground">+{participants.length - 3}</span>
        )}
      </div>
      {isController && (
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setInjectOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 transition-colors"
            title="Inject a synthetic result for an in-flight tool call"
          >
            <Syringe className="w-3 h-3" />
            Inject
          </button>
          {paused ? (
            <button
              type="button"
              onClick={handleResume}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 transition-colors"
              title="Resume the agent loop"
            >
              <Play className="w-3 h-3" />
              Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRequestPause}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
              title="Pause the agent before the next tool call"
            >
              <Pause className="w-3 h-3" />
              Pause agent
            </button>
          )}
        </div>
      )}
      {joined && joinedRole !== 'controller' && (
        <button
          type="button"
          onClick={handleLeave}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
          title="Leave the observer session"
        >
          <LogOut className="w-3 h-3" />
          Leave
        </button>
      )}

      {/* Phase 4 — controller-only inject-tool form (absolute popover below the bar). */}
      {isController && injectOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 flex flex-col gap-2 p-3 rounded-md border border-sky-500/40 bg-card shadow-lg text-xs">
          <div className="flex items-center gap-2">
            <Syringe className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span className="font-medium">Inject tool result</span>
            <button
              type="button"
              onClick={() => setInjectOpen(false)}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              close
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Target tool_use id</span>
            {/* Input + datalist: autocompletes in-flight calls AND accepts any
                tool_use id (pre-queue an injection for a call not yet made). */}
            <input
              list="collab-inject-tools"
              value={injectToolUseId}
              onChange={(e) => setInjectToolUseId(e.target.value)}
              placeholder="pick an in-flight call or type a tool_use id"
              className="px-2 py-1 rounded border border-border bg-background font-mono"
            />
            <datalist id="collab-inject-tools">
              {pendingTools.map((m) => {
                const snip =
                  m.toolInput === undefined ? '' : ` — ${JSON.stringify(m.toolInput).slice(0, 40)}`;
                return (
                  <option key={m.toolUseId} value={m.toolUseId}>
                    {m.toolName ?? 'tool'}
                    {snip}
                  </option>
                );
              })}
            </datalist>
            {pendingTools.length === 0 && (
              <span className="text-[10px] text-muted-foreground">
                No in-flight tool calls — type a tool_use id to pre-queue, or pause the agent first.
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Result content</span>
            <textarea
              value={injectContent}
              onChange={(e) => setInjectContent(e.target.value)}
              rows={3}
              placeholder="Synthetic tool result fed to the agent in place of running the tool"
              className="px-2 py-1 rounded border border-border bg-background font-mono"
            />
          </label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={injectIsError}
                onChange={(e) => setInjectIsError(e.target.checked)}
              />
              <span>mark as error</span>
            </label>
            <input
              type="text"
              value={injectReason}
              onChange={(e) => setInjectReason(e.target.value)}
              placeholder="reason (audit log)"
              className="flex-1 px-2 py-1 rounded border border-border bg-background"
            />
          </div>
          <button
            type="button"
            onClick={handleInjectTool}
            disabled={!injectToolUseId}
            className="self-end inline-flex items-center gap-1 text-xs px-3 py-1 rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Syringe className="w-3 h-3" />
            Queue injection
          </button>
        </div>
      )}
    </div>
  );
}
