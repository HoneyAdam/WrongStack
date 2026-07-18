# `/auto-review` — Continuous auto-review status

`/auto-review` is registered by the opt-in `wstack-auto-review` plugin **only when that plugin's resolved `enabled` option is true**. It reports:

- whether auto-review is enabled;
- the provider and model selected for review subagents;
- the fallback model chain;
- the debounce window, file cap, and parallelism limit;
- the cascade follow-up agent threshold; and
- how many reviews are currently in-flight.

Unlike `/chimera` (which fires once at session end) and `/review` (which is manual), auto-review fires **continuously** on every `iteration.completed` event, debounced so rapid edits within a single burst are batched into one review.

## Subcommands

| Command | Effect |
|---------|--------|
| `/auto-review` | Show current status and config. |
| `/auto-review on` | Enable (via config update). |
| `/auto-review off` | Disable. |

Enable/disable is driven by `config.json` under `extensions["wstack-auto-review"]`.

## How it works

```
iteration.completed
  → git status (detect new file changes since last trigger)
  → debounce (skip if within debounceMs of the last review)
  → batch (cap at maxFilesPerBatch)
  → read file contents
  → buildReviewContext (diffs, siblings, commits, todos, cascadeOn)
  → emit chimera.review_needed
  → Director spawns review subagent (provider/model from config)
  → review report → session transcript + mailbox broadcast
  → emit chimera.review_complete
  → plugin parses severity from report
  → if cascadeOn threshold crossed → emit chimera.cascade_needed
  → Director spawns follow-up agents (security-scanner, bug-hunter)
```

## Cascade (follow-up agents)

When `cascadeOn` is set to `"high"` or `"critical"`, a review report containing findings at or above that severity automatically triggers follow-up investigation agents:

| `cascadeOn` | Fires when | Agents spawned |
|-------------|-----------|----------------|
| `"off"` (default) | Never | None |
| `"high"` | Any High or Critical finding | `bug-hunter` + `security-scanner` (if security keyword present) |
| `"critical"` | Any Critical finding | `bug-hunter` + `security-scanner` (if security keyword present) |

The plugin's `parseReviewSeverity()` extracts Critical/High/Medium counts from the report (matching `### Critical (N)` headers), then `shouldCascade()` gates on the threshold. `decideCascadeAgents()` scans the Critical and High sections for 20 security keywords (injection, xss, secret, shell, deserialization, innerhtml, path traversal, etc.) to decide whether the `security-scanner` agent should join `bug-hunter`.

Follow-up agents receive the review report (capped at 12K chars) and the changed file list, then investigate and confirm or refute each finding. Results are appended to the session transcript.

## Configuration

Configuration is read from `extensions["wstack-auto-review"]`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | false | Master switch |
| `provider` | string | session provider | LLM provider for review agents |
| `model` | string | session model | LLM model for review agents |
| `fallbackProfile` | string | — | Named fallback profile from `config.fallbackProfiles` |
| `debounceMs` | number | 5000 | Min gap between review triggers |
| `maxFilesPerBatch` | number | 15 | Max files per review call |
| `maxConcurrentReviews` | number | 2 | Parallel review subagent cap |
| `cascadeOn` | "off" \| "critical" \| "high" | "off" | Follow-up agent threshold — spawns security-scanner/bug-hunter when findings cross this severity |

Example config:

```json
{
  "extensions": {
    "wstack-auto-review": {
      "enabled": true,
      "provider": "deepseek",
      "model": "deepseek-chat",
      "debounceMs": 5000,
      "maxFilesPerBatch": 15,
      "cascadeOn": "high"
    }
  }
}
```

## What is reviewed

- **Only git-tracked files** that changed since the last review trigger
- **Debounced** — rapid edits within `debounceMs` are batched into one review
- **Capped** at `maxFilesPerBatch` files per call
- **Skipped** — `.wrongstack/` files
- **Deleted files** are silently omitted

## Requirements

- **`--director` flag** (Director mode) — the subagent spawning pipeline (`execution.ts`) requires the Director to be active. Without it, review events are silently skipped.
- **`git`** available in the session working directory.

See also: [`/chimera`](chimera.md) (post-session review), [`/review`](review.md) (manual review trigger).

## Code reference

- `packages/core/src/plugins/auto-review-plugin.ts` — plugin, severity parser, cascade listener
- `packages/cli/src/execution.ts` — `review_complete` emission, `cascade_needed` handler
