# /metrics — Runtime counters

Show the current in-memory metrics snapshot and the safe status of the metrics
HTTP exporter.

## Usage

```text
/metrics [--json]
```

Metric collection is opt-in:

```text
wstack --metrics
wstack --metrics-port 9090
```

The human-readable view groups series by metric name, sorts those groups, and
renders counters, gauges, histograms, and labels. It also reports:

- whether in-memory collection is enabled;
- whether the Prometheus HTTP exporter is `disabled`, `listening`, or `failed`.

`/metrics --json` returns `{ enabled, exporter, snapshot }` and attaches the
same object as slash-command metadata. Exporter status deliberately excludes
the bind address, endpoint URL, and any authentication configuration.

When `--metrics-port` is active, Prometheus can scrape `/metrics` and the
runtime readiness endpoint is available at `/healthz` on the same listener.

If collection is disabled, the regular command explains how to enable it and
the JSON form returns `enabled: false` with a `null` snapshot.
