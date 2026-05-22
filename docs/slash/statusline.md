# /statusline — TUI Status Bar Customizer

## What it does

`/statusline` toggles which items appear in the TUI status bar without restarting. Items are stored in `statuslineHiddenItems` in `SlashCommandContext` and read on TUI mount.

## Usage

| Usage | Effect |
|---|---|
| `/statusline` | Show current status bar configuration |
| `/statusline todos on\|off` | Toggle todos item |
| `/statusline plan on\|off` | Toggle plan item |
| `/statusline fleet on\|off` | Toggle fleet item |
| `/statusline git on\|off` | Toggle git branch + status item |
| `/statusline elapsed on\|off` | Toggle elapsed time item |
| `/statusline context on\|off` | Toggle context window % item |
| `/statusline cost on\|off` | Toggle estimated cost item |
| `/statusline all on` | Show all items |
| `/statusline all off` | Hide all items |

## Available items

| Item | What it shows |
|---|---|
| `todos` | Current todo count (in_progress / pending / completed) |
| `plan` | Active plan item count |
| `fleet` | Subagent count: 0 pending, 0 done |
| `git` | Branch name + dirty/clean indicator |
| `elapsed` | Session elapsed time (HH:MM:SS) |
| `context` | Context window usage percentage |
| `cost` | Estimated session cost |

## Persistence

Config is saved to `~/.wrongstack/statusline.json` via the `statuslineConfig` callbacks in `SlashCommandContext`.

## Code reference

- `packages/cli/src/slash-commands/statusline.ts`
- `packages/tui/src/components/status-bar.tsx` — TUI status bar rendering
- `packages/cli/src/index.ts` — `statuslineConfig` and `statuslineHiddenItems` wiring