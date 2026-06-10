import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

/**
 * `/mouse` — toggle "full mouse mode" in the TUI: the chat history is rendered
 * into a managed, in-app-scrolled viewport (wheel + scrollbar + clickable UI)
 * instead of riding the terminal's native scrollback.
 *
 * The command is intentionally stateless: it doesn't hold the live value (which
 * lives in the App's `mouseMode` state). It emits an intent via `metadata`, and
 * the TUI App resolves it against its own state, persists the setting, and
 * prints the resulting status. Outside the TUI the metadata is simply ignored.
 */
export function buildMouseCommand(_opts: SlashCommandContext): SlashCommand {
  return {
    name: 'mouse',
    category: 'Config',
    description: 'Toggle full mouse mode (in-app scroll + clickable UI).',
    help: [
      'Usage:',
      '  /mouse            Show current mouse-mode status',
      '  /mouse on         Enable full mouse mode',
      '  /mouse off        Disable it (restore native terminal scrollback)',
      '  /mouse toggle     Flip the current state',
      '',
      'In full mouse mode the terminal wheel scrolls the chat in-app (SGR mouse',
      'tracking captures it), the scrollbar is drag-able, and status-bar chips /',
      'confirm buttons are clickable. Native scrollback is off; Shift+wheel and',
      'PgUp/PgDn page through the in-app history instead. The setting persists.',
    ].join('\n'),
    async run(args) {
      const arg = args.trim().toLowerCase();
      let intent: 'on' | 'off' | 'toggle' | 'query';
      if (!arg || arg === 'status') intent = 'query';
      else if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === '1') intent = 'on';
      else if (arg === 'off' || arg === 'disable' || arg === 'false' || arg === '0') intent = 'off';
      else if (arg === 'toggle') intent = 'toggle';
      else {
        return {
          message: `Unknown argument: ${arg}. Use /mouse on, /mouse off, or /mouse toggle.`,
        };
      }
      // The App (TUI) consumes this intent, applies + persists it, and prints
      // the resulting status. No `message` here so it isn't double-printed.
      return { metadata: { mouseToggle: intent } };
    },
  };
}
