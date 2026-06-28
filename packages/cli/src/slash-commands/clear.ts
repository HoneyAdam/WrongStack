import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export function buildClearCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'clear',
    category: 'Session',
    description: 'Reset the session and start a new one.',
    help: [
      'Usage:',
      '  /clear                 Reset conversation AND clear persistent memory',
      '  /clear --keep-memory   Reset the conversation but preserve memory entries',
      '',
      'Wipes everything in the current REPL state: messages, todos, read-file tracking,',
      'file mtimes, meta. Memory store entries (all scopes) are cleared too unless',
      '--keep-memory is passed. Chat history on disk is reset. The terminal is wiped.',
      'Use this when you want a fresh conversation without restarting `wstack`.',
    ].join('\n'),
    async run(args, ctx) {
      const keepMemory = /(^|\s)--keep-memory(\s|$)|(^|\s)--keep-mem(\s|$)/.test(args);
      if (ctx) {
        ctx.state.replaceMessages([]);
        ctx.state.replaceTodos([]);
        ctx.readFiles.clear();
        ctx.fileMtimes.clear();
        for (const key of Object.keys(ctx.meta)) ctx.state.deleteMeta(key);
      }
      // Clear on-disk chat history via the session writer
      if (ctx?.session) {
        await ctx.session.clearSession();
      }
      // Clear on-disk history via session store (e.g. pre-existing entries)
      if (opts.sessionStore) {
        await opts.sessionStore.clearHistory(ctx?.session.id ?? '');
      }
      if (!keepMemory) {
        await opts.memoryStore?.clear();
      }
      opts.onClear?.();
      await opts.onNewSession?.();
      opts.renderer.clear();
      const msg = keepMemory
        ? 'Session cleared (context and history reset; memory preserved).'
        : 'Session cleared (context, memory, and history reset).';
      opts.renderer.writeInfo(msg);
      return { message: msg };
    },
  };
}
