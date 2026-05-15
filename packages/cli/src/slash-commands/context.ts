import { color } from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import { countToolResults, countToolUses, countTurnPairs, estimateTokens } from './helpers.js';
import type { SlashCommandContext } from './index.js';

export function buildContextCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'context',
    aliases: ['ctx'],
    description: 'Show context window summary.',
    help: [
      'Usage:',
      '  /context           Show counts: messages, est. tokens, tool calls, todos, read files.',
      '  /context detail    As above, plus model, cwd, projectRoot, and the file list.',
    ].join('\n'),
    async run(args, ctx) {
      const messages = ctx.messages;
      const detailed = args.trim() === 'detail';
      const lines = [
        `${color.bold('Context Window')}`,
        `  messages:    ${messages.length} total (${countTurnPairs(messages)} user+assistant pairs)`,
        `  tokens (≈):  ${estimateTokens(messages).toLocaleString()} (chars ÷ 4 estimate)`,
        `  system prompt: ${ctx.systemPrompt.length} block${ctx.systemPrompt.length !== 1 ? 's' : ''}`,
        `  tools:       ${countToolUses(messages)} calls made, ${countToolResults(messages)} results in history`,
        `  read files:  ${ctx.readFiles.size} files`,
        `  todos:       ${ctx.todos.filter((t) => t.status === 'in_progress').length} in_progress / ${ctx.todos.filter((t) => t.status === 'pending').length} pending / ${ctx.todos.filter((t) => t.status === 'completed').length} completed`,
      ];
      if (detailed) {
        lines.push(
          `  model:       ${ctx.model}`,
          `  cwd:         ${ctx.cwd}`,
          `  projectRoot: ${ctx.projectRoot}`,
          `  file mtimes: ${ctx.fileMtimes.size} tracked`,
        );
        if (ctx.readFiles.size > 0) lines.push(`  file list:   ${[...ctx.readFiles].join(', ')}`);
      }
      const msg = lines.join('\n');
      opts.renderer.write(`${msg}\n`);
      return { message: msg };
    },
  };
}
