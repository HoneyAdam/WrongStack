import React from 'react';
import { Box, Static, Text } from 'ink';

export type HistoryEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'tool'; name: string; durationMs: number; ok: boolean }
  | { id: number; kind: 'info'; text: string }
  | { id: number; kind: 'warn'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'turn-summary'; text: string };

export interface HistoryProps {
  entries: HistoryEntry[];
  streamingText?: string;
}

export function History({ entries, streamingText }: HistoryProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Static items={entries}>
        {(entry) => (
          <Box key={entry.id} marginBottom={entry.kind === 'turn-summary' ? 1 : 0}>
            <Entry entry={entry} />
          </Box>
        )}
      </Static>
      {streamingText ? (
        <Box>
          <Text>{streamingText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function Entry({ entry }: { entry: HistoryEntry }): React.ReactElement {
  switch (entry.kind) {
    case 'user':
      return (
        <Text>
          <Text color="cyan">›</Text> {entry.text}
        </Text>
      );
    case 'assistant':
      return <Text>{entry.text}</Text>;
    case 'tool':
      return (
        <Text dimColor>
          {entry.ok ? '✓' : '✗'} tool: {entry.name} ({entry.durationMs}ms)
        </Text>
      );
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
