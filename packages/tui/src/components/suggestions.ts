/**
 * Unified next-steps suggestion parser.
 *
 * Three code paths feed into the suggestion store:
 *   1. TUI rendering  — entry.tsx parses only "<next_steps>" from assistant output
 *   2. REPL store     — repl.ts parses only "<next_steps>" from final agent output
 *   3. /suggest output — suggest.ts parses LLM-generated numbered lists
 *
 * Heading mode (`requireHeading = true`):
 *   Assistant-output paths accept only balanced <next_steps>...</next_steps> blocks.
 *   Loose headings like "Next steps:" are intentionally ignored so `/next` only
 *   activates for the canonical machine-readable format.
 *
 * Raw mode (`requireHeading = false`):
 *   Parses numbered/bullet items from anywhere in text (subagent /suggest output).
 *
 * Supported assistant-output format:
 *   <next_steps>      (canonical XML tag format)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface ParsedNextStep {
  index: number;
  text: string;
  /** Whether this item has auto="true" attribute for YOLO+auto autonomy mode. */
  auto?: boolean;
}

export interface ParseNextStepsResult {
  /** Matched steps with their original index and stripped text. */
  steps: ParsedNextStep[];
  /** Flat string array — what gets stored in the suggestion store. */
  texts: string[];
  /**
   * Content with the entire canonical "<next_steps>" block removed.
   * Used by entry.tsx to strip suggestions from the rendered message body.
   */
  stripped: string;
  /** Flat string array — texts of items with auto="true" attribute only. */
  autoTexts: string[];
}

// ── Patterns ───────────────────────────────────────────────────────────────

/** Matches the canonical <next_steps> tag before numbered items. */
const NEXT_STEPS_TAG_RE = /<next_steps>\s*\n+/i;

/** Matches an item line: "1. text", "1) text", "- text", "* text". */
/** Also captures optional auto="true" attribute at the end. */
const ITEM_RE = /^(?:(\d+)[.)]\s*|[-*•]\s*)(.+?)(\s+auto="true")?$/;

const MAX_STEPS = 6;

// ── Core parser ─────────────────────────────────────────────────────────────

/**
 * Parse canonical "<next_steps>" blocks from assistant output (or raw numbered lines).
 *
 * @param content        — raw assistant message text or subagent output
 * @param strict         — retained for compatibility; assistant-output paths always require the canonical XML tag.
 * @param requireHeading — when true, a canonical XML tag must precede the item list.
 *                        when false, numbered/bullet items are parsed from anywhere in text
 *                        (used by /suggest subagent output which has no heading).
 */
export function parseNextSteps(
  content: string,
  strict = false,
  requireHeading = true,
): ParseNextStepsResult {
  if (requireHeading) {
    return parseWithHeading(content, strict);
  }
  return parseRawNumbered(content);
}

/** Parse numbered/bullet items from raw text without a heading. */
function parseRawNumbered(content: string): ParseNextStepsResult {
  const lines = content.split('\n');
  const steps: ParsedNextStep[] = [];
  const seenNumbers = new Set<number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = ITEM_RE.exec(line);
    if (!m) continue; // skip non-item lines in raw mode

    const numPart = m[1];
    const text = m[2]!.trim();
    const hasAuto = !!m[3]; // auto="true" captured in group 3
    let index: number;

    if (numPart !== undefined) {
      index = Number.parseInt(numPart, 10);
    } else {
      index = steps.length + 1; // bullet items get sequential indices
    }

    if (seenNumbers.has(index)) continue;
    if (text.length < 3) continue;
    seenNumbers.add(index);
    steps.push({ index, text, auto: hasAuto });

    if (steps.length >= MAX_STEPS) break;
  }

  return {
    steps,
    texts: steps.map((s) => s.text),
    stripped: content,
    autoTexts: steps.filter((s) => s.auto).map((s) => s.text),
  };
}

/** Parse a heading + item block (the main assistant-message path). */
function parseWithHeading(content: string, _strict: boolean): ParseNextStepsResult {
  const headingMatch = NEXT_STEPS_TAG_RE.exec(content);

  if (!headingMatch) {
    return { steps: [], texts: [], stripped: content, autoTexts: [] };
  }

  const headingEnd = headingMatch.index + headingMatch[0]!.length;
  const afterHeading = content.slice(headingEnd);
  const lines = afterHeading.split('\n');
  const steps: ParsedNextStep[] = [];
  const seenNumbers = new Set<number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = ITEM_RE.exec(line);
    if (!m) break; // non-item line — block ends

    const numPart = m[1];
    const text = m[2]!.trim();
    const hasAuto = !!m[3]; // auto="true" captured in group 3
    let index: number;

    if (numPart !== undefined) {
      index = Number.parseInt(numPart, 10);
    } else {
      index = steps.length + 1;
    }

    if (seenNumbers.has(index)) continue;
    if (text.length < 3) continue;
    seenNumbers.add(index);
    steps.push({ index, text, auto: hasAuto });

    if (steps.length >= MAX_STEPS) break;
  }

  if (steps.length === 0) {
    return { steps: [], texts: [], stripped: content, autoTexts: [] };
  }

  // Require a closing tag. Malformed XML is rejected so raw text remains
  // visible instead of being partially consumed as automation input.
  if (!afterHeading.includes('</next_steps>')) {
    return { steps: [], texts: [], stripped: content, autoTexts: [] };
  }

  const texts = steps.map((s) => s.text);
  const autoTexts = steps.filter((s) => s.auto).map((s) => s.text);

  // Strip the entire XML block from the content. `blockEnd` is the LENGTH of
  // that block, so `content.slice(blockStart + blockEnd)` is the rest of the content.
  const blockStart = headingMatch.index;
  const blockEnd = headingMatch[0]!.length + findBlockEnd(afterHeading, steps.length);
  const stripped =
    (content.slice(0, blockStart) + content.slice(blockStart + blockEnd))
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  return { steps, texts, stripped, autoTexts };
}

/**
 * Find the byte offset in `afterHeading` where the block ends.
 *
 * The block to strip is the items (one per line) plus the `</next_steps>`
 * closing tag (and the trailing newline after it).
 *
 * Returns the byte offset of the first character AFTER the block. The
 * caller's `content.slice(0, blockStart) + content.slice(blockStart + offset)`
 * then produces the stripped content.
 *
 * Walks line-by-line. Stops at the first non-item line, the closing XML
 * tag, or the end of the input — whichever comes first.
 */
function findBlockEnd(afterHeading: string, stepCount: number): number {
  // Fast path: if the block is the <next_steps> XML form, find the closing
  // tag and return its end (consuming the tag + trailing newline).
  const closeIdx = afterHeading.indexOf('</next_steps>');
  if (closeIdx !== -1) {
    let end = closeIdx + '</next_steps>'.length;
    if (afterHeading[end] === '\n') end += 1;
    return end;
  }

  // Defensive fallback for malformed input that reached this helper without a
  // closing tag. The caller rejects such input before using the stripped text.
  const lines = afterHeading.split('\n');
  let consumed = 0;
  let found = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) break; // blank line ends the block

    const m = ITEM_RE.exec(line);
    if (!m) break; // non-item line ends the block

    consumed += rawLine.length + 1; // +1 for the \n separator
    found++;
    if (found >= stepCount) {
      // Don't include the trailing newline of the last item — the slice
      // logic in the caller handles whitespace cleanup.
      consumed -= 1;
      break;
    }
  }

  return consumed;
}

/**
 * Strip <next_steps>...</next_steps> blocks from subagent output text.
 * Subagent results should not contain suggestion blocks — those belong to
 * the main assistant's output. This prevents raw XML tags from appearing
 * as literal text in the fleet panel.
 */
export function stripNextStepsBlock(text: string): string {
  // Match <next_steps>...</next_steps> or <next_steps/> (self-closing)
  // The block may span multiple lines.
  return text
    .replace(/<next_steps\b[^>]*>[\s\S]*?<\/next_steps>/gi, '')
    .replace(/<next_steps\b[^>]*\/?>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
