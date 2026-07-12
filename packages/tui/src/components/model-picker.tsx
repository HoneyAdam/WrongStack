import type React from 'react';
import { Box, Text } from '../ink.js';
import { colorForFamily, UI_COLORS } from './provider-colors.js';

export interface ProviderOption {
  id: string;
  family: string;
  /** Model ids the picker offers in step 2 for this provider. */
  models: string[];
  /** Optional dim hint shown next to the model list (e.g. "from saved config"). */
  modelsLabel?: string | undefined;
}

export interface ModelPickerProps {
  step: 'provider' | 'model';
  providerOptions: ProviderOption[];
  /** All model options for the current provider. */
  modelOptions: string[];
  /** Filtered/searched model options (may differ when searchQuery is active). */
  filteredOptions: string[];
  selected: number;
  pickedProviderId?: string | undefined;
  /** Current search query (step 2 only). */
  searchQuery?: string | undefined;
  /** Status hint (e.g. error from a failed switch attempt) shown at the bottom. */
  hint?: string | undefined;
  /**
   * Overlay title. Defaults to 'Switch model' (the /model command); generic
   * `requestModelPick` callers pass their own (e.g. "Add council voter").
   */
  titleLabel?: string | undefined;
}

const MAX_VISIBLE = 10;

/** Compute the visible window, keeping `selected` centered when possible. */
function getVisibleWindow(selected: number, total: number): { start: number; end: number } {
  const half = Math.floor(MAX_VISIBLE / 2);
  let start = selected - half;
  let end = start + MAX_VISIBLE;
  if (start < 0) {
    start = 0;
    end = Math.min(total, MAX_VISIBLE);
  }
  if (end > total) {
    end = total;
    start = Math.max(0, end - MAX_VISIBLE);
  }
  return { start, end };
}

/**
 * Two-step Ink overlay for the TUI's `/model` command.
 *   Step 1: pick a provider that has a key.
 *   Step 2: pick a model bound to that provider (type to filter).
 *
 * Driven entirely by props — App owns cursor state, key events, and search.
 */
export function ModelPicker({
  step,
  providerOptions,
  filteredOptions,
  selected,
  pickedProviderId,
  searchQuery,
  hint,
  titleLabel,
}: ModelPickerProps): React.ReactElement {
  const title = titleLabel ?? 'Switch model';
  if (step === 'provider') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={UI_COLORS.border} paddingX={1}>
        <Text color={UI_COLORS.title} bold>
          {`━━ ${title} — Step 1/2: Pick provider ━━`}
        </Text>
        <Text dimColor>↑/↓ navigate · Enter select · Esc cancel · Ctrl+C exit</Text>
        {providerOptions.length === 0 ? (
          <Text dimColor>(no providers with keys — add one via `wstack auth`)</Text>
        ) : (
          <Box flexDirection="column" minHeight={providerOptions.length}>
            {providerOptions.map((p, i) => {
              const isSelected = i === selected;
              const famColor = colorForFamily(p.family);
              return (
                <Text
                  key={p.id}
                  inverse={isSelected}
                  {...(isSelected ? { color: UI_COLORS.focused } : {})}
                >
                  {isSelected ? '› ' : '  '}
                  <Text bold color={isSelected ? undefined : famColor}>
                    {p.id.padEnd(28)}
                  </Text>
                  <Text color={isSelected ? undefined : famColor} dimColor={!isSelected}>
                    {' '}
                    [{p.family}]
                  </Text>
                  <Text dimColor>
                    {' '}
                    {p.models.length} model{p.models.length === 1 ? '' : 's'}
                  </Text>
                </Text>
              );
            })}
          </Box>
        )}
        {hint ? <Text color={UI_COLORS.hint}>{hint}</Text> : null}
      </Box>
    );
  }

  // ── Step 2: model picker with scroll window + search ───────────────────────
  const total = filteredOptions.length;
  const { start, end } = getVisibleWindow(selected, total);
  const visibleItems = filteredOptions.slice(start, end);

  const searchHint = searchQuery
    ? ` | filter:"${searchQuery}" → ${total} match${total === 1 ? '' : 'es'}`
    : total > MAX_VISIBLE
      ? ` (${total} models — type to filter)`
      : '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={UI_COLORS.border} paddingX={1}>
      <Text color={UI_COLORS.title} bold>
        {`━━ ${title} — Step 2/2: Pick model `}({pickedProviderId}
        {searchHint}){' ━━'}
      </Text>
      <Text dimColor>↑/↓ navigate · Enter select · Esc back · Ctrl+C exit · type to filter</Text>
      {total === 0 ? (
        <Text dimColor>
          {searchQuery
            ? `(no models match "${searchQuery}")`
            : '(no models known for this provider)'}
        </Text>
      ) : (
        <Box flexDirection="column" minHeight={MAX_VISIBLE + 2}>
          {start > 0 && <Text dimColor>▲ {start} above</Text>}
          {visibleItems.map((id, vi) => {
            const absoluteIndex = start + vi;
            const isSelected = absoluteIndex === selected;
            return (
              <Text
                key={id}
                inverse={isSelected}
                {...(isSelected ? { color: UI_COLORS.selectedModel } : {})}
              >
                {isSelected ? '› ' : '  '}
                {id}
              </Text>
            );
          })}
          {/* Pad remaining slots so old longer list never leaves ghost text */}
          {Array.from({ length: MAX_VISIBLE - visibleItems.length }).map(
            (_, i) => (
              <Text key={`pad-${i}`}> </Text>
            ),
          )}
          {end < total && <Text dimColor>▼ {total - end} below</Text>}
        </Box>
      )}
      {hint ? <Text color={UI_COLORS.hint}>{hint}</Text> : null}
    </Box>
  );
}
