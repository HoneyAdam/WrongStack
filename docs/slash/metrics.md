# /metrics — Prometheus Metrics Snapshot

## What it does

Dumps the current metrics snapshot from the configured `MetricsSink`. Requires `--metrics` flag at startup.

## Output format

Metrics are grouped by name and sorted alphabetically:

```
# provider/complete
  count=42 sum=3.8 min=0.05 max=1.2 p50=0.09 p95=0.45 p99=0.88 {model=claude-3-5-sonnet}

# tool/execute
  count=128 sum=0.0 min=0.0 max=0.0 p50=0 p95=0 p99=0 {tool=read}
```

Each series shows `count`, `sum`, `min`, `max`, `p50/p95/p99` (histogram) or a single `value` (gauge). Label key-value pairs are shown in dim color.

## Code reference

- `packages/cli/src/slash-commands/metrics.ts`
- `packages/core/src/observability/metrics.ts` — `MetricsSink` interface
- `packages/core/src/observability/wire-metrics-to-events.ts` — event bridge