# WebUI Operator Workbench Redesign

**Date:** 2026-07-14  
**Scope:** `packages/webui`, `packages/webui-hq`, Desktop-hosted WebUI, shared browser E2E  
**Status:** Phase 0 and the session-history vertical slice are implemented; Phase 1 shell decomposition is next

**Validated UI baseline:** Tailwind CSS 4.3.2, Radix Dialog 1.1.19, Dropdown Menu 2.1.20, Scroll Area 1.2.14, Tabs 1.1.17, and Lucide React 1.24.0.

## Outcome

WrongStack's browser surfaces become one dense, fast operator workbench rather than a collection of dashboards. The project WebUI and Fleet HQ use the website's color, typography, grid, and brand signals while retaining an application-specific, completely square geometry.

The stable shell is:

```text
┌────────┬──────────────────┬──────────────────────────────────────┐
│ icon   │ secondary menu   │ topbar + active work surface         │
│ rail   │ 240–360 px       │                                      │
│        │                  │                  ┌───────────────────┤
│        │                  │                  │ right inspector   │
│        │                  │                  │ overlay drawer    │
│        │                  │                  │                   │
│        │                  │                  └───────────────────┤
└────────┴──────────────────┴──────────────────────────────────────┘
                                            optional terminal dock ┘
```

The right inspector is always an overlay above the active surface. Opening it must never resize chat, Monaco, diff, Kanban, SDD, Fleet Map, or terminal content.

## Implemented baseline

- Phase 0: website palette, local typography, zero-radius invariant, global Radix right inspector, Fleet/Agents/Audit consolidation, and Chromium contracts.
- Session history: one shared sidebar/workspace surface with persistent search, pinned/active/completed/issues filters, recent/token/activity sorting, rename/resume/delete flows, operational metrics, History/Live Radix tabs, and 200-session loading.
- Session wire parity: standalone and CLI hosts now publish the same rich summary projection, including persisted names, outcome, duration inputs, iterations, tool/error counts, file changes, compactions, and tool breakdown.
- Verified with main WebUI and WebUI-server full suites plus focused CLI and Chromium workbench contracts.

## Non-negotiable design rules

1. No rounded product geometry. Cards, buttons, menus, inputs, tabs, badges, progress tracks, scrollbars, drawers, dialogs, and avatars are square. This is enforced at the token/root layer while legacy classes are removed incrementally.
2. Website palette is canonical:
   - light paper `#F8F6F0`, surface `#F0EDE5`, card `#FFFDF8`, ink `#171714`
   - dark graphite `#1B1C1A`, surface `#22231F`, card `#292A26`, cream `#F5F2E9`
   - primary signal pink `#D51F4D` / dark `#FE2E5F`
   - secondary signal orange `#9A5700` / dark `#FD9F02`
3. Manrope is the UI text face, Space Grotesk the display face, IBM Plex Mono the code/data face. Fonts remain self-hosted and offline.
4. Lucide is the only interface icon language. Emoji navigation and mixed icon systems are removed.
5. Color communicates action or state, not decoration. Pink is selection/primary, orange is attention, green/amber/red retain semantic status meaning.
6. Surfaces are separated by one-pixel rules, tonal steps, and typography. Shadows are reserved for overlays.
7. Every interactive primitive has visible focus, keyboard behavior, an accessible name, and reduced-motion behavior.

## Current-state findings

- The main WebUI has the right libraries but only a thin primitive layer: React 19, Tailwind 4, Radix primitives, Lucide, Zustand, Monaco, xterm, XYFlow, and Kanban are already present.
- `App.tsx` and several feature components carry too much shell and domain responsibility. Large examples include Office Map, Setup, Chat Input, Settings, and Kanban.
- Overlay behavior is fragmented across bottom docks, Radix sheets, hand-rolled fixed modals, and inline right asides.
- Main WebUI contains hundreds of raw buttons and many local form/control styles. HQ has a separate 2,000+ line CSS system and previously used a different graphite/cyan identity.
- Monaco editor and diff exist, but the Git transport currently exposes information/diff operations rather than a complete staging workflow.
- Browser coverage is desktop Chromium-centric; mobile geometry, keyboard tab contracts, accessibility scans, and visual regression need first-class gates.

## Target architecture

### 1. Shared visual foundation

Introduce a product-surface package only after the first primitives have converged:

```text
packages/webui-ui/
  src/tokens.css
  src/primitives/
  src/workbench/
  src/icons.ts
```

It has no dependency on `core`, CLI, or either server. `webui` and `webui-hq` consume it. Start with tokens and primitives that are already used by both surfaces; do not create speculative abstractions.

Primitive set:

- Button, IconButton, Input, Textarea, Select, Checkbox, Switch
- Badge, StatusMark, Progress, Skeleton, EmptyState
- Tooltip, Popover, DropdownMenu, ContextMenu, Command
- Dialog, AlertDialog, Sheet, Tabs, ScrollArea
- DataTable, SplitPane, ResizablePanel, VirtualList
- WorkbenchShell, ActivityRail, SecondarySidebar, Topbar, RightInspector, BottomDock

Radix owns interaction semantics. Tailwind owns tokens/layout/state styling. Lucide owns icons. Feature components do not hand-roll focus traps, outside click, Escape, or roving focus.

### 2. Shell and navigation

- Activity rail: 48 px browser / 40 px compact Desktop shell; primary destinations only.
- Secondary sidebar: contextual navigation and filters, resizable between 240 and 360 px, collapsible with one command.
- Topbar: project/session identity, active view, model, run state, search, command palette, inspector, settings.
- Main surface: exactly one route/view owner and its local split panes.
- Right inspector: one global target router, non-modal on desktop and full-width modal sheet on narrow screens.
- Bottom dock: terminal and truly horizontal streaming surfaces only. Domain detail does not return to the bottom dock.

The main view registry replaces the growing `currentView` conditional chain in `App.tsx`. Each entry defines lazy component, rail destination, secondary panel, title, commands, and optional inspector targets.

### 3. Global inspector contract

The store evolves from a tab boolean into an ID-based target contract:

```ts
type InspectorTarget =
  | { kind: 'fleet'; tab: 'overview' | 'agents' | 'audit' }
  | { kind: 'kanban.task'; boardId: string; taskId: string }
  | { kind: 'sdd.task'; specId: string; taskId: string }
  | { kind: 'office.agent'; agentId: string }
  | { kind: 'mail.message'; messageId: string }
  | { kind: 'git.file'; path: string }
  | { kind: 'editor.symbol'; path: string; line: number };
```

Only stable IDs enter UI state. Feature renderers resolve current data from domain stores so the drawer cannot retain stale object snapshots. The API is `openInspector(target)`, `replaceInspector(target)`, `closeInspector()`, with an optional short back-stack for drill-down.

Widths use three named modes rather than arbitrary component values: compact 420 px, regular 560 px, wide `min(760px, 52vw)`. Mobile is `calc(100vw - rail)` or full viewport when the rail collapses.

## Surface migrations

### Chat and session

- Keep messages central and the composer anchored.
- Move fleet, agent, audit, context breakdown, and tool-call metadata into the global inspector.
- Keep terminal in the bottom dock.
- Turn Work/Goal/Plan/Autophase chips into one consistent dock or contextual secondary panel; eliminate overlapping mini-navigation systems.
- Virtualize long transcripts and keep message actions visible on keyboard focus, not only hover.

### Monaco editor

- Secondary sidebar owns Explorer, Outline, Search, and open-file groups.
- Main surface owns tabs, breadcrumbs, Monaco, diagnostics, and split editor.
- Right inspector owns symbol detail, diagnostics detail, file history, and agent file activity.
- Save/conflict state is explicit in the topbar and tab; no silent overwrite.
- Monaco and language workers remain route-lazy. Worker chunks get an explicit size budget.

### Git changes and diff

- Secondary sidebar lists working-tree groups and files with filter/search.
- Main surface uses Monaco `DiffEditor` with unified/side-by-side modes, whitespace toggle, next/previous hunk, and editable working side where safe.
- Right inspector shows file metadata, hunk summary, related agent/tool activity, and later stage/unstage/discard actions.
- Stage/unstage/discard must not be presented until server routes exist with project-root containment, permission checks, cancellation, and tests.

### Kanban

- Secondary sidebar owns board selection, saved filters, agents, and queue health.
- Main surface owns horizontally virtualized columns and keyboard-capable drag/drop.
- Task cards expose a compact status grammar; opening a task targets `kanban.task` in the global inspector.
- The current inline Task Inspector aside is removed only after parity for edit, assignment, queue state, activity, and destructive confirmations.

### SDD

- SDD board and flow become modes of one work surface rather than separate visual systems.
- Spec/task selection uses the same sidebar hierarchy and global inspector contract as Kanban.
- Wizard steps use Radix state primitives and the shared control set.
- Live agent execution is represented with the same status marks used by Fleet.

### Fleet HQ / Office Map

- HQ gets the same tokens, fonts, square geometry, Lucide icons, and workbench shell.
- Rail groups: Overview, Fleet, Agents, Mailbox, Alerts, Cost, Console.
- Fleet Map/Office Map stays central; agent, event, alert, client, and mailbox detail open in the global right inspector.
- Cockpit cards become a configurable grid of shared metric/data primitives.
- Live Console uses virtualization and stable filters; it is not a collection of individually styled log cards.
- HQ control commands retain capability checks and existing server-side authorization. Visual consolidation does not widen control authority.

### Settings and setup

- Settings uses a searchable secondary category list and one main form surface.
- Provider/model pickers use a common searchable command/listbox primitive.
- Setup becomes a short progressive sequence with persistent validation state, not one oversized component.
- Advanced/security-sensitive options show scope and persistence destination explicitly.

## Delivery phases

### Phase 0 — visual invariant and inspector bridge

- Apply website palette, local fonts, and zero-radius invariant to WebUI and HQ.
- Make the Radix Sheet animation explicit and reduced-motion safe.
- Mount one global right inspector and route legacy Fleet/Agents entry points into it.
- Convert Fleet/Agents/Audit tabs to Radix Tabs.
- Add strict component and Chromium E2E contracts for overlay geometry, keyboard tabs, close/focus restore, and no main-surface resize.

### Phase 1 — shell decomposition

- Extract WorkbenchShell, Topbar, ActivityRail, SecondarySidebar, RightInspector, and BottomDock.
- Replace `App.tsx` condition chains with a lazy view registry.
- Normalize command palette actions and keyboard shortcuts around the registry.
- Add responsive rail/sidebar/drawer behavior.

### Phase 2 — shared primitives

- Inventory raw controls and migrate the highest-frequency patterns first.
- Build form, overlay, navigation, status, and data primitives.
- Upgrade Tailwind, Radix packages, and Lucide to the latest validated snapshots in one isolated dependency PR.
- Promote converged primitives/tokens to `packages/webui-ui` and consume them from HQ.

### Phase 3 — code workbench

- Rebuild Explorer + Monaco layout.
- Rebuild Changes around Monaco DiffEditor.
- Add safe Git action routes and permission-aware UX if staging actions are desired.
- Add diagnostics/symbol/file targets to the global inspector.

### Phase 4 — work management

- Migrate Kanban Task Inspector.
- Unify SDD board/flow/wizard detail behavior.
- Add keyboard drag/drop, large-board virtualization, optimistic update rollback, and connection-state recovery.

### Phase 5 — Fleet HQ

- Replace emoji/mixed navigation with Lucide.
- Move HQ to the shared shell and primitives.
- Merge Office Map and Fleet detail patterns into the inspector contract.
- Normalize Cockpit, mailbox, alerts, costs, console, and command controls.

### Phase 6 — quality and removal

- Delete dead Fleet/Agents overlays, old inline asides, duplicate CSS, and compatibility fields after callers migrate.
- Add mobile Chromium, Firefox, reduced-motion, keyboard-only, and high-contrast projects.
- Add accessibility checks and stable visual snapshots for light/dark, empty/loading/error/live states.
- Enforce bundle and rendering budgets.

## Acceptance gates

- No interactive element computes to a non-zero `border-radius`.
- Drawer opening changes main-surface width by 0 px at desktop breakpoints.
- Escape closes the topmost overlay; close restores focus to the invoker.
- Tabs, menus, listboxes, dialogs, and drag/drop have keyboard paths.
- Light and dark text/action combinations meet WCAG AA; focus indicators meet non-text contrast requirements.
- `prefers-reduced-motion` removes non-essential motion.
- No new raw fixed-overlay implementation outside shared primitives.
- Monaco, xterm, XYFlow, and large feature views remain lazy-loaded.
- Main WebUI and HQ pass typecheck, production build, unit tests, and their targeted browser contracts.
- Shared UI work introduces no dependency from `core` to a product surface.

## First extraction order

1. `InspectorPanel` shell → generic `RightInspector` target host.
2. Kanban Task Inspector → `kanban.task` renderer.
3. SDD Task Drawer → `sdd.task` renderer.
4. Office Map agent drawer → `office.agent` renderer.
5. Mailbox detail and Git file metadata.
6. Fleet HQ event/client/agent detail.

This order proves the target API across independent domains before extracting a shared package.
