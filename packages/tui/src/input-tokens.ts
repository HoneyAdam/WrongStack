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

/** One rendered cell of the input row. Exactly one of chip/prompt/cursor may be true. */
export interface InputCell {
  ch: string;
  /** Inside an attachment chip token. */
  chip: boolean;
  /** Part of the leading prompt (e.g. "› "). */
  prompt: boolean;
  /** The single cursor cell (rendered inverse). */
  cursor: boolean;
}

/**
 * Lay out `prompt + value` into wrapped rows of at most `width` columns, so the
 * input area can grow to exactly the number of visual lines its content needs.
 * Char-wrap (not word-wrap) keeps every cell index aligned with the buffer, so
 * the cursor lands on the right row/column. A cursor at end-of-buffer gets a
 * virtual trailing space cell (which may spill onto a fresh row, exactly like a
 * terminal). Newlines in `value` start a new row.
 */
export function layoutInputRows(
  prompt: string,
  value: string,
  cursor: number,
  width: number,
): InputCell[][] {
  const w = Math.max(1, Math.floor(width));
  // Mark which value-character offsets fall inside a chip token.
  const chipAt = new Array<boolean>(value.length).fill(false);
  let off = 0;
  for (const span of splitChips(value)) {
    if (span.chip) for (let i = 0; i < span.text.length; i++) chipAt[off + i] = true;
    off += span.text.length;
  }
  const cursorIdx = prompt.length + Math.max(0, Math.min(cursor, value.length));
  const cells: InputCell[] = [];
  for (let i = 0; i < prompt.length; i++) {
    cells.push({ ch: prompt[i] as string, chip: false, prompt: true, cursor: false });
  }
  for (let i = 0; i < value.length; i++) {
    cells.push({ ch: value[i] as string, chip: chipAt[i] === true, prompt: false, cursor: false });
  }
  if (cursorIdx >= cells.length) {
    cells.push({ ch: ' ', chip: false, prompt: false, cursor: true });
  } else {
    (cells[cursorIdx] as InputCell).cursor = true;
  }
  // Wrap into rows: break on explicit '\n' (consumed) or when a row fills `w`.
  const rows: InputCell[][] = [];
  let row: InputCell[] = [];
  for (const cell of cells) {
    if (cell.ch === '\n') {
      rows.push(row);
      row = [];
      continue;
    }
    row.push(cell);
    if (row.length >= w) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0 || rows.length === 0) rows.push(row);
  return rows;
}
