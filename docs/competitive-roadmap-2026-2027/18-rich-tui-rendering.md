# Rich TUI Rendering

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Improve Markdown, code, diff, table, link, and image-related output in the Ink TUI while retaining predictable behavior on limited terminals.

## Scope

- CommonMark/GFM subset with headings, lists, tables, quotes, and links.
- Syntax-aware code blocks, line numbers, wrapping controls, and copy affordances.
- Unified and side-by-side diff modes where terminal width permits.
- Inline image protocol detection for Kitty/iTerm2/Sixel with a text fallback.
- Virtualized/collapsible long tool outputs and accessible no-color mode.

## Architecture

- Parse once into a renderer-neutral message tree where practical.
- Keep terminal capability detection outside `core`.
- Bound rendering work and preserve streaming without reparsing the full transcript on each delta.
- Never emit image escape sequences unless the terminal capability is positively detected or configured.

## Delivery plan

1. Establish rendering fixtures and golden snapshots.
2. Replace ad hoc Markdown formatting with a bounded renderer.
3. Add code/diff/table specialization.
4. Add optional image protocols and artifact open actions.
5. Profile long sessions and add virtualization/collapse thresholds.

## Acceptance criteria

- Output remains readable in plain, no-color, and narrow terminals.
- Streaming a long response does not produce quadratic render cost.
- Unknown or malformed Markdown cannot inject terminal control sequences.
- Snapshot tests cover Windows Terminal and representative ANSI capability levels.

