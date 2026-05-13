import React from 'react';
import { Box, Static, Text } from 'ink';

export type HistoryEntry =
  | { id: number; kind: 'user'; text: string; queued?: boolean }
  | { id: number; kind: 'assistant'; text: string }
  | {
      id: number;
      kind: 'tool';
      name: string;
      durationMs: number;
      ok: boolean;
      input?: unknown;
      output?: string;
    }
  | { id: number; kind: 'info'; text: string }
  | { id: number; kind: 'warn'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'turn-summary'; text: string };

export interface HistoryProps {
  entries: HistoryEntry[];
  streamingText?: string;
}

export function History({ entries, streamingText }: HistoryProps): React.ReactElement {
  // Cap the streaming tail. Ink redraws the dynamic area in-place each
  // render by counting the lines it last emitted and moving the cursor
  // up that many rows. If the streaming buffer grows past the terminal
  // viewport, that math breaks and the input + status bar get dumped
  // into scrollback — which is exactly the "duplicating dynamic UI"
  // bug we hit. The full response is still flushed to Static as a
  // single `assistant` entry when the iteration finishes (see
  // app.tsx runBlocks), so capping here is purely visual.
  const tail = streamingText ? tailForDisplay(streamingText, MAX_STREAM_DISPLAY_CHARS) : '';

  return (
    <Box flexDirection="column">
      <Static items={entries}>
        {(entry) => (
          <Box key={entry.id} marginBottom={entry.kind === 'turn-summary' ? 1 : 0}>
            <Entry entry={entry} />
          </Box>
        )}
      </Static>
      {tail ? (
        <Box>
          <Text>{tail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

const MAX_STREAM_DISPLAY_CHARS = 480;

export function tailForDisplay(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.length - maxChars;
  // Prefer a newline boundary near the cut for a cleaner visual edge.
  const nl = text.indexOf('\n', cut);
  if (nl !== -1 && nl < cut + 80) {
    return `… ${text.slice(nl + 1)}`;
  }
  return `… ${text.slice(cut)}`;
}

function Entry({ entry }: { entry: HistoryEntry }): React.ReactElement {
  switch (entry.kind) {
    case 'user':
      return (
        <Text>
          <Text color={entry.queued ? 'yellow' : 'cyan'}>{entry.queued ? '⌛' : '›'}</Text>{' '}
          <Text dimColor={entry.queued ?? false}>{entry.text}</Text>
          {entry.queued ? <Text dimColor>{' (queued)'}</Text> : null}
        </Text>
      );
    case 'assistant':
      return <Text>{entry.text}</Text>;
    case 'tool': {
      const argsLine = entry.input !== undefined ? previewArgs(entry.input) : '';
      const outLine = entry.output ? previewOutput(entry.output) : '';
      return (
        <Box flexDirection="column">
          <Text dimColor>
            {entry.ok ? '✓' : '✗'} tool: {entry.name} · {entry.durationMs}ms
          </Text>
          {argsLine ? (
            <Text dimColor>
              {'  args: '}
              {argsLine}
            </Text>
          ) : null}
          {outLine ? (
            <Text dimColor>
              {'  → '}
              {entry.ok ? '' : '! '}
              {outLine}
            </Text>
          ) : null}
        </Box>
      );
    }
    case 'info':
      return <Text dimColor>{entry.text}</Text>;
    case 'warn':
      return <Text color="yellow">{entry.text}</Text>;
    case 'error':
      return <Text color="red">{entry.text}</Text>;
    case 'turn-summary':
      return <Text dimColor>{entry.text}</Text>;
  }
}

const MAX_PREVIEW = 120;

export function previewArgs(input: unknown): string {
  let s: string;
  try {
    s = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  return collapse(s, MAX_PREVIEW);
}

export function previewOutput(output: string): string {
  return collapse(output, MAX_PREVIEW);
}

function collapse(s: string, max: number): string {
  const oneLine = s.replace(/\r?\n/g, '↵').replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}
