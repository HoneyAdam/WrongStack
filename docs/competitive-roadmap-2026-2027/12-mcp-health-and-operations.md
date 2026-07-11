# MCP Health and Operations

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Proposed

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

