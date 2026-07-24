import {
  ArrowDown,
  FolderCode,
  Moon,
  Settings,
  Sparkles,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentChatPane } from './agent-chat-pane.js';
import { BrainPanel } from './brain-panel.js';
import { ChatMessageList } from './chat-message-list.js';
import { Composer } from './composer.js';
import { ErrorBoundary } from './error-boundary.js';
import { FileChangesButton } from './file-changes-button.js';
import { FileDiffPanel } from './file-diff-panel.js';
import { FileExplorer } from './file-explorer.js';
import { FinishedAgentsMenu } from './finished-agents-menu.js';
import { useAgentRoster } from './hooks/use-agent-roster.js';
import { useComposerActions } from './hooks/use-composer-actions.js';
import { useF5Resilience } from './hooks/use-f5-resilience.js';
import { useFileMention } from './hooks/use-file-mention.js';
import { useImageAttachments } from './hooks/use-image-attachments.js';
import { useModelCatalog } from './hooks/use-model-catalog.js';
import { useServerOutage } from './hooks/use-server-outage.js';
import { useSimpleSocket } from './hooks/use-simple-socket.js';
import { useSimpleSessionState } from './hooks/use-simple-session-state.js';
import { useStatusNotice } from './hooks/use-status-notice.js';
import { useStickyScroll } from './hooks/use-sticky-scroll.js';
import { useTheme } from './hooks/use-theme.js';
import { resetAgentNameCache } from './lib/agent-model.js';
import { playChime } from './lib/chime.js';
import { copyText } from './lib/clipboard.js';
import { clearComposerDraft, readComposerDraft, writeComposerDraft } from './lib/composer-draft.js';
import {
  composePromptWithFileReferences,
  type FileMention,
  removeFileMention,
} from './lib/file-mention.js';
import type { MessageHandlerDeps } from './lib/message-handler.js';
import { createMessageHandler } from './lib/message-handler.js';
import { isVisionModel } from './lib/model-capabilities.js';
import { type AutonomyMode, DEFAULT_PREFS, type SimplePrefs } from './lib/prefs-model.js';
import {
  enqueueFront,
  enqueueItem,
  type QueuedItem,
  type QueueMode,
  removeQueuedAt,
  resolveSendPlan,
} from './lib/queue-model.js';
import {
  parseFallbackRef,
  type RefineDecision,
  type RefineState,
  resolveRefineText,
} from './lib/refine-model.js';
import { sessionDisplayName } from './lib/session-model.js';
import { aggregateFileEdits } from './lib/timeline-model.js';
import { agentTranscriptToToolCalls } from './lib/tool-model.js';
import {
  createWorklistStore,
  type PlanStatus,
  type TaskStatus,
  type TodoStatus,
  type WorklistView,
} from './lib/worklist-store.js';
import type { SimpleSocket } from './lib/ws.js';
import { MemoryDrawer } from './memory-drawer.js';
import { ModelSwitcher } from './model-switcher.js';
import { PromptLibrary } from './prompt-library.js';
import { ServerOutageOverlay } from './server-outage-overlay.js';
import { SessionHealthPanel } from './session-health-panel.js';
import { SessionSwitcher } from './session-switcher.js';
import { SettingsPanel } from './settings-panel.js';
import { ToolSidebar } from './tool-sidebar.js';
import type {
  AgentMode,
  ChatMessage,
  FileEditMeta,
  PendingConfirm,
  ToolCallInfo,
} from './types.js';

const REFINE_RETRY_FEEDBACK =
  'Make another pass that is sharper and more self-contained. Use the provided project memory, current session context, and recent conversation only to resolve references and preserve project vocabulary; keep the original scope unchanged.';

function compactTokens(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return Math.round(value).toString();
}

function messageId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function SimpleUiSession() {
  const { theme, toggleTheme } = useTheme();
  const {
    session,
    setSession,
    sessions,
    setSessions,
    context,
    setContext,
    sessionStart,
    setSessionStart,
    sessionIdRef,
    activeModelRef,
  } = useSimpleSessionState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [modes, setModes] = useState<AgentMode[]>([]);
  const [activeModeId, setActiveModeId] = useState('default');
  const [prefs, setPrefs] = useState<SimplePrefs>(DEFAULT_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [queue, setQueue] = useState<QueuedItem[]>([]);
  const [refineState, setRefineState] = useState<RefineState | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [draft, setDraft] = useState('');
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const { notice, showNotice: setNotice } = useStatusNotice();
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCallInfo[]>([]);
  const [worklists] = useState(createWorklistStore);
  const [diffFiles, setDiffFiles] = useState<FileEditMeta[] | null>(null);
  const socketRef = useRef<SimpleSocket | null>(null);
  /** Provider ids already asked for their model list — catalog + saved overlap. */
  const requestedModelsRef = useRef<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
  messagesRef.current = messages;
  diffFilesRef.current = diffFiles;
  settingsOpenRef.current = settingsOpen;

  /** Send a message to the agent and reflect it locally. The single send
   *  path — the composer, the queue drain, and every refine decision all
   *  funnel through here. */
  const dispatchUserMessage = useCallback(
    (content: string, images?: { data: string; mime: string }[]) => {
      const sessionId = sessionIdRef.current;
      if (!content || !sessionId) return;
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
    },
    [],
  );

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
        ? slash > 0
          ? profileRef.slice(0, slash)
          : active?.provider
        : prefsRef.current.refinerProvider || active?.provider;
      const displayedModel = profileRef
        ? slash > 0
          ? profileRef.slice(slash + 1)
          : profileRef
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
        const lastUser = [...messagesRef.current].reverse().find((m) => m.role === 'user');
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

  // F5 / tab-close resilience: exit confirmation + draft flush.
  useF5Resilience({
    confirmExitRef: prefsRef,
    runningRef,
    sessionIdRef,
    draftRef,
    fileRefsRef,
    writeComposerDraft,
  });

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
    if (!copiedMessageId) return;
    const timer = setTimeout(() => setCopiedMessageId(null), 1_800);
    return () => clearTimeout(timer);
  }, [copiedMessageId]);

  /** Ask the server for a provider's model list, at most once per provider. */

  const {
    setSubagents,
    agentTranscripts,
    setAgentTranscripts,
    setSelectedAgentId,
    agentTabs,
    liveAgentTabs,
    finishedAgentTabs,
    activeAgentId,
    activeAgent,
    leaderSelected,
  } = useAgentRoster({ running });

  const {
    setModels,
    providerLabels,
    setProviderLabels,
    groupedModels,
    selectedModel,
    pendingModelSwitch,
    selectModel,
    confirmModelSwitch,
    requestProviderModels,
  } = useModelCatalog({
    session,
    contextMaxContext: context.maxContext,
    running,
    socketRef,
    requestedModelsRef,
  });

  const visionSupported = isVisionModel(session?.model ?? '');

  const {
    fileMention,
    setFileMention,
    fileMatches,
    setFileMatches,
    filePickerIndex,
    setFilePickerIndex,
    fileSearching,
    setFileSearching,
    selectFile: selectFileRaw,
  } = useFileMention({ socketRef });

  const {
    attachedImages,
    attachImages,
    removeImage,
    setAttachedImages,
  } = useImageAttachments();

  const {
    scrollRef,
    showJumpToLatest,
    setShowJumpToLatest,
    jumpToLatest,
    onScroll: onScrollSticky,
    stickToBottomRef,
  } = useStickyScroll({ messages, activity, pendingConfirm });

  const {
    submitWith,
    refineDecision,
    refineRetry,
    refineRetryFallback,
    abort,
  } = useComposerActions({
    sessionIdRef,
    socketRef,
    draftRef,
    fileRefsRef,
    refineStateRef,
    draft,
    fileRefs,
    running,
    startSend,
    dispatchUserMessage,
    setQueue,
    setDraft,
    setFileRefs,
    setAttachedImages,
    setRefineState,
  });

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

  const { connection } = useSimpleSocket({
    onMessage: handleServerMessage,
    sessionIdRef,
    socketRef,
    onDisconnect: () => {
      setFileMention(null);
      setFileMatches([]);
      setFileSearching(false);
    },
  });
  const { outage, dismissed: outageDismissed, dismiss: dismissOutage } = useServerOutage(connection);

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

  const _currentSessionName = sessionDisplayName(
    sessions.find((item) => item.id === session?.id),
    session?.id,
  );
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
    () => (prefs.showModelReasoning ? messages : messages.filter((m) => m.role !== 'thinking')),
    [messages, prefs.showModelReasoning],
  );

  const selectedToolCalls = useMemo(
    () =>
      leaderSelected
        ? toolCalls
        : agentTranscriptToToolCalls(agentTranscripts[activeAgentId] ?? []),
    [activeAgentId, agentTranscripts, leaderSelected, toolCalls],
  );

  const fileEditSummary = useMemo(() => aggregateFileEdits(toolCalls), [toolCalls]);

  /** File edits with timestamps for the chat timeline widgets.
   *  One entry per file (deduplicated by path) with merged diffs, so
   *  edits to the same file in separate tool calls produce a single
   *  inline widget showing the total change. */
  const fileEdits = useMemo(() => {
    const aggregate = aggregateFileEdits(toolCalls);
    return aggregate.files.map((edit) => ({ edit, ts: '' }));
  }, [toolCalls]);

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

  const createSession = () => {
    if (running || !sessionIdRef.current) return;
    socketRef.current?.send('session.new', { sessionId: sessionIdRef.current });
  };

  const resumeSession = (id: string) => {
    if (running || !sessionIdRef.current || id === sessionIdRef.current) return;
    socketRef.current?.send('session.resume', { sessionId: sessionIdRef.current, id });
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

  const requestWorklist = useCallback((view: WorklistView) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    socketRef.current?.send(
      view === 'todos' ? 'todos.get' : view === 'tasks' ? 'tasks.get' : 'plan.get',
      {
        sessionId,
      },
    );
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
            <SessionSwitcher
              session={session}
              sessions={sessions}
              running={running}
              onRefreshSessions={() => {
                if (sessionIdRef.current) {
                  socketRef.current?.send('sessions.list', {
                    sessionId: sessionIdRef.current,
                    limit: 12,
                  });
                }
              }}
              onCreateSession={createSession}
              onResumeSession={resumeSession}
            />
          </div>
        </div>

        <ModelSwitcher
          selectedModel={selectedModel}
          groupedModels={groupedModels}
          providerLabels={providerLabels}
          disabled={!session || groupedModels.length === 0 || running}
          pendingModelSwitch={pendingModelSwitch}
          onSelectModel={selectModel}
          onConfirmSwitch={confirmModelSwitch}
          onCancelSwitch={() => {
            /* handled inside useModelCatalog via Escape effect */
          }}
        />

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
            onClick={toggleTheme}
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
            <span
              className={`connection-ping-dot ${connection === 'open' ? 'good' : connection === 'connecting' ? 'poor' : 'bad'}`}
            />
            {connection === 'open' ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>
              {connection === 'open' ? 'LIVE' : connection === 'connecting' ? '…' : 'OFF'}
            </span>
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
                    liveAgentTabs[
                      (index + direction + liveAgentTabs.length) % liveAgentTabs.length
                    ];
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
          onScroll={onScrollSticky}
        >
          <ChatMessageList
            messages={displayMessages}
            fileEdits={leaderSelected ? fileEdits : undefined}
            latestAssistantId={latestAssistantId}
            copiedMessageId={copiedMessageId}
            running={running}
            activity={activity}
            theme={theme}
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
              theme={theme}
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
      <PromptLibrary
        onRecall={(text) => {
          setDraft(text);
          textareaRef.current?.focus();
        }}
      />
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
              onRemoveImage={removeImage}
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
        <FileDiffPanel files={diffFiles} socketRef={socketRef} onClose={() => setDiffFiles(null)} />
      )}

      {!outageDismissed && <ServerOutageOverlay outage={outage} onDismiss={dismissOutage} />}
    </div>
  );
}
