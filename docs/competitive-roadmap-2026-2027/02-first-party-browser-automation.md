# First-Party Browser Automation

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** In Progress

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

## Implementation progress (2026-07-12)

Completed:

- Added 16 lazy first-party `browser_*` tools to the shared builtin tool pack, making the same
  capability available across CLI, TUI, WebUI, Desktop, and fleet workers without MCP setup.
- Added isolated per-agent contexts over one managed Chromium process, explicit open/list/close
  lifecycle, automatic last-context process reclamation, run-disposal cleanup, and abort cleanup.
- Added navigation, accessibility snapshots, screenshots, click/type/select/press/hover/drag/wait,
  project-local upload, bounded evaluation, and installation diagnostics.
- Added SSRF-aware HTTP(S) navigation and subrequest guards, URL credential rejection, disabled
  downloads, project-root upload confinement, bounded/redacted console and network evidence, and
  confirmation gates for risky operations.
- Added `browser_type.secretEnv`, which resolves credential values only inside the tool process so
  session audit and replay retain the placeholder name rather than the secret value.
- Added ULID-addressed PNG and Playwright trace artifacts under project-global WrongStack state,
  outside the repository.
- Added a real local fixture integration suite covering navigation, interaction, snapshots,
  redaction, screenshot/trace artifacts, owner isolation, cancellation, and cleanup.
- Updated the bundled Browser agent instructions to prefer first-party tools while documenting
  collision-free coexistence with the optional `playwright_*` MCP preset.
- Added a package-manager-independent browser doctor/repair command plus real Chromium launch and
  interaction smoke gates on Ubuntu, Windows, and the Linux release job.

Remaining:

- Extend secret placeholders from trusted environment variables to named SecretVault bindings.
- Add dedicated inline screenshot/trace viewers and artifact actions to WebUI and TUI; current
  surfaces receive the shared artifact metadata and local path.
