# Quality Engineering Program

**Priority:** P0  
**Horizon:** Continuous, first milestone within 0–3 months  
**Status:** Proposed

## Outcome

Create trustworthy coverage and regression signals across CLI, TUI, WebUI, SimpleUI, Desktop, and shared packages.

## Workstreams

### Coverage

- Produce coverage in CI using the existing `test:coverage` script.
- Set ratcheting thresholds per package instead of one monorepo percentage.
- Publish summaries and trends; do not commit volatile raw coverage artifacts.

### Cross-surface E2E

- Add CLI PTY journeys for startup, tool approval, cancellation, and resume.
- Add TUI harness coverage for navigation, overlays, and fleet/Brain events.
- Add Desktop install/launch/session smoke tests.
- Extend WebUI E2E around reconnect, permissions, and long sessions.

### Visual regression

- Add stable WebUI/HQ screenshots for critical states and narrow layouts.
- Use deterministic fonts, time, IDs, animations, and fixture data.

### Flaky-test intelligence

- Record retries and duration history, quarantine only with owner and expiry, and fail on new unowned flakes.

### Platform coverage

- Keep the current Ubuntu/Windows CI matrix and add targeted macOS/release smoke coverage where platform code justifies the cost.

## First milestone

1. Establish a reliable coverage artifact and baseline.
2. Add five critical CLI PTY journeys and three Desktop smoke paths.
3. Add visual baselines for WebUI chat, approval, fleet, settings, and HQ cockpit.
4. Publish flake metadata and ownership in CI.

## Acceptance criteria

- Coverage cannot fall silently on changed packages.
- Retries are visible and never turn a failing test green without a flake record.
- E2E failures retain bounded logs, screenshots, and traces.
- Tests avoid production credentials and external mutable services.

