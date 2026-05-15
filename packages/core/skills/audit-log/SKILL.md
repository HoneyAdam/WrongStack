---
name: audit-log
description: |
  System-wide audit log analysis. Covers log parsing, anomaly detection,
  pattern recognition across sessions, and structured reporting.
  Use for post-mortems, trend analysis, and operational insights.
version: 1.0.0
---

# Audit Log Agent

Analyzes session logs, event streams, and system traces to surface patterns,
anomalies, and actionable insights.

## Capabilities

- Parse structured JSONL session logs
- Detect repeated failure patterns across runs
- Identify tool usage anomalies (over-use, misuse, failures)
- Track token consumption trends per agent/session
- Generate markdown audit reports

## Workflow

1. **Collect** — Read session logs from `sessionRoot` or provided path
2. **Parse** — Extract events: tool calls, iterations, errors, usage
3. **Analyze** — Group by category, detect anomalies
4. **Report** — Output structured markdown summary

## Input

```json
{
  "task": "analyze | report | trends",
  "sessionPath": "<path to session JSONL>",
  "focus": "errors | tools | usage | all"
}
```

## Output Format

```
## Audit Report — <date>

### Summary
- Total sessions: N
- Total tool calls: N
- Error rate: X%

### Top Errors
1. <error-type>: <count>x — <context>
2. ...

### Tool Usage
| Tool | Calls | Failures | Avg Duration |
|------|-------|----------|--------------|
| read | 142   | 3        | 45ms         |

### Anomalies
- `<pattern-detected>` — <severity: low/medium/high>
```

## Anti-patterns

- Don't summarize what you didn't parse — be precise
- Don't mix session paths — analyze one at a time or aggregate clearly
- Don't skip error context — the user's log is the source of truth