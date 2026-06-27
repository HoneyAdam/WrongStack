import type React from 'react';
import { Box, Text } from '../ink.js';

export interface PromptPickEntry {
  slug: string;
  title: string;
  description: string;
  category: string;
  source: string;
  content: string;
}

const MAX_VISIBLE = 12;

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

/** Apply the picker's category filter. catIndex 0 (= "all") returns everything. */
export function filterPromptPicker(
  all: PromptPickEntry[],
  categories: string[],
  catIndex: number,
): PromptPickEntry[] {
  const cat = categories[catIndex];
  if (!cat || cat === 'all') return all;
  return all.filter((e) => e.category === cat);
}

function glyph(source: string): string {
  return source === 'project' ? '📁' : source === 'user' ? '👤' : source === 'synced' ? '☁' : '📦';
}

export interface PromptPickerProps {
  /** Already-filtered entries for the active category. */
  entries: PromptPickEntry[];
  selected: number;
  category: string;
  total: number;
}

/**
 * Prompt library picker overlay (opened by a bare `/prompt` in the TUI).
 * Presentational only — navigation/category/selection state lives in the
 * reducer; Enter sets the input buffer to the chosen prompt's content (with
 * any `{{variables}}` left in place for the user to fill inline).
 */
export function PromptPicker({ entries, selected, category, total }: PromptPickerProps): React.ReactElement {
  const { start, end } = getVisibleWindow(selected, entries.length);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        ━━ Prompt library · {category} ({entries.length}/{total}) ━━
      </Text>
      <Text dimColor>↑/↓ navigate · ←/→ category · Enter insert · Esc cancel</Text>
      {entries.length === 0 ? (
        <Text dimColor>No prompts in this category.</Text>
      ) : (
        entries.slice(start, end).map((e, i) => {
          const idx = start + i;
          const isSel = idx === selected;
          return (
            <Text key={e.slug} inverse={isSel} {...(isSel ? { color: 'cyan' } : {})}>
              {isSel ? '› ' : '  '}
              {glyph(e.source)} <Text bold>{e.title}</Text>{' '}
              <Text dimColor>{e.description.slice(0, 52)}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}
