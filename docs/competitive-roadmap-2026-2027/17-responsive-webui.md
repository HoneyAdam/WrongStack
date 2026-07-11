# Responsive WebUI

**Priority:** P1  
**Horizon:** 2–5 months  
**Status:** Proposed

## Outcome

Make the WebUI useful on tablets and phones for monitoring, approvals, messaging, and lightweight edits without pretending a small screen is a full desktop IDE.

## Scope

- Responsive navigation, chat, settings, fleet, task, and approval flows.
- Touch-sized controls, safe-area handling, virtual keyboard behavior, and reduced-motion support.
- Compact code/diff viewers with line wrapping and deliberate horizontal scrolling.
- Connection/reconnect state suitable for mobile network changes.
- Installable PWA only after authentication and cache boundaries are reviewed.

## Delivery plan

1. Define supported breakpoints and mobile-critical journeys.
2. Refactor layout primitives and navigation.
3. Adapt chat input, approvals, task/fleet views, and diff review.
4. Add device/browser E2E and accessibility checks.
5. Evaluate PWA packaging and notification support separately.

## Acceptance criteria

- Core monitoring and approval journeys work at 360 CSS pixels without clipped controls.
- No secret, transcript, or project file is cached by a service worker by default.
- Keyboard-only and screen-reader behavior does not regress on desktop.
- Large virtualized transcripts remain responsive on mid-range mobile hardware.

