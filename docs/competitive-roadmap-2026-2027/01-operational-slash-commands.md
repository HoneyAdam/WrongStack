# Operational Slash Commands

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Proposed

## Outcome

Complete the planned `/git`, `/health`, `/metrics`, and `/plan` command surfaces without duplicating business logic already owned by tools, stores, and observability services. `/security` already exists and should receive parity tests and documentation review rather than a second implementation.

## Scope

- `/git`: concise status, diff summary, branch information, and safe delegation to the existing git tool.
- `/health`: aggregate `HealthRegistry`, provider, MCP, session, and storage checks.
- `/metrics`: show current session counters and configured exporter status; support machine-readable output where command contracts allow it.
- `/plan`: inspect and manage the existing plan store/tool state without creating a parallel planning model.
- Register commands in `buildBuiltinSlashCommands()`, add dedicated tests, and write fresh docs only after behavior exists.

## Delivery plan

1. Define a thin command-to-service contract for each command.
2. Implement read-only subcommands first; gate mutations through existing policies.
3. Add CLI/TUI rendering and stable structured results.
4. Add `packages/cli/tests/slash-<name>.test.ts` coverage and docs under `docs/slash/`.
5. Audit `/security` for naming, help, and cross-surface parity.

## Acceptance criteria

- All four commands are in the authoritative builtin list and deep help.
- No command reimplements git parsing, metric aggregation, health checks, or plan persistence.
- Unavailable optional services degrade with actionable messages.
- Targeted tests, CLI typecheck, and full workspace validation pass.

## Risks

- Command names may overlap tool names; documentation must distinguish user commands from model-callable tools.
- Health output can leak paths or provider details, so structured redaction is required.

