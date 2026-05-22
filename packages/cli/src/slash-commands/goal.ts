import { color } from '@wrongstack/core';
import {
  emptyGoal,
  formatGoal,
  goalFilePath,
  loadGoal,
  saveGoal,
} from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export function buildGoalCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'goal',
    description:
      'Set, inspect, or clear the long-running autonomous mission used by /autonomy eternal.',
    help: [
      'Usage:',
      '  /goal                     Show current goal + recent journal',
      '  /goal set <text>          Set a new goal (overwrites previous)',
      '  /goal clear               Clear the goal (stops eternal mode if running)',
      '  /goal status              Same as /goal (alias)',
      '  /goal journal [N]         Show last N journal entries (default 25)',
      '',
      'Goals live in <projectRoot>/.wrongstack/goal.json and persist across sessions.',
      'A goal is the prerequisite for /autonomy eternal — the engine consults it on',
      'every iteration to decide what to do next.',
    ].join('\n'),
    async run(args) {
      const trimmed = args.trim();
      const [verbRaw, ...rest] = trimmed.split(/\s+/);
      const verb = (verbRaw ?? '').toLowerCase();
      const restJoined = rest.join(' ').trim();
      const goalPath = goalFilePath(opts.projectRoot);

      switch (verb) {
        case '':
        case 'show':
        case 'status': {
          const current = await loadGoal(goalPath);
          if (!current) {
            const msg = 'No goal set. Use `/goal set <mission text>` to create one.';
            opts.renderer.write(msg);
            return { message: msg };
          }
          const msg = formatGoal(current);
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'set':
        case 'new': {
          if (!restJoined) {
            const msg = 'Usage: /goal set <mission text>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          const existing = await loadGoal(goalPath);
          // Preserve journal across goal replacement — useful as audit trail.
          // The new mission gets a fresh setAt but keeps the prior iterations
          // count so journal entries remain sequentially numbered.
          const next = existing
            ? { ...existing, goal: restJoined, setAt: new Date().toISOString(), lastActivityAt: new Date().toISOString() }
            : emptyGoal(restJoined);
          await saveGoal(goalPath, next);
          const msg = `${color.green('Goal set:')} ${restJoined}\n${color.dim(`Stored in ${goalPath}`)}`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'clear':
        case 'reset': {
          const existing = await loadGoal(goalPath);
          if (!existing) {
            const msg = 'No goal to clear.';
            opts.renderer.write(msg);
            return { message: msg };
          }
          // Soft-clear: mark engine stopped so any running engine exits next cycle,
          // and write a sentinel goal that the engine treats as "no work".
          // We *delete* the file rather than zero it out so loadGoal() returns null
          // and the engine's runOneIteration() short-circuits to stopRequested.
          const { unlink } = await import('node:fs/promises');
          try {
            await unlink(goalPath);
          } catch {
            // best-effort
          }
          if (opts.onEternalStop) opts.onEternalStop();
          const msg = `${color.amber('Goal cleared.')} Eternal mode will stop on next cycle.`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'journal':
        case 'log': {
          const current = await loadGoal(goalPath);
          if (!current) {
            const msg = 'No goal set.';
            opts.renderer.write(msg);
            return { message: msg };
          }
          const n = restJoined ? Math.max(1, Number.parseInt(restJoined, 10) || 25) : 25;
          if (current.journal.length === 0) {
            const msg = 'Journal is empty.';
            opts.renderer.write(msg);
            return { message: msg };
          }
          const tail = current.journal.slice(-n);
          const lines = tail.map((e) => {
            const mark = e.status === 'success' ? color.green('✓') : e.status === 'failure' ? color.red('✗') : e.status === 'aborted' ? color.amber('⊘') : color.dim('·');
            const note = e.note ? color.dim(` — ${e.note}`) : '';
            return `${color.dim(`#${e.iteration}`)} ${mark} ${color.dim(`[${e.source}]`)} ${e.task}${note}`;
          });
          const header = `Journal (last ${tail.length} of ${current.journal.length}):`;
          const msg = `${header}\n${lines.join('\n')}`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        default: {
          const msg = `Unknown subcommand "${verb}". Try: show | set <text> | clear | journal [N]`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      }
    },
  };
}
