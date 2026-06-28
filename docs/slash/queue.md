# /queue — Pending mid-run messages (TUI)

## What it does

While the agent is running, plain messages you type are held in a **queue** and
replayed as real user turns once the current run finishes. `/queue` inspects and
manages that backlog, and toggles the mid-run send-mode picker.

## Usage

```
/queue                  List pending messages
/queue list             Same as /queue
/queue clear            Drop all pending messages
/queue delete N M…      Drop messages at 1-based positions (aliases: del, rm)
/queue picker on|off    Toggle the mid-run send-mode picker (queue/btw/steer)
/queue picker           Show whether the picker is on
```

## The mid-run send-mode picker

By default, submitting a plain message while the agent is busy pops a picker that
asks how to deliver it — **Queue** (run after the current turn), **By the way**
(fold in at the next step without interrupting, via `setBtwNote`), or **Steer**
(abort now, drop the queue, redirect). Queue is the default; `Esc` queues so the
typed text is never lost. See [`/btw`](./btw.md) for the full comparison.

`/queue picker off` reverts to the legacy behavior (plain mid-run messages are
queued silently). The setting persists to `autonomy.midRunSendPicker` and is
restored on the next session.

## Code references

- `packages/tui/src/queue-slash.ts` — the `/queue` command (incl. `picker`)
- `packages/tui/src/components/send-mode-picker.tsx` — the picker UI + key logic
- `packages/core/src/core/queued-messages.ts` — queue-awareness snapshot the
  running agent sees
