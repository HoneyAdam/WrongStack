import { useCallback, useEffect, useRef } from 'react';
import { getWSClient, type WrongStackWebSocketClient } from '@/lib/ws-client';
import {
  useChatStore,
  useSessionStore,
  useUIStore,
  useConfigStore,
  useHistoryStore,
  type SessionHistoryEntry,
} from '@/stores';
import type { WSServerMessage } from '@/types';

/**
 * One-shot WebSocket handler installation.
 *
 * Critical: this is called by `useWebSocketBootstrap` from App.tsx EXACTLY
 * ONCE per page. Every other component that needs to talk to the backend uses
 * `useWebSocket()` (below) which only returns action methods — it does NOT
 * register handlers.
 *
 * The earlier design had every component that imported `useWebSocket()`
 * register its own copy of the handlers via `ws.on(type, handler)`. With
 * ChatInput + ConfirmDialog + SettingsPanel all using the hook, every
 * incoming WS message was processed three times — three identical tool
 * bubbles, three appends of the same text_delta, three clearMessages on
 * session.start. That's the "duplicate tool bubble / repeated text" bug
 * the user kept hitting. Singleton install fixes it at the root.
 */
function installHandlers(ws: WrongStackWebSocketClient): () => void {
  const offs: Array<() => void> = [];

  const on = (type: string, fn: (msg: WSServerMessage) => void) => {
    offs.push(ws.on(type, fn));
  };

  on('session.start', (msg) => {
    const payload = msg.payload as {
      sessionId: string;
      model: string;
      provider: string;
      maxContext?: number;
      projectName?: string;
      cwd?: string;
      mode?: string;
      inputCost?: number;
      outputCost?: number;
      cacheReadCost?: number;
      /** Backend tells us "the whole context was wiped on my side, mirror
       *  that in the UI". Sent by context.clear so the chat empties even
       *  though the sessionId is unchanged. */
      reset?: boolean;
    };
    const prev = useSessionStore.getState().session?.id;
    const isNew = !prev || prev !== payload.sessionId;
    useSessionStore.getState().startSession({
      id: payload.sessionId,
      startedAt: Date.now(),
      model: payload.model,
      provider: payload.provider,
    });
    useSessionStore.getState().setEnv({
      maxContext: payload.maxContext,
      projectName: payload.projectName,
      mode: payload.mode,
      inputCost: payload.inputCost,
      outputCost: payload.outputCost,
      cacheReadCost: payload.cacheReadCost,
    });
    useConfigStore.getState().setConfig({
      provider: payload.provider,
      model: payload.model,
    });
    if (isNew || payload.reset) useChatStore.getState().clearMessages();

    // Resume hydration: rebuild the chat from the on-disk transcript so the
    // user can pick up exactly where they left off. We translate each
    // Message into the simpler ChatMessage shape the UI store expects.
    const replay = (payload as { replayMessages?: Array<{ role: string; content: unknown }> }).replayMessages;
    if (replay && replay.length > 0) {
      const chat = useChatStore.getState();
      for (const m of replay) {
        if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
          let text = '';
          if (typeof m.content === 'string') {
            text = m.content;
          } else if (Array.isArray(m.content)) {
            for (const b of m.content as Array<Record<string, unknown>>) {
              if (b.type === 'text' && typeof b.text === 'string') {
                text += (text ? '\n' : '') + b.text;
              } else if (b.type === 'tool_use') {
                chat.addMessage({
                  role: 'tool',
                  content: '',
                  toolName: String(b.name ?? 'tool'),
                  toolInput: b.input,
                  toolUseId: String(b.id ?? ''),
                });
                text = '';
              } else if (b.type === 'tool_result') {
                const all = useChatStore.getState().messages;
                let last: { id: string } | undefined;
                for (let i = all.length - 1; i >= 0; i--) {
                  if (all[i]!.toolUseId === String(b.tool_use_id ?? '')) {
                    last = all[i]!;
                    break;
                  }
                }
                if (last) {
                  chat.setToolResult(
                    last.id,
                    typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
                    !b.is_error,
                  );
                }
              }
            }
          }
          if (text) {
            chat.addMessage({ role: m.role as 'user' | 'assistant', content: text });
          }
        }
      }
    }
  });

  on('context.debug', (msg) => {
    const p = msg.payload as {
      total: number;
      systemPrompt: number;
      tools: {
        total: number;
        count: number;
        breakdown: Array<{ name: string; tokens: number }>;
      };
      messages: {
        total: number;
        count: number;
        breakdown: Array<{ index: number; role: string; tokens: number; preview: string }>;
      };
    };
    const fmt = (n: number) => n.toLocaleString();
    // Sort tools+messages by size descending so the top consumers float up.
    const topTools = [...p.tools.breakdown].sort((a, b) => b.tokens - a.tokens).slice(0, 8);
    const topMsgs = [...p.messages.breakdown].sort((a, b) => b.tokens - a.tokens).slice(0, 8);
    const lines = [
      `📊 **Context breakdown** (heuristic — 4 chars/token)`,
      ``,
      `**Total estimate:** ${fmt(p.total)} tokens`,
      `• System prompt: ${fmt(p.systemPrompt)}`,
      `• Tool schemas: ${fmt(p.tools.total)} (${p.tools.count} tools)`,
      `• Messages: ${fmt(p.messages.total)} (${p.messages.count} messages)`,
      ``,
      `**Top tool schemas:**`,
      ...topTools.map((t) => `  · ${t.name}: ${fmt(t.tokens)}`),
      ``,
      `**Top messages:**`,
      ...topMsgs.map(
        (m) => `  · #${m.index} ${m.role}: ${fmt(m.tokens)} — ${m.preview || '(empty)'}`,
      ),
    ];
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: lines.join('\n'),
    });
  });

  on('context.compacted', (msg) => {
    const payload = msg.payload as {
      before: number;
      after: number;
      saved: number;
      reductions: Array<{ phase: string; saved: number }>;
    };
    // Inline notice in the chat — the model just shed ~N tokens of history,
    // user should see what happened so the next reply context isn't a
    // surprise. Not an error; rendered as a subdued assistant note.
    const summary = payload.reductions.length
      ? payload.reductions.map((r) => `${r.phase}: ${r.saved}`).join(', ')
      : 'no-op';
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: `🗜️ Context compacted: ${payload.before} → ${payload.after} tokens (saved ~${payload.saved}). ${summary}`,
    });
    // The new context size is the de-facto next input — reflect it in the
    // topbar so the ctx % chip updates immediately.
    useSessionStore.setState({ lastInputTokens: payload.after });
  });

  on('session.end', () => {
    useConfigStore.getState().setWsConnected(false);
  });

  on('iteration.started', (msg) => {
    const payload = msg.payload as { index: number; maxIterations?: number };
    useSessionStore.getState().setIteration({
      index: payload.index,
      max: payload.maxIterations ?? 0,
    });
    // Defensive: a new iteration means the agent is actively working.
    // Make sure the running indicator stays visible even if some earlier
    // event dropped isLoading prematurely.
    useChatStore.getState().setLoading(true);
    // Don't pre-create an empty assistant bubble — text_delta lazy-creates
    // one when the model actually writes something.
    useChatStore.getState().setCurrentAssistantMessage(null);
  });

  on('provider.text_delta', (msg) => {
    const payload = msg.payload as { text: string; messageId: string };
    let id = useChatStore.getState().currentAssistantMessageId;
    if (!id) {
      id = useChatStore
        .getState()
        .addMessage({ role: 'assistant', content: '', streaming: true });
      useChatStore.getState().setCurrentAssistantMessage(id);
    }
    useChatStore.getState().appendToMessage(id, payload.text);
  });

  on('tool.started', (msg) => {
    const payload = msg.payload as {
      id: string;
      name: string;
      input?: unknown;
      messageId: string;
    };
    // Guard against duplicate tool.started for the same backend id. Could
    // happen if the agent retries / re-emits, and we definitely don't want a
    // second bubble for the same tool_use.
    const existing = useChatStore
      .getState()
      .messages.find((m) => m.toolUseId === payload.id);
    if (existing) {
      useChatStore.getState().setCurrentToolId(existing.id);
      return;
    }
    useChatStore.getState().setCurrentAssistantMessage(null);
    const id = useChatStore.getState().addMessage({
      role: 'tool',
      content: '',
      toolName: payload.name,
      toolInput: payload.input,
      toolUseId: payload.id,
    });
    useChatStore.getState().setCurrentToolId(id);
    useChatStore.getState().addExecution({
      id: payload.id,
      name: payload.name,
      input: payload.input,
      ok: true,
      startedAt: Date.now(),
    });
  });

  on('tool.progress', (msg) => {
    // Reserved for live tool output; currently logged for observability only.
    // eslint-disable-next-line no-console
    console.debug('[WS] Tool progress:', msg.payload);
  });

  on('tool.executed', (msg) => {
    const payload = msg.payload as {
      id?: string;
      name: string;
      durationMs: number;
      ok: boolean;
      input?: unknown;
      output?: string;
    };
    const { messages, currentToolId } = useChatStore.getState();
    // Prefer matching on backend tool_use id (works for parallel tools).
    // Fall back to currentToolId only when id is missing (legacy emitters).
    const owner = payload.id
      ? messages.find((m) => m.toolUseId === payload.id)
      : currentToolId
        ? messages.find((m) => m.id === currentToolId)
        : undefined;
    if (owner) {
      useChatStore
        .getState()
        .setToolResult(owner.id, payload.output ?? '', payload.ok);
      useChatStore
        .getState()
        .updateMessage(owner.id, { toolDurationMs: payload.durationMs });
    }
    if (payload.id) {
      useChatStore.getState().updateExecution(payload.id, {
        completedAt: Date.now(),
        durationMs: payload.durationMs,
        output: payload.output,
        ok: payload.ok,
      });
    }
    if (currentToolId && owner && owner.id === currentToolId) {
      useChatStore.getState().setCurrentToolId(null);
    }
  });

  on('provider.response', (msg) => {
    const payload = msg.payload as {
      usage: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
      stopReason: string;
      messageId: string;
    };
    useSessionStore.getState().updateUsage(payload.usage);
    const { inputCost, outputCost, cacheReadCost } = useSessionStore.getState();
    const dCost =
      (payload.usage.input * inputCost +
        payload.usage.output * outputCost +
        (payload.usage.cacheRead ?? 0) * cacheReadCost) /
      1_000_000;
    if (dCost > 0) useSessionStore.getState().addCost(dCost);
    // Run is NOT done if the provider stopped to use tools — the agent will
    // execute them and loop. Keep isLoading true so the Thinking/Running
    // indicator stays visible between iterations. The terminal flip happens
    // in run.result.
    if (payload.stopReason !== 'tool_use' && payload.stopReason !== 'tool_call') {
      useChatStore.getState().setLoading(false);
    }
    // Close out the current streaming bubble either way — finalize the text
    // (collapse model-emitted duplicate paragraphs) and drop the streaming
    // flag so a fresh iteration starts a new bubble.
    const id = useChatStore.getState().currentAssistantMessageId;
    if (id) useChatStore.getState().finalizeMessage(id);
    useChatStore.getState().setCurrentAssistantMessage(null);
  });

  on('tool.confirm_needed', (msg) => {
    const payload = msg.payload as {
      id: string;
      toolName: string;
      input: unknown;
      suggestedPattern: string;
    };
    useUIStore.getState().showConfirm({
      id: payload.id,
      toolName: payload.toolName,
      input: payload.input,
      suggestedPattern: payload.suggestedPattern,
    });
  });

  on('run.result', (msg) => {
    const payload = msg.payload as {
      status: string;
      iterations: number;
      finalText?: string;
      error?: { code: string; message: string; recoverable: boolean };
    };
    useSessionStore.getState().setIteration(null);
    useChatStore.getState().setLoading(false);
    useChatStore.getState().setCurrentAssistantMessage(null);
    if (payload.status !== 'done' && payload.error) {
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: `Error: ${payload.error.message}`,
        isError: true,
      });
    }
  });

  on('tools.list', (msg) => {
    const p = msg.payload as {
      tools: Array<{ name: string; description: string; params: string[] }>;
    };
    const lines = [
      `🛠️ **Registered tools** (${p.tools.length})`,
      '',
      ...p.tools.map(
        (t) =>
          `• \`${t.name}\`${t.params.length ? ` (${t.params.join(', ')})` : ''} — ${t.description || '_no description_'}`,
      ),
    ];
    useChatStore.getState().addMessage({ role: 'assistant', content: lines.join('\n') });
  });

  on('memory.list', (msg) => {
    const p = msg.payload as { text: string; error?: string };
    const body = p.text?.trim();
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: p.error
        ? `Memory read failed: ${p.error}`
        : body
          ? `🧠 **Memory** \n\n${body}`
          : '🧠 **Memory** \n\n_empty — nothing remembered yet_',
    });
  });

  on('skills.list', (msg) => {
    const p = msg.payload as {
      enabled: boolean;
      error?: string;
      skills: Array<{
        name: string;
        description: string;
        version: string;
        source: string;
        path: string;
        trigger: string;
        scope: string[];
      }>;
    };
    if (!p.enabled) {
      useChatStore.getState().addMessage({
        role: 'assistant',
        content: '🎯 **Skills** \n\n_disabled (config.features.skills = false)_',
      });
      return;
    }
    const lines = [
      `🎯 **Skills** (${p.skills.length})`,
      '',
      ...(p.skills.length === 0
        ? ['_none registered_']
        : p.skills.map(
            (s) =>
              `• \`${s.name}\`${s.version ? ` v${s.version}` : ''} _(${s.source})_ — ${s.description || s.trigger || '_no description_'}`,
          )),
    ];
    if (p.error) lines.push('', `⚠ ${p.error}`);
    useChatStore.getState().addMessage({ role: 'assistant', content: lines.join('\n') });
  });

  on('diag.get', (msg) => {
    const p = msg.payload as {
      provider: string;
      model: string;
      cwd: string;
      sessionId: string;
      tools: { count: number; names: string[] };
      features: { memory: boolean; skills: boolean; modelsRegistry: boolean };
      mode: string;
      usage: { input: number; output: number; cacheRead?: number };
      messages: number;
      todos: number;
    };
    const lines = [
      '🩺 **Runtime diagnostics**',
      '',
      `**Provider:** \`${p.provider}\` / \`${p.model}\``,
      `**Mode:** \`${p.mode}\``,
      `**Session:** \`${p.sessionId}\``,
      `**CWD:** \`${p.cwd}\``,
      '',
      `**Tools:** ${p.tools.count}`,
      `**Messages:** ${p.messages}  ·  **Todos:** ${p.todos}`,
      `**Usage:** ${p.usage.input.toLocaleString()} in · ${p.usage.output.toLocaleString()} out${p.usage.cacheRead ? ` · ${p.usage.cacheRead.toLocaleString()} cache` : ''}`,
      '',
      `**Features:** memory=${p.features.memory ? '✓' : '✗'} · skills=${p.features.skills ? '✓' : '✗'} · modelsRegistry=${p.features.modelsRegistry ? '✓' : '✗'}`,
    ];
    useChatStore.getState().addMessage({ role: 'assistant', content: lines.join('\n') });
  });

  on('stats.get', (msg) => {
    const p = msg.payload as {
      sessionId: string;
      provider: string;
      model: string;
      usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
      cache: { readTokens: number; writeTokens: number; hitRatio: number } | null;
      cost: number;
      messages: number;
      readFiles: number;
      tools: number;
      elapsedMs: number;
    };
    const elapsedSec = Math.floor(p.elapsedMs / 1000);
    const elapsed =
      elapsedSec < 60
        ? `${elapsedSec}s`
        : elapsedSec < 3600
          ? `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`
          : `${Math.floor(elapsedSec / 3600)}h ${Math.floor((elapsedSec % 3600) / 60)}m`;
    const lines = [
      '📈 **Session stats**',
      '',
      `**Session:** \`${p.sessionId}\``,
      `**Provider/Model:** \`${p.provider}\` / \`${p.model}\``,
      `**Elapsed:** ${elapsed}`,
      '',
      `**Usage:** ${p.usage.input.toLocaleString()} in · ${p.usage.output.toLocaleString()} out`,
      ...(p.cache && p.cache.readTokens > 0
        ? [
            `**Cache:** ${p.cache.readTokens.toLocaleString()} read · ${p.cache.writeTokens.toLocaleString()} write · hit ratio ${(p.cache.hitRatio * 100).toFixed(1)}%`,
          ]
        : []),
      `**Cost:** $${p.cost.toFixed(4)}`,
      '',
      `**Messages:** ${p.messages}  ·  **Files read:** ${p.readFiles}  ·  **Tools available:** ${p.tools}`,
    ];
    useChatStore.getState().addMessage({ role: 'assistant', content: lines.join('\n') });
  });

  on('modes.list', (msg) => {
    const p = msg.payload as {
      modes: Array<{ id: string; name: string; description: string; isActive: boolean }>;
      activeId: string;
    };
    useSessionStore.getState().setModes(
      p.modes.map((m) => ({ id: m.id, name: m.name, description: m.description })),
    );
    useSessionStore.getState().setEnv({ mode: p.activeId });
  });

  on('sessions.list', (msg) => {
    const payload = msg.payload as {
      sessions: SessionHistoryEntry[];
      error?: string;
    };
    useHistoryStore.getState().setEntries(payload.sessions ?? [], payload.error ?? null);
  });

  on('error', (msg) => {
    const payload = msg.payload as { phase: string; message: string };
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: `[${payload.phase}] ${payload.message}`,
      isError: true,
    });
    useChatStore.getState().setLoading(false);
  });

  return () => {
    for (const off of offs) off();
  };
}

/**
 * Mounts the WebSocket connection and installs event handlers EXACTLY ONCE.
 * Call this from App.tsx (top of the tree) and nowhere else.
 */
export function useWebSocketBootstrap(): void {
  const { autoConnect, wsUrl } = useConfigStore();
  const { setWsConnected } = useConfigStore();
  const installed = useRef(false);

  useEffect(() => {
    if (!autoConnect) return;
    const ws = getWSClient(wsUrl);

    ws.connect()
      .then(() => setWsConnected(true))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[WS] Connection failed:', err);
        setWsConnected(false);
      });

    // installed.current guards against React StrictMode's double-mount in dev.
    if (installed.current) return;
    installed.current = true;
    const off = installHandlers(ws);
    return () => {
      off();
      installed.current = false;
    };
  }, [autoConnect, wsUrl, setWsConnected]);
}

/**
 * Cheap accessor for the singleton WS client and its imperative action
 * methods. Components call this freely; it does NOT register handlers.
 */
export function useWebSocket() {
  const { wsUrl } = useConfigStore();
  const client = getWSClient(wsUrl);

  const sendMessage = useCallback(
    (content: string) => {
      if (client.isConnected) return client.sendMessage(content);
      return null;
    },
    [client],
  );

  const sendAbort = useCallback(() => client.sendAbort(), [client]);

  const { hideConfirm } = useUIStore();
  const sendConfirm = useCallback(
    (id: string, decision: 'yes' | 'no' | 'always' | 'deny') => {
      client.sendConfirm(id, decision);
      hideConfirm();
    },
    [client, hideConfirm],
  );

  const switchModel = useCallback(
    (provider: string, model: string) => client.switchModel(provider, model),
    [client],
  );

  const listProviders = useCallback(() => client.listProviders(), [client]);
  const listProviderModels = useCallback(
    (providerId: string) => client.listProviderModels(providerId),
    [client],
  );
  const listSavedProviders = useCallback(
    () => client.listSavedProviders(),
    [client],
  );
  const addKey = useCallback(
    (providerId: string, label: string, apiKey: string) =>
      client.addKey(providerId, label, apiKey),
    [client],
  );
  const updateKey = useCallback(
    (providerId: string, label: string, apiKey: string) =>
      client.updateKey(providerId, label, apiKey),
    [client],
  );
  const deleteKey = useCallback(
    (providerId: string, label: string) => client.deleteKey(providerId, label),
    [client],
  );
  const setActiveKey = useCallback(
    (providerId: string, label: string) =>
      client.setActiveKey(providerId, label),
    [client],
  );
  const addProvider = useCallback(
    (id: string, family: string, baseUrl?: string, apiKey?: string) =>
      client.addProvider(id, family, baseUrl, apiKey),
    [client],
  );
  const removeProvider = useCallback(
    (providerId: string) => client.removeProvider(providerId),
    [client],
  );

  const listSessions = useCallback(
    (limit?: number) => {
      useHistoryStore.getState().setLoading(true);
      client.listSessions(limit);
    },
    [client],
  );
  const deleteSession = useCallback(
    (id: string) => {
      useHistoryStore.getState().removeEntry(id);
      client.deleteSession(id);
    },
    [client],
  );
  const resumeSession = useCallback((id: string) => client.resumeSessionById(id), [client]);
  const saveSession = useCallback(() => client.saveSession(), [client]);
  const listTools = useCallback(() => client.listTools(), [client]);
  const listMemory = useCallback(() => client.listMemory(), [client]);
  const listSkills = useCallback(() => client.listSkills(), [client]);
  const getDiag = useCallback(() => client.getDiag(), [client]);
  const getStats = useCallback(() => client.getStats(), [client]);
  const listModes = useCallback(() => client.listModes(), [client]);
  const switchMode = useCallback((id: string) => client.switchMode(id), [client]);

  return {
    client,
    sendMessage,
    sendAbort,
    sendConfirm,
    switchModel,
    listProviders,
    listProviderModels,
    listSavedProviders,
    addKey,
    updateKey,
    deleteKey,
    setActiveKey,
    addProvider,
    removeProvider,
    listSessions,
    deleteSession,
    resumeSession,
    saveSession,
    listTools,
    listMemory,
    listSkills,
    getDiag,
    getStats,
    listModes,
    switchMode,
  };
}
