# `/chimera` — Post-session reviewer status

`/chimera` is registered by the opt-in `wstack-chimera` plugin **only when that plugin's resolved `enabled` option is true**. It reports:

- whether Chimera is enabled;
- the provider and model selected for its review subagent;
- the maximum number of changed files considered; and
- that output uses the provider's model-native ceiling.

The command is read-only. Use the core [`/review`](review.md) command to request a manual changed-file review. Chimera's automatic review is driven by the `session.ended` event, not by invoking `/chimera`.

Configuration is read from `extensions["wstack-chimera"]`.

## Code reference

- `packages/core/src/plugins/chimera-plugin.ts`
