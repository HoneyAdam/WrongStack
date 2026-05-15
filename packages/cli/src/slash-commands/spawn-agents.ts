import type { SlashCommand } from '@wrongstack/core';
import { parseSpawnFlags } from '../arg-parser.js';
import type { SlashCommandContext } from './index.js';

export function buildSpawnCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'spawn',
    description: 'Spawn an isolated subagent to handle a task.',
    async run(args) {
      const { description, opts: parsed } = parseSpawnFlags(args.trim());
      if (!description)
        return {
          message:
            'Usage: /spawn [--provider=<id>] [--model=<id>] [--name=<label>] [--tools=a,b,c] <task description>',
        };
      if (!opts.onSpawn) return { message: 'Multi-agent is not enabled in this session.' };
      try {
        const summary =
          Object.keys(parsed).length > 0
            ? await opts.onSpawn(description, parsed)
            : await opts.onSpawn(description);
        return { message: summary };
      } catch (err) {
        return { message: `Spawn failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

export function buildAgentsCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'agents',
    description: 'Show status of spawned subagents.',
    async run() {
      if (!opts.onAgents) return { message: 'Multi-agent is not enabled in this session.' };
      return { message: opts.onAgents() };
    },
  };
}
