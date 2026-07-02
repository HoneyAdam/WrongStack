# @wrongstack/webui-hq

HQ Command Center dashboard — the offline React app for the cross-machine
coordination surface served at `wstack --hq` (port 3499).

## Overview

This is a **self-contained Vite + React app** with zero CDN dependencies —
everything bundles into `dist/` so it works on offline/LAN/restricted-network
machines. It connects to the HQ server's `/ws/browser` WebSocket channel and
renders 9 views:

| View | Source | Purpose |
|------|--------|---------|
| Fleet | `hq.snapshot` | machine → project → terminal → agent tree |
| Console | `/api/sessions/:id/events` | live chat transcript per terminal |
| Mailbox | `hq.snapshot.mailboxes` | unread/incomplete/high-priority counts |
| Cost | `hq.snapshot.projects` | per-project cost breakdown |
| Brain | `brain.event` envelopes | decision/intervention timeline |
| Worktrees | `worktree.event` envelopes | phase lifecycle swim-lanes |
| Trends | `/api/trends/cost` | time-bucketed cost/activity |
| Alerts | `hq.alert` + `/api/alerts` | live + history alert feed |
| Control | `POST /api/command` | steer/abort/spawn/broadcast to clients |

## Build

```bash
pnpm --filter @wrongstack/webui-hq build
```

Produces `dist/` (index.html + assets + vendor chunk). The HQ server
(`packages/cli/src/hq-server.ts`) resolves this `dist/` via
`resolveHqDistDir()` and serves it at `/`. If unbuilt, HQ falls back to the
inline `HQ_HTML` dashboard so HQ is always functional.

## Dev

```bash
pnpm --filter @wrongstack/webui-hq dev
```

Starts Vite dev server on port 5174. Point it at a running HQ server by
setting the WS URL — in dev, the app derives the WS URL from
`window.location`, so visit the HQ server directly (port 3499) for the
served build, or proxy in dev.

## Architecture

- `src/lib/hq-ws-client.ts` — `/ws/browser` client (reconnect, token from
  `?token=` query, dispatches `hq.snapshot`/`hq.event`/`hq.alert`).
- `src/store.ts` — lightweight React-based global store
  (`useSyncExternalStore`, no zustand). Holds snapshot, events, alerts, UI state.
- `src/app.tsx` — activity bar + view router + status bar.
- `src/views/` — the 9 views.

All types come from `@wrongstack/core` (`HqSnapshot`, `HqEventEnvelope`, etc.).
