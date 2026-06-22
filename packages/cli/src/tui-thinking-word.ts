export const DEFAULT_TUI_THINKING_WORD = 'thinking';
export const MAX_TUI_THINKING_WORD_LENGTH = 16;

/** Normalize autonomy.thinkingWord to a single short word for the TUI statusline. */
export function normalizeTuiThinkingWord(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_TUI_THINKING_WORD;
  const word = value.trim();
  if (word.length === 0 || word.length > MAX_TUI_THINKING_WORD_LENGTH) {
    return DEFAULT_TUI_THINKING_WORD;
  }
  if (!/^[\p{L}\p{N}_-]+$/u.test(word)) return DEFAULT_TUI_THINKING_WORD;
  return word;
}
