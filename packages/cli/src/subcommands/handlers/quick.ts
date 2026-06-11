import type { SubcommandHandler } from '../index.js';

/**
 * `wrongstack quick` — launch directly into the TUI with sensible defaults.
 *
 * - Skips all interactive setup prompts (provider picker, mode picker, etc.)
 * - Uses the last-used or default provider/model from config
 * - Logs configured plugins as debug lines (like a debug log dump)
 * - Opens the TUI immediately with the F3 agents monitor visible by default
 */
export const quickCmd: SubcommandHandler = (args, deps) => {
  // Mark quick mode so execute() knows to pass initialAgentsMonitorOpen to runTui.
  if (deps.flags) {
    deps.flags['quick'] = true;
    deps.flags['tui'] = true;
  }
  // Clear positional args so the TUI path is taken (enteringTui check).
  args.length = 0;

  // List configured plugins as debug logs — one line per plugin.
  const plugins = deps.config.plugins ?? [];
  if (plugins.length === 0) {
    console.debug('[wrongstack:quick] No plugins configured');
  } else {
    for (const p of plugins) {
      const name = typeof p === 'string' ? p : p.name;
      const enabled = typeof p === 'object' && p.enabled === false ? ' (disabled)' : '';
      console.debug(`[wrongstack:quick] plugin: ${name}${enabled}`);
    }
  }

  // Return 0 — execute() will detect flags.quick and flags.tui, then call runTui.
  // The actual exit code comes from runTui.
  return Promise.resolve(0);
};
