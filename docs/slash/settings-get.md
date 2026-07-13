# `/settings-get` — Read TUI settings

Aliases: `/config-get`, `/get`.

Read settings without opening the interactive editor.

```text
/settings-get
/settings-get <chord>
```

Bare `/settings-get` renders a compact grouped summary. With a chord, it prints that setting's label and current display value. Unknown chords produce an error plus the list of available names.

Examples:

```text
/settings-get yolo
/settings-get multi-diff
/settings-get log-level
```

This command is mounted by the TUI. Use `/settings <chord> <value>` to change a value or `/settings reset <chord>` to restore its factory default.

## Code reference

- `packages/tui/src/app.tsx` — official TUI registration
- `packages/tui/src/components/settings-picker.tsx` — chord resolution and value formatting
