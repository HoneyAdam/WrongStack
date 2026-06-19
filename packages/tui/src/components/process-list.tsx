import { Box, Text, useInput } from '../ink.js';
import { useEffect, useState } from 'react';
import type React from 'react';
import { getProcessRegistry } from '@wrongstack/tools';

/**
 * F8 — Process List Monitor.
 *
 * Live view of all background bash/exec processes tracked by the global
 * ProcessRegistry. This panel OWNS the keyboard while open:
 * every keystroke is captured here and NEVER reaches the chat input,
 * because handleKey in app.tsx returns early when processListOpen is true
 * (before it can modify the input buffer). This two-layer design —
 * ProcessList's own useInput for shortcuts, handleKey's guard to suppress
 * everything else — keeps the input field completely unaffected.
 */
export function ProcessListMonitor(): React.ReactElement {
  const [, setTick] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Force a re-render every second so elapsed times stay live.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Re-read from the registry on every render so the list is always fresh.
  const registry = getProcessRegistry();
  const all = registry.list();
  const stats = registry.stats();

  // Clamp selection when the list shrinks (process exited / killed / removed).
  // Without this, safeIndex fixes the render but selectedIndex stays stale,
  // causing a jump when a new process appears later.
  const safeIndex = Math.min(selectedIndex, Math.max(0, all.length - 1));
  if (safeIndex !== selectedIndex) {
    // Eagerly sync so the next keystroke works from the correct position.
    setSelectedIndex(safeIndex);
  }
  const selected = all[safeIndex];

  const now = Date.now();
  const running = all.filter((p) => !p.killed).length;

  // Circuit breaker state label
  const b = stats.breaker;
  const breakerState =
    b.state === 'closed'
      ? '🟢 closed'
      : b.state === 'half-open'
        ? '🟡 half-open'
        : '🔴 open';

  const pageSize = Math.max(1, Math.floor(all.length / 2));

  useInput((input, key) => {
    // Navigation — these NEVER touch the chat input buffer
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(all.length - 1, prev + 1));
    } else if (key.pageUp) {
      setSelectedIndex((prev) => Math.max(0, prev - pageSize));
    } else if (key.pageDown) {
      setSelectedIndex((prev) => Math.min(all.length - 1, prev + pageSize));
    } else if (key.home || (key.ctrl && input === 'a') || input === 'g') {
      setSelectedIndex(0);
    } else if (key.end || (key.ctrl && input === 'e') || input === 'G') {
      setSelectedIndex(Math.max(0, all.length - 1));
    }
    // Actions — also NEVER touch the chat input buffer
    else if (key.return && selected) {
      getProcessRegistry().kill(selected.pid);
    } else if (key.delete && selected) {
      getProcessRegistry().kill(selected.pid, { force: true });
    } else if (input === 'a' && !key.ctrl) {
      getProcessRegistry().killAll();
    } else if (input === 'A') {
      getProcessRegistry().killAll({ force: true });
    } else if (input === 'r') {
      getProcessRegistry().forceBreakerReset();
    }
    // Every other key is deliberately ignored — it will fall through
    // to handleKey in app.tsx, which returns early when processListOpen
    // is true, so nothing ever reaches the input buffer.
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
      {/* Header */}
      <Box flexDirection="row" gap={1}>
        <Text bold color="red">
          PROCESS LIST
        </Text>
        <Text dimColor>│</Text>
        <Text color={running > 0 ? 'yellow' : 'green'}>●{running}</Text>
        <Text dimColor>/</Text>
        <Text dimColor>{all.length} tracked</Text>
        <Text dimColor>│</Text>
        <Text dimColor>
          breaker {breakerState}
          {b.state !== 'closed' ? ` fail=${b.consecutiveFailures}/5 slow=${b.slowCallsInWindow}/3` : ''}
        </Text>
        <Text dimColor>│ F8 to close</Text>
      </Box>

      {all.length === 0 ? (
        <Text dimColor>No active processes. Bash/exec spawns appear here.</Text>
      ) : null}

      {/* Process rows */}
      {all.map((p, i) => {
        const age = ((now - p.startedAt) / 1000).toFixed(1);
        const isSelected = i === safeIndex;
        const cmd = p.command.length > 90 ? `${p.command.slice(0, 87)}…` : p.command;

        return (
          <Box key={p.pid} flexDirection="row" gap={1}>
            <Text color={isSelected ? 'red' : 'gray'}>{isSelected ? '▶' : ' '}</Text>
            <Text dimColor>{String(p.pid).padEnd(7)}</Text>
            <Text dimColor>{p.name.padEnd(6)}</Text>
            <Text dimColor>{`${age}s`.padEnd(7)}</Text>
            <Text {...(isSelected ? { color: 'red' } : {})} bold={isSelected}>
              {cmd}
            </Text>
            {p.killed ? <Text color="red">[killed]</Text> : null}
          </Box>
        );
      })}

      {/* Keyboard hints */}
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text dimColor>↑↓ nav</Text>
        <Text dimColor>·</Text>
        <Text dimColor>PgUp/PgDn page</Text>
        <Text dimColor>·</Text>
        <Text dimColor>Home/Ctrl+A/g first</Text>
        <Text dimColor>·</Text>
        <Text dimColor>End/Ctrl+E/G last</Text>
      </Box>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Enter kill (SIGTERM)</Text>
        <Text dimColor>·</Text>
        <Text dimColor>Del force kill (SIGKILL)</Text>
        <Text dimColor>·</Text>
        <Text dimColor>a kill all</Text>
        <Text dimColor>·</Text>
        <Text dimColor>r reset breaker</Text>
      </Box>
    </Box>
  );
}
