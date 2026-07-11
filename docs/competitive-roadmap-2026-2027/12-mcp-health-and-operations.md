# MCP Health and Operations

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** In Progress

## Outcome

Upgrade MCP status from connection state to actionable service health with latency, failure, restart, and saturation signals.

## Scope

- Per-server connection, discovery, and call latency histograms.
- Error counts classified by transport/protocol/tool failure.
- Reconnect, wake, sleep, and restart counters with last-reason metadata.
- Bounded circuit-breaker and restart policies that respect lazy servers.
- HealthRegistry, MetricsSink, CLI, WebUI, and HQ views.

## Delivery plan

1. Define metric names, health states, and cardinality limits.
2. Instrument registry and transports without logging payloads.
3. Add degraded/unhealthy thresholds and restart backoff.
4. Surface diagnostics and safe manual actions.
5. Add long-running fault-injection tests for stdio and HTTP transports.

## Acceptance criteria

- Health distinguishes dormant, connecting, healthy, degraded, failed, and intentionally disabled states.
- Automatic restart cannot create a tight process/network loop.
- Tool names, arguments, URLs with secrets, and tokens do not become metric labels.
- Operators can correlate a failed tool call with server health and recent lifecycle events.

## Implementation progress (2026-07-12)

Completed:

- Added a bounded per-server operational snapshot with separate connection and health states,
  connection/discovery/tool-call latency summaries, transport/protocol/tool failure counts,
  reconnect/wake/sleep/restart counters, call saturation, and the latest 32 safe lifecycle events.
- Added explicit `disabled`, `dormant`, `connecting`, `healthy`, `degraded`, and `failed` health
  states. Disabled configurations are tracked without opening a process or network connection.
- Kept the existing capped exponential reconnect policy (five cycles, three attempts per cycle,
  jitter, and a 30-second ceiling) and exposed its counters/reasons operationally.
- Wired safe summaries into `/mcp`, WebUI Settings → MCP, HealthRegistry, MetricsSink, and HQ
  telemetry (`mcp.health.snapshot` and `mcp.operation`).
- Removed MCP server names from MetricsSink labels. New metric labels are restricted to fixed
  operation, state, outcome, and failure-kind enums; tool names, arguments, URLs, reasons, and
  tokens are not labels.
- Added configurable per-server health thresholds (`connectionLatencyP95Ms`,
  `discoveryLatencyP95Ms`, `callLatencyP95Ms`, `inFlightCalls`) that push an otherwise-healthy
  server into `degraded`. Thresholds are optional and disabled by default so existing behaviour is
  preserved; each configured threshold is exposed as a `healthChecks` entry in the operational
  snapshot so operators can see exactly why a server is degraded.
- Added regression coverage for state derivation, bounded latency/event buffers, redacted reason
  codes, tool-call outcomes/saturation, disabled configurations, health aggregation, metric
  cardinality, and threshold evaluation.

Remaining:

- Add long-running stdio and HTTP fault-injection soak tests.
- Add a dedicated HQ MCP operations dashboard (the safe events/snapshots are already published).
