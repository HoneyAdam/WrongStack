# Browser-Aware E2E Runner

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** In Progress

## Outcome

Turn generic test execution plus browser automation into a guided E2E workflow that can discover an app, start it, exercise user journeys, collect evidence, and explain failures.

## Scope

- Detect Playwright and Cypress projects and their configured web servers.
- Start or attach to a dev server through the process registry.
- Run selected specs, projects, tags, or a generated smoke journey.
- Collect traces, screenshots, videos, console errors, failed requests, and relevant logs.
- Map failure evidence back to source and propose a minimal next action.

## Delivery plan

1. Add framework discovery and a read-only execution plan.
2. Integrate process lifecycle with the existing `test` and browser capabilities.
3. Normalize artifacts and failure records across Playwright and Cypress.
4. Add WebUI/TUI evidence views and rerun controls.
5. Add deterministic fixture projects for CI.

## Acceptance criteria

- The runner never leaves a spawned server or browser process behind.
- Existing project configuration remains authoritative; WrongStack does not rewrite it silently.
- A failed journey returns a bounded, structured report with direct artifact references.
- Generated tests are written only after permission and remain reviewable before execution.

## Dependencies

- First-party browser automation.
- Artifact storage and rendering from the multimodal plan.
- Quality engineering conventions for traces and visual baselines.

## Implementation progress (2026-07-12)

Completed:

- Added an auto-approved, read-only `e2e_plan` builtin shared by CLI, TUI, WebUI, Desktop, and
  fleet workers through the normal tool registry.
- Added bounded monorepo discovery for Playwright and Cypress configs, dependencies, package
  scripts, package managers, and specs with cancellation and traversal containment.
- Added static managed-server/base-URL inspection without importing executable project configs;
  dynamic values are reported as incomplete instead of being evaluated.
- Added deterministic package-script or framework-default command/argv plans without spawning a
  process or rewriting existing configuration.
- Added Playwright and Cypress fixture coverage for nested workspaces, server hints, filtering,
  cancellation, and path-containment behavior.

Remaining:

- Integrate permission-gated server and test execution with the process registry.
- Normalize Playwright/Cypress failures, logs, screenshots, videos, and traces.
- Add generated smoke journeys plus WebUI/TUI evidence views and rerun controls.
