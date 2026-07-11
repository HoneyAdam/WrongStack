# Distributed Fleet

**Priority:** P3  
**Horizon:** 9–18 months  
**Status:** Discovery required

## Outcome

Extend Director-managed work from local processes to authenticated remote workers while preserving authoritative lineage, budgets, cancellation, mailbox semantics, and project isolation.

## Required design decisions

- Worker identity, enrollment, revocation, and mutual authentication.
- Repository transfer model: shared Git remote, snapshot bundle, or managed workspace service.
- Task lease, heartbeat, reconnect, duplicate-execution, and result-commit semantics.
- Secret delivery and per-task capability scoping.
- Artifact, log, event, and cost transport with backpressure.
- Version skew and protocol negotiation.

## Delivery plan

1. Write a protocol and threat-model ADR; build a loopback worker prototype.
2. Add signed task envelopes, leases, idempotency keys, and reconnect handling.
3. Add one remote worker over an authenticated channel with read-only tasks.
4. Add isolated mutating workspaces, artifact transfer, and budget enforcement.
5. Add scheduling, labels, capacity, HQ visibility, and production operations.

## Acceptance criteria

- A lost or duplicated connection cannot cause an unbounded duplicate mutation.
- Director remains the authority for lineage, task state, budgets, and result consumption.
- Worker credentials are revocable and cannot access projects outside assigned scope.
- Protocol/version incompatibility fails before task execution.

## Go/no-go gate

Do not begin production implementation until enterprise identity, tamper-evident audit, and measured demand for remote execution exist.

