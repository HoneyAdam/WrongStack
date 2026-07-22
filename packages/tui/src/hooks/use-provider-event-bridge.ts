import { formatTodosList } from '@wrongstack/core/utils';
import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
} from 'react';
import type { AppProps } from '../app-props.js';
import type { Action } from '../app-state.js';
import {
  applyMemoryContextSnapshot,
  applyMemoryInjectorRun,
  emptyMemoryContextMonitor,
  memoryEventMatchesSession,
  type MemoryContextMonitorState,
} from '../memory-context-monitor.js';
import { memoryLifecycleEntry } from '../memory-lifecycle-entry.js';
import { contentBlocksText } from '../rehydrate-history.js';

interface ProviderEventBridgeOptions {
  events: AppProps['events'];
  agent: AppProps['agent'];
  dispatch: Dispatch<Action>;
  streamingTextRef: MutableRefObject<string>;
  streamSegmentsRef: MutableRefObject<Array<{ kind: 'assistant' | 'thinking'; text: string }>>;
  pendingDeltaRef: MutableRefObject<string>;
  flushTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  sessionGenerationRef: MutableRefObject<number>;
  activeRunGenerationRef: MutableRefObject<number>;
  assistantCommittedThisRunRef: MutableRefObject<boolean>;
  setMemoryContextMonitor: Dispatch<SetStateAction<MemoryContextMonitorState>>;
}

/** Bridges provider/tool/delegate/memory events into render-neutral TUI actions. */
export function useProviderEventBridge({
  events,
  agent,
  dispatch,
  streamingTextRef,
  streamSegmentsRef,
  pendingDeltaRef,
  flushTimerRef,
  sessionGenerationRef,
  activeRunGenerationRef,
  assistantCommittedThisRunRef,
  setMemoryContextMonitor,
}: ProviderEventBridgeOptions): void {
  // Subscribe to provider streaming events.
  useEffect(() => {
    // Throttle stream delta DISPATCHES to reduce flicker — we batch into
    // React state at ~10fps. The full text is also written into
    // streamingTextRef synchronously on every delta, so `runBlocks` can
    // read the complete stream when `agent.run` returns without racing
    // the throttle's last unflushed batch.
    const FLUSH_MS = 100;
    const appendStreamSegment = (kind: 'assistant' | 'thinking', text: string) => {
      const last = streamSegmentsRef.current.at(-1);
      if (last?.kind === kind) {
        last.text += text;
      } else {
        streamSegmentsRef.current.push({ kind, text });
      }
    };
    const flush = () => {
      if (pendingDeltaRef.current) {
        dispatch({ type: 'streamDelta', delta: pendingDeltaRef.current });
        pendingDeltaRef.current = '';
      }
      flushTimerRef.current = null;
    };
    const offDelta = events.on('provider.text_delta', (e) => {
      if (activeRunGenerationRef.current !== sessionGenerationRef.current) return;
      // Strip any bracketed-paste DCS sequences that some providers echo
      // into the stream. They are invisible in a real terminal but appear as
      // junk text if Ink's raw rendering catches them. The ESC byte is
      // matched optionally — a stripped/split ESC would otherwise leave a
      // bare `[200~` in the rendered text (same failure as the input path).
      const text = e.text.replace(/\x1b?\[200~|\x1b?\[201~/g, '');
      streamingTextRef.current += text;
      pendingDeltaRef.current += text;
      appendStreamSegment('assistant', text);
      if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flush, FLUSH_MS);
    });
    const offThinking = events.on('provider.thinking_delta', (e) => {
      if (activeRunGenerationRef.current !== sessionGenerationRef.current) return;
      // Reasoning/thinking deltas (Codex reasoning summaries, Anthropic
      // extended thinking, OpenAI-compatible <think> blocks). Buffered in
      // stream-order alongside assistant prose so the per-iteration flush
      // commits them as a THINKING entry BEFORE the next tool entry, and
      // the live tail mirrors whatever segment type is currently streaming.
      const text = e.text.replace(/\x1b?\[200~|\x1b?\[201~/g, '');
      appendStreamSegment('thinking', text);
      pendingDeltaRef.current += text;
      if (!flushTimerRef.current) flushTimerRef.current = setTimeout(flush, FLUSH_MS);
    });
    const offToolStart = events.on('tool.started', (e) => {
      dispatch({ type: 'toolStarted', id: e.id, name: e.name });
      dispatch({ type: 'leaderToolStart', name: e.name });
    });
    const offIterStart = events.on('iteration.started', () => {
      dispatch({ type: 'leaderIterStart' });
    });
    const offIterEnd = events.on('iteration.completed', () => {
      dispatch({ type: 'leaderIterEnd' });
    });
    const offToolProgress = events.on('tool.progress', (e) => {
      // Only `partial_output` becomes the live tail. Other event kinds
      // (`log`, `warning`, `metric`, `file_changed`) are deliberately not
      // rendered here — they pile up too fast and would steal screen real
      // estate from the assistant text. They still flow through EventBus
      // for observability/metrics consumers.
      if (e.event.type !== 'partial_output' || !e.event.text) return;
      dispatch({
        type: 'toolStreamAppend',
        toolUseId: e.id,
        name: e.name,
        text: e.event.text,
        startedAt: Date.now(),
      });
    });
    const offTool = events.on('tool.executed', (e) => {
      // `delegate` renders its own readable start/finish lines via the
      // delegate.started / delegate.completed events below — skip the
      // generic tool entry so history doesn't also show the big JSON blob.
      if (e.name !== 'delegate') {
        dispatch({
          type: 'addEntry',
          entry: {
            kind: 'tool',
            name: e.name,
            durationMs: e.durationMs,
            ok: e.ok,
            input: e.input,
            output: e.output,
            // Real model-visible sizes — forwarded so the size chip beside
            // the tool header can show what the model paid for instead of
            // the misleading preview-byte count we used to surface.
            outputBytes: e.outputBytes,
            outputTokens: e.outputTokens,
            outputLines: e.outputLines,
          },
        });
      }
      // `tool.executed` has no tool_use id; the reducer falls back to
      // clearing the oldest running entry that matches this name.
      dispatch({ type: 'toolEnded', name: e.name });
      // Clear the live tail for this tool — the final entry is now in
      // retained history, so there is no need to keep mirroring it below.
      dispatch({ type: 'toolStreamClear', name: e.name });
      // Mirror into the leader-only counter so the AgentsMonitor's LEADER
      // row stays live even when no subagents exist.
      dispatch({ type: 'leaderToolEnd', name: e.name, ok: e.ok, durationMs: e.durationMs });
      // Echo the current todo list into chat whenever the `todo` tool
      // mutates ctx.todos — same format as `/todos list`. Snapshotted from
      // agent.ctx.todos at this point (the tool executor has already
      // applied the mutation by the time tool.executed fires).
      if (e.ok && e.name === 'todo') {
        dispatch({
          type: 'addEntry',
          entry: { kind: 'info', text: formatTodosList(agent.ctx.todos) },
        });
      }
    });
    const offRetry = events.on('provider.retry', (e) => {
      const secs = (e.delayMs / 1000).toFixed(e.delayMs >= 1000 ? 1 : 2);
      dispatch({
        type: 'addEntry',
        entry: { kind: 'warn', text: `⟳ retry ${e.attempt} in ${secs}s — ${e.description}` },
      });
    });
    const offProvErr = events.on('provider.error', (e) => {
      dispatch({
        type: 'addEntry',
        entry: { kind: 'error', text: e.description },
      });
    });
    // Fallback hop — the chain rotated to a working model after the primary's
    // retries were exhausted. Surface which model is now answering.
    const offFallback = events.on('provider.fallback', (e) => {
      const fallbackEvent = e as typeof e & {
        contextWindowWarning?:
          | { fromMaxContext: number; toMaxContext: number; currentTokens?: number | undefined }
          | undefined;
      };
      const contextWarning = fallbackEvent.contextWindowWarning
        ? `\n⚠ smaller context window: ${fallbackEvent.contextWindowWarning.fromMaxContext.toLocaleString('en-US')} → ${fallbackEvent.contextWindowWarning.toMaxContext.toLocaleString('en-US')} tokens${
            fallbackEvent.contextWindowWarning.currentTokens
              ? `; current request ≈ ${fallbackEvent.contextWindowWarning.currentTokens.toLocaleString('en-US')} tokens (${Math.round((fallbackEvent.contextWindowWarning.currentTokens / fallbackEvent.contextWindowWarning.toMaxContext) * 100)}% of new window)`
              : ''
          }`
        : '';
      dispatch({
        type: 'addEntry',
        entry: {
          kind: 'warn',
          text: `↻ rate-limited (${e.status}) — switched to ${e.to.providerId}/${e.to.model}${contextWarning}`,
        },
      });
    });
    // Per-iteration text flush. Without this, the entire run buffers all text
    // deltas in the live tail box and dumps them into history as ONE assistant
    // entry only after `agent.run()` returns. Tool results, in contrast, land
    // in history immediately via `tool.executed` — so a multi-iteration turn
    // renders as "all tools, then a wall of text" instead of the natural
    // text → tool → text → tool interleaving that matches the actual stream.
    //
    // We hook `provider.response` (fires once per LLM call, both for
    // intermediate `tool_use` stops and the final `end_turn`) and commit
    // whatever has accumulated in `streamingTextRef` as an assistant history
    // entry. The next iteration's deltas start a fresh buffer. `runBlocks`
    // becomes purely the loop driver — it no longer adds the assistant entry,
    // since the per-iteration flushes have already done so.
    const offProvResp = events.on('provider.response', (e) => {
      if (activeRunGenerationRef.current !== sessionGenerationRef.current) return;
      const text = streamingTextRef.current;
      const segments = streamSegmentsRef.current;
      const fallbackText = contentBlocksText(e.content);
      streamingTextRef.current = '';
      streamSegmentsRef.current = [];
      pendingDeltaRef.current = '';
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      dispatch({ type: 'streamReset' });
      // Commit buffered segments in stream order. Each contiguous run of the
      // same kind becomes one history entry, so a turn that streamed
      // thinking → text → tool lands as THINKING then ASSISTANT before the
      // tool entry — matching what the user saw live. When no thinking was
      // emitted the segments array is a single assistant entry, preserving
      // the original single-commit behavior.
      for (const seg of segments) {
        if (seg.text.trim()) {
          dispatch({ type: 'addEntry', entry: { kind: seg.kind, text: seg.text } });
          // Only assistant prose counts as "the reply was shown" — a
          // thinking-only turn must not suppress the finalText recovery.
          if (seg.kind === 'assistant') assistantCommittedThisRunRef.current = true;
        }
      }
      // Fallback: if segments were empty but streamingTextRef had content
      // (legacy path / segments not populated), still commit as assistant.
      if (segments.length === 0 && text.trim()) {
        dispatch({ type: 'addEntry', entry: { kind: 'assistant', text } });
        assistantCommittedThisRunRef.current = true;
      } else if (segments.length === 0 && fallbackText.trim()) {
        dispatch({ type: 'addEntry', entry: { kind: 'assistant', text: fallbackText } });
        assistantCommittedThisRunRef.current = true;
      }
    });
    const offConfirmNeeded = events.on('tool.confirm_needed', (e) => {
      // Only show the ConfirmPrompt component — no duplicate history entry needed.
      // The full ConfirmPrompt with y/n/a/d keys is rendered below;
      // the history placeholder was redundant.
      dispatch({
        type: 'confirmOpen',
        info: {
          toolUseId: e.toolUseId,
          toolName: e.tool.name,
          input: e.input,
          suggestedPattern: e.suggestedPattern,
          resolve: e.resolve,
          destructive: e.riskTier === 'destructive' || e.decisionSource === 'yolo_destructive',
          boundaryReason: e.boundaryReason,
        },
      });
    });
    const offTrustPersisted = events.on('trust.persisted', (e) => {
      const icon = e.decision === 'always' ? '✓' : '✗';
      const label = e.decision === 'always' ? 'always allowed' : 'denied';
      dispatch({
        type: 'addEntry',
        entry: {
          kind: 'info',
          text: `${icon} ${label}: ${e.tool}(${e.pattern})`,
        },
      });
    });
    // `delegate` lifecycle — render a "started" line up front (so the
    // minutes-long subagent wait doesn't look idle) and a humanized result
    // line on completion. These replace the suppressed generic tool entry.
    const offDelegateStart = events.on('delegate.started', (e) => {
      const task = e.task.length > 100 ? `${e.task.slice(0, 99)}…` : e.task;
      dispatch({
        type: 'addEntry',
        entry: {
          kind: 'subagent',
          agentLabel: e.target,
          agentColor: 'magenta',
          icon: '🤝',
          text: 'delegating',
          detail: task,
        },
      });
    });
    const offDelegateDone = events.on('delegate.completed', (e) => {
      const cost = e.costUsd && e.costUsd > 0 ? `$${e.costUsd.toFixed(4)}` : undefined;
      dispatch({
        type: 'addEntry',
        entry: {
          kind: 'subagent',
          agentLabel: e.target,
          agentColor: e.ok ? 'green' : 'red',
          icon: e.ok ? '✓' : '✗',
          text: e.summary,
          detail: cost,
        },
      });
    });
    const offMemoryStale = events.on('memory.staled', (e) => {
      dispatch({
        type: 'addEntry',
        entry: { kind: 'warn', text: `Super Memory stale: ${e.memoryId} — ${e.reason}` },
      });
    });
    const offMemoryContradicted = events.on('memory.contradicted', (e) => {
      dispatch({
        type: 'addEntry',
        entry: { kind: 'warn', text: `Super Memory contradicted: ${e.memoryId}` },
      });
    });
    const offMemoryHygiene = events.on('memory.hygiene_completed', (e) => {
      dispatch({
        type: 'addEntry',
        entry: {
          kind: 'info',
          text: `Super Memory hygiene: ${e.examined} examined, ${e.deduplicated} deduplicated, ${e.staled} stale, ${e.archived} archived.`,
        },
      });
    });
    // Use the pattern API at the workspace package boundary: the running core
    // already emits this named event, while TUI may typecheck against the last
    // built core declarations until the next full workspace build.
    const offMemoryInjector = events.onPattern('memory.injector_run', (_event, payload) => {
      const e = payload as {
        outcome: 'injected' | 'empty' | 'error';
        trigger: string;
        candidates: number;
        contextPressure: number;
        injectedChars: number;
        error?: string | undefined;
        rejected: Record<
          'duplicate' | 'belowScore' | 'alreadyVisible' | 'cooldown' | 'budget',
          number
        >;
        activated: Array<{
          id: string;
          kind: string;
          text: string;
          score: number;
          relationStrength: number;
          anchors: string[];
          tags: string[];
          activationReasons: string[];
          importance: number;
          confidence: number;
          freshness: number;
          persistence: string;
        }>;
        injected: Array<{ id: string }>;
        sessionId?: string | undefined;
      };
      if (!memoryEventMatchesSession(e, agent.ctx.session.id)) return;
      setMemoryContextMonitor((current) =>
        applyMemoryInjectorRun(current, e as unknown as Record<string, unknown>),
      );
    });
    const offMemoryContextSnapshot = events.onPattern(
      'memory.context_snapshot',
      (_event, payload) => {
        if (!memoryEventMatchesSession(payload, agent.ctx.session.id)) return;
        setMemoryContextMonitor((current) =>
          applyMemoryContextSnapshot(current, payload as Record<string, unknown>),
        );
      },
    );
    const offMemoryContextSession = events.on('session.started', (payload) => {
      // Require an explicit sessionId match — the widget-clear is destructive
      // and the permissive === undefined branch in memoryEventMatchesSession
      // would wipe the monitor for any legacy emitter that omits sessionId.
      const eventSessionId = (payload as { sessionId?: unknown } | undefined)?.sessionId;
      if (typeof eventSessionId !== 'string' || eventSessionId !== agent.ctx.session.id) return;
      setMemoryContextMonitor(emptyMemoryContextMonitor());
    });
    const offMemoryLifecycle = events.onPattern('memory.*', (event, payload) => {
      const lifecycle = memoryLifecycleEntry(event, payload as Record<string, unknown>);
      if (!lifecycle) return;
      dispatch({ type: 'addEntry', entry: { kind: 'memory-lifecycle', ...lifecycle } });
    });
    return () => {
      offDelta();
      offThinking();
      offToolStart();
      offIterStart();
      offIterEnd();
      offToolProgress();
      offTool();
      offRetry();
      offProvErr();
      offFallback();
      offProvResp();
      offConfirmNeeded();
      offTrustPersisted();
      offDelegateStart();
      offDelegateDone();
      offMemoryStale();
      offMemoryContradicted();
      offMemoryHygiene();
      offMemoryInjector();
      offMemoryContextSnapshot();
      offMemoryContextSession();
      offMemoryLifecycle();
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, [events, agent.ctx.todos, agent.ctx.session.id]);

}
