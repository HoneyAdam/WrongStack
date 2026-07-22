---
name: design-system
description: |
  Use this skill BEFORE writing or restyling any UI in WrongStack — web
  pages, panels, dashboards, or mobile screens. It drives the Design Studio
  engine: commit to a kit, tune it (radius/density/font/motion), materialize
  the tokens to a real theme file, then verify adherence. Triggers: user asks
  to build/redesign a "UI", "frontend", "landing page", "dashboard", "panel",
  "component", "mobile screen", "website", or mentions Tailwind/shadcn/React/
  Flutter/SwiftUI/Compose styling, theming, border-radius, spacing, or fonts.
version: 1.0.0
---

# Design System Engine — WrongStack

## Overview

Never emit generic, default-framework, unstyled UI. WrongStack ships a Design
Studio: 50+ curated kits, each a full **design system** (not just colors —
radius, spacing, type, motion, elevation scales), tunable and enforceable. Commit
to ONE kit BEFORE writing UI, make the tokens the codebase's source of truth,
then check your output against them.

## The workflow (always in this order)

1. **Commit** — pick a kit and load its full spec for the target stack:
   `design {action:"use", kit:"<id>", stack:"web|react-native|flutter|swiftui|compose"}`
   Browse first with `design {action:"list"}` if unsure. The user can also pin
   one with `/design <kit-id>`.
2. **Tune** (optional) — nudge high-level knobs instead of raw tokens:
   `design {action:"tune", tune:{ radius:"lg", density:"compact", font:"Space Grotesk", motion:"snappy" }}`
   - `radius`: none | sm | md | lg | xl | full (or a base length like "1rem")
   - `density`: compact | cozy | comfortable (scales the spacing rhythm)
   - `motion`: snappy | smooth | none
   For a specific color: `design {action:"set", set:{ primary:"oklch(62% 0.2 25)", "dark.bg":"#111" }}`.
   To switch kits wholesale: `/design swap <kit-id>` (drops the old overrides).
3. **Materialize** — write the (tuned) tokens to a real theme file so the build
   enforces them, not a prompt:
   `design {action:"materialize"}`  → web: CSS vars + Tailwind v4 `@theme`
   (OKLCH); native: `AppScale` + color constants. Import this file in your UI.
4. **Build against the tokens** — use the token utilities, never hardcoded values:
   - Web/Tailwind v4: `bg-bg text-fg border-border rounded-lg p-4 text-base shadow-2`
     — these resolve to the kit because materialize maps them into `@theme`.
   - Never: raw hex/`oklch()` literals, generic `bg-blue-500`, arbitrary
     `rounded-[7px]` / `p-[13px]` — they bypass the token scale.
5. **Verify** — scan for drift: `design {action:"verify"}`. Fix any flagged
   color / radius / spacing violations before finishing.

## Non-negotiable foundations (every UI, under every kit)

- **Mobile-first & responsive**: test 320 / 768 / 1024 / 1440px; no horizontal
  scroll; touch targets ≥ 44px; respect safe-area insets on native.
- **Light AND dark** from one token set — never hardcode colors.
- **WCAG 2.2 AA**: semantic markup, one `h1`, `:focus-visible` rings, 4.5:1 body
  contrast, labelled controls, meaning never by color alone.
- **Motion** honors `prefers-reduced-motion`; animate transform/opacity.
- Ship empty / loading / error states, not just the happy path.

Load the full baseline any time with `design {action:"foundations"}`.

## For delegated / roster frontend work

The active kit, overrides, and auto-verify-on-write follow into spawned
subagents (shared `.design/active.json`). When you delegate UI work, the
subagent inherits the pinned kit — but still remind it to build against the
token utilities and run `design verify` before returning.

## Notes

- Kit choice persists in `.design/active.json` (gitignored) across sessions.
- Project overrides live in `.design/rules.md` and WIN over kit defaults.
- If the model drifts to off-palette colors or arbitrary radius/spacing, the
  auto-verify middleware appends a non-blocking warning to the write result —
  self-correct on the next edit.
