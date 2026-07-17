import type { Director, FleetChatVerbosity, FleetEvent } from '@wrongstack/core';
import { useEffect, useRef } from 'react';
import type { Action, State } from '../app-reducer.js';
import { stripNextStepsBlock } from '@wrongstack/tools/next-steps';
import { addTool, formatToolSummary, newToolAgg, type ToolAgg } from './fleet-chat-coalescer.js';

const FLUSH_MS = 150;
const STREAM_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue'];

function labelFor(
  labelsRef: React.MutableRefObject<Map<string, { label: string; color: string }>>,
  id: string,
  name?: string | undefined,
): { label: string; color: string } {
  const labels = labelsRef.current;
  const existing = labels.get(id);
  if (existing) return existing;
  const n = labels.size + 1;
  const label = name && name !== id ? name : `AGENT#${n}`;
  const color = STREAM_COLORS[(n - 1) % STREAM_COLORS.length] ?? 'cyan';
  const next = { label, color };
  labels.set(id, next);
  return next;
}

export interface UseDirectorFleetBridgeOptions {
  director: Director | null;
  dispatch: React.Dispatch<Action>;
  stateRef: React.MutableRefObject<State>;
  chatMode: FleetChatVerbosity;
  /** Session generation ref — bumped on /clear so post-clear events from
   *  subagents spawned before the bump are discarded. */
  sessionGenerationRef?: { current: number } | undefined;
}

/**
 * Director FleetBus -> TUI state bridge.
 *
 * High-frequency text deltas are batched so subagent streams do not cause a
 * render per token. The hook keeps live refs for settings/state that should not
 * force FleetBus re-subscription.
 *
 * Chat-history gating (`chatMode`):
 * - 'full'    — every tool call gets its own 🔧 line, interim 💬 text commits
 *               at each tool boundary (legacy behavior).
 * - 'compact' — tool calls fold into a per-agent {@link ToolAgg} and the
 *               whole turn commits as ONE entry (💬 text with the tool
 *               summary as `detail`, or a lone 🔧 summary) at session end /
 *               task completion / teardown.
 * - 'off'     — no subagent chat entries at all; provider errors/retries
 *               still surface as warn/error entries.
 * The fleet table (F2/F3) is fed in EVERY mode. The mode is read at commit
 * time via a live ref; a mid-burst flip applies from the next boundary on.
 * `/clear` mid-run is safe: buffers live inside the effect, and subagent
 * entries are never rehydrated on resume.
 */
export function useDirectorFleetBridge({
  director,
  dispatch,
  stateRef,
  chatMode,
  sessionGenerationRef,
}: UseDirectorFleetBridgeOptions): void {
  const labelsRef = useRef<Map<string, { label: string; color: string }>>(new Map());
  const chatModeRef = useRef(chatMode);
  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);

  useEffect(() => {
    const d = director;
    if (!d) return;

    // Track the session generation at which each subagent was first seen.
    // After /clear bumps sessionGenerationRef, events for subagents spawned
    // before the bump are discarded — their enq/dispatch calls would
    // re-pollute the cleared chat and fleet table.
    const spawnGen = new Map<string, number>();
    const isLive = (subagentId: string): boolean => {
      if (!sessionGenerationRef) return true;
      const gen = spawnGen.get(subagentId);
      if (gen === undefined) return true; // unknown agent — allow
      return gen === sessionGenerationRef.current;
    };

    const batch: Action[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    const flushBatch = () => {
      batchTimer = null;
      if (batch.length === 0) return;
      dispatch({ type: 'fleetBatch', actions: batch.splice(0, batch.length) });
    };
    const enq = (action: Action) => {
      batch.push(action);
      if (batch.length >= 256) {
        if (batchTimer) clearTimeout(batchTimer);
        flushBatch();
        return;
      }
      if (!batchTimer) batchTimer = setTimeout(flushBatch, FLUSH_MS);
    };

    // Live-panel buffer. Periodically flushed deltas feed the FleetPanel's
    // rolling preview (recentMessages), which is a short, transient view —
    // cleared on every flush so it only reflects the most recent burst.
    const streamBuf = new Map<string, string>();
    let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushStreamBufs = () => {
      for (const [id, text] of streamBuf) {
        // Strip <nextsteps> blocks from subagent output — suggestions belong
        // to the main assistant, not subagent results. This prevents raw XML
        // tags from appearing as literal text in the fleet panel.
        const cleaned = stripNextStepsBlock(text);
        if (!cleaned) continue;
        enq({ type: 'fleetMessage', id, text: cleaned });
      }
      streamBuf.clear();
      streamFlushTimer = null;
    };

    // Chat-history buffers. Unlike streamBuf these accumulate across the whole
    // turn and are NOT cleared on the periodic flush — they are committed to
    // ONE chat entry only at a turn boundary (in full mode: a tool call,
    // session end, or task completion; in compact mode: session end / task
    // completion / teardown only, so the whole turn stays one bubble).
    // historyBuf holds the assistant text; toolAgg holds the compact-mode
    // per-agent tool aggregation.
    const historyBuf = new Map<string, string>();
    const toolAgg = new Map<string, ToolAgg>();
    const finalizeTurn = (id: string): void => {
      // Skip committing buffered text for subagents spawned before /clear.
      if (!isLive(id)) {
        historyBuf.delete(id);
        toolAgg.delete(id);
        return;
      }
      const text = historyBuf.get(id);
      historyBuf.delete(id);
      const agg = toolAgg.get(id);
      toolAgg.delete(id);
      // Mode is read at COMMIT time: a mid-burst mode flip applies to the
      // pending buffers (switching to 'off' drops the tail — intended).
      const mode = chatModeRef.current;
      if (mode === 'off') return;
      const cleaned = text ? stripNextStepsBlock(text).trim() : '';
      const summary = agg ? formatToolSummary(agg) : '';
      if (!cleaned && !summary) return;
      const label = labelFor(labelsRef, id);
      const base = {
        kind: 'subagent' as const,
        agentLabel: label.label,
        agentColor: label.color,
      };
      if (cleaned) {
        // Single-line text: tool summary rides the same line as dim `detail`.
        // Multi-line text: `detail` renders after line 1 (mid-message), so
        // append the summary as a trailing indented line instead.
        const multiline = cleaned.includes('\n');
        enq({
          type: 'addEntry',
          entry: !summary
            ? { ...base, icon: '💬', text: cleaned }
            : multiline
              ? { ...base, icon: '💬', text: `${cleaned}\n🔧 ${summary}` }
              : { ...base, icon: '💬', text: cleaned, detail: `🔧 ${summary}` },
        });
      } else {
        // Tool-only turn (compact mode) — a lone 🔧 summary line.
        enq({ type: 'addEntry', entry: { ...base, icon: '🔧', text: summary } });
      }
    };

    const status = d.status();
    for (const subagent of status.subagents) {
      spawnGen.set(subagent.id, sessionGenerationRef?.current ?? 0);
      const meta = d.getSubagentMeta(subagent.id);
      dispatch({
        type: 'fleetSpawn',
        id: subagent.id,
        name: meta?.name ?? subagent.name,
        provider: meta?.provider,
        model: meta?.model,
      });
      labelFor(labelsRef, subagent.id, meta?.name ?? subagent.name);
    }
    dispatch({
      type: 'fleetCost',
      cost: d.snapshot().total.cost,
      input: d.snapshot().total.input,
      output: d.snapshot().total.output,
      perAgent: d.snapshot().perSubagent,
    });

    const seen = new Set(status.subagents.map((subagent) => subagent.id));
    const pending = new Map<string, string>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const doFlush = () => {
      for (const [id, text] of pending) {
        if (text) enq({ type: 'fleetDelta', id, text });
      }
      pending.clear();
      flushTimer = null;
    };

    const offFleet = d.fleet.onAny((event: FleetEvent) => {
      const enqueue = enq;
      const fresh = !seen.has(event.subagentId);
      if (fresh) {
        seen.add(event.subagentId);
        spawnGen.set(event.subagentId, sessionGenerationRef?.current ?? 0);
        const meta = d.getSubagentMeta(event.subagentId);
        enqueue({
          type: 'fleetSpawn',
          id: event.subagentId,
          name: meta?.name,
          provider: meta?.provider,
          model: meta?.model,
        });
        const label = labelFor(labelsRef, event.subagentId, meta?.name);
        if (chatModeRef.current !== 'off') {
          const where =
            meta?.provider && meta?.model ? `${meta.provider}/${meta.model}` : 'spawned';
          enqueue({
            type: 'addEntry',
            entry: {
              kind: 'subagent',
              agentLabel: label.label,
              agentColor: label.color,
              icon: '▶',
              text: where,
            },
          });
        }
      }

      // Discard events from subagents spawned before the last /clear.
      if (!isLive(event.subagentId)) return;

      switch (event.type) {
        case 'subagent.removed':
          seen.delete(event.subagentId);
          labelsRef.current.delete(event.subagentId);
          enqueue({ type: 'fleetRemove', id: event.subagentId });
          break;
        case 'iteration.started':
        case 'session.started':
          enqueue({ type: 'fleetStart', id: event.subagentId });
          break;
        case 'provider.text_delta': {
          const payload = event.payload as { text?: string | undefined };
          if (payload?.text) {
            pending.set(event.subagentId, (pending.get(event.subagentId) ?? '') + payload.text);
            if (!flushTimer) flushTimer = setTimeout(doFlush, FLUSH_MS);
            streamBuf.set(
              event.subagentId,
              (streamBuf.get(event.subagentId) ?? '') + payload.text,
            );
            // Accumulate the full assistant message for the chat-history bubble.
            // Committed as one entry at the next turn boundary (see finalizeHistory).
            historyBuf.set(
              event.subagentId,
              (historyBuf.get(event.subagentId) ?? '') + payload.text,
            );
            if (streamFlushTimer) clearTimeout(streamFlushTimer);
            streamFlushTimer = setTimeout(flushStreamBufs, FLUSH_MS * 4);
          }
          break;
        }
        case 'provider.thinking_delta': {
          const payload = event.payload as { text?: string | undefined };
          if (payload?.text) {
            streamBuf.set(
              event.subagentId,
              (streamBuf.get(event.subagentId) ?? '') + payload.text,
            );
            if (streamFlushTimer) clearTimeout(streamFlushTimer);
            streamFlushTimer = setTimeout(flushStreamBufs, FLUSH_MS * 4);
          }
          break;
        }
        case 'provider.retry': {
          const payload = event.payload as {
            attempt?: number | undefined;
            delayMs?: number | undefined;
          };
          enqueue({
            type: 'addEntry',
            entry: {
              kind: 'warn',
              text: `subagent retry ${payload?.attempt ?? '?'}${payload?.delayMs ? ` (${payload.delayMs}ms)` : ''}`,
            },
          });
          break;
        }
        case 'provider.error': {
          const payload = event.payload as { description?: string | undefined };
          enqueue({
            type: 'addEntry',
            entry: {
              kind: 'error',
              text: `subagent error${payload?.description ? `: ${payload.description}` : ''}`,
            },
          });
          break;
        }
        case 'tool.started': {
          const payload = event.payload as { name?: string | undefined };
          if (payload?.name) {
            // Full mode: commit any assistant text that preceded this tool
            // call as one complete bubble, so the tool entry renders
            // separately after it. Compact mode keeps accumulating — the
            // whole turn commits as ONE bubble at the next real boundary
            // (flushing here would re-fragment the turn).
            if (chatModeRef.current === 'full') finalizeTurn(event.subagentId);
            enqueue({ type: 'fleetToolStart', id: event.subagentId, name: payload.name });
          }
          break;
        }
        case 'tool.executed': {
          const payload = event.payload as {
            name?: string | undefined;
            ok?: boolean | undefined;
            durationMs?: number | undefined;
            outputBytes?: number | undefined;
            outputLines?: number | undefined;
          };
          enqueue({
            type: 'fleetTool',
            id: event.subagentId,
            name: payload?.name,
            ok: payload?.ok,
            durationMs: payload?.durationMs,
            outputBytes: payload?.outputBytes,
            outputLines: payload?.outputLines,
          });
          enqueue({ type: 'fleetToolEnd', id: event.subagentId });
          if (payload?.name) {
            const mode = chatModeRef.current;
            if (mode === 'full') {
              const label = labelFor(labelsRef, event.subagentId);
              enqueue({
                type: 'addEntry',
                entry: {
                  kind: 'subagent',
                  agentLabel: label.label,
                  agentColor: label.color,
                  icon: '🔧',
                  text: `→ ${payload.name} ${payload.ok === false ? '✗' : '✓'}${payload.durationMs != null ? ` (${payload.durationMs}ms)` : ''}`,
                },
              });
            } else if (mode === 'compact') {
              let agg = toolAgg.get(event.subagentId);
              if (!agg) {
                agg = newToolAgg();
                toolAgg.set(event.subagentId, agg);
              }
              addTool(agg, payload.name, payload.ok, payload.durationMs);
            }
          }
          break;
        }
        case 'provider.response':
          enqueue({
            type: 'fleetCost',
            cost: d.snapshot().total.cost,
            input: d.snapshot().total.input,
            output: d.snapshot().total.output,
            perAgent: d.snapshot().perSubagent,
          });
          break;
        case 'session.ended':
          // Commit the subagent's final assistant message (and, in compact
          // mode, the accumulated tool summary) as one entry.
          finalizeTurn(event.subagentId);
          break;
        case 'compaction.fired':
          if (chatModeRef.current !== 'off') {
            enqueue({
              type: 'addEntry',
              entry: { kind: 'info', text: 'subagent compaction triggered' },
            });
          }
          break;
        case 'compaction.failed':
          // warn-level: failures surface in every mode, including 'off'.
          enqueue({
            type: 'addEntry',
            entry: { kind: 'warn', text: 'subagent compaction failed' },
          });
          break;
        case 'token.threshold':
          if (chatModeRef.current === 'full') {
            enqueue({
              type: 'addEntry',
              entry: { kind: 'info', text: 'subagent token threshold reached' },
            });
          }
          break;
        case 'budget.threshold_reached': {
          const payload = event.payload as {
            kind?: string | undefined;
            used?: number | undefined;
            limit?: number | undefined;
          };
          enqueue({
            type: 'fleetBudgetWarning',
            id: event.subagentId,
            kind: payload?.kind ?? 'unknown',
            used: payload?.used ?? 0,
            limit: payload?.limit ?? 0,
          });
          break;
        }
        case 'budget.extended': {
          const payload = event.payload as { totalExtensions?: number | undefined };
          if (payload?.totalExtensions !== undefined) {
            enqueue({
              type: 'fleetBudgetExtended',
              id: event.subagentId,
              totalExtensions: payload.totalExtensions,
            });
          }
          break;
        }
        case 'ctx.pct': {
          const payload = event.payload as {
            load?: number | undefined;
            tokens?: number | undefined;
            maxContext?: number | undefined;
            ctxCost?: number | undefined;
          };
          if (payload?.load !== undefined) {
            enqueue({
              type: 'fleetCtxPct',
              id: event.subagentId,
              load: payload.load,
              tokens: payload.tokens ?? 0,
              maxContext: payload.maxContext ?? 0,
              ctxCost: payload.ctxCost,
            });
          }
          break;
        }
        case 'bug.found':
          handleCollabBugFound(event, enqueue, stateRef);
          break;
        case 'refactor.plan':
          handleCollabPlan(event, enqueue, stateRef);
          break;
        case 'critic.evaluation':
          handleCollabEvaluation(event, enqueue, stateRef);
          break;
        case 'collab.session_done':
          handleCollabDone(event, enqueue, stateRef);
          break;
      }
    });

    const offDone = d.on('task.completed', (payload) => {
      // Discard completions from subagents spawned before the last /clear.
      if (!isLive(payload.result.subagentId)) return;
      dispatch({
        type: 'fleetDone',
        id: payload.result.subagentId,
        status: payload.result.status,
        iterations: payload.result.iterations,
        toolCalls: payload.result.toolCalls,
      });
      dispatch({
        type: 'fleetCost',
        cost: d.snapshot().total.cost,
        input: d.snapshot().total.input,
        output: d.snapshot().total.output,
        perAgent: d.snapshot().perSubagent,
      });
      // Commit any unflushed assistant text / tool summary for this subagent
      // before it's done. task.completed fires for failed and timed-out tasks
      // too, so a crashed agent's pending burst still flushes here.
      finalizeTurn(payload.result.subagentId);
      if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        flushStreamBufs();
      }
      if (batchTimer) clearTimeout(batchTimer);
      flushBatch();
    });

    return () => {
      offFleet();
      offDone();
      if (flushTimer) clearTimeout(flushTimer);
      doFlush();
      if (streamFlushTimer) clearTimeout(streamFlushTimer);
      flushStreamBufs();
      // Commit anything still buffered for any subagent on teardown — union
      // of both buffers, because a compact-mode agent may have tool calls
      // but no text (tool-only turn).
      for (const id of new Set([...historyBuf.keys(), ...toolAgg.keys()])) finalizeTurn(id);
      if (batchTimer) clearTimeout(batchTimer);
      flushBatch();
    };
  }, [director, dispatch, stateRef, sessionGenerationRef]);
}

function collabRole(subagentId: string): string | null {
  if (subagentId.includes('bug-hunter')) return 'bug-hunter';
  if (subagentId.includes('refactor-planner')) return 'refactor-planner';
  if (subagentId.includes('critic')) return 'critic';
  return null;
}

function collabSessionId(subagentId: string): string {
  return subagentId.split('-').slice(1).join('-') || subagentId;
}

function handleCollabBugFound(
  event: FleetEvent,
  dispatch: (action: Action) => void,
  stateRef: React.MutableRefObject<State>,
): void {
  const role = collabRole(event.subagentId);
  const collabSession = stateRef.current.collabSession;
  if (!role && !collabSession) return;
  if (!collabSession) {
    dispatch({
      type: 'collabSubagentSpawned',
      subagentId: event.subagentId,
      role: role ?? 'unknown',
    });
  }
  const payload = event.payload as {
    finding?: {
      id?: string | undefined;
      severity?: string | undefined;
      description?: string | undefined;
    };
  };
  if (!payload?.finding) return;
  dispatch({
    type: 'collabBugFound',
    sessionId: collabSessionId(event.subagentId),
    bugId: payload.finding.id ?? 'unknown',
    severity: payload.finding.severity ?? 'unknown',
    description: payload.finding.description ?? '',
  });
}

function handleCollabPlan(
  event: FleetEvent,
  dispatch: (action: Action) => void,
  stateRef: React.MutableRefObject<State>,
): void {
  if (!stateRef.current.collabSession) return;
  const payload = event.payload as {
    plan?: {
      id?: string | undefined;
      riskScore?: string | undefined;
      phases?: unknown[] | undefined;
    };
  };
  if (!payload?.plan) return;
  dispatch({
    type: 'collabPlanEmitted',
    sessionId: collabSessionId(event.subagentId),
    planId: payload.plan.id ?? 'unknown',
    riskScore: payload.plan.riskScore ?? 'unknown',
    phaseCount: payload.plan.phases?.length ?? 0,
  });
}

function handleCollabEvaluation(
  event: FleetEvent,
  dispatch: (action: Action) => void,
  stateRef: React.MutableRefObject<State>,
): void {
  if (!stateRef.current.collabSession) return;
  const payload = event.payload as {
    evaluation?: {
      id?: string | undefined;
      verdict?: string | undefined;
      score?: number | undefined;
    };
  };
  if (!payload?.evaluation) return;
  dispatch({
    type: 'collabEvalComplete',
    sessionId: collabSessionId(event.subagentId),
    evalId: payload.evaluation.id ?? 'unknown',
    verdict: payload.evaluation.verdict ?? 'unknown',
    score: payload.evaluation.score ?? 0,
  });
}

function handleCollabDone(
  event: FleetEvent,
  dispatch: (action: Action) => void,
  stateRef: React.MutableRefObject<State>,
): void {
  const collabSession = stateRef.current.collabSession;
  if (!collabSession) return;
  const payload = event.payload as {
    report?: {
      sessionId?: string | undefined;
      overallVerdict?: 'approve' | 'needs_revision' | 'reject' | undefined;
    };
  };
  if (!payload?.report) return;
  dispatch({
    type: 'collabSessionDone',
    sessionId: payload.report.sessionId ?? collabSession.sessionId ?? 'unknown',
    verdict: payload.report.overallVerdict ?? 'needs_revision',
  });
}
