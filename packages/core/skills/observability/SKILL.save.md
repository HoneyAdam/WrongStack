# Observability — WrongStack (Compact)

Instruments WrongStack code with structured logs, traces, and metrics.

## Rules

1. Log at the right level: DEBUG (dev), INFO (normal), WARN (recoverable), ERROR (needs attention).
2. Structured logs only — JSON to stdout, not plain text to files.
3. Every significant event needs a `traceId`.
4. Never log secrets, tokens, or PII — redact before logging.
5. Logs must answer: what happened, what context, what was the outcome.

## Log schema

```json
{
  "level": "info|warn|error",
  "traceId": "uuid",
  "event": "event_name",
  "timestamp": "ISO8601",
  "duration_ms": 12,
  "outcome": "success|failure|timeout"
}
```

## Metrics

| Metric | Type | Why |
|--------|------|-----|
| `tool.executions` | Counter | How often each tool runs |
| `tool.duration_ms` | Histogram | Latency per tool |
| `session.iterations` | Gauge | Active iterations |
| `error.count` | Counter | Errors by type |
| `context.tokens` | Gauge | Context size |