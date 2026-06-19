import { Box, Text } from '../ink.js';
import type React from 'react';

/** A single F-key entry in the picker. */
export interface FKeyEntry {
  key: number;
  label: string;
  action: string;
}

/** All 12 F-key panels in order. */
export const F_KEY_ENTRIES: FKeyEntry[] = [
  { key: 1, label: 'Project switcher', action: 'projectPickerOpen' },
  { key: 2, label: 'Fleet orchestration monitor', action: 'toggleMonitor' },
  { key: 3, label: 'Agents live monitor', action: 'toggleAgentsMonitor' },
  { key: 4, label: 'Worktree monitor', action: 'toggleWorktreeMonitor' },
  { key: 5, label: 'Autonomy settings', action: 'togglePlanPanel' },
  { key: 6, label: 'Todos monitor overlay', action: 'toggleTodosMonitor' },
  { key: 7, label: 'Queue panel', action: 'toggleQueuePanel' },
  { key: 8, label: 'Process list overlay', action: 'toggleProcessList' },
  { key: 9, label: 'Goal panel', action: 'toggleGoalPanel' },
  { key: 10, label: 'Live sessions panel', action: 'toggleSessionsPanel' },
  { key: 11, label: 'Coordinator monitor', action: 'toggleCoordinatorMonitor' },
  { key: 12, label: 'Status line picker', action: 'statuslineOpen' },
];

export interface FKeyPickerProps {
  selected: number;
}

/**
 * Keyboard-navigable F-key panel picker.
 * Shown when the user types `/f` in the TUI.
 * Arrow keys navigate, Enter opens the selected panel, Esc closes.
 */
export function FKeyPicker({ selected }: FKeyPickerProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexShrink={0}>
      <Text color="cyan" bold>
        ━━ F-Key Panels ━━
      </Text>
      <Text dimColor>↑↓ navigate · Enter open · Esc close</Text>

      {F_KEY_ENTRIES.map((entry) => {
        const idx = entry.key - 1;
        const isSelected = idx === selected;
        const marker = isSelected ? '▸' : ' ';
        const labelColor = isSelected ? 'cyan' : undefined;

        return (
          <Box key={entry.key}>
            <Box width={4} flexShrink={0}>
              <Text color="dimColor">{marker}</Text>
            </Box>
            <Text color="dimColor">
              F{entry.key}
            </Text>
            <Text>  </Text>
            <Text color={labelColor}>{entry.label}</Text>
          </Box>
        );
      })}

      {selected > 0 ? (
        <Text dimColor>↑ Scroll up</Text>
      ) : null}
      {selected < 11 ? (
        <Text dimColor>↓ Scroll down</Text>
      ) : null}
    </Box>
  );
}
