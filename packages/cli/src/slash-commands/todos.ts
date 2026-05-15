import { randomUUID } from 'node:crypto';
import { color } from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export function buildTodosCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'todos',
    description:
      'Inspect or edit the live todo list: /todos [show|clear|add <text>|done <id|index>]',
    async run(args) {
      const ctx = opts.context;
      if (!ctx) return { message: 'No active context.' };
      const [verb, ...rest] = args.trim().split(/\s+/);
      const restJoined = rest.join(' ').trim();
      switch (verb) {
        case '':
        case 'show':
        case 'list': {
          const todos = ctx.todos;
          if (todos.length === 0) return { message: 'No todos.' };
          const lines: string[] = [];
          const done = todos.filter((t) => t.status === 'completed').length;
          lines.push(color.dim(`Todos (${done}/${todos.length} done):`));
          todos.forEach((t, i) => {
            const mark =
              t.status === 'completed'
                ? color.green('[x]')
                : t.status === 'in_progress'
                  ? color.yellow('[~]')
                  : color.dim('[ ]');
            const text = t.status === 'in_progress' && t.activeForm ? t.activeForm : t.content;
            const label = t.status === 'completed' ? color.dim(text) : text;
            lines.push(`  ${color.dim(String(i + 1).padStart(2))}. ${mark} ${label}`);
          });
          return { message: lines.join('\n') };
        }
        case 'clear': {
          const n = ctx.todos.length;
          ctx.todos.length = 0;
          return {
            message:
              n === 0 ? 'Todos were already empty.' : `Cleared ${n} todo${n === 1 ? '' : 's'}.`,
          };
        }
        case 'add': {
          if (!restJoined) return { message: 'Usage: /todos add <text>' };
          ctx.todos.push({
            id: `todo_${Date.now()}_${randomUUID().slice(0, 7)}`,
            content: restJoined,
            status: 'pending',
          });
          return { message: `Added: ${restJoined}` };
        }
        case 'done':
        case 'complete': {
          if (!restJoined) return { message: 'Usage: /todos done <id|index>' };
          const asIndex = Number.parseInt(restJoined, 10);
          let target = !Number.isNaN(asIndex)
            ? ctx.todos[asIndex - 1]
            : ctx.todos.find((t) => t.id === restJoined);
          if (!target)
            target = ctx.todos.find((t) =>
              t.content.toLowerCase().includes(restJoined.toLowerCase()),
            );
          if (!target) return { message: `No todo matched "${restJoined}".` };
          target.status = 'completed';
          return { message: `Marked done: ${target.content}` };
        }
        default:
          return {
            message: `Unknown subcommand "${verb}". Try: show | clear | add <text> | done <id|index>`,
          };
      }
    },
  };
}
