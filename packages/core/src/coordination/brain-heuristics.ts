/**
 * Shared heuristic patterns for Brain decision-making.
 *
 * These regexes are used by both `DefaultBrainArbiter` (coordination/brain.ts)
 * and `quickDecide` (execution/autonomy-brain.ts) to detect the
 * blocked-resolved pattern: a question about a blocked task where the
 * context contains explicit evidence that the blocker has been resolved.
 *
 * Extracted to a single module to prevent drift between the two consumers.
 * If you add or remove a resolution marker, update BOTH the regex and the
 * tests in `tests/execution/brain-quickdecide.test.ts`.
 */

/**
 * Resolution markers: words that indicate a blocking dependency has been
 * explicitly resolved in the context. Word-boundary anchored to avoid
 * false positives on substrings (e.g. "unresolved" should NOT match).
 */
export const BLOCKED_RESOLVED_MARKERS =
  /\b(?:resolved|fixed|completed|unblocked|available|done|merged|landed|shipped)\b/;

/**
 * Competing-alternative guard: rejects questions that offer a choice
 * (e.g. "Should we unblock and continue or wait?"). When "or" is present,
 * the question is offering alternatives — not a simple unblock signal.
 */
export const COMPETING_ALTERNATIVE = /\bor\b/;

/**
 * Evaluate the blocked-resolved heuristic against a question/context pair.
 *
 * Returns `true` when:
 * 1. The question mentions "blocked"
 * 2. The question does NOT contain competing alternatives ("or")
 * 3. The context contains an explicit resolution marker
 *
 * Callers must additionally verify:
 * - `request.fallback === 'continue'` (caller declared continue safe)
 * - `!request.options?.length` (no structured choices to override)
 *
 * @param question - Lowercased question text
 * @param context - Lowercased context text
 */
export function isBlockedResolved(question: string, context: string): boolean {
  return (
    question.includes('blocked') &&
    !COMPETING_ALTERNATIVE.test(question) &&
    BLOCKED_RESOLVED_MARKERS.test(context)
  );
}
