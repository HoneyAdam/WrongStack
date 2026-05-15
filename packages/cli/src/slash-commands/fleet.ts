import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export function buildFleetCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'fleet',
    description:
      'Inspect or control the subagent fleet: /fleet [status|usage|kill <id>|manifest|help]',
    help: [
      'Usage:',
      '  /fleet                  Show fleet status (alias for /fleet status).',
      '  /fleet status           Pending + completed subagent task table.',
      '  /fleet usage            Per-subagent runtime cost.',
      '  /fleet kill <id>        Terminate a running subagent.',
      '  /fleet manifest         Print the director manifest.',
      '  /fleet help             Show this help.',
    ].join('\n'),
    async run(args) {
      if (!opts.onFleet) return { message: 'Multi-agent is not enabled in this session.' };
      const trimmed = args.trim();
      const [verb, ...rest] = trimmed.length === 0 ? ['status'] : trimmed.split(/\s+/);
      const target = rest.join(' ').trim() || undefined;
      switch (verb) {
        case 'status':
        case 'usage':
        case 'manifest': {
          const out = await opts.onFleet(verb, undefined);
          return { message: out };
        }
        case 'kill': {
          if (!target) return { message: 'Usage: /fleet kill <subagent-id>' };
          return { message: await opts.onFleet('kill', target) };
        }
        case 'help':
        case '?':
          return {
            message: [
              '/fleet — inspect or control the subagent fleet',
              '',
              '  /fleet                  → status (default)',
              '  /fleet status           pending + completed tasks per subagent',
              '  /fleet usage            iterations, tool calls, duration roll-up',
              '  /fleet kill <id>        terminate a subagent',
              '  /fleet manifest         director manifest (requires --director)',
            ].join('\n'),
          };
        default:
          return {
            message: `Unknown subcommand "${verb}". Try: status | usage | kill <id> | manifest | help`,
          };
      }
    },
  };
}
