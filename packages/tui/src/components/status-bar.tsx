import React from 'react';
import { Box, Text } from 'ink';
import type { TokenCounter } from '@wrongstack/core';

export interface StatusBarProps {
  model: string;
  state: 'idle' | 'running' | 'streaming' | 'aborting';
  tokenCounter?: TokenCounter;
  hint?: string;
  queueCount?: number;
}

export function StatusBar({
  model,
  state,
  tokenCounter,
  hint,
  queueCount = 0,
}: StatusBarProps): React.ReactElement {
  const usage = tokenCounter?.total();
  const cost = tokenCounter?.estimateCost();
  const cache = tokenCounter?.cacheStats();
  const stateColor =
    state === 'idle' ? 'cyan' : state === 'aborting' ? 'yellow' : 'green';
  const stateLabel =
    state === 'idle' ? 'idle' : state === 'aborting' ? 'aborting…' : 'thinking…';

  return (
    <Box flexDirection="row" gap={2} paddingX={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
      <Text color={stateColor}>● {stateLabel}</Text>
      <Text dimColor>│</Text>
      <Text color="magenta">{model}</Text>
      {usage ? (
        <>
          <Text dimColor>│</Text>
          <Text>
            ↑ <Text color="cyan">{fmtTok(usage.input)}</Text> ↓{' '}
            <Text color="cyan">{fmtTok(usage.output)}</Text>
          </Text>
        </>
      ) : null}
      {cache && cache.hitRatio > 0 ? (
        <>
          <Text dimColor>│</Text>
          <Text dimColor>cache {(cache.hitRatio * 100).toFixed(0)}%</Text>
        </>
      ) : null}
      {cost && cost.total > 0 ? (
        <>
          <Text dimColor>│</Text>
          <Text color="yellow">${cost.total.toFixed(4)}</Text>
        </>
      ) : null}
      {queueCount > 0 ? (
        <>
          <Text dimColor>│</Text>
          <Text color="cyan">⌛ queued: {queueCount}</Text>
        </>
      ) : null}
      {hint ? (
        <>
          <Text dimColor>│</Text>
          <Text dimColor>{hint}</Text>
        </>
      ) : null}
    </Box>
  );
}

function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
