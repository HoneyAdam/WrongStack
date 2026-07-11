# First-Party Browser Automation

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Proposed

## Outcome

Provide a dependable browser capability that works across CLI, TUI, WebUI, Desktop, and fleet workers without requiring users to discover and configure a separate Playwright MCP server.

## Current baseline

WrongStack already documents Playwright MCP tools and ships a preset. This initiative promotes browser automation from an optional integration to a first-party runtime capability while preserving MCP as an adapter path.

## Capability contract

- Session lifecycle: open, list, select, and close isolated browser contexts.
- Navigation and observation: navigate, snapshot accessibility/DOM state, screenshot, and wait.
- Interaction: click, type, select, press, hover, drag, and upload.
- Extraction: bounded page evaluation and structured content extraction.
- Evidence: artifact IDs for screenshots, traces, console logs, and network summaries.

## Architecture

- Place browser implementation above `core`; expose tools through the normal registry.
- Use one managed browser process with isolated contexts per run or subagent.
- Treat arbitrary page evaluation, downloads, uploads, and external navigation as explicit capabilities in the permission policy.
- Apply cancellation, timeouts, bounded output, secret redaction, and cleanup on run disposal.

## Delivery plan

1. Define transport-neutral browser interfaces and artifact types.
2. Implement Playwright-backed lifecycle and read-only observation tools.
3. Add interaction tools and policy scopes.
4. Add cross-surface artifact rendering and fleet isolation.
5. Add local fixture-site integration tests and package/browser installation diagnostics.

## Acceptance criteria

- A clean install can navigate a fixture, interact, and capture evidence on supported platforms.
- Browser processes and contexts are always reclaimed on completion, timeout, and abort.
- Tool calls are replayable from session logs without storing secrets or unbounded page data.
- Optional MCP browser servers can coexist without name collisions.

