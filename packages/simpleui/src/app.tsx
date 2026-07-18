import {
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  FolderCode,
  History,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatPane } from './agent-chat-pane.js';
import { FinishedAgentsMenu } from './finished-agents-menu.js';
import { ChatMessageList } from './chat-message-list.js';
import { Composer } from './composer.js';
import { ErrorBoundary } from './error-boundary.js';
import { FileDiffPanel } from './file-diff-panel.js';
import { FileChangesButton } from './file-changes-button.js';
import { MemoryDrawer } from './memory-drawer.js';
import { FileExplorer } from './file-explorer.js';
import { PromptLibrary } from './prompt-library.js';
import { BrainPanel } from './brain-panel.js';
import { SessionHealthPanel } from './session-health-panel.js';
import {
  buildAgentTabs,
  canComposeForAgent,
  LEADER_AGENT_ID,
  partitionAgentTabs,
  pruneAgents,
  resetAgentNameCache,
  resolveSelectedAgentId,
} from './lib/agent-model.js';
import { copyText } from './lib/clipboard.js';
import { playChime } from './lib/chime.js';
import { clearComposerDraft, readComposerDraft, writeComposerDraft } from './lib/composer-draft.js';
import {
  composePromptWithFileReferences,
  type FileMention,
  removeFileMention,
} from './lib/file-mention.js';
import { createMessageHandler } from './lib/message-handler.js';
import type { MessageHandlerDeps } from './lib/message-handler.js';
import {
  findModelContextWindow,
  planModelSwitch,
} from './lib/model-switch.js';
import {
  relativeSessionTime,
  sessionDisplayName,
} from './lib/session-model.js';
import {
  DEFAULT_PREFS,
  type AutonomyMode,
  type SimplePrefs,
} from './lib/prefs-model.js';
import {
  enqueueFront,
  enqueueItem,
  removeQueuedAt,
  resolveSendPlan,
  type QueueMode,
  type QueuedItem,
} from './lib/queue-model.js';
import {
  parseFallbackRef,
  resolveRefineText,
  type RefineDecision,
  type RefineState,
} from './lib/refine-model.js';
import type { StatusNoticeProjection } from './lib/status-notice.js';
import { aggregateFileEdits } from './lib/timeline-model.js';
import { agentTranscriptToToolCalls } from './lib/tool-model.js';
import {
  createWorklistStore,
  type PlanStatus,
  type TaskStatus,
  type TodoStatus,
  type WorklistView,
} from './lib/worklist-store.js';
import { SimpleSocket } from './lib/ws.js';
import { SettingsPanel } from './settings-panel.js';
import { ToolSidebar } from './tool-sidebar.js';
import type {
  AgentMode,
  AgentTranscriptEntry,
  ChatMessage,
  ConnectionState,
  ContextInfo,
  FileEditMeta,
  ModelDescriptor,
  PendingConfirm,
  ServerMessage,
  SessionInfo,
  SimpleSessionSummary,
  SimpleSubagent,
  ToolCallInfo,
} from './types.js';

const EMPTY_CONTEXT: ContextInfo = { load: 0, tokens: 0, maxContext: 0 };
const THEME_STORAGE_KEY = 'wrongstack.simpleui.theme';
const REFINE_RETRY_FEEDBACK =
  'Make another pass that is sharper and more self-contained. Use the provided project memory, current session context, and recent conversation only to resolve references and preserve project vocabulary; keep the original scope unchanged.';

type Theme = 'dark' | 'light';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function compactTokens(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return Math.round(value).toString();
}

function messageId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

/** Check if a model id matches common vision-capable model patterns. */
function isVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return (
    id.includes('vision') ||
    id.includes('gpt-4o') ||
    id.includes('gpt-4-turbo') ||
    id.includes('claude-3') ||
    id.includes('claude-3.5') ||
    id.includes('claude-4') ||
    id.startsWith('gemini') ||
    id.includes('gemini-2') ||
    id.includes('llava') ||
    id.includes('pixtral') ||
    id.includes('qwenvl') ||
    id.includes('cogvlm')
  );
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessions, setSessions] = useState<SimpleSessionSummary[]>([]);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [context, setContext] = useState<ContextInfo>(EMPTY_CONTEXT);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<Record<string, ModelDescriptor[]>>({});
  const [modes, setModes] = useState<AgentMode[]>([]);
  const [activeModeId, setActiveModeId] = useState('default');
  const [prefs, setPrefs] = useState<SimplePrefs>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [refineState, setRefineState] = useState<RefineState | null>(null);
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>({});
  const [pendingModelSwitch, setPendingModelSwitch] = useState<{
    provider: string;
    model: string;
    modelName: string;
    currentWindow: number;
    nextWindow: number;
  } | null>(null);
  const [subagents, setSubagents] = useState<SimpleSubagent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState(LEADER_AGENT_ID);
  const [agentTranscripts, setAgentTranscripts] = useState<Record<string, AgentTranscriptEntry[]>>(
    {},
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [draft, setDraft] = useState('');
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [fileMention, setFileMention] = useState<FileMention | null>(null);
  const [fileMatches, setFileMatches] = useState<string[]>([]);
  const [filePickerIndex, setFilePickerIndex] = useState(0);
  const [fileSearching, setFileSearching] = useState(false);
  const [attachedImages, setAttachedImages] = useState<
    { id: string; data: string; mime: string; name: string }[]
  >([]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const [notice, setNotice] = useState<(StatusNoticeProjection & { id: string }) | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [worklists] = useState(createWorklistStore);
  const [diffFiles, setDiffFiles] = useState<FileEditMeta[] | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const socketRef = useRef<SimpleSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const activeModelRef = useRef<{ provider: string; model: string } | null>(null);
  /** Provider ids already asked for their model list — catalog + saved overlap. */
  const requestedModelsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const draftRef = useRef('');
  const fileRefsRef = useRef<string[]>([]);
  const runningRef = useRef(false);
  // handleServerMessage is a stable []-callback, so the drain and refine
  // paths it triggers read live state through refs rather than closing over
  // a stale render.
  const refineStateRef = useRef<RefineState | null>(null);
  const prefsRef = useRef<SimplePrefs>(DEFAULT_PREFS);
  const queueRef = useRef<QueuedItem[]>([]);
  draftRef.current = draft;
  fileRefsRef.current = fileRefs;
  runningRef.current = running;
  refineStateRef.current = refineState;
  prefsRef.current = prefs;
  queueRef.current = queue;

  // Refs for the global keyboard shortcut handler — read live state
  // without re-registering the keydown listener on every render.
  const messagesRef = useRef<ChatMessage[]>([]);
  const diffFilesRef = useRef<FileEditMeta[] | null>(null);
  const settingsOpenRef = useRef(false);
  const sessionMenuOpenRef = useRef(false);
  messagesRef.current = messages;
  diffFilesRef.current = diffFiles;
  settingsOpenRef.current = settingsOpen;
  sessionMenuOpenRef.current = sessionMenuOpen;

  /** Send a message to the agent and reflect it locally. The single send
   *  path — the composer, the queue drain, and every refine decision all
   *  funnel through here. */
  const dispatchUserMessage = useCallback((content: string, images?: { data: string; mime: string }[]) => {
    const sessionId = sessionIdRef.current;
    if (!content || !sessionId) return;
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    setMessages((current) => [
      ...current,
      {
        id: messageId('user'),
        role: 'user',
        text: content,
        ...(images && images.length > 0 ? { images } : {}),
      },
    ]);
    setRunning(true);
    setToolCalls([]);
    setActivity('Thinking');
    const payload: Record<string, unknown> = {
      sessionId,
      id: messageId('prompt'),
      content,
      timestamp: Date.now(),
    };
    if (images && images.length > 0) payload['images'] = images;
    socketRef.current?.send('user_message', payload);
  }, []);

  /** Open the refine round-trip, or send straight through when refine is off. */
  const startSend = useCallback(
    (content: string, images?: { data: string; mime: string }[]) => {
      if (!prefsRef.current.enhanceEnabled) {
        dispatchUserMessage(content, images);
        return;
      }
      const active = activeModelRef.current;
      const profileRef = prefsRef.current.refinerFallbackProfile
        ? prefsRef.current.fallbackProfiles[prefsRef.current.refinerFallbackProfile]?.[0]
        : undefined;
      const slash = profileRef?.indexOf('/') ?? -1;
      const displayedProvider = profileRef
        ? slash > 0 ? profileRef.slice(0, slash) : active?.provider
        : prefsRef.current.refinerProvider || active?.provider;
      const displayedModel = profileRef
        ? slash > 0 ? profileRef.slice(slash + 1) : profileRef
        : prefsRef.current.refinerModel || active?.model;
      setRefineState({
        original: content,
        refined: content,
        english: content,
        status: 'refining',
        provider: displayedProvider,
        model: displayedModel,
      });
      socketRef.current?.send('model.refine', { text: content });
    },
    [dispatchUserMessage],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is best-effort in privacy-restricted browsers.
    }
  }, [theme]);

  // ── Global keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // ── Escape: close the topmost open panel ──
      if (event.key === 'Escape') {
        if (diffFilesRef.current) {
          event.preventDefault();
          setDiffFiles(null);
          return;
        }
        if (settingsOpenRef.current) {
          event.preventDefault();
          setSettingsOpen(false);
          return;
        }
        if (refineStateRef.current) {
          event.preventDefault();
          setRefineState(null);
          return;
        }
        if (sessionMenuOpenRef.current) {
          event.preventDefault();
          setSessionMenuOpen(false);
          return;
        }
        return;
      }

      // ── Ctrl/Cmd+Enter: send the composer ──
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!runningRef.current && draftRef.current.trim()) {
          event.preventDefault();
          startSend(draftRef.current);
        }
        return;
      }

      // ── ArrowUp: recall last sent message into empty composer ──
      if (
        event.key === 'ArrowUp' &&
        document.activeElement === textareaRef.current &&
        !draftRef.current.trim() &&
        !runningRef.current
      ) {
        event.preventDefault();
        const lastUser = [...messagesRef.current]
          .reverse()
          .find((m) => m.role === 'user');
        if (lastUser) {
          setDraft(lastUser.text);
          // Move cursor to end on next frame so the textarea has updated.
          requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (ta) {
              ta.selectionStart = ta.value.length;
              ta.selectionEnd = ta.value.length;
            }
          });
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [startSend]);

  // ── Exit confirmation via browser beforeunload ─────────────────
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (prefsRef.current.confirmExit && runningRef.current) {
        event.preventDefault();
        // Modern browsers show a generic "Leave site?" dialog; the
        // returnValue assignment is required by the spec even though
        // the string is ignored.
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!sessionMenuRef.current?.contains(event.target as Node)) setSessionMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
    };
  }, [sessionMenuOpen]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKey = (event: KeyboardEvent) => {
      if (event.key === 'l' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        event.preventDefault();
        if (!runningRef.current && sessionIdRef.current) {
          socketRef.current?.send('session.new', { sessionId: sessionIdRef.current });
        }
        return;
      }
    };
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, 5_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!copiedMessageId) return;
    const timer = setTimeout(() => setCopiedMessageId(null), 1_800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);

  /** Ask the server for a provider's model list, at most once per provider. */
  const requestProviderModels = useCallback((providerId: string) => {
    if (!providerId || requestedModelsRef.current.has(providerId)) return;
    requestedModelsRef.current.add(providerId);
    socketRef.current?.send('provider.models', { providerId });
  }, []);

  const handlerDeps: MessageHandlerDeps = {
    prefsRef,
    draftRef,
    fileRefsRef,
    queueRef,
    sessionIdRef,
    messagesRef,
    activeModelRef,
    runningRef,
    refineStateRef,
    socketRef,
    requestedModelsRef,
    stickToBottomRef,
    setMessages,
    setRunning,
    setActivity,
    setToolCalls,
    setSubagents,
    setAgentTranscripts,
    setSession,
    setSessionMenuOpen,
    setSessions,
    setContext,
    setModels,
    setModes,
    setActiveModeId,
    setPrefs,
    setDraft,
    setFileRefs,
    setFileMention,
    setNotice,
    setQueue,
    setRefineState,
    setPendingConfirm,
    setSelectedAgentId,
    setSessionStart,
    setShowJumpToLatest,
    setFileMatches,
    setFilePickerIndex,
    setFileSearching,
    setAttachedImages,
    setCopiedMessageId,
    setProviderLabels,
    setDiffFiles,
    resetAgentNameCache: () => resetAgentNameCache(),
    onChime: playChime,
    dispatchUserMessage,
    requestProviderModels,
    writeComposerDraft,
    clearComposerDraft,
    readComposerDraft,
    worklists,
  };

  const handleServerMessage = useMemo(
    () => createMessageHandler(handlerDeps),
    [dispatchUserMessage, requestProviderModels, worklists],
  );

  useEffect(() => {
    const socket = new SimpleSocket({
      onMessage: handleServerMessage,
      onState: (state) => {
        setConnection(state);
        if (state === 'open') {
          socket.send('providers.saved');
          socket.send('providers.list');
          // The server owns preference truth; seed from it rather than
          // trusting whatever this tab last rendered.
          socket.send('prefs.get');
          socket.send('modes.list');
          if (sessionIdRef.current) {
            socket.send('sessions.list', { sessionId: sessionIdRef.current, limit: 12 });
          }
        } else {
          setSessionMenuOpen(false);
          setFileMention(null);
          setFileMatches([]);
          setFileSearching(false);
        }
      },
    });
    socketRef.current = socket;
    void socket.connect();
    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [handleServerMessage]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, activity, pendingConfirm]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(180, Math.max(48, element.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    if (!session?.id) return;
    const timer = setTimeout(() => {
      writeComposerDraft(session.id, { text: draft, fileRefs });
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, fileRefs, session?.id]);

  useEffect(() => {
    const flushDraft = () => {
      if (!sessionIdRef.current) return;
      writeComposerDraft(sessionIdRef.current, {
        text: draftRef.current,
        fileRefs: fileRefsRef.current,
      });
    };
    window.addEventListener('pagehide', flushDraft);
    return () => {
      window.removeEventListener('pagehide', flushDraft);
      flushDraft();
    };
  }, []);

  useEffect(() => {
    if (!fileMention) {
      setFileSearching(false);
      return;
    }
    setFileSearching(true);
    setFilePickerIndex(0);
    const timer = setTimeout(() => {
      socketRef.current?.send('files.list', { query: fileMention.query, limit: 12 });
    }, 80);
    return () => clearTimeout(timer);
  }, [fileMention]);

  const groupedModels = useMemo(
    () => Object.entries(models).filter(([, entries]) => entries.length > 0),
    [models],
  );
  const agentTabs = useMemo(() => buildAgentTabs(subagents, running), [running, subagents]);
  const { active: liveAgentTabs, finished: finishedAgentTabs } = useMemo(
    () => partitionAgentTabs(agentTabs),
    [agentTabs],
  );
  const activeAgentId = resolveSelectedAgentId(selectedAgentId, agentTabs);

  // Periodically prune idle/offline workers that have aged out so the strip and
  // dropdown don't accumulate agents no longer worth viewing.
  useEffect(() => {
    if (subagents.length === 0) return;
    const timer = setInterval(() => {
      setSubagents((current) => {
        const pruned = pruneAgents(current, Date.now());
        return pruned.length === current.length ? current : pruned;
      });
    }, 15_000);
    return () => clearInterval(timer);
  }, [subagents.length]);
  const leaderSelected = canComposeForAgent(activeAgentId);
  const currentSessionSummary = useMemo(
    () => sessions.find((item) => item.id === session?.id),
    [session?.id, sessions],
  );
  const currentSessionName = sessionDisplayName(currentSessionSummary, session?.id);
  const selectedModel = session ? `${session.provider}\t${session.model}` : '';
  const visionSupported = isVisionModel(session?.model ?? '');
  const load = Math.max(0, Math.min(1, context.load));
  const latestAssistantId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (message?.role === 'assistant') return message.id;
    }
    return undefined;
  }, [messages]);

  // Filter out thinking blocks when the user has disabled model reasoning display.
  const displayMessages = useMemo(
    () =>
      prefs.showModelReasoning ? messages : messages.filter((m) => m.role !== 'thinking'),
    [messages, prefs.showModelReasoning],
  );

  const activeAgent = agentTabs.find((agent) => agent.id === activeAgentId) ?? agentTabs[0];
  const selectedToolCalls = useMemo(
    () =>
      leaderSelected
        ? toolCalls
        : agentTranscriptToToolCalls(agentTranscripts[activeAgentId] ?? []),
    [activeAgentId, agentTranscripts, leaderSelected, toolCalls],
  );

  const fileEditSummary = useMemo(
    () => aggregateFileEdits(toolCalls),
    [toolCalls],
  );

  /** File edits with timestamps for the chat timeline widgets.
   *  One entry per file (deduplicated by path) with merged diffs, so
   *  edits to the same file in separate tool calls produce a single
   *  inline widget showing the total change. */
  const fileEdits = useMemo(
    () => {
      const aggregate = aggregateFileEdits(toolCalls);
      return aggregate.files.map((edit) => ({ edit, ts: '' }));
    },
    [toolCalls],
  );

  const selectNextStep = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const copyAssistantMessage = async (id: string, text: string) => {
    if (await copyText(text)) {
      setCopiedMessageId(id);
      return;
    }
    setNotice({
      id: messageId('notice'),
      text: 'Could not copy response',
      tone: 'error',
    });
  };

  const jumpToLatest = () => {
    stickToBottomRef.current = true;
    setShowJumpToLatest(false);
    const element = scrollRef.current;
    if (!element) return;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  const selectFile = (path: string) => {
    if (!fileMention) return;
    const cursor = fileMention.start;
    setDraft((current) => removeFileMention(current, fileMention));
    setFileRefs((current) => (current.includes(path) ? current : [...current, path]));
    setFileMention(null);
    setFileMatches([]);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const attachImages = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        const reader = new FileReader();
        reader.onload = () => {
          const data = reader.result as string;
          setAttachedImages((prev) => [
            ...prev,
            { id: messageId('img'), data, mime: file.type, name: file.name },
          ]);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const removeAttachedImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const createSession = () => {
    if (running || !sessionIdRef.current) return;
    socketRef.current?.send('session.new', { sessionId: sessionIdRef.current });
    setSessionMenuOpen(false);
  };

  const resumeSession = (id: string) => {
    if (running || !sessionIdRef.current || id === sessionIdRef.current) return;
    socketRef.current?.send('session.resume', { sessionId: sessionIdRef.current, id });
    setSessionMenuOpen(false);
  };

  /** Dropdown pick — switches immediately, or asks first when the new model's
   *  context window is smaller than the current one. */
  const selectModel = (provider: string, model: string) => {
    if (!session) return;
    const plan = planModelSwitch({
      models,
      currentProvider: session.provider,
      currentModel: session.model,
      sessionMaxContext: session.maxContext || context.maxContext,
      nextProvider: provider,
      nextModel: model,
    });
    if (plan.kind === 'noop') return;
    if (plan.kind === 'warn') {
      setPendingModelSwitch({
        provider,
        model,
        modelName: plan.modelName,
        currentWindow: plan.currentWindow,
        nextWindow: plan.nextWindow,
      });
      return;
    }
    socketRef.current?.send('model.switch', { provider, model });
  };

  const confirmModelSwitch = () => {
    if (!pendingModelSwitch) return;
    socketRef.current?.send('model.switch', {
      provider: pendingModelSwitch.provider,
      model: pendingModelSwitch.model,
    });
    setPendingModelSwitch(null);
  };

  // The pending smaller-context warning is stale once the session moves on
  // (switch confirmed elsewhere, session resumed) or a run starts.
  useEffect(() => {
    if (!pendingModelSwitch) return;
    if (running) setPendingModelSwitch(null);
  }, [pendingModelSwitch, running]);

  useEffect(() => {
    if (!pendingModelSwitch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingModelSwitch(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pendingModelSwitch]);

  const submitWith = (mode: QueueMode) => {
    // ── Slash commands ──
    if (draft.trim() === '/clear' && sessionIdRef.current) {
      clearComposerDraft(sessionIdRef.current);
      draftRef.current = '';
      fileRefsRef.current = [];
      setDraft('');
      setFileRefs([]);
      setFileMention(null);
      socketRef.current?.send('session.new', { sessionId: sessionIdRef.current });
      return;
    }

    const content = composePromptWithFileReferences(draft, fileRefs);
    // The refine panel owns the pending text; a second submit would race it.
    if (!content || connection !== 'open' || !sessionIdRef.current || refineState) return;

    const plan = resolveSendPlan(mode, running);
    const imgs = attachedImages.length > 0
      ? attachedImages.map((i) => ({ data: i.data, mime: i.mime }))
      : undefined;
    clearComposerDraft(sessionIdRef.current);
    draftRef.current = '';
    fileRefsRef.current = [];
    setDraft('');
    setFileRefs([]);
    setFileMention(null);
    setAttachedImages([]);

    if (plan === 'send') {
      startSend(content, imgs);
      return;
    }

    const item: QueuedItem = { id: messageId('queued'), text: content, mode, addedAt: Date.now() };
    if (plan === 'abort-then-enqueue-front') {
      // Stop the in-flight run, then let that run's run.result drain this
      // from the head of the queue. Sending inline here would race the very
      // run.result the abort triggers.
      socketRef.current?.send('abort', { sessionId: sessionIdRef.current });
      setQueue((current) => enqueueFront(current, item));
      setNotice({ id: messageId('notice'), text: 'Steering the run…', tone: 'info' });
      return;
    }
    setQueue((current) => enqueueItem(current, item));
    setNotice({
      id: messageId('notice'),
      text: mode === 'queue' ? 'Queued for after this run' : 'Added to the run',
      tone: 'info',
    });
  };

  const refineDecision = (decision: RefineDecision) => {
    const state = refineState;
    if (!state) return;
    const text = resolveRefineText(state, decision);
    setRefineState(null);
    if (text === null) {
      // `edit` hands the text back to the composer instead of sending.
      setDraft(state.original);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    dispatchUserMessage(text);
  };

  const refineRetry = () => {
    const state = refineState;
    if (!state) return;
    // A manual retry re-arms the one automatic post-timeout retry.
    setRefineState({
      ...state,
      status: 'refining',
      error: undefined,
      errorKind: undefined,
      retried: false,
    });
    socketRef.current?.send('model.refine', {
      text: state.original,
      ...((state.status ?? 'ready') === 'ready'
        ? {
            previousRefined: state.refined,
            previousEnglish: state.english,
            retryFeedback: REFINE_RETRY_FEEDBACK,
          }
        : {}),
    });
  };

  const refineRetryFallback = (ref: string) => {
    const state = refineState;
    if (!state) return;
    const target = parseFallbackRef(ref);
    if (!target) return;
    setRefineState({ ...state, status: 'refining', retried: true });
    socketRef.current?.send('model.refine', {
      text: state.original,
      timeoutMs: 180_000,
      provider: target.provider,
      model: target.model,
    });
  };

  const updatePrefs = (patch: Partial<SimplePrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
    socketRef.current?.send('prefs.update', patch as Record<string, unknown>);
  };

  const switchAutonomy = (mode: AutonomyMode) => {
    setPrefs((current) => ({ ...current, autonomy: mode }));
    // Autonomy has its own route: prefs.update only writes meta, which the
    // running loop never reads.
    socketRef.current?.send('autonomy.switch', { mode });
  };

  const switchMode = (id: string) => {
    setActiveModeId(id);
    socketRef.current?.send('mode.switch', { id });
  };

  const decideConfirm = (decision: 'yes' | 'no' | 'always') => {
    if (!pendingConfirm) return;
    socketRef.current?.send('tool.confirm_result', {
      sessionId: sessionIdRef.current ?? undefined,
      id: pendingConfirm.id,
      decision,
    });
    setPendingConfirm(null);
  };

  const abort = () => {
    socketRef.current?.send('abort', { sessionId: sessionIdRef.current ?? undefined });
    setActivity('Stopping');
  };

  const requestWorklist = useCallback((view: WorklistView) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    socketRef.current?.send(view === 'todos' ? 'todos.get' : view === 'tasks' ? 'tasks.get' : 'plan.get', {
      sessionId,
    });
  }, []);

  const updateTodoStatus = useCallback((id: string, status: TodoStatus) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) socketRef.current?.send('todo.update', { sessionId, id, status });
  }, []);

  const updateTaskStatus = useCallback((id: string, status: TaskStatus) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) socketRef.current?.send('task.update', { sessionId, id, status });
  }, []);

  const updatePlanStatus = useCallback((target: string, status: PlanStatus) => {
    const sessionId = sessionIdRef.current;
    if (sessionId) socketRef.current?.send('plan.item.update', { sessionId, target, status });
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="project-block">
          <div className="brand-mark">
            <img src="/wrongstack.svg" alt="WrongStack" draggable={false} />
          </div>
          <div className="project-icon">
            <FolderCode size={17} />
          </div>
          <div className="project-copy" title={session?.cwd}>
            <strong>{session?.projectName ?? 'WrongStack'}</strong>
            <div className="session-switcher" ref={sessionMenuRef}>
              <button
                type="button"
                className="session-trigger"
                disabled={!session || running}
                aria-expanded={sessionMenuOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  if (!sessionMenuOpen && sessionIdRef.current) {
                    socketRef.current?.send('sessions.list', {
                      sessionId: sessionIdRef.current,
                      limit: 12,
                    });
                  }
                  setSessionMenuOpen((open) => !open);
                }}
              >
                <History size={11} aria-hidden="true" />
                <span>{session ? currentSessionName : 'Connecting…'}</span>
                <ChevronDown size={11} aria-hidden="true" />
              </button>

              {sessionMenuOpen && (
                <section className="session-menu" role="dialog" aria-label="Recent sessions">
                  <div className="session-menu-heading">
                    <span>RECENT SESSIONS</span>
                    <button type="button" disabled={running} onClick={createSession}>
                      <Plus size={11} aria-hidden="true" />
                      NEW
                    </button>
                  </div>
                  <div className="session-menu-list">
                    {sessions.length === 0 ? (
                      <div className="session-menu-empty">No saved sessions yet</div>
                    ) : (
                      sessions.slice(0, 12).map((item) => {
                        const active = item.isCurrent || item.id === session?.id;
                        return (
                          <button
                            type="button"
                            className={active ? 'active' : undefined}
                            aria-current={active ? 'page' : undefined}
                            disabled={active || running}
                            key={item.id}
                            onClick={() => resumeSession(item.id)}
                          >
                            <span className="session-menu-main">
                              {active ? (
                                <Check size={12} aria-hidden="true" />
                              ) : (
                                <History size={12} aria-hidden="true" />
                              )}
                              <span className="session-menu-copy">
                                <b>{sessionDisplayName(item)}</b>
                                <small>
                                  {[item.provider, item.model].filter(Boolean).join(' · ')}
                                </small>
                              </span>
                            </span>
                            <time dateTime={item.startedAt}>
                              {relativeSessionTime(item.startedAt)}
                            </time>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>

        <div className="model-control">
          <Bot size={15} aria-hidden="true" />
          <select
            aria-label="Provider and model"
            value={selectedModel}
            disabled={!session || groupedModels.length === 0 || running}
            onChange={(event) => {
              const [provider = '', model = ''] = event.target.value.split('\t');
              selectModel(provider, model);
            }}
          >
            {groupedModels.length === 0 && <option value="">Loading models…</option>}
            {groupedModels.map(([provider, entries]) => (
              <optgroup key={provider} label={providerLabels[provider] ?? provider}>
                {entries.map((item) => (
                  <option key={`${provider}:${item.id}`} value={`${provider}\t${item.id}`}>
                    {item.name}
                    {item.contextWindow ? ` · ${compactTokens(item.contextWindow)}` : ''}
                    {isVisionModel(item.id) ? ' 👁' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
          {pendingModelSwitch && (
            <div
              className="model-switch-warning"
              role="alertdialog"
              aria-label="Smaller context window warning"
            >
              <p>
                <strong>{pendingModelSwitch.modelName}</strong> has a smaller context window
                ({compactTokens(pendingModelSwitch.nextWindow)} vs current{' '}
                {compactTokens(pendingModelSwitch.currentWindow)}). The session may need to
                compact sooner.
              </p>
              <div className="model-switch-warning-actions">
                <button
                  type="button"
                  className="model-switch-confirm"
                  onClick={confirmModelSwitch}
                >
                  SWITCH
                </button>
                <button type="button" onClick={() => setPendingModelSwitch(null)}>
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="topbar-right">
            <button
            type="button"
            className="context-meter"
            title={`${context.tokens} / ${context.maxContext} tokens — Click to compact`}
            disabled={!session || running}
            onClick={() => {
              if (sessionIdRef.current) {
                socketRef.current?.send('context.compact', {
                  sessionId: sessionIdRef.current,
                  aggressive: false,
                });
                setActivity('Compacting context');
              }
            }}
          >
            <div className="context-copy">
              <span>CONTEXT</span>
              <strong>{Math.round(load * 100)}%</strong>
            </div>
            <div className="context-track">
              <span
                style={{
                  width: `${load * 100}%`,
                  background:
                    load > 0.9 ? 'var(--danger)' : load > 0.7 ? 'var(--warning)' : 'var(--accent)',
                }}
              />
            </div>
            <small>
              {compactTokens(context.tokens)} / {compactTokens(context.maxContext)}
            </small>
            <span className="context-compact-hint">COMPACT</span>
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            aria-expanded={settingsOpen}
            title="Settings"
          >
            <Settings size={15} />
          </button>
          <div className={`connection ${connection}`} title={`WebSocket: ${connection}`}>
            <span className={`connection-ping-dot ${connection === 'open' ? 'good' : connection === 'connecting' ? 'poor' : 'bad'}`} />
            {connection === 'open' ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{connection === 'open' ? 'LIVE' : connection === 'connecting' ? '…' : 'OFF'}</span>
          </div>
        </div>
      </header>

      <section className="agent-strip" aria-label="Agent conversations">
        <div className="agent-strip-label">
          <Users size={14} aria-hidden="true" /> AGENTS
        </div>
        <div className="agent-list" role="tablist" aria-label="Agent conversations">
          {liveAgentTabs.map((agent, index) => {
            const selected = activeAgentId === agent.id;
            return (
              <button
                type="button"
                id={`agent-tab-${agent.id}`}
                className={`agent-item${selected ? ' active' : ''}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`agent-panel-${agent.id}`}
                tabIndex={selected ? 0 : -1}
                key={agent.id}
                title={agent.task ?? `${agent.name} · ${agent.status}`}
                onClick={() => setSelectedAgentId(agent.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                  event.preventDefault();
                  const direction = event.key === 'ArrowRight' ? 1 : -1;
                  const next =
                    liveAgentTabs[(index + direction + liveAgentTabs.length) % liveAgentTabs.length];
                  if (!next) return;
                  setSelectedAgentId(next.id);
                  requestAnimationFrame(() =>
                    document.getElementById(`agent-tab-${next.id}`)?.focus(),
                  );
                }}
              >
                <span className={`agent-dot ${agent.status}`} aria-hidden="true" />
                <strong>{agent.name}</strong>
                <span>{agent.status}</span>
                {agent.task && <small>{agent.task}</small>}
              </button>
            );
          })}
        </div>
        <FinishedAgentsMenu
          agents={finishedAgentTabs}
          activeAgentId={activeAgentId}
          onSelect={setSelectedAgentId}
        />
      </section>

      <ErrorBoundary>
        <main
          id="agent-panel-leader"
          className="chat-scroll"
          role="tabpanel"
          aria-labelledby="agent-tab-leader"
          hidden={!leaderSelected}
          ref={scrollRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom =
              element.scrollHeight - element.scrollTop - element.clientHeight <= 120;
            stickToBottomRef.current = nearBottom;
            setShowJumpToLatest(!nearBottom);
          }}
        >
          <ChatMessageList
            messages={displayMessages}
            fileEdits={leaderSelected ? fileEdits : undefined}
            latestAssistantId={latestAssistantId}
            copiedMessageId={copiedMessageId}
            running={running}
            activity={activity}
            onOpenDiff={(meta) => setDiffFiles([meta])}
            emptyState={
              <div className="empty-state">
                <Sparkles size={25} strokeWidth={1.5} />
                <span>READY IN</span>
                <h1>{session?.projectName ?? 'your project'}</h1>
                <p>Describe the job. WrongStack will handle the rest.</p>
              </div>
            }
            onCopyMessage={copyAssistantMessage}
            onSelectNextStep={selectNextStep}
          />
        </main>
        {agentTabs
          .filter((agent) => !agent.isLeader)
          .map((agent) => (
            <AgentChatPane
              key={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              entries={agentTranscripts[agent.id] ?? []}
              running={agent.status === 'running' || agent.status === 'busy'}
              hidden={activeAgentId !== agent.id}
            />
          ))}
      </ErrorBoundary>

      <ToolSidebar
        agentId={activeAgentId}
        agentName={activeAgent?.name ?? activeAgentId}
        calls={selectedToolCalls}
        worklists={worklists}
        requestWorklist={requestWorklist}
        onTodoStatusChange={updateTodoStatus}
        onTaskStatusChange={updateTaskStatus}
        onPlanStatusChange={updatePlanStatus}
      />

      <FileChangesButton
        fileCount={fileEditSummary.fileCount}
        totalAdded={fileEditSummary.totalAdded}
        totalRemoved={fileEditSummary.totalRemoved}
        files={fileEditSummary.files}
        onOpenDiff={(files) => setDiffFiles(files)}
      />

      <MemoryDrawer socketRef={socketRef} />
      <FileExplorer socketRef={socketRef} />
      <PromptLibrary onRecall={(text) => { setDraft(text); textareaRef.current?.focus(); }} />
      <BrainPanel socketRef={socketRef} />
      <SessionHealthPanel context={context} messages={messages} sessionStart={sessionStart} />

      {leaderSelected && showJumpToLatest && (
        <button type="button" className="jump-to-latest" onClick={jumpToLatest}>
          <ArrowDown size={13} aria-hidden="true" />
          LATEST
        </button>
      )}

      {leaderSelected && (
        <ErrorBoundary>
          <footer className="composer-wrap">
            <Composer
              draft={draft}
              setDraft={setDraft}
              fileRefs={fileRefs}
              setFileRefs={setFileRefs}
              fileMention={fileMention}
              setFileMention={setFileMention}
              fileMatches={fileMatches}
              filePickerIndex={filePickerIndex}
              setFilePickerIndex={setFilePickerIndex}
              fileSearching={fileSearching}
              running={running}
              connection={connection}
              session={session}
              pendingConfirm={pendingConfirm}
              notice={notice}
              textareaRef={textareaRef}
              queue={queue}
              refineState={refineState}
              submitWith={submitWith}
              abort={abort}
              decideConfirm={decideConfirm}
              selectFile={selectFile}
              clearQueue={() => setQueue([])}
              removeQueued={(id) =>
                setQueue((current) =>
                  removeQueuedAt(
                    current,
                    current.findIndex((item) => item.id === id),
                  ),
                )
              }
              onRefineDecision={refineDecision}
              onRefineRetry={refineRetry}
              onRefineRetryFallback={refineRetryFallback}
              attachedImages={attachedImages}
              onAttachImages={attachImages}
              onRemoveImage={removeAttachedImage}
              visionSupported={visionSupported}
            />
          </footer>
        </ErrorBoundary>
      )}

      <ErrorBoundary>
        <SettingsPanel
          open={settingsOpen}
          prefs={prefs}
          modes={modes}
          activeModeId={activeModeId}
          connection={connection}
          onClose={() => setSettingsOpen(false)}
          onAutonomyChange={switchAutonomy}
          onModeChange={switchMode}
          onPrefChange={updatePrefs}
        />
      </ErrorBoundary>

      {diffFiles && (
        <FileDiffPanel
          files={diffFiles}
          socketRef={socketRef}
          onClose={() => setDiffFiles(null)}
        />
      )}
    </div>
  );
}
