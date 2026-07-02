import { Box, Text } from '../ink.js';
import type React from 'react';

export interface PluginPickerItem {
  name: string;
  enabled: boolean;
  risk: 'low' | 'medium' | 'high';
  summary: string;
  /**
   * When false the row is locked: the picker renders a 🔒 marker and ignores
   * Enter/←/→ on it. Core plugins (security, prompts, skills, sync, git, …)
   * and the critical guard plugins (secret-scanner, branch-guard) set this
   * to false so they stay visible in the menu but cannot be toggled off —
   * matching the rationale in `PLUGIN_AUDIT_ENTRIES`.
   */
  lockable?: boolean | undefined;
}

export interface PluginPickerProps {
  items: PluginPickerItem[];
  selected: number;
  busy?: boolean | undefined;
  hint?: string | undefined;
}

export function PluginPicker({
  items,
  selected,
  busy = false,
  hint,
}: PluginPickerProps): React.ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        Plugin menu
      </Text>
      <Text dimColor>
        ↑/↓ select · Enter/←/→ toggle · 🔒 = locked · Esc close
      </Text>
      <Box marginTop={1} flexDirection="column">
        {items.length === 0 ? (
          <Text dimColor>{busy ? 'Loading plugins…' : 'No plugins available.'}</Text>
        ) : (
          items.map((item, index) => {
            const focused = index === selected;
            const marker = focused ? '›' : ' ';
            const isLocked = item.lockable === false;
            const state = isLocked
              ? '🔒 on '
              : item.enabled
                ? '● on '
                : '○ off';
            const color = isLocked
              ? 'yellow'
              : item.enabled
                ? 'green'
                : 'gray';
            return (
              <Text key={item.name} color={focused ? 'cyan' : undefined}>
                {marker} <Text color={color}>{state}</Text> {item.name.padEnd(18)}{' '}
                <Text dimColor>risk={item.risk.padEnd(6)}</Text> {item.summary}
              </Text>
            );
          })
        )}
      </Box>
      {hint ? (
        <Box marginTop={1}>
          <Text dimColor>{hint}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
