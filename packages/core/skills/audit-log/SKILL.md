---
name: audit-log
description: |
  Use this skill when analyzing WrongStack session logs, event streams, or
  system traces to surface patterns, anomalies, or operational insights.
  Triggers: user says "audit", "session analysis", "log analysis", "usage patterns".
version: 1.1.0
---

# Audit Log Agent — WrongStack

Analyzes session logs, event streams, and system traces to surface patterns, anomalies, and actionable insights.

## Workflow

```
1. Collect:  Read session logs from path or sessionRoot
2. Parse:    Extract events: tool calls, iterations, errors, usage
3. Analyze:  Group by category, detect anomalies
4. Report:  Structured markdown summary
```

## What to look for

### Tool usage patterns
- Over-used tools (100+ calls to the same tool = possibly a loop)
- Tools that consistently fail (repeated failures = bug or misconfiguration)
- Unusual tool sequences (e.g., 50 writes in a row with no reads)

### Error patterns
- Same error repeating across iterations
- Error rate by type: what's most common?
- Errors clustered in specific packages or tools

### Cost patterns
- Tokens per iteration: is it growing?
- Which provider/model combination is most expensive?
- Any unexpected cost spikes?

### Context management
- Iterations with very high tool count (possible loop)
- Context compaction triggered frequently
- Session that keeps restarting

## Input

```json
{
  "task": "analyze | report | trends",
  "sessionPath": "<path to session JSONL>",
  "focus": "errors | tools | usage | all"
}
```

## Output format

```
## Audit Report — <date>

### Summary
- Total iterations: N
- Total tool calls: N
- Error rate: X%
- Cost: $X.XX

### Top Errors (by count)
1. `ToolExecutionError` — 47x —集中在 `bash` tool, command timeout
2. `PermissionDenied` — 12x — `exec` tool, no trust file entry

### Tool Usage
| Tool | Calls | Failures | Avg Duration |
|------|-------|----------|--------------|
| read | 142   | 3        | 45ms |
| bash | 89    | 12       | 2300ms |

### Anomalies
- High bash failure rate (13.5%) — likely command timeout
- 3 iterations with >50 tool calls — possible loop, review iteration 14

### Cost Trend
- Iteration 1-10: avg $0.04/iteration
- Iteration 11-20: avg $0.11/iteration (context growth)
```

## Anti-patterns

- **Don't summarize what you didn't parse** — be precise, cite the data
- **Don't mix sessions** — analyze one at a time or aggregate clearly
- **Don't skip error context** — the raw error message is the source of truth
- **Don't ignore cost trends** — growing costs indicate context bloat
- **Don't ignore repeated failures** — same tool failing 5x = real issue

## Skills in scope

- `bug-hunter` — for turning audit findings into concrete bugs to fix
- `refactor-planner` — for addressing systemic issues found in logs