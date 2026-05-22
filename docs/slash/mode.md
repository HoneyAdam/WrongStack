# /mode — Session Mode Switcher

## What it does

Switches or views the active session mode. Modes are named behavioral presets that layer additional prompt instructions on top of the base system prompt (via `DefaultModeStore`).

## Available modes

| Mode | Description |
|---|---|
| `default` | General-purpose coding assistant |
| `brief` | Fast, no-nonsense — get to the point |
| `teach` | Mentor mode — explains why, not just what |
| `code-reviewer` | Focused on reviewing code quality |
| `code-auditor` | Security and correctness focused |
| `architect` | System design and architecture focus |
| `debugger` | Step-by-step problem diagnosis |
| `tester` | Test-first approach |
| `devops` | Infrastructure and deployment focus |
| `refactorer` | Code improvement and cleanup focus |

## Usage

```
/mode              → show current + available modes
/mode brief       → switch to brief mode
/mode teach        → switch to teach mode
```

Active mode is stored in `modeStore` and included in the system prompt by `DefaultSystemPromptBuilder`.

## Code reference

- `packages/cli/src/slash-commands/mode.ts`
- `packages/core/src/models/mode-store.ts`
- `packages/core/src/core/system-prompt-builder.ts` — mode layer integration