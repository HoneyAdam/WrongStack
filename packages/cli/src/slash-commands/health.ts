import { color } from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import { statusIcon } from './helpers.js';
import type { SlashCommandContext } from './index.js';

export function buildHealthCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'health',
    description: 'Run health checks (requires --metrics flag).',
    async run() {
      if (!opts.healthRegistry)
        return { message: 'Health checks not enabled. Restart with --metrics.' };
      const result = await opts.healthRegistry.run();
      const lines = [
        `${statusIcon(result.status)} overall: ${result.status}`,
        ...result.checks.map((c) => {
          const detail = c.detail ? color.dim(` — ${c.detail}`) : '';
          return `  ${statusIcon(c.status)} ${c.name}: ${c.status}${detail}`;
        }),
      ];
      return { message: lines.join('\n') };
    },
  };
}
