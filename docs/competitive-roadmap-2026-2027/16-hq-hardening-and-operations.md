# HQ Hardening and Operations

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** In Progress — optional browser password login slice completed

## Outcome

Close the remaining security and operational gaps in the already functional HQ Command Center rather than rebuilding shipped telemetry, alerts, history, or dashboard features.

## Scope

- Hash HQ tokens at rest and show raw values only when minted.
- Add per-client and per-route rate limiting with bounded queues.
- Add optional browser password/session login for deployments that cannot manage bearer tokens conveniently.
- Improve token rotation, revocation, expiry, capability editing, and audit UX.
- Add backup/restore, retention controls, disk-pressure behavior, and health endpoints.

## Progress

- **Optional browser password login** — implemented.
  - `packages/core/src/hq/auth-store.ts`: scrypt password hashing + cookie-secret minting.
  - `packages/cli/src/hq-server.ts`: `POST /api/login`, `POST /api/logout`, `GET /api/auth/status`; signed `hq.session` cookie gating `/api/*` and `/ws/browser`; password mode coexists with existing browser tokens.
  - `packages/webui-hq/src/views/token-gate.tsx`: password tab/form; falls back to token mode; clears stale stored tokens on successful password login.
  - `packages/cli/src/boot/short-circuit-hq.ts` + `packages/cli/src/subcommands/handlers/hq.ts`: `--password <secret>` passed through on first run.
  - Tests: `packages/cli/tests/hq-password-login.test.ts` (10 tests).

## Delivery plan

1. Migrate auth storage to versioned token hashes with backward-compatible rotation.
2. Add rate limits for WebSocket ingress, command enqueue, polling, and HTTP APIs.
3. ~~Add password login using a memory-hard password hash and secure cookies.~~ ✅ Done
4. Add operational diagnostics, retention controls, and failure drills.
5. Run an external-facing threat-model review before declaring HQ production-ready.

## Acceptance criteria

- Theft of `auth.json` does not yield usable bearer tokens or passwords.
- Rate limiting does not break normal reconnect bursts or command acknowledgements.
- Every control command has authenticated actor, target, capability decision, status, and timestamp.
- HQ fails closed for control operations while retaining safe read-only diagnostics where possible.

## Related plan

- `docs/plans/hq-command-center-2026-07.md`

