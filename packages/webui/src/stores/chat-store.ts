import { expectDefined } from '@wrongstack/core';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage } from './types.js';

/**
 * Strip immediately-repeated paragraphs/lines from an assistant reply.
 * MiniMax-M2.7 (and other smaller open models) sometimes emit the same
 * paragraph twice in one stream — we don't want that to land in the chat.
 * We only collapse *consecutive* duplicates so legitimate repetition
 * elsewhere in the message is preserved.
 */
function dedupeRepeatedBlocks(text: string): string {
  if (!text) return text;
  const paraSplit = text.split(/\n{2,}/);
  const paras: string[] = [];
  for (const p of paraSplit) {
    if (paras.length > 0 && paras[paras.length - 1]?.trim() === p.trim()) continue;
    paras.push(p);
  }
  const cleaned = paras.map((p) => {
    const lines = p.split('\n');
    const out: string[] = [];
    for (const line of lines) {
      if (out.length > 0 && line.trim().length > 0 && out[out.length - 1]?.trim() === line.trim()) {
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  });
  return cleaned.join('\n\n');
}

// ============================================
// Chat Store
// ============================================

function indexToolMessages(messages: readonly ChatMessage[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolUseId) index.set(m.toolUseId, m.id);
  }
  return index;
}

/** Submit mode for a queued/typed message. Drives whether the message
 *  interrupts the running agent (`steer`), rides alongside without
 *  interrupting (`btw`), or is held for after the run completes (`queue`). */
export type QueueMode = 'btw' | 'steer' | 'queue';

/** One entry in the message queue — the text plus how it was added.
 *  `addedAt` powers the optional sort-by-newest toggle. */
export interface QueuedItem {
  text: string;
  mode: QueueMode;
  addedAt: number;
}

interface ChatState {
  messages: ChatMessage[];
  currentAssistantMessageId: string | null;
  currentToolId: string | null;
  isLoading: boolean;
  abortController: AbortController | null;
  executions: Map<string, ToolExecution>;
  toolMessageIdsByUseId: Map<string, string>;
  /** Messages typed while the agent was running. Drained one-at-a-time
   *  after run.result lands so the user can stack up follow-ups without
   *  waiting for each turn to finish. Each item carries the submit mode
   *  so the queue panel can render the appropriate label. */
  queue: QueuedItem[];
  /** Snapshot taken at the start of the current run (first iteration.started
   *  after idle). Used by run.result to compute the per-turn summary —
   *  duration is now-at minus this `at`, cost delta is the difference
   *  between the session's current cost and the cost captured here. Null
   *  while idle. */
  runStart: { at: number; cost: number } | null;
  /** Transient extended-thinking buffer. Populated by provider.thinking_delta
   *  events and shown as a soft, ephemeral bubble below the chat tail while
   *  the model is reasoning. Cleared the moment the model produces user-
   *  facing output (text_delta) or starts a tool — and at provider.response /
   *  run.result. The archive buffer below is what eventually lands in
   *  `messages`; this live buffer is only for the temporary bubble. */
  thinkingBuffer: string;
  /** Wall-clock ms when the current thinking burst started, for the chip's
   *  elapsed timer. Reset alongside `thinkingBuffer`. */
  thinkingStartedAt: number | null;
  /** Full thinking text accumulated for the current iteration. Unlike the
   *  live chip buffer, this survives text/tool events until iteration end. */
  thinkingLogBuffer: string;
  /** Wall-clock ms when the archived thinking text for this iteration began. */
  thinkingLogStartedAt: number | null;
  /** Id of the session whose transcript is currently in `messages`. The
   *  verifier view compares this to the server-reported active session id
   *  on every `session.start` — a mismatch means the user switched sessions
   *  without an explicit clear, and we drop the local transcript rather
   *  than render it. Persisted alongside `messages` so the cross-session
   *  bleed check survives F5. */
  boundSessionId: string | null;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'> & { timestamp?: number }) => string;
  setMessages: (messages: ChatMessage[]) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, text: string) => void;
  finalizeMessage: (id: string) => void;
  setToolResult: (id: string, result: string, ok: boolean) => void;
  appendToolProgress: (id: string, line: string) => void;
  appendToolProgressLines: (id: string, lines: string[]) => void;
  getToolMessageId: (toolUseId: string) => string | undefined;
  setToolResultByUseId: (toolUseId: string, result: string, ok: boolean) => void;
  appendToolProgressLinesByUseId: (toolUseId: string, lines: string[]) => void;
  setLoading: (loading: boolean) => void;
  setAbortController: (ctrl: AbortController | null) => void;
  clearMessages: () => void;
  /** Bind the current transcript to a session id. See boundSessionId above
   *  for why this is a separate action. */
  setBoundSessionId: (id: string | null) => void;
  setCurrentAssistantMessage: (id: string | null) => void;
  setCurrentToolId: (id: string | null) => void;
  truncateAfter: (id: string) => void;
  addExecution: (exec: ToolExecution) => void;
  updateExecution: (id: string, updates: Partial<ToolExecution>) => void;
  enqueue: (text: string, mode?: QueueMode) => void;
  dequeue: () => QueuedItem | null;
  removeQueued: (idx: number) => void;
  clearQueue: () => void;
  setRunStart: (s: { at: number; cost: number } | null) => void;
  appendThinking: (text: string) => void;
  clearThinking: () => void;
  flushThinkingLog: (iteration: number) => void;
  clearThinkingLog: () => void;
}

interface ToolExecution {
  id: string;
  name: string;
  input?: unknown | undefined;
  output?: string | undefined;
  durationMs?: number | undefined;
  ok: boolean;
  startedAt: number;
  completedAt?: number | undefined;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      messages: [],
      currentAssistantMessageId: null,
      currentToolId: null,
      isLoading: false,
      abortController: null,
      executions: new Map(),
      toolMessageIdsByUseId: new Map(),
      queue: [],
      runStart: null,
      thinkingBuffer: '',
      thinkingStartedAt: null,
      thinkingLogBuffer: '',
      thinkingLogStartedAt: null,
      /** Id of the session this transcript belongs to. The verifier view uses
       *  this to detect cross-session bleed: after F5, if the persisted
       *  sessionId doesn't match the server-reported active session, we drop
       *  the local transcript rather than render stale messages. */
      boundSessionId: null as string | null,

      addMessage: (msg) => {
        const id = `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        const fullMsg: ChatMessage = { ...msg, id, timestamp: msg.timestamp ?? Date.now() };
        set((state) => {
          const next: Partial<ChatState> = {
            messages: [...state.messages, fullMsg],
            currentAssistantMessageId:
              msg.role === 'assistant' ? id : state.currentAssistantMessageId,
          };
          if (fullMsg.role === 'tool' && fullMsg.toolUseId) {
            const nextIndex = new Map(state.toolMessageIdsByUseId);
            nextIndex.set(fullMsg.toolUseId, id);
            next.toolMessageIdsByUseId = nextIndex;
          }
          return next;
        });
        return id;
      },

      setMessages: (messages) => {
        set({
          messages,
          currentAssistantMessageId: null,
          currentToolId: null,
          executions: new Map(),
          toolMessageIdsByUseId: indexToolMessages(messages),
          thinkingBuffer: '',
          thinkingStartedAt: null,
          thinkingLogBuffer: '',
          thinkingLogStartedAt: null,
          // boundSessionId is the caller's responsibility to set when the
          // caller knows which session owns these messages (e.g. the
          // session.start handler passes the sessionId). When this store
          // is hit via /resume or hydrateReplayMessages, the caller must
          // also call setBoundSessionId; bare setMessages() leaves the
          // prior binding intact so background rehydrate from localStorage
          // can detect a sessionId mismatch.
        });
      },

      updateMessage: (id, updates) => {
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, ...updates } : m)),
        }));
      },

      appendToMessage: (id, text) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, content: m.content + text } : m,
          ),
        }));
      },

      finalizeMessage: (id) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, content: dedupeRepeatedBlocks(m.content), streaming: false } : m,
          ),
        }));
      },

      setToolResult: (id, result, ok) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, toolResult: result, isError: !ok, progressLines: undefined } : m,
          ),
        }));
      },

      appendToolProgress: (id, line) => {
        get().appendToolProgressLines(id, [line]);
      },

      appendToolProgressLines: (id, lines) => {
        if (lines.length === 0) return;
        set((state) => ({
          messages: state.messages.map((m) => {
            if (m.id !== id) return m;
            // Mutate in-place to avoid repeated array allocations.
            // This is safe because set() gives us a new state object.
            const prev = m.progressLines ?? [];
            prev.push(...lines);
            if (prev.length > 30) prev.splice(0, prev.length - 30);
            return { ...m, progressLines: prev };
          }),
        }));
      },

      getToolMessageId: (toolUseId) => get().toolMessageIdsByUseId.get(toolUseId),

      setToolResultByUseId: (toolUseId, result, ok) => {
        const id = get().toolMessageIdsByUseId.get(toolUseId);
        if (id) get().setToolResult(id, result, ok);
      },

      appendToolProgressLinesByUseId: (toolUseId, lines) => {
        const id = get().toolMessageIdsByUseId.get(toolUseId);
        if (id) get().appendToolProgressLines(id, lines);
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setAbortController: (ctrl) => set({ abortController: ctrl }),

      clearMessages: () =>
        set({
          messages: [],
          currentAssistantMessageId: null,
          currentToolId: null,
          executions: new Map(),
          toolMessageIdsByUseId: new Map(),
          thinkingBuffer: '',
          thinkingStartedAt: null,
          thinkingLogBuffer: '',
          thinkingLogStartedAt: null,
          // Clearing the binding too — when the user hits /clear or Ctrl+L,
          // any rehydrated transcript from localStorage has to be re-bound
          // to the active session before the next message lands.
          boundSessionId: null,
        }),

      setBoundSessionId: (id) => set({ boundSessionId: id }),

      setCurrentAssistantMessage: (id) => set({ currentAssistantMessageId: id }),
      setCurrentToolId: (id) => set({ currentToolId: id }),

      truncateAfter: (id) =>
        set((state) => {
          const idx = state.messages.findIndex((m) => m.id === id);
          if (idx === -1) return state;
          const messages = state.messages.slice(0, idx + 1);
          return {
            messages,
            currentAssistantMessageId: null,
            currentToolId: null,
            toolMessageIdsByUseId: indexToolMessages(messages),
          };
        }),

      addExecution: (exec) => {
        set((state) => {
          const newExecutions = new Map(state.executions);
          newExecutions.set(exec.id, exec);
          return { executions: newExecutions };
        });
      },

      updateExecution: (id, updates) => {
        set((state) => {
          const newExecutions = new Map(state.executions);
          const existing = newExecutions.get(id);
          if (existing) {
            newExecutions.set(id, { ...existing, ...updates });
          }
          return { executions: newExecutions };
        });
      },

      enqueue: (text, mode = 'queue') =>
        set((state) => ({
          queue: [...state.queue, { text, mode, addedAt: Date.now() }],
        })),
      dequeue: () => {
        const { queue } = get();
        if (queue.length === 0) return null;
        const [next, ...rest] = queue;
        set({ queue: rest });
        return expectDefined(next);
      },
      removeQueued: (idx) => set((state) => ({ queue: state.queue.filter((_, i) => i !== idx) })),
      clearQueue: () => set({ queue: [] }),
      setRunStart: (s) => set({ runStart: s }),
      appendThinking: (text) =>
        set((state) => ({
          thinkingBuffer: state.thinkingBuffer + text,
          thinkingStartedAt: state.thinkingStartedAt ?? Date.now(),
          thinkingLogBuffer: state.thinkingLogBuffer + text,
          thinkingLogStartedAt: state.thinkingLogStartedAt ?? Date.now(),
        })),
      clearThinking: () => set({ thinkingBuffer: '', thinkingStartedAt: null }),
      flushThinkingLog: (iteration) => {
        const { thinkingLogBuffer, thinkingLogStartedAt } = get();
        const text = thinkingLogBuffer.trim();
        if (!text) return;
        const startedAt = thinkingLogStartedAt ?? Date.now();
        get().addMessage({
          role: 'system',
          content: '',
          thinkingLog: {
            iteration,
            text,
            startedAt,
            durationMs: Math.max(0, Date.now() - startedAt),
          },
        });
        get().clearThinkingLog();
      },
      clearThinkingLog: () => set({ thinkingLogBuffer: '', thinkingLogStartedAt: null }),
    }),
    {
      name: 'wrongstack-chat',
      version: 1,
      // Persist enough to recreate the visible transcript after F5.
      //
      //   messages         — the full user/assistant/tool/transcript.
      //   queue            — typed-but-unsubmitted entries (so a refresh
      //                      doesn't make the user retype them).
      //   boundSessionId   — paired with messages so the verifier view can
      //                      detect cross-session bleed.
      //
      // We deliberately do NOT persist: isLoading, abortController, runStart,
      // executions, currentAssistantMessageId, currentToolId, the live
      // thinking buffers, or toolMessageIdsByUseId. These are either non-
      // serializable (AbortController, Map), pure runtime state (isLoading,
      // runStart, currentAssistantMessageId is reset on every replay), or
      // toolMessageIdsByUseId which is rebuildable from messages via
      // indexToolMessages(). Re-fetching them from the server on resume is
      // cheaper and more correct than resurrecting them from localStorage.
      partialize: (s) => ({
        messages: s.messages,
        queue: s.queue,
        boundSessionId: s.boundSessionId,
        thinkingLogBuffer: s.thinkingLogBuffer,
      }),
      migrate: (persisted, version) => {
        if (version > 1) {
          // Future shape; drop and start clean.
          return null as never as {
            messages: ChatState['messages'];
            queue: ChatState['queue'];
            boundSessionId: string | null;
            thinkingLogBuffer: string;
          };
        }
        const p = (persisted ?? {}) as Partial<ChatState> & {
          messages?: unknown;
          queue?: unknown;
        };
        // Defensive: messages and queue must be arrays. Anything else means
        // the persisted blob is from a build that emitted a different
        // shape — wipe and start from defaults.
        const safeMessages = Array.isArray(p.messages) ? p.messages : [];
        const safeQueue = Array.isArray(p.queue) ? p.queue : [];
        return {
          messages: safeMessages as ChatState['messages'],
          queue: safeQueue as ChatState['queue'],
          boundSessionId: typeof p.boundSessionId === 'string' ? p.boundSessionId : null,
          thinkingLogBuffer: typeof p.thinkingLogBuffer === 'string' ? p.thinkingLogBuffer : '',
        };
      },
      // `_state` is unused by design — we only care that the rehydrate
      // completed without error, which is the verifier view's signal
      // that the local transcript is now safe to render.
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        if (typeof window !== 'undefined') {
          (
            window as unknown as { __wrongstackChatRehydrated?: boolean }
          ).__wrongstackChatRehydrated = true;
        }
      },
    },
  ),
);
