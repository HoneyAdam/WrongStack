/**
 * Shared types used across TUI controller modules.
 *
 * Extracted here to avoid identical interface declarations spread across
 * input-key-router, overlay-key-router, run-blocks-controller,
 * submit-controller, and submit-prompt-refinement.
 */

/** Mutable cell — analogous to React useRef / MutableRefObject. */
export interface MutableCell<T> {
  current: T;
}

/** A single segment of streaming assistant output. */
export interface StreamSegment {
  kind: 'assistant' | 'thinking';
  text: string;
}
