export type SubmitHistoryRoute = 'slash' | 'prompt-picker' | 'paste-image' | 'normal';

/**
 * Decide whether a submitted input should be pushed into input history.
 *
 * Mirrors the current TUI submit behavior in `app.tsx`:
 * - blank input is ignored entirely
 * - `/image` and `/paste-image` are remembered
 * - bare `/prompt` and `/prompts-browse` are remembered
 * - all slash commands are remembered
 * - normal free-text submissions are remembered
 */
export function shouldPushSubmittedHistory(raw: string): {
  push: boolean;
  route: SubmitHistoryRoute | 'empty';
  trimmed: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { push: false, route: 'empty', trimmed };
  if (trimmed === '/image' || trimmed === '/paste-image') {
    return { push: true, route: 'paste-image', trimmed };
  }
  if (trimmed === '/prompt' || trimmed === '/prompts-browse') {
    return { push: true, route: 'prompt-picker', trimmed };
  }
  if (trimmed.startsWith('/')) {
    return { push: true, route: 'slash', trimmed };
  }
  return { push: true, route: 'normal', trimmed };
}
