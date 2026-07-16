# `/desktop` · `/webui` — App surface guidance

These commands describe WrongStack's graphical surfaces from an active CLI/TUI session. They do **not** start another process or open a browser.

| Command | Alias | Result |
|---|---|---|
| `/desktop` | — | Explain how the installed Desktop app relates to the current session. |
| `/webui` | `/web` | Explain how to start and access the browser UI. |

The commands are deliberately informational: a running slash-command host does not reliably know which platform package, host, or port the user intends to launch. From a shell, use the actual launch surfaces instead:

```text
wstack desktop
wstack --webui
wstack --simpleui
```

SimpleUI is the lightweight browser chat for conversation, live tool progress, and
agent tabs; unlike WebUI, it does not include the full workspace.

## Code reference

- `packages/cli/src/slash-commands/surfaces.ts`
- `packages/cli/src/arg-parser.ts` — parses the Desktop, `--webui`, and `--simpleui` launch forms
