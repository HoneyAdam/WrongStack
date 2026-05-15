import { Box, Text, useInput } from 'ink';
import type React from 'react';

export interface ConfirmPromptProps {
  toolName: string;
  input: unknown;
  suggestedPattern: string;
  onDecision: (decision: 'yes' | 'no' | 'always' | 'deny') => void;
}

function stringifyInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;
  return Object.entries(obj)
    .filter(([k]) => k !== 'content' && k !== 'new_string')
    .map(([k, v]) => `${k}: ${truncate(JSON.stringify(v), 80)}`)
    .join('  ');
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function hasDiff(input: unknown): boolean {
  return Boolean(
    input && typeof input === 'object' && 'diff' in (input as Record<string, unknown>),
  );
}

function renderDiffLine(line: string): React.ReactElement {
  const prefix = line.startsWith('+')
    ? 'green'
    : line.startsWith('-')
      ? 'red'
      : line.startsWith('@@')
        ? 'cyan'
        : undefined;
  return (
    <Text key={line} color={prefix}>
      {line}
      {'\n'}
    </Text>
  );
}

function renderDiff(diff: string): React.ReactElement {
  const lines = diff
    .split('\n')
    .filter((l) => l.length > 0)
    .slice(0, 20);
  return (
    <Box flexDirection="column" paddingX={2}>
      {lines.map((l) => renderDiffLine(l))}
    </Box>
  );
}

export function ConfirmPrompt({
  toolName,
  input,
  suggestedPattern,
  onDecision,
}: ConfirmPromptProps): React.ReactElement {
  useInput((_, key) => {
    if (key.return) {
      onDecision('yes');
    } else if (key.escape) {
      onDecision('no');
    } else if (key.ctrl && _.toLowerCase() === 'a') {
      onDecision('always');
    } else if (key.ctrl && _.toLowerCase() === 'd') {
      onDecision('deny');
    }
  });

  const inputSummary = stringifyInput(input);
  const showDiff = hasDiff(input);
  const inp = input as { diff?: unknown };
  const diff = typeof inp?.diff === 'string' ? inp.diff : '';

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottom={false}
      paddingX={1}
    >
      <Box flexDirection="row">
        <Text bold color="yellow">
          ⚠ Confirm
        </Text>
        <Text> </Text>
        <Text bold>{toolName}</Text>
      </Box>
      {inputSummary ? <Text dimColor>{inputSummary}</Text> : null}
      {showDiff && diff ? (
        <Box flexDirection="column" marginY={1}>
          {renderDiff(diff)}
        </Box>
      ) : null}
      <Text dimColor>─────────────────</Text>
      <Box flexDirection="row">
        <Text>
          <Text bold color="green">
            [↵]
          </Text>
          <Text dimColor> yes </Text>
          <Text bold color="red">
            [Esc]
          </Text>
          <Text dimColor> no </Text>
          <Text bold color="cyan">
            [Ctrl+A]
          </Text>
          <Text dimColor> always ({suggestedPattern}) </Text>
          <Text bold color="red">
            [Ctrl+D]
          </Text>
          <Text dimColor> deny</Text>
        </Text>
      </Box>
    </Box>
  );
}
