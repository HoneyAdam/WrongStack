import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import type {
  Agent,
  AttachmentStore,
  EventBus,
  SlashCommandRegistry,
  TokenCounter,
} from '@wrongstack/core';
import { InputBuilder } from '@wrongstack/core';
import { History, type HistoryEntry } from './components/history.js';
import { Input, type KeyEvent } from './components/input.js';
import { StatusBar } from './components/status-bar.js';

export interface AppProps {
  agent: Agent;
  slashRegistry: SlashCommandRegistry;
  attachments: AttachmentStore;
  events: EventBus;
  tokenCounter?: TokenCounter;
  model: string;
  banner?: boolean;
  onExit: (code: number) => void;
}

type State = {
  entries: HistoryEntry[];
  buffer: string;
  cursor: number;
  placeholders: string[];
  streamingText: string;
  status: 'idle' | 'running' | 'streaming' | 'aborting';
  interrupts: number;
  hint: string;
  nextId: number;
};

type Action =
  | { type: 'addEntry'; entry: Omit<HistoryEntry, 'id'> }
  | { type: 'setBuffer'; buffer: string; cursor: number }
  | { type: 'addPlaceholder'; ph: string }
  | { type: 'clearInput' }
  | { type: 'streamDelta'; delta: string }
  | { type: 'streamReset' }
  | { type: 'status'; status: State['status'] }
  | { type: 'interrupt' }
  | { type: 'resetInterrupts' }
  | { type: 'hint'; text: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'addEntry':
      return {
        ...state,
        entries: [...state.entries, { ...action.entry, id: state.nextId } as HistoryEntry],
        nextId: state.nextId + 1,
      };
    case 'setBuffer':
      return { ...state, buffer: action.buffer, cursor: action.cursor };
    case 'addPlaceholder':
      return { ...state, placeholders: [...state.placeholders, action.ph] };
    case 'clearInput':
      return { ...state, buffer: '', cursor: 0, placeholders: [] };
    case 'streamDelta':
      return { ...state, streamingText: state.streamingText + action.delta };
    case 'streamReset':
      return { ...state, streamingText: '' };
    case 'status':
      return { ...state, status: action.status };
    case 'interrupt':
      return { ...state, interrupts: state.interrupts + 1 };
    case 'resetInterrupts':
      return { ...state, interrupts: 0 };
    case 'hint':
      return { ...state, hint: action.text };
  }
}

const PASTE_THRESHOLD_CHARS = 200;

export function App({
  agent,
  slashRegistry,
  attachments,
  events,
  tokenCounter,
  model,
  banner = true,
  onExit,
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    entries: banner
      ? [
          {
            id: 0,
            kind: 'info' as const,
            text: 'WrongStack — Built on the wrong stack. Shipped anyway. (/help, /exit)',
          },
        ]
      : [],
    buffer: '',
    cursor: 0,
    placeholders: [],
    streamingText: '',
    status: 'idle' as const,
    interrupts: 0,
    hint: '',
    nextId: 1,
  });

  const builderRef = useRef<InputBuilder | null>(null);
  if (builderRef.current === null) {
    builderRef.current = new InputBuilder({ store: attachments });
  }

  const activeCtrlRef = useRef<AbortController | null>(null);

  // Subscribe to provider streaming events.
  useEffect(() => {
    const offDelta = events.on('provider.text_delta', (e) => {
      dispatch({ type: 'streamDelta', delta: e.text });
    });
    const offTool = events.on('tool.executed', (e) => {
      dispatch({
        type: 'addEntry',
        entry: { kind: 'tool', name: e.name, durationMs: e.durationMs, ok: e.ok },
      });
    });
    return () => {
      offDelta();
      offTool();
    };
  }, [events]);

  // Handle SIGINT: first cancels current iteration, second exits.
  useEffect(() => {
    const onSigint = () => {
      if (state.interrupts >= 1 && state.status === 'idle') {
        exit();
        onExit(130);
        return;
      }
      dispatch({ type: 'interrupt' });
      if (activeCtrlRef.current) {
        activeCtrlRef.current.abort();
        dispatch({ type: 'status', status: 'aborting' });
        dispatch({
          type: 'addEntry',
          entry: { kind: 'warn', text: 'Iteration cancelled. Press Ctrl+C again to exit.' },
        });
      } else {
        dispatch({
          type: 'addEntry',
          entry: { kind: 'warn', text: 'Press Ctrl+C again to exit.' },
        });
      }
    };
    process.on('SIGINT', onSigint);
    return () => {
      process.off('SIGINT', onSigint);
    };
  }, [state.interrupts, state.status, exit, onExit]);

  const handleKey = async (input: string, key: KeyEvent) => {
    if (state.status !== 'idle') return;

    if (key.return) {
      await submit();
      return;
    }

    if (key.backspace || key.delete) {
      if (state.cursor === 0) return;
      const next = state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor);
      dispatch({ type: 'setBuffer', buffer: next, cursor: state.cursor - 1 });
      return;
    }

    if (key.leftArrow) {
      if (state.cursor > 0) dispatch({ type: 'setBuffer', buffer: state.buffer, cursor: state.cursor - 1 });
      return;
    }
    if (key.rightArrow) {
      if (state.cursor < state.buffer.length)
        dispatch({ type: 'setBuffer', buffer: state.buffer, cursor: state.cursor + 1 });
      return;
    }
    if (key.ctrl && input === 'a') {
      dispatch({ type: 'setBuffer', buffer: state.buffer, cursor: 0 });
      return;
    }
    if (key.ctrl && input === 'e') {
      dispatch({ type: 'setBuffer', buffer: state.buffer, cursor: state.buffer.length });
      return;
    }
    if (key.ctrl && input === 'u') {
      dispatch({ type: 'setBuffer', buffer: '', cursor: 0 });
      return;
    }

    if (!input || key.ctrl || key.meta) return;

    // Paste detection: chunks larger than threshold or containing a newline
    // are routed through InputBuilder instead of inserted character-by-char.
    if (input.length > PASTE_THRESHOLD_CHARS || input.includes('\n')) {
      const builder = builderRef.current;
      if (!builder) return;
      const ph = await builder.appendPaste(input);
      if (ph) {
        const lineCount = input.split('\n').length;
        dispatch({ type: 'addPlaceholder', ph: `${ph} (${lineCount} lines)` });
      } else {
        const next =
          state.buffer.slice(0, state.cursor) + input + state.buffer.slice(state.cursor);
        dispatch({ type: 'setBuffer', buffer: next, cursor: state.cursor + input.length });
      }
      return;
    }

    const next = state.buffer.slice(0, state.cursor) + input + state.buffer.slice(state.cursor);
    dispatch({ type: 'setBuffer', buffer: next, cursor: state.cursor + input.length });
  };

  const submit = async () => {
    const raw = state.buffer;
    const trimmed = raw.trim();
    if (!trimmed && state.placeholders.length === 0) return;

    dispatch({ type: 'resetInterrupts' });
    dispatch({ type: 'addEntry', entry: { kind: 'user', text: trimmed || '(attachments only)' } });

    if (trimmed.startsWith('/')) {
      dispatch({ type: 'clearInput' });
      try {
        const res = await slashRegistry.dispatch(trimmed, agent.ctx);
        if (res?.message) {
          dispatch({ type: 'addEntry', entry: { kind: 'info', text: res.message } });
        }
        if (res?.exit) {
          exit();
          onExit(0);
        }
      } catch (err) {
        dispatch({
          type: 'addEntry',
          entry: { kind: 'error', text: err instanceof Error ? err.message : String(err) },
        });
      }
      return;
    }

    const builder = builderRef.current;
    if (!builder) return;
    if (trimmed) builder.appendText(trimmed);
    const blocks = await builder.submit();
    dispatch({ type: 'clearInput' });

    const ctrl = new AbortController();
    activeCtrlRef.current = ctrl;
    dispatch({ type: 'status', status: 'running' });

    try {
      const startedAt = Date.now();
      const before = tokenCounter?.total();
      const costBefore = tokenCounter?.estimateCost().total ?? 0;
      const result = await agent.run(blocks, { signal: ctrl.signal });

      // Flush the streamed text into history as a single assistant entry.
      if (state.streamingText || (result.status === 'done' && result.finalText)) {
        const text = state.streamingText || result.finalText || '';
        if (text.trim()) dispatch({ type: 'addEntry', entry: { kind: 'assistant', text } });
      }
      dispatch({ type: 'streamReset' });

      if (result.status === 'aborted') {
        dispatch({ type: 'addEntry', entry: { kind: 'warn', text: 'Aborted.' } });
      } else if (result.status === 'failed') {
        dispatch({
          type: 'addEntry',
          entry: {
            kind: 'error',
            text: `Failed: ${result.error instanceof Error ? result.error.message : String(result.error)}`,
          },
        });
      } else if (result.status === 'max_iterations') {
        dispatch({
          type: 'addEntry',
          entry: { kind: 'warn', text: `Hit max iterations (${result.iterations}).` },
        });
      }

      if (tokenCounter && before) {
        const after = tokenCounter.total();
        const costAfter = tokenCounter.estimateCost().total;
        dispatch({
          type: 'addEntry',
          entry: {
            kind: 'turn-summary',
            text: `[in: ${fmtTok(after.input - before.input)}  out: ${fmtTok(after.output - before.output)}  iters: ${result.iterations}  cost: ${(costAfter - costBefore).toFixed(4)}  ${((Date.now() - startedAt) / 1000).toFixed(1)}s]`,
          },
        });
      }
    } catch (err) {
      dispatch({
        type: 'addEntry',
        entry: { kind: 'error', text: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      activeCtrlRef.current = null;
      dispatch({ type: 'status', status: 'idle' });
    }
  };

  const inputHint = useMemo(() => {
    if (state.status !== 'idle') return '';
    if (state.buffer.startsWith('/')) return 'slash command — Enter to dispatch';
    if (state.buffer.startsWith('@')) return '@-picker not yet wired';
    return '';
  }, [state.buffer, state.status]);

  return (
    <Box flexDirection="column">
      <History entries={state.entries} streamingText={state.streamingText} />
      <Input
        value={state.buffer}
        cursor={state.cursor}
        placeholders={state.placeholders}
        disabled={state.status !== 'idle'}
        hint={inputHint}
        onKey={handleKey}
      />
      <StatusBar
        model={model}
        state={state.status}
        tokenCounter={tokenCounter}
        hint={state.hint}
      />
    </Box>
  );
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
