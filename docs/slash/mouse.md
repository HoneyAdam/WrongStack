# /mouse - Full Mouse Mode

## What It Does

`/mouse on` enables **full mouse mode** in the TUI. The chat history stops
riding the terminal's native scrollback and is instead rendered into a managed,
in-app-scrolled viewport (`ScrollableHistory`). SGR mouse tracking stays on for
the whole session, so:

- The wheel scrolls the chat **in-app** (3 rows per notch).
- `Shift+wheel` and `PgUp`/`PgDn` page through the in-app history.
- A drag-able scrollbar is shown on the right edge.
- Status-bar chips and confirm-prompt buttons become clickable.

The trade-off is that the terminal's native wheel-scroll of its own scrollback
is captured while tracking is active. The full session scroll lives in-app, and
the complete log is always on disk. See `packages/tui/src/mouse.ts` for the
protocol-level rationale.

`/mouse off` restores the default `<Static>` rendering and native scrollback.

The command is stateless — it emits a toggle intent that the TUI App resolves
against its live state, persists, and confirms. Outside the TUI it is a no-op.

## Usage

| Usage | Effect |
|---|---|
| `/mouse` | Show current mouse-mode status |
| `/mouse on` | Enable full mouse mode |
| `/mouse off` | Disable it (restore native scrollback) |
| `/mouse toggle` | Toggle current state |

The command also accepts `enable`, `true`, `1`, `disable`, `false`, and `0`.

## Enabling at Startup

Mouse mode can also be turned on before the TUI mounts:

- `--mouse` CLI flag (e.g. `wrongstack --tui --mouse`).
- `WRONGSTACK_MOUSE=1` environment variable.
- The persisted `autonomy.mouseMode` setting (set automatically the last time
  you ran `/mouse on`).

Resolution order at launch: `--mouse` → saved setting → `WRONGSTACK_MOUSE`.

## Notes

- The setting persists to the `autonomy` section of `~/.wrongstack/config.json`,
  so a `/mouse on` survives restarts.
- Overlays/pickers already enable mouse tracking on their own while open
  (wheel-to-select, click-to-confirm); full mouse mode keeps that behavior and
  extends it to the chat history and the rest of the UI.
