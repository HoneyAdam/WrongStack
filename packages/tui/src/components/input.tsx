import React from 'react';
import { Box, Text, useInput } from 'ink';

export interface InputProps {
  prompt?: string;
  value: string;
  cursor: number;
  placeholders: string[];
  disabled?: boolean;
  hint?: string;
  onKey: (input: string, key: KeyEvent) => void;
}

export interface KeyEvent {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
}

export function Input({
  prompt = '› ',
  value,
  cursor,
  placeholders,
  disabled,
  hint,
  onKey,
}: InputProps): React.ReactElement {
  useInput((input, key) => {
    if (disabled) return;
    onKey(input, key as KeyEvent);
  });

  const before = value.slice(0, cursor);
  const at = value.slice(cursor, cursor + 1) || ' ';
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      {placeholders.map((p, i) => (
        <Text key={i} dimColor>
          {'  ↳ '}
          {p}
        </Text>
      ))}
      <Box>
        <Text color="cyan">{prompt}</Text>
        <Text>{before}</Text>
        <Text inverse>{at}</Text>
        <Text>{after}</Text>
      </Box>
      {hint ? <Text dimColor>{hint}</Text> : null}
    </Box>
  );
}
