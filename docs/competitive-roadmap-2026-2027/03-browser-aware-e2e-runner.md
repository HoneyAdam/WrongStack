# Browser-Aware E2E Runner

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

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

