# `/chimera` — Post-session reviewer status

`/chimera` is registered by the opt-in `wstack-chimera` plugin **only when that plugin's resolved `enabled` option is true**. It reports:

- whether Chimera is enabled;
- the provider and model selected for its review subagent;
- the maximum number of changed files considered;
- the auto-fix mode; and
- that output uses the provider's model-native ceiling.

## Subcommands

| Command | Effect |
|---------|--------|
| `/chimera` | Show current status. |
| `/chimera autoFix <off\|ask\|auto>` | Set the auto-fix mode for the current session (runtime only, config file unchanged). |

The auto-fix modes:

- **off** — Send the review result to the mailbox. The leader agent waits for a user command (default).
- **ask** — Send the review as an ask. The leader prompts the user for permission before acting.
- **auto** — Send the review result AND spawn a fix subagent immediately to apply the findings.

Use the core [`/review`](review.md) command to request a manual changed-file review. Chimera's automatic review is driven by the `session.ended` event, not by invoking `/chimera`.

Configuration is read from `extensions["wstack-chimera"]`.

## Code reference

- `packages/core/src/plugins/chimera-plugin.ts`
