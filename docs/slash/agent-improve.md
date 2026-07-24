# /agent-improve — Project agent identity and learning management

Manage per-role project customizations: identity, learned knowledge, runtime
configuration, and the consolidation review process.

Each built-in roster agent has a base definition (role + prompt + tools) in
the catalog. On top of that, each project can override prompt, tools, budget,
attach a custom identity, accumulate learned wisdom, and consolidate that
wisdom into an optimized document.

Files live under `.wrongstack/agents/<role>/`:

| File | Purpose |
|---|---|
| `config.json` | Static overrides (tools, budget, model policy, availability) |
| `identity.md` | Custom prompt appendix (tone, project-specific rules) |
| `learned.md` | **Structured instruction list** — what the agent has learned, decomposed into what / why / how |
| `consolidated.md` | Reviewed, LLM-synthesized document (optimized learned data) |
| `consolidation.json` | Metadata tracking the last consolidation review |
| `knowledge.json` | Current-needs checklist (versions to verify today) |
| `learning.json` | Learning policy (enabled/disabled, capture counters) |
| `profile.json` | Durable definition for project-created roles |

## Subcommands

| Command | Effect |
|---|---|
| `/agent-improve` | List all roles with project customizations |
| `/agent-improve <role>` | Show customization details for one role |
| `/agent-improve <role> show` | Same as above |
| `/agent-improve <role> update <text>` | Write new identity content for the role |
| `/agent-improve <role> refresh` | Reset identity.md + learned.md to empty templates (keeps config/knowledge) |
| `/agent-improve <role> capture` | Scan last agent output for `## LEARNED` blocks and persist them |
| `/agent-improve <role> consolidate` | Optimize raw learned entries into a reviewed, consolidated document |
| `/agent-improve <role> reset` | Delete ALL custom files for this role |
| `/agent-improve * reset` | Delete ALL custom files for every role |

## Knowledge capture

Agents output a `## LEARNED` section in their response to persist
project-specific patterns. The runtime captures these automatically at the
end of delegated subagent tasks, subject to:

- **Cooldown** — 120 seconds between captures per role
- **Frequency cap** — 3 captures per role per session
- **Normalization** — each captured block is run through `normalizeLearnedEntry`
  before it qualifies as learned data:
  - Strips ephemeral artifacts (commit SHAs, timestamps, line numbers,
    PR/issue refs) so entries stay actionable across sessions
  - Drops narrative-only sentences ("When I did X...", "Today I found...")
    while salvaging any directive tail via deontic-verb detection
    ("had to use", "must be", "should")
  - Enforces a 600-character cap (truncates to the last fitting sentence
    boundary)
  - Rejects entries that are too short, too narrative, or code-only
  - Classifies each entry into one of four categories:
    `convention`, `pattern`, `warning`, or `fact`
- **Size limit** — at 8 KB (soft) further auto-captures are deferred; at
  16 KB (hard) oldest entries are pruned

Use `/agent-improve <role> capture` to manually re-scan any text for
`## LEARNED` blocks, bypassing the guards.

### Structured instruction list (capture-time consolidation)

Every capture **merges the new entry with all historical entries and
rewrites the entire `learned.md` buffer as a structured instruction list**.
The buffer is never an append-only journal — it is always a current,
consolidated snapshot of what the agent has learned.

The structured format groups entries by category and decomposes each into
three components:

| Component | Description |
|---|---|
| **What** | The directive itself — what the agent should do (e.g. "Always run pnpm typecheck before declaring work complete.") |
| **Why** | The reason behind the directive — derived from the entry's category and any project-specific signals in the text (e.g. "Established convention — skipping it risks regressions.") |
| **How** | Concrete, runnable anchors — commands, file paths, and package names extracted from backticks in the directive text (e.g. ``pnpm typecheck``, `packages/core/src/...`) |

#### Categories

| Category | Section heading | Trigger words | Example |
|---|---|---|---|
| **warning** | `## What to avoid` | avoid, never, must not, beware, pitfall | "Avoid mutating shared state in async handlers." |
| **convention** | `## What to do` | always, must, should, ensure, verify, before, after | "Always run pnpm typecheck before declaring work complete." |
| **pattern** | `## Patterns to follow` | use, prefer, choose, adopt, pattern, approach | "Use pnpm for monorepo package management." |
| **fact** | `## Project facts` | (default when no directive verb matches) | "The project uses vitest 2.x for unit tests." |

Categories are ordered warning-first in the rendered document so the
highest-signal entries (pitfalls) are seen first.

#### Example buffer

```markdown
# Learned instructions for `executor`

> Project-specific learning data for the `executor` agent. Each entry is a
> directive — read it as an instruction, not a journal entry.

## What to avoid

<!-- learned-stamp: category=warning; capturedAt=2026-07-24T13:44:00Z -->
- **Avoid mutating shared state in async handlers.**
  - *Why:* Known failure mode — skipping this has caused real defects in this
    codebase. The cost of getting it wrong outweighs the cost of the check.

## What to do

<!-- learned-stamp: category=convention; capturedAt=2026-07-24T13:44:00Z -->
- **Always run pnpm typecheck before declaring work complete.**
  - *Why:* Established convention — skipping it risks regressions. Project
    signals: guard before shipping.
  - *How:* `pnpm --filter @wrongstack/core typecheck`

## Patterns to follow

<!-- learned-stamp: category=pattern; capturedAt=2026-07-24T13:44:00Z -->
- **Use pnpm for monorepo package management.**
  - *Why:* This project's chosen approach — alternatives were considered and
    rejected.

---
*Last capture: 2026-07-24T13:44:00Z · 3 entries*
```

#### How it works

1. **Parse** — existing entries are read from the buffer (stamp metadata is
   recovered from hidden `<!-- learned-stamp: -->` comments)
2. **Normalize** — each new `## LEARNED` block is stripped of ephemeral
   artifacts, narrative framing, and classified
3. **Merge** — the new entry is merged with existing entries, deduplicating
   by content similarity (Jaccard ≥ 0.55 on normalized token sets)
4. **Decompose** — every entry is split into what / why / how
5. **Render** — the full structured document is written as the single source
   of truth

#### Writing good `## LEARNED` blocks

The runtime tells each agent how to write captureable entries. The key rules:

- **Write directives, not narratives.** "Always use X for Y" persists.
  "When I worked on X today I noticed Y" is rejected at capture time.
- **Be generic.** No commit SHAs, timestamps, line numbers, or PR refs.
  File paths, package names, and command names are fine — they anchor the
  lesson.
- **Front-load concrete anchors.** Commands in backticks and file paths are
  extracted into the "How" field automatically.

**Bad** (session log — rejected):
```
## LEARNED
When I worked on the telegram plugin today, commit 9c7682b84 had a race
condition in poll-lock at line 42 because writeFileSync wasn't using the
'wx' flag.
```

**Good** (directive — persists, then merges into the structured list):
```
## LEARNED
Always use the 'wx' (exclusive create) flag with writeFileSync when
implementing concurrent lock acquisition in `packages/core/src/.../poll-lock.ts`
— filesystem-level atomicity guarantees only one writer wins.
```

## Consolidation (optimize learned data)

The `consolidate` action triggers an LLM review pass that synthesizes the
structured entries into a single, narrowly-scoped document:

1. Reads every entry from the structured buffer
2. Builds an LLM instruction that extracts directives, drops noise, and
   rewrites verbose entries into concise guidance
3. Sends the instruction to the leader agent via `runText`
4. The agent produces `consolidated.md`

The consolidation instruction emphasizes **being selective** — dropping
narrative fragments, extracting the directive from mixed entries, and
rewriting session-specific anchors into general principles. The output must
be smaller than the input; a consolidation that preserves every word is not
a consolidation.

Once `consolidated.md` exists:

- `buildProjectContextualizedPrompt` prefers it over the raw `learned.md`
- New raw entries captured after consolidation are appended under a
  "Recently captured" section (staleness gate) so the capture→inject loop
  is never broken
- The raw buffer is retained on disk for audit

Metadata in `consolidation.json` tracks the source entry count, byte
reduction, trigger source, and optional model.

### WebUI equivalent

The **Self-Learning** tab in the WebUI Agent Roster view provides the same
capability:

- **Optimize** button per agent — triggers consolidation for one role
- **Optimize All (N)** bulk action — consolidates every agent exceeding the
  soft limit in a single combined prompt
- **Proactive warnings** — agents with `needsSummarization: true` are
  highlighted with warning borders and actionable badges

## Examples

```
/agent-improve
/agent-improve executor show
/agent-improve executor update "Always run typecheck before reporting completion."
/agent-improve executor capture
/agent-improve executor consolidate
/agent-improve executor refresh
/agent-improve executor reset
```

See also: `/spawn` (fleet spawning), `/fleet` (fleet management).
