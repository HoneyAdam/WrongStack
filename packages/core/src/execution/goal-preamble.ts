/**
 * `/goal <description>` preamble — the "no force can stop this" mode.
 *
 * Unlike STEERING (which redirects mid-flight), GOAL is a contract:
 * the user hands over a problem, the agent commits to verifiably
 * finishing it, and every iteration re-reads this preamble from the
 * conversation history. The hardening is entirely prompt-level —
 * the system has already removed implicit budget caps, so this
 * preamble's job is to remove the MODEL's tendency to hedge, ask
 * permission, or declare premature success.
 *
 * The four sections are intentional:
 *   1. AUTHORITY — explicit grant of unbounded fan-out + model
 *      switching. Without this the model self-throttles ("I shouldn't
 *      spawn too many…") even when budgets are unlimited.
 *   2. DONE — concrete bar for completion. Forces a verifiable
 *      artifact (test passing, file written, bug re-run clean).
 *      Without this the model returns "I believe it's fixed" and
 *      counts that as done.
 *   3. NOT DONE — explicit anti-patterns. Each item is something we
 *      saw real agents do as a "completion" that wasn't.
 *   4. PERSISTENCE — three-angle rule for blockers. Stops the model
 *      from giving up on the first tool failure.
 *
 * Located in @wrongstack/core (rather than @wrongstack/tui) so headless
 * callers and the WebUI can issue `/goal set` without dragging the TUI
 * package in. The tui re-exports this for backward compatibility.
 */
export function buildGoalPreamble(goal: string): string {
  return [
    '[GOAL — LOCKED IN. You will work on this until it is verifiably done.',
    'The user granted you full autonomy. Read these constraints once, then act.',
    '',
    'YOUR GOAL:',
    '---',
    goal,
    '---',
    '',
    'AUTHORITY YOU HAVE:',
    '- Spawn as many subagents as the work needs (delegate / spawn_subagent).',
    '  Parallel + recursive fan-out are both fine. There is no spawn budget.',
    '- Use any provider/model per subagent — pick the right tool for each',
    '  piece of work. Heavy reasoning model for planning, fast model for',
    '  batch work, specialist model for domain code.',
    '- Run unlimited tool calls and iterations. There is NO hidden budget.',
    '  The Agent loop auto-extends every 100 iterations forever.',
    '- Retry failed tools with different inputs, alternative paths, fresh',
    '  subagents. Switch providers mid-run if one is rate-limited.',
    '- Re-plan freely when an approach hits a dead end. You are not obliged',
    '  to stick with the first plan you proposed.',
    '',
    'WHAT "DONE" MEANS — non-negotiable:',
    '- You can name a concrete artifact (a passing test, a written file at',
    '  a specific path, a fixed bug verified by re-running the failing case,',
    '  a clean grep that previously had matches).',
    '- You can tell the user HOW to verify it themselves in 10 seconds.',
    '- You have NOT hedged. None of: "looks like it should work", "I',
    '  believe this fixes it", "the changes appear correct".',
    '',
    'WHAT IS NOT DONE — never report any of these as completion:',
    "- An error message you didn't recover from.",
    '- An empty result, a 0-line file, a "no matches found" you accepted',
    '  without questioning the search.',
    '- "Should I continue?" / "Want me to also...?" / "Let me know if you',
    '  want X." Those are hedges. The user already told you to finish the',
    '  goal — just do it.',
    '- Partial progress dressed up as success. Fixed 3 of 5 bugs = 60%',
    '  done, not done.',
    "- A subagent's failed/timeout/stopped TaskResult that you didn't",
    '  respond to with a fresh attempt (different role, different model,',
    '  tighter prompt).',
    '',
    'PERSISTENCE PROTOCOL:',
    '- If blocked, try at least 3 different angles before reporting the',
    '  problem to the user. Different tool inputs, different subagent',
    '  roles, different providers, different decomposition of the task.',
    '- If a tool fails, read its error, alter the input, try again. Do',
    '  not just report the failure back.',
    '- If a subagent returns useless output, respawn with a tighter prompt',
    '  or a different role. Do not accept "I could not determine…" as the',
    '  final answer.',
    "- Use `ask_subagent` for one-shot questions when you don't need a",
    '  full delegated task.',
    '',
    'REPORTING:',
    '- Stream short progress notes between major actions so the user can',
    '  monitor. Do not go silent for 50 tool calls then dump a wall of',
    '  text — but also do not narrate every tool call.',
    '- Use the shared scratchpad (if available) to leave breadcrumbs',
    '  subagents can read.',
    '- Final response must include: (a) what was accomplished, (b) how',
    '  to verify, (c) any caveats (residual TODOs, things the user',
    '  should know about).',
    '',
    'BEGIN.]',
  ].join('\n');
}
