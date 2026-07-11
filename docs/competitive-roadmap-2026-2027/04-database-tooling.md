# Database Tooling

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Add safe, portable database inspection and migration workflows without turning WrongStack into a credential broker or embedding every vendor driver in the core tool package.

## Initial scope

- Connection profiles stored through the secret vault and user-local configuration only.
- Read-only schema discovery for PostgreSQL, MySQL, and SQLite.
- Parameterized query execution with row, byte, and duration limits.
- Migration discovery, dry-run/plan, apply, and status through project-native frameworks.
- Transaction and environment labels that make production access unmistakable.

## Architecture

- Define a small database adapter interface in a dedicated package or plugin boundary.
- Prefer native project CLIs or MCP adapters for vendor-specific behavior.
- Separate `database.read`, `database.write`, `database.ddl`, and `database.production` permission capabilities.
- Redact DSNs and values from logs; retain query fingerprints and outcome metadata for audit.

## Delivery plan

1. Ship SQLite and PostgreSQL read-only discovery/query support.
2. Add connection testing and redacted diagnostics.
3. Add migration framework adapters with plan-first behavior.
4. Add MySQL and plugin/MCP extension points.
5. Add WebUI connection-profile UX only after the storage and policy model is stable.

## Acceptance criteria

- Queries are parameterized and bounded by default.
- Production writes require an explicit policy decision even in otherwise trusted workflows unless an explicit allow rule exists.
- Cancellation interrupts drivers or child processes.
- Tests cover DSN redaction, transaction rollback, limits, and hostile result sizes.

