# `/rewind` — Checkpoint timeline (TUI)

| Command | Effect |
|---|---|
| `/rewind` | Open the checkpoint timeline overlay. |
| `/rewind <index>` | Rewind directly to the non-negative checkpoint index. |

Rewinding restores the selected file checkpoint and truncates conversation history so the session can continue from that point. If the session has no checkpoints, bare `/rewind` reports that instead of opening the overlay.

This slash command is mounted by the TUI. The standalone shell command `wstack rewind` is a separate surface documented under [`docs/subcommands/rewind.md`](../subcommands/rewind.md).

## Code reference

- `packages/tui/src/app.tsx` — mounted slash command
- `packages/tui/src/components/checkpoint-timeline.tsx` — interactive timeline
