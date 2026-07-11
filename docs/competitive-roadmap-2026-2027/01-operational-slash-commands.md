# Operational Slash Commands

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Implemented

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

## Implementation progress

- [x] `/git` read-only overview shipped with `status`, `branch`, `diff`,
  `--staged`, bounded output, structured `--json` results, deep help, and
  registration in `buildBuiltinSlashCommands()`.
  - Implementation: `packages/cli/src/slash-commands/git.ts`
  - Tests: `packages/cli/tests/slash-git.test.ts`
  - User documentation: `docs/slash/git.md`
- [x] `/health` now covers redacted provider readiness, session and project
  storage read/write access, and MCP lifecycle state without exposing paths,
  server names, commands, URLs, or authentication configuration.
  It also supports deep help and structured `--json` output.
  - Implementation: `packages/cli/src/slash-commands/health.ts`
  - Wiring: `packages/cli/src/wiring/metrics.ts` and
    `packages/cli/src/wiring/lifecycle-plugins.ts`
  - Tests: `packages/cli/tests/slash-health.test.ts`
  - User documentation: `docs/slash/health.md`
- [x] `/metrics` now reports safe collection/HTTP-exporter state, supports
  structured `--json` output and metadata, and has dedicated user
  documentation at `docs/slash/metrics.md`.
  - Implementation: `packages/cli/src/slash-commands/metrics.ts`
  - Tests: `packages/cli/tests/slash-metrics.test.ts`
- [x] `/plan` now has deep help, read-only template listing, stable `--json`
  results/errors, persisted-plan metadata, task/todo/template payloads, and
  dedicated documentation at `docs/slash/plan.md`.
  - Implementation: `packages/cli/src/slash-commands/plan.ts`
  - Tests: `packages/cli/tests/slash-plan.test.ts`
- [x] The former `git-plugin`, `observability-plugin`, and `plan-plugin`
  first-party plugins were removed; their commands now live as CLI builtins
  so they appear in the authoritative builtin list and `/help`. This also
  removes duplicate plugin registration from `BUILTIN_PLUGIN_FACTORIES`.
- [x] `/security` now has `Inspect` categorization, deep help, stable `--json`
  payloads/errors, redaction-safe metadata, corrected HQ dispatch guidance,
  dedicated command-contract tests, and CLI/TUI registry collision coverage.

## Acceptance criteria

- All four commands are in the authoritative builtin list and deep help.
- No command reimplements git parsing, metric aggregation, health checks, or plan persistence.
- Unavailable optional services degrade with actionable messages.
- Targeted tests, CLI typecheck, and full workspace validation pass.

## Verification

- Targeted operational-command suites pass for `/git`, `/health`, `/metrics`,
  `/plan`, and `/security`.
- Core and CLI typechecks pass.
- Topological `pnpm build` passes.
- Full `pnpm test` passes: root 14,676 tests passed (65 skipped), WebUI
  2,078 tests passed.

## Risks

- Command names may overlap tool names; documentation must distinguish user commands from model-callable tools.
- Health output can leak paths or provider details, so structured redaction is required.
