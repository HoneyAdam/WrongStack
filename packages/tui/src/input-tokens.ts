/**
 * Inline attachment chip token grammar, shared by the editable input for chip
 * rendering and whole-token cursor deletion. Kept in sync with the
 * AttachmentStore placeholder regex in @wrongstack/core. Two shapes:
 *   - seq-keyed  `[pasted|image|file #N …]`  (a cosmetic suffix after the seq,
 *     e.g. `, 123 lines`, is tolerated; legacy `[file #N]` is included)
 *   - path-keyed `[file:<path>]`
 */
export const INLINE_TOKEN_SRC = '\\[(?:pasted|image|file) #\\d+[^\\]]*\\]|\\[file:[^\\]]+\\]';

const AT_END = new RegExp(`(?:${INLINE_TOKEN_SRC})$`);
const AT_START = new RegExp(`^(?:${INLINE_TOKEN_SRC})`);
const GLOBAL = new RegExp(INLINE_TOKEN_SRC, 'g');

/**
 * If a whole chip ends immediately before `cursor`, return the buffer and
 * cursor with that chip removed (so one backspace deletes the entire token,
 * anywhere in the line). Returns null when there's no chip there — the caller
 * falls back to a single-character delete.
 */
export function deleteTokenBackward(
  buffer: string,
  cursor: number,
): { buffer: string; cursor: number } | null {
  const m = buffer.slice(0, cursor).match(AT_END);
  if (!m) return null;
  const start = cursor - m[0].length;
  return { buffer: buffer.slice(0, start) + buffer.slice(cursor), cursor: start };
}

/**
 * Length of a chip that starts exactly at `cursor`, or 0 if none — lets a
 * forward delete drop the whole token in one keystroke.
 */
export function tokenLengthForward(buffer: string, cursor: number): number {
  const m = buffer.slice(cursor).match(AT_START);
  return m ? m[0].length : 0;
}

export interface ChipSpan {
  text: string;
  /** True for an attachment chip token, false for a plain run. */
  chip: boolean;
}

/** Split a string into chip / plain spans for styled rendering. */
export function splitChips(text: string): ChipSpan[] {
  if (!text) return [];
  const spans: ChipSpan[] = [];
  let last = 0;
  for (const m of text.matchAll(GLOBAL)) {
    const idx = m.index ?? 0;
    if (idx > last) spans.push({ text: text.slice(last, idx), chip: false });
    spans.push({ text: m[0], chip: true });
    last = idx + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), chip: false });
  return spans;
}
