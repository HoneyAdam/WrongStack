import {
  Bot,
  ChevronDown,
  CircleStop,
  FolderCode,
  LoaderCircle,
  ListChecks,
  Moon,
  Send,
  ShieldAlert,
  Sparkles,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { contentToText, replayToMessages, updateSubagents } from './lib/chat-model.js';
import { projectAssistantMessage } from './lib/message-projection.js';
import { SimpleSocket } from './lib/ws.js';
import type {
  ChatMessage,
  ConnectionState,
  ContextInfo,
  ModelDescriptor,
  PendingConfirm,
  ServerMessage,
  SessionInfo,
  SimpleSubagent,
} from './types.js';

const EMPTY_CONTEXT: ContextInfo = { load: 0, tokens: 0, maxContext: 0 };
const THEME_STORAGE_KEY = 'wrongstack.simpleui.theme';

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

function safeLine(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  } catch {
    return 'Tool input';
  }
}

function messageId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [context, setContext] = useState<ContextInfo>(EMPTY_CONTEXT);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [models, setModels] = useState<Record<string, ModelDescriptor[]>>({});
  const [providerLabels, setProviderLabels] = useState<Record<string, string>>({});
  const [subagents, setSubagents] = useState<SimpleSubagent[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState('');
  const socketRef = useRef<SimpleSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const activeModelRef = useRef<{ provider: string; model: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is best-effort in privacy-restricted browsers.
    }
  }, [theme]);

  const handleServerMessage = useCallback((message: ServerMessage) => {
    const payload = message.payload ?? {};
    switch (message.type) {
      case 'session.start': {
        const id = typeof payload['sessionId'] === 'string' ? payload['sessionId'] : '';
        const provider = typeof payload['provider'] === 'string' ? payload['provider'] : '';
        const model = typeof payload['model'] === 'string' ? payload['model'] : '';
        const maxContext = finiteNumber(payload['maxContext']);
        sessionIdRef.current = id || null;
        activeModelRef.current = provider && model ? { provider, model } : null;
        setSession({
          id,
          provider,
          model,
          projectName:
            typeof payload['projectName'] === 'string' ? payload['projectName'] : 'Project',
          cwd: typeof payload['cwd'] === 'string' ? payload['cwd'] : '',
          maxContext,
        });
        setModels((current) => ({
          ...current,
          [provider]: current[provider]?.some((item) => item.id === model)
            ? current[provider]
            : [{ id: model, name: model }, ...(current[provider] ?? [])].filter((item) => item.id),
        }));
        if (Array.isArray(payload['replayMessages'])) {
          setMessages(replayToMessages(payload['replayMessages']));
        } else if (payload['reset'] === true) {
          setMessages([]);
        }
        const replayUsage = payload['replayUsage'];
        const replayInput =
          replayUsage && typeof replayUsage === 'object'
            ? finiteNumber((replayUsage as Record<string, unknown>)['input'])
            : 0;
        setContext((current) => ({
          load:
            current.maxContext > 0 ? current.load : maxContext > 0 ? replayInput / maxContext : 0,
          tokens: current.tokens || replayInput,
          maxContext: maxContext || current.maxContext,
        }));
        if (provider) socketRef.current?.send('provider.models', { providerId: provider });
        break;
      }
      case 'providers.saved': {
        const providers = Array.isArray(payload['providers']) ? payload['providers'] : [];
        for (const entry of providers) {
          if (!entry || typeof entry !== 'object') continue;
          const id = (entry as Record<string, unknown>)['id'];
          if (typeof id === 'string')
            socketRef.current?.send('provider.models', { providerId: id });
        }
        break;
      }
      case 'provider.catalog': {
        const providers = Array.isArray(payload['providers']) ? payload['providers'] : [];
        const labels: Record<string, string> = {};
        for (const entry of providers) {
          if (!entry || typeof entry !== 'object') continue;
          const item = entry as Record<string, unknown>;
          if (typeof item['id'] === 'string') {
            labels[item['id']] = typeof item['name'] === 'string' ? item['name'] : item['id'];
          }
        }
        setProviderLabels(labels);
        break;
      }
      case 'provider.models': {
        const provider = typeof payload['provider'] === 'string' ? payload['provider'] : '';
        const list = Array.isArray(payload['models'])
          ? payload['models'].flatMap((entry) => {
              if (!entry || typeof entry !== 'object') return [];
              const item = entry as Record<string, unknown>;
              if (typeof item['id'] !== 'string') return [];
              return [
                {
                  id: item['id'],
                  name: typeof item['name'] === 'string' ? item['name'] : item['id'],
                  contextWindow: finiteNumber(item['contextWindow']) || undefined,
                } satisfies ModelDescriptor,
              ];
            })
          : [];
        if (provider) {
          const active = activeModelRef.current;
          const nextList =
            active?.provider === provider && !list.some((item) => item.id === active.model)
              ? [{ id: active.model, name: active.model }, ...list]
              : list;
          setModels((current) => ({ ...current, [provider]: nextList }));
        }
        break;
      }
      case 'provider.text_delta': {
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (!text) break;
        setRunning(true);
        setActivity('Responding');
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) {
            return current.map((item, index) =>
              index === current.length - 1 ? { ...item, text: item.text + text } : item,
            );
          }
          return [
            ...current,
            { id: messageId('assistant'), role: 'assistant', text, streaming: true },
          ];
        });
        break;
      }
      case 'provider.response': {
        const responseText = contentToText(payload['content']).trim();
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === 'assistant' && last.streaming) {
            return current.map((item, index) =>
              index === current.length - 1 ? { ...item, streaming: false } : item,
            );
          }
          return responseText
            ? [...current, { id: messageId('assistant'), role: 'assistant', text: responseText }]
            : current;
        });
        setActivity('Working');
        break;
      }
      case 'iteration.started':
        setRunning(true);
        setActivity('Thinking');
        break;
      case 'tool.started':
        setRunning(true);
        setActivity(`Running ${typeof payload['name'] === 'string' ? payload['name'] : 'tool'}`);
        break;
      case 'tool.progress': {
        const event = payload['event'];
        const text =
          event && typeof event === 'object'
            ? (event as Record<string, unknown>)['text']
            : undefined;
        if (typeof text === 'string' && text.trim())
          setActivity(text.trim().split('\n')[0] ?? 'Working');
        break;
      }
      case 'tool.executed':
        setActivity('Thinking');
        break;
      case 'run.result':
        setRunning(false);
        setActivity('');
        setMessages((current) =>
          current.map((item) => (item.streaming ? { ...item, streaming: false } : item)),
        );
        break;
      case 'error': {
        const text = typeof payload['message'] === 'string' ? payload['message'] : 'Run failed';
        setRunning(false);
        setActivity('');
        setMessages((current) => [...current, { id: messageId('error'), role: 'system', text }]);
        break;
      }
      case 'ctx.pct': {
        const rawLoad = finiteNumber(payload['load']);
        setContext({
          load: rawLoad > 1 ? rawLoad / 100 : rawLoad,
          tokens: finiteNumber(payload['tokens']),
          maxContext: finiteNumber(payload['maxContext']),
        });
        break;
      }
      case 'ctx.max_context': {
        const maxContext = finiteNumber(payload['maxContext']);
        setContext((current) => ({ ...current, maxContext }));
        setSession((current) => (current ? { ...current, maxContext } : current));
        break;
      }
      case 'tool.confirm_needed':
        if (typeof payload['id'] === 'string') {
          setPendingConfirm({
            id: payload['id'],
            toolName: typeof payload['toolName'] === 'string' ? payload['toolName'] : 'tool',
            input: payload['input'],
            riskTier: typeof payload['riskTier'] === 'string' ? payload['riskTier'] : undefined,
          });
        }
        break;
      case 'coordinator.stats': {
        const statuses = Array.isArray(payload['subagentStatuses'])
          ? payload['subagentStatuses']
          : [];
        setSubagents(
          statuses.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const item = entry as Record<string, unknown>;
            const id = typeof item['id'] === 'string' ? item['id'] : '';
            if (!id || id === 'leader') return [];
            return [
              {
                id,
                name: typeof item['name'] === 'string' ? item['name'] : id,
                status: typeof item['status'] === 'string' ? item['status'] : 'idle',
                task: typeof item['currentTask'] === 'string' ? item['currentTask'] : undefined,
              } satisfies SimpleSubagent,
            ];
          }),
        );
        break;
      }
      case 'subagent.event':
        setSubagents((current) => updateSubagents(current, payload));
        break;
      case 'agent.status_changed': {
        const id = typeof payload['subagentId'] === 'string' ? payload['subagentId'] : '';
        if (!id || id === 'leader') break;
        setSubagents((current) => {
          const exists = current.some((agent) => agent.id === id);
          const patch = {
            id,
            name: typeof payload['agentName'] === 'string' ? payload['agentName'] : id,
            status: typeof payload['status'] === 'string' ? payload['status'] : 'idle',
            task: typeof payload['task'] === 'string' ? payload['task'] : undefined,
          } satisfies SimpleSubagent;
          return exists
            ? current.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent))
            : [...current, patch];
        });
        break;
      }
    }
  }, []);

  useEffect(() => {
    const socket = new SimpleSocket({
      onMessage: handleServerMessage,
      onState: (state) => {
        setConnection(state);
        if (state === 'open') {
          socket.send('providers.saved');
          socket.send('providers.list');
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, activity, pendingConfirm]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${Math.min(220, Math.max(54, element.scrollHeight))}px`;
  }, [draft]);

  const groupedModels = useMemo(
    () => Object.entries(models).filter(([, entries]) => entries.length > 0),
    [models],
  );
  const selectedModel = session ? `${session.provider}\t${session.model}` : '';
  const load = Math.max(0, Math.min(1, context.load));
  const latestAssistantId = useMemo(
    () => messages.findLast((message) => message.role === 'assistant')?.id,
    [messages],
  );

  const selectNextStep = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const sendPrompt = () => {
    const content = draft.trim();
    if (!content || connection !== 'open' || !sessionIdRef.current || running) return;
    setMessages((current) => [...current, { id: messageId('user'), role: 'user', text: content }]);
    setDraft('');
    setRunning(true);
    setActivity('Thinking');
    socketRef.current?.send('user_message', {
      sessionId: sessionIdRef.current,
      id: messageId('prompt'),
      content,
      timestamp: Date.now(),
    });
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="project-block">
          <div className="brand-mark" aria-hidden="true">
            W
          </div>
          <div className="project-icon">
            <FolderCode size={17} />
          </div>
          <div className="project-copy">
            <strong>{session?.projectName ?? 'WrongStack'}</strong>
            <span title={session?.cwd}>{session?.cwd || 'Connecting to project…'}</span>
          </div>
        </div>

        <div className="model-control">
          <Bot size={15} aria-hidden="true" />
          <select
            aria-label="Model"
            value={selectedModel}
            disabled={!session || groupedModels.length === 0 || running}
            onChange={(event) => {
              const [provider = '', model = ''] = event.target.value.split('\t');
              if (!provider || !model) return;
              socketRef.current?.send('model.switch', { provider, model });
            }}
          >
            {groupedModels.length === 0 && <option value="">Loading models…</option>}
            {groupedModels.map(([provider, entries]) => (
              <optgroup key={provider} label={providerLabels[provider] ?? provider}>
                {entries.map((item) => (
                  <option key={`${provider}:${item.id}`} value={`${provider}\t${item.id}`}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown size={14} className="select-chevron" aria-hidden="true" />
        </div>

        <div className="topbar-right">
          <div className="context-meter" title={`${context.tokens} / ${context.maxContext} tokens`}>
            <div className="context-copy">
              <span>CONTEXT</span>
              <strong>{Math.round(load * 100)}%</strong>
            </div>
            <div className="context-track">
              <span style={{ width: `${load * 100}%` }} />
            </div>
            <small>
              {compactTokens(context.tokens)} / {compactTokens(context.maxContext)}
            </small>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
            aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <div className={`connection ${connection}`} title={`WebSocket: ${connection}`}>
            {connection === 'open' ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>{connection === 'open' ? 'LIVE' : connection.toUpperCase()}</span>
          </div>
        </div>
      </header>

      {subagents.length > 0 && (
        <section className="agent-strip" aria-label="Subagents">
          <div className="agent-strip-label">
            <Users size={14} /> AGENTS
          </div>
          <div className="agent-list">
            {subagents.map((agent) => (
              <div className="agent-item" key={agent.id} title={agent.task}>
                <span className={`agent-dot ${agent.status}`} />
                <strong>{agent.name}</strong>
                <span>{agent.status}</span>
                {agent.task && <small>{agent.task}</small>}
              </div>
            ))}
          </div>
        </section>
      )}

      <main className="chat-scroll" ref={scrollRef}>
        <div className="conversation">
          {messages.length === 0 ? (
            <div className="empty-state">
              <Sparkles size={25} strokeWidth={1.5} />
              <span>READY IN</span>
              <h1>{session?.projectName ?? 'your project'}</h1>
              <p>Describe the job. WrongStack will handle the rest.</p>
            </div>
          ) : (
            messages.map((message) => {
              const projection =
                message.role === 'assistant'
                  ? projectAssistantMessage(message.text)
                  : { text: message.text, nextSteps: [] };
              const nextSteps =
                message.id === latestAssistantId && !message.streaming
                  ? projection.nextSteps
                  : [];

              return (
                <article className={`message ${message.role}`} key={message.id}>
                  <div className="message-label">
                    {message.role === 'user'
                      ? 'YOU'
                      : message.role === 'assistant'
                        ? 'WRONGSTACK'
                        : 'SYSTEM'}
                  </div>
                  <div className="message-body">
                    {projection.text && (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ children, ...props }) => (
                            <a {...props} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {projection.text}
                      </ReactMarkdown>
                    )}
                    {message.streaming && (
                      <span className="stream-caret" role="status" aria-label="Streaming" />
                    )}
                    {nextSteps.length > 0 && (
                      <section className="next-steps" aria-label="Suggested next steps">
                        <div className="next-steps-heading">
                          <ListChecks size={14} aria-hidden="true" />
                          <span>NEXT STEPS</span>
                        </div>
                        <div className="next-steps-list">
                          {nextSteps.map((step) => (
                            <button
                              type="button"
                              className="next-step"
                              key={`${step.index}:${step.text}`}
                              onClick={() => selectNextStep(step.text)}
                            >
                              <span className="next-step-index">{step.index}</span>
                              <span className="next-step-text">{step.text}</span>
                              {step.auto && <span className="next-step-auto">AUTO</span>}
                            </button>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>
                </article>
              );
            })
          )}
          {running && activity && (
            <div className="activity-line">
              <LoaderCircle size={14} className="spin" />
              <span>{activity}</span>
            </div>
          )}
        </div>
      </main>

      <footer className="composer-wrap">
        <div className="composer-inner">
          {pendingConfirm && (
            <div className={`permission-bar ${pendingConfirm.riskTier ?? 'standard'}`}>
              <ShieldAlert size={17} />
              <div className="permission-copy">
                <strong>Allow {pendingConfirm.toolName}?</strong>
                <span>{safeLine(pendingConfirm.input)}</span>
              </div>
              <div className="permission-actions">
                <button type="button" onClick={() => decideConfirm('no')}>
                  Deny
                </button>
                <button type="button" onClick={() => decideConfirm('always')}>
                  Always
                </button>
                <button type="button" className="primary" onClick={() => decideConfirm('yes')}>
                  Allow
                </button>
              </div>
            </div>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendPrompt();
            }}
          >
            <textarea
              ref={textareaRef}
              aria-label="Message"
              value={draft}
              placeholder={
                connection === 'open' ? 'Tell WrongStack what to do…' : 'Waiting for connection…'
              }
              disabled={connection !== 'open'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  sendPrompt();
                }
              }}
            />
            {running ? (
              <button
                type="button"
                className="send-button stop"
                onClick={abort}
                aria-label="Stop run"
              >
                <CircleStop size={18} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!draft.trim() || connection !== 'open'}
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            )}
          </form>
          <div className="composer-meta">
            <span>ENTER TO SEND · SHIFT + ENTER FOR NEW LINE</span>
            <span>{session?.model ?? 'NO MODEL'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
