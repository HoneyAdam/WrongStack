import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

/**
 * /audit — opens the TUI AuditPanel overlay showing the side-effect
 * timeline (bash commands, package installs, network requests).
 *
 * P2 #5 Phase 4: in the REPL (non-TUI) context, falls back to the /diag
 * output which already includes the side-effect section.
 */
export function buildAuditCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'audit',
    category: 'Inspect',
    description: 'Show the side-effect audit trail (bash, install, fetch).',
    async run() {
      // Try opening the TUI overlay panel via the panel-open mechanism.
      if (opts.onPanelOpen.current) {
        const opened = opts.onPanelOpen.current('toggleAuditPanel');
        if (opened) return { message: '' };
      }
      // Fallback: render the side-effect section inline (REPL context).
      if (!opts.context) return { message: 'Audit not available in this context.' };
      const sideEffects = opts.context.sideEffects ?? [];
      if (sideEffects.length === 0) {
        return { message: 'No side effects recorded yet.' };
      }
      const lines = sideEffects.slice(-20).map((se) => {
        const time = se.ts.slice(11, 19);
        const detail = se.outcome ? ` → ${se.outcome}` : '';
        const input = se.input['command'] ?? se.input['url'] ?? se.input['packages'] ?? '';
        return `  ${time}  ${se.toolName.padEnd(8)} ${se.risk.padEnd(7)} ${String(input).slice(0, 60)}${detail}`;
      });
      return {
        message: `Side Effects (last ${Math.min(20, sideEffects.length)}):\n${lines.join('\n')}`,
      };
    },
  };
}
