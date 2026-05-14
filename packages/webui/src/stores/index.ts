import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Usage } from '@wrongstack/core';
import type { ContentBlock } from '@wrongstack/core';

/**
 * Strip immediately-repeated paragraphs/lines from an assistant reply.
 * MiniMax-M2.7 (and other smaller open models) sometimes emit the same
 * paragraph twice in one stream — we don't want that to land in the chat.
 * We only collapse *consecutive* duplicates so legitimate repetition
 * elsewhere in the message is preserved.
 */
function dedupeRepeatedBlocks(text: string): string {
  if (!text) return text;
  // Pass 1: paragraph-level (split on blank lines).
  const paraSplit = text.split(/\n{2,}/);
  const paras: string[] = [];
  for (const p of paraSplit) {
    if (paras.length > 0 && paras[paras.length - 1]!.trim() === p.trim()) continue;
    paras.push(p);
  }
  // Pass 2: line-level within each paragraph (handles models that emit the
  // same sentence twice without a blank line between).
  const cleaned = paras.map((p) => {
    const lines = p.split('\n');
    const out: string[] = [];
    for (const line of lines) {
      if (
        out.length > 0 &&
        line.trim().length > 0 &&
        out[out.length - 1]!.trim() === line.trim()
      ) {
        continue;
      }
      out.push(line);
    }
    return out.join('\n');
  });
  return cleaned.join('\n\n');
}

// ============================================
// Types
// ============================================

export interface MessageContent {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
}

export interface ToolExecution {
  id: string;
  name: string;
  input?: unknown;
  output?: string;
  durationMs?: number;
  ok: boolean;
  startedAt: number;
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  /** Wall-clock ms reported by the backend in tool.executed; rendered next
   *  to the tool name so the user can spot slow tools at a glance. */
  toolDurationMs?: number;
  /** Backend's tool_use id (e.g. "toolu_..." from Anthropic). Used to map
   *  tool.executed events back to the right bubble when the model fires
   *  multiple tools in parallel — currentToolId alone only points at the
   *  most recent start and would leave earlier ones stuck on "Running...". */
  toolUseId?: string;
  isError?: boolean;
  timestamp: number;
  usage?: Usage;
  streaming?: boolean;
  parentId?: string;
}

export interface SessionInfo {
  id: string;
  startedAt: number;
  provider: string;
  model: string;
  title?: string;
}

// ============================================
// Chat Store
// ============================================

interface ChatState {
  messages: ChatMessage[];
  currentAssistantMessageId: string | null;
  currentToolId: string | null;
  isLoading: boolean;
  abortController: AbortController | null;
  executions: Map<string, ToolExecution>;

  // Actions
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, text: string) => void;
  /** Clean up an assistant bubble after its provider.response arrived:
   *  collapse model-emitted duplicate paragraphs / consecutive duplicate
   *  lines, flip the streaming flag off. Some models (notably MiniMax-M2.7)
   *  emit the same paragraph twice in one stream — this strips that noise
   *  at the bubble boundary so the persisted content matches what the user
   *  expects to see. */
  finalizeMessage: (id: string) => void;
  setToolResult: (id: string, result: string, ok: boolean) => void;
  setLoading: (loading: boolean) => void;
  setAbortController: (ctrl: AbortController | null) => void;
  clearMessages: () => void;
  setCurrentAssistantMessage: (id: string | null) => void;
  setCurrentToolId: (id: string | null) => void;
  addExecution: (exec: ToolExecution) => void;
  updateExecution: (id: string, updates: Partial<ToolExecution>) => void;
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

      addMessage: (msg) => {
        const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const fullMsg: ChatMessage = { ...msg, id, timestamp: Date.now() };
        set((state) => ({
          messages: [...state.messages, fullMsg],
          currentAssistantMessageId:
            msg.role === 'assistant' ? id : state.currentAssistantMessageId,
        }));
        return id;
      },

      updateMessage: (id, updates) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          ),
        }));
      },

      appendToMessage: (id, text) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id
              ? { ...m, content: m.content + text }
              : m
          ),
        }));
      },

      finalizeMessage: (id) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id
              ? { ...m, content: dedupeRepeatedBlocks(m.content), streaming: false }
              : m
          ),
        }));
      },

      setToolResult: (id, result, ok) => {
        set((state) => ({
          messages: state.messages.map((m) =>
            m.id === id
              ? { ...m, toolResult: result, isError: !ok }
              : m
          ),
        }));
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setAbortController: (ctrl) => set({ abortController: ctrl }),

      clearMessages: () =>
        set({
          messages: [],
          currentAssistantMessageId: null,
          currentToolId: null,
          executions: new Map(),
        }),

      setCurrentAssistantMessage: (id) =>
        set({ currentAssistantMessageId: id }),

      setCurrentToolId: (id) => set({ currentToolId: id }),

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
    }),
    {
      name: 'wrongstack-chat',
      // Intentionally persist nothing. Messages are bound to a backend session;
      // restoring them on reload would resurrect a stale conversation that the
      // backend no longer has context for (the next session.start clearMessages
      // anyway). Keep theme/wsUrl in useConfigStore, transcripts ephemeral.
      partialize: () => ({}),
    }
  )
);

// ============================================
// Config Store
// ============================================

interface ConfigState {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  wsUrl: string;
  wsConnected: boolean;
  theme: 'light' | 'dark' | 'system';
  autoConnect: boolean;

  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setConfig: (config: Partial<Omit<ConfigState, 'setProvider' | 'setModel' | 'setConfig' | 'setTheme'>>) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setWsConnected: (connected: boolean) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      // Default WS URL tracks the page's hostname so loading from 127.0.0.1,
      // localhost, or a LAN IP all just work. For `localhost` we force the
      // literal IPv4 address — see ws-client.ts `defaultWsUrl()` for the
      // Windows IPv6/IPv4 resolution gotcha this avoids.
      wsUrl: (() => {
        if (typeof window === 'undefined' || !window.location?.hostname) {
          return 'ws://127.0.0.1:3457';
        }
        const h = window.location.hostname.toLowerCase();
        if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') {
          return 'ws://127.0.0.1:3457';
        }
        return `ws://${window.location.hostname}:3457`;
      })(),
      wsConnected: false,
      theme: 'system',
      autoConnect: true,
      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
      setConfig: (config) => set(config),
      setTheme: (theme) => set({ theme }),
      setWsConnected: (connected) => set({ wsConnected: connected }),
    }),
    {
      name: 'wrongstack-config',
    }
  )
);

// ============================================
// Session Store
// ============================================

interface SessionState {
  session: SessionInfo | null;
  totalTokens: Usage;
  /** Input tokens of the LAST provider response — used as the "live context
   *  size" indicator in the topbar (matches what TUI's ContextChip shows). */
  lastInputTokens: number;
  cost: number;
  startTime: number | null;
  /** Model max context window, from models.dev catalog. 0 = unknown. */
  maxContext: number;
  /** USD per 1M tokens — used to compute cost deltas on every provider.response. */
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  /** basename(projectRoot) for the topbar. */
  projectName: string;
  /** Active mode id (default | code | …). */
  mode: string;
  /** All modes the backend knows about, populated by modes.list. The
   *  topbar mode chip uses this to render a picker; empty until the
   *  backend responds. */
  modes: Array<{ id: string; name: string; description: string }>;
  /** Iteration progress while the agent is running. Resets on run.result. */
  iteration: { index: number; max: number } | null;

  setSession: (session: SessionInfo | null) => void;
  updateUsage: (usage: Usage) => void;
  addCost: (cost: number) => void;
  startSession: (session: SessionInfo) => void;
  endSession: () => void;
  setEnv: (env: {
    maxContext?: number;
    projectName?: string;
    mode?: string;
    inputCost?: number;
    outputCost?: number;
    cacheReadCost?: number;
  }) => void;
  setIteration: (it: { index: number; max: number } | null) => void;
  setModes: (modes: Array<{ id: string; name: string; description: string }>) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      lastInputTokens: 0,
      cost: 0,
      startTime: null,
      maxContext: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      projectName: '',
      mode: 'default',
      modes: [],
      iteration: null,

      setSession: (session) => set({ session }),

      updateUsage: (usage) =>
        set((state) => ({
          totalTokens: {
            input: state.totalTokens.input + usage.input,
            output: state.totalTokens.output + usage.output,
            cacheRead: (state.totalTokens.cacheRead ?? 0) + (usage.cacheRead ?? 0),
            cacheWrite: (state.totalTokens.cacheWrite ?? 0) + (usage.cacheWrite ?? 0),
          },
          lastInputTokens: usage.input || state.lastInputTokens,
        })),

      addCost: (cost) => set((state) => ({ cost: state.cost + cost })),

      startSession: (session) =>
        // Full reset on every session boundary. Without this, /new and
        // /clear would keep the previous session's token totals + cost in
        // the status bar — confusing because the chat looks empty but the
        // header insists there were 50k tokens already used.
        set({
          session,
          startTime: Date.now(),
          iteration: null,
          lastInputTokens: 0,
          totalTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          cost: 0,
        }),

      endSession: () =>
        set({
          session: null,
          startTime: null,
          iteration: null,
        }),

      setEnv: (env) =>
        set((state) => ({
          maxContext: env.maxContext ?? state.maxContext,
          projectName: env.projectName ?? state.projectName,
          mode: env.mode ?? state.mode,
          inputCost: env.inputCost ?? state.inputCost,
          outputCost: env.outputCost ?? state.outputCost,
          cacheReadCost: env.cacheReadCost ?? state.cacheReadCost,
        })),

      setIteration: (iteration) => set({ iteration }),
      setModes: (modes) => set({ modes }),
    }),
    {
      name: 'wrongstack-session',
      partialize: () => ({}),
    }
  )
);

// ============================================
// UI Store
// ============================================

interface UIState {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  currentView: 'chat' | 'history' | 'settings';
  showConfirmDialog: boolean;
  confirmInfo: {
    id: string;
    toolName: string;
    input: unknown;
    suggestedPattern: string;
  } | null;
  /** ⌘K palette is mounted globally; this flag controls its visibility. */
  paletteOpen: boolean;
  /** "?" shortcuts overlay visibility. */
  shortcutsOpen: boolean;
  /** Ctrl+F chat-content search. */
  searchOpen: boolean;
  searchQuery: string;
  /** Rolling list of recently sent user prompts so ↑ in an empty input can
   *  recall them like a terminal. Capped to ~50 to keep storage bounded. */
  promptHistory: string[];

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setCurrentView: (view: 'chat' | 'history' | 'settings') => void;
  showConfirm: (info: UIState['confirmInfo']) => void;
  hideConfirm: () => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (q: string) => void;
  pushPrompt: (text: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      settingsOpen: false,
      currentView: 'chat',
      showConfirmDialog: false,
      confirmInfo: null,
      paletteOpen: false,
      shortcutsOpen: false,
      searchOpen: false,
      searchQuery: '',
      promptHistory: [],

      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setCurrentView: (view) => set({ currentView: view }),
      showConfirm: (info) => set({ showConfirmDialog: true, confirmInfo: info }),
      hideConfirm: () => set({ showConfirmDialog: false, confirmInfo: null }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setSearchOpen: (open) => set({ searchOpen: open, searchQuery: open ? '' : '' }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      pushPrompt: (text) =>
        set((state) => {
          const trimmed = text.trim();
          if (!trimmed) return state;
          // Dedupe consecutive duplicates and cap the buffer.
          const filtered = state.promptHistory.filter((p) => p !== trimmed);
          return { promptHistory: [trimmed, ...filtered].slice(0, 50) };
        }),
    }),
    {
      name: 'wrongstack-ui',
      // Persist only what's useful across reloads — sidebar state and the
      // prompt history. Modal flags (palette/shortcuts/search) reset on
      // load so the user doesn't reopen the app into an open dialog.
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        promptHistory: s.promptHistory,
      }),
    },
  ),
);

// ============================================
// History Store
// ============================================

/** A row in the sidebar's History tab. Mirrors core's SessionSummary +
 *  isCurrent so the active session can be highlighted. Timestamps are
 *  ISO-8601 strings as stored on disk; the UI parses them lazily. */
export interface SessionHistoryEntry {
  id: string;
  title: string;
  startedAt: string;
  model: string;
  provider: string;
  tokenTotal: number;
  isCurrent: boolean;
}

interface HistoryState {
  entries: SessionHistoryEntry[];
  loading: boolean;
  error: string | null;
  setEntries: (entries: SessionHistoryEntry[], error?: string | null) => void;
  setLoading: (loading: boolean) => void;
  removeEntry: (id: string) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()((set) => ({
  entries: [],
  loading: false,
  error: null,
  setEntries: (entries, error = null) => set({ entries, error, loading: false }),
  setLoading: (loading) => set({ loading }),
  removeEntry: (id) =>
    set((state) => ({
      entries: state.entries.filter((e) => e.id !== id),
    })),
  clearHistory: () => set({ entries: [] }),
}));