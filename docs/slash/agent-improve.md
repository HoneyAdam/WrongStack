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
| `learned.md` | Auto-generated wisdom from past sessions (raw capture buffer) |
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

## Knowledge automation

Agents output a `## LEARNED` section in their response to persist
project-specific patterns. The runtime captures these automatically at the
end of delegated subagent tasks, subject to:

- **Cooldown** — 120 seconds between captures per role
- **Frequency cap** — 3 captures per role per session
- **Quality filter** — blocks entries shorter than 50 chars, code-only blocks,
  or near-duplicates (Jaccard ≥ 0.55)
- **Size limit** — at 8 KB (soft) further auto-captures are deferred; at
  16 KB (hard) oldest entries are pruned

Use `/agent-improve <role> capture` to manually re-scan any text for
`## LEARNED` blocks, bypassing the guards.

## Consolidation (optimize learned data)

Over time the raw `learned.md` buffer grows with verbose, overlapping entries.
The `consolidate` action triggers a review process:

1. Reads every raw `learned.md` entry
2. Builds an LLM instruction that synthesizes them into a single
   narrowly-scoped document
3. Sends the instruction to the leader agent via `runText`
4. The agent produces `consolidated.md`, preserving every fact while
   reducing context volume

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
