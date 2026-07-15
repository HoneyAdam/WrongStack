import type { SlashCommand } from '@wrongstack/core';
import {
  buildGoalPreamble,
  color,
  createGoalKanbanBoard,
  emptyGoal,
  formatGoal,
  formatGoalAutonomyChoice,
  formatGoalEvent,
  formatGoalKanbanPreview,
  type GoalFile,
  loadGoal,
  parseAutonomyChoice,
  saveGoal,
} from '@wrongstack/core';
import { refineGoalWithFallback, resolveRefinerTarget } from './goal-refiner.js';
import type { SlashCommandContext } from './index.js';

const KNOWN_VERBS = new Set([
  '',
  'show',
  'status',
  'set',
  'new',
  'clear',
  'reset',
  'journal',
  'log',
  'pause',
  'resume',
  'refine',
]);

export function buildGoalCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'goal',
    category: 'Agent',
    description:
      'Set, inspect, or clear the long-running autonomous mission. Auto-refines goals for clarity.',
    help: [
      'Usage:',
      '  /goal                     Show current goal + progress + recent journal',
      '  /goal set <text>          Set a new goal (auto-refined for clarity)',
      '  /goal refine              Re-refine the current goal',
      '  /goal clear               Clear the goal (stops eternal mode if running)',
      '  /goal pause               Pause at end of current iteration',
      '  /goal resume              Resume a paused goal',
      '  /goal journal [N]         Show last N journal entries (default 25)',
      '',
      'When a goal is set, WrongStack auto-refines it using the LLM to:',
      '  • Make it unambiguous and concrete',
      '  • Extract verifiable deliverables with acceptance criteria',
      '  • Estimate completion progress (shown as a progress bar)',
      '',
      'Stage flow: decide → execute → reflect → sleep | paused | stopped',
      'The engine updates progress after each iteration toward the deliverable list.',
      '',
      'Goals live in ~/.wrongstack/projects/<hash>/goal.json and persist across sessions.',
      'A goal is the prerequisite for /autonomy eternal — the engine consults it on',
      'every iteration to decide what to do next.',
    ].join('\n'),
    async run(args) {
      // TUI mode: bare /goal opens the goal panel.
      if (!args.trim() && opts.onPanelOpen?.current) {
        const opened = opts.onPanelOpen.current('toggleGoalPanel');
        if (opened) return { message: '' };
      }
      const trimmed = args.trim();
      const [verbRaw, ...rest] = trimmed.split(/\s+/);
      const verb = (verbRaw ?? '').toLowerCase();
      const restJoined = rest.join(' ').trim();
      if (!opts.paths) return { message: 'Goal not available — paths not configured.' };
      const goalPath = opts.paths.projectGoal;

      // If the first token isn't a known verb, treat the entire args
      // string as the goal text — `/goal rewrite the auth module` works.
      const verbForDispatch = verb && !KNOWN_VERBS.has(verb) ? 'set' : verb;
      const setText = verbForDispatch === 'set' && !KNOWN_VERBS.has(verb) ? trimmed : restJoined;

      switch (verbForDispatch) {
        case '':
        case 'show':
        case 'status': {
          const current = await loadGoal(goalPath, opts.events);
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
          if (!setText) {
            const msg = 'Usage: /goal set <mission text>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }

          // Resolve the best available refiner provider+model from config,
          // validated against favorites + available providers.
          const cfg = opts.configStore?.get();
          const activeId = cfg?.provider ?? '';
          const activeModel = cfg?.model ?? '';
          const refinerTarget =
            cfg && opts.createProvider
              ? resolveRefinerTarget(cfg, opts.createProvider, activeId, activeModel)
              : undefined;

          opts.renderer.write(color.dim('Refining goal…'));
          const refined = await refineGoalWithFallback(setText, {
            primaryProvider: opts.llmProvider,
            primaryModel: opts.llmModel,
            refinerProvider: refinerTarget?.provider,
            refinerModel: refinerTarget?.model,
          });

          const existing = await loadGoal(goalPath, opts.events);
          const now = new Date().toISOString();
          const next: GoalFile = existing
            ? {
                ...existing,
                goal: setText,
                refinedGoal: refined.refinedGoal,
                deliverables: refined.deliverables,
                setAt: now,
                lastActivityAt: now,
                progress: undefined, // reset progress
                progressNote: undefined,
              }
            : {
                ...emptyGoal(setText),
                refinedGoal: refined.refinedGoal,
                deliverables: refined.deliverables,
              };

          await saveGoal(goalPath, next, opts.events);

          // Show summary
          const lines: string[] = [];
          lines.push(`🎯 ${color.green('Goal locked:')} ${color.bold(refined.refinedGoal)}`);
          if (refined.refinedGoal !== setText) {
            lines.push(
              color.dim(
                `  (original: "${setText.length > 60 ? setText.slice(0, 60) + '…' : setText}")`,
              ),
            );
          }
          if (refined.deliverables.length > 0) {
            lines.push('');
            lines.push(`${color.bold('Deliverables')} (${refined.deliverables.length}):`);
            for (const d of refined.deliverables) {
              lines.push(`  ${color.dim('○')} ${d}`);
            }
          }
          lines.push('');
          lines.push(color.dim(`Stored in ${goalPath} — progress tracked automatically.`));

          opts.renderer.write(lines.join('\n'));

          // ── Create goal kanban board ──────────────────────────────────
          const boardId = await createGoalKanbanBoard(opts.projectRoot, next).catch(
            () => null,
          );

          // ── Show Goal Event (post-refinement kanban preview) ──────────
          const eventMsg = formatGoalEvent(next, boardId);
          opts.renderer.write(eventMsg);

          const preview = formatGoalKanbanPreview(next, boardId, refined.deliverables.length);
          opts.renderer.write(preview);

          // ── Present Autonomy Eternal / Eternal Parallel choices ──────
          if (opts.reader && opts.onAutonomy) {
            const choiceMsg = formatGoalAutonomyChoice();
            opts.renderer.write(choiceMsg);

            const answer = await opts.reader.readLine('  › ');

            const mode = parseAutonomyChoice(answer ?? '');
            if (mode && opts.onEternalStart) {
              // Launch the chosen autonomy mode
              if (opts.onYolo) opts.onYolo(true);
              opts.onAutonomy(mode);
              opts.onEternalStart(mode);
              const modeLabel =
                mode === 'eternal-parallel'
                  ? `${color.magenta('PARALLEL')} mode`
                  : `${color.red('ETERNAL')} mode`;
              opts.renderer.write(
                `${color.green('✓')} Autonomy mode: ${modeLabel} — engine launching against goal.`,
              );
            } else if (mode) {
              // onAutonomy is available but onEternalStart is not
              opts.onAutonomy(mode);
              opts.renderer.write(
                `${color.dim('Autonomy mode set but engine controller not wired. Launch manually with /autonomy ' + mode + '.')}`,
              );
            } else {
              opts.renderer.write(
                `${color.dim('No mode selected. Launch manually:')} ${color.cyan('/autonomy eternal')} ${color.dim('or')} ${color.cyan('/autonomy parallel')}.`,
              );
            }
          } else {
            // No reader available — print instructions
            opts.renderer.write(
              `${color.dim('\nTo start autonomous mode:\n  ')}${color.cyan('/autonomy eternal')} ${color.dim('— single-agent loop\n  ')}${color.cyan('/autonomy parallel')} ${color.dim('— multi-agent fan-out')}`,
            );
          }

          return {
            message: `Goal locked: ${refined.refinedGoal}`,
            runText: buildGoalPreamble(refined.refinedGoal, refined.deliverables),
          };
        }

        case 'refine': {
          const current = await loadGoal(goalPath, opts.events);
          if (!current) {
            const msg = 'No goal set to refine. Use /goal set <text> first.';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }

          const cfg = opts.configStore?.get();
          const activeId = cfg?.provider ?? '';
          const activeModel = cfg?.model ?? '';
          const refinerTarget =
            cfg && opts.createProvider
              ? resolveRefinerTarget(cfg, opts.createProvider, activeId, activeModel)
              : undefined;

          opts.renderer.write(color.dim('Re-refining goal…'));
          const refined = await refineGoalWithFallback(current.goal, {
            primaryProvider: opts.llmProvider,
            primaryModel: opts.llmModel,
            refinerProvider: refinerTarget?.provider,
            refinerModel: refinerTarget?.model,
          });

          const updated: GoalFile = {
            ...current,
            refinedGoal: refined.refinedGoal,
            deliverables: refined.deliverables,
          };
          await saveGoal(goalPath, updated, opts.events);

          const msg = `${color.green('✓')} Goal re-refined with ${refined.deliverables.length} deliverables.`;
          opts.renderer.write(msg);
          return { message: `${msg}\n\n${formatGoal(updated)}` };
        }

        case 'clear':
        case 'reset': {
          const current = await loadGoal(goalPath, opts.events);
          if (!current) {
            const msg = 'No goal to clear.';
            opts.renderer.write(msg);
            return { message: msg };
          }
          const { unlink } = await import('node:fs/promises');
          try {
            await unlink(goalPath);
          } catch {
            // best-effort — file may already be gone
          }
          // Cant: the goal file is gone. The autonomy engine and the `autonomous`
          // mode loop both check for the file's existence before running; without
          // it they will not spin up again until `/goal set` is called.
          // Switching to `auto` mode so the agent keeps working autonomously
          // without a goal — the user can stop with `/autonomy off`.
          if (opts.onEternalStop) opts.onEternalStop();
          if (opts.onAutonomy) opts.onAutonomy('auto');
          const msg = `${color.amber('Goal cleared.')} Goal file removed; switching to auto mode. Use /autonomy off to stop.`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'journal':
        case 'log': {
          const current = await loadGoal(goalPath, opts.events);
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
            const mark =
              e.status === 'success'
                ? color.green('✓')
                : e.status === 'failure'
                  ? color.red('✗')
                  : e.status === 'aborted'
                    ? color.amber('⊘')
                    : color.dim('·');
            const note = e.note ? color.dim(` — ${e.note}`) : '';
            return `${color.dim(`#${e.iteration}`)} ${mark} ${color.dim(`[${e.source}]`)} ${e.task}${note}`;
          });
          const header = `Journal (last ${tail.length} of ${current.journal.length}):`;
          const msg = `${header}\n${lines.join('\n')}`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'pause': {
          const current = await loadGoal(goalPath, opts.events);
          if (!current) {
            const msg = 'No goal set — nothing to pause.';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          if (current.goalState === 'paused') {
            const msg = `${color.dim('Already paused.')} Use /goal resume to continue.`;
            opts.renderer.write(msg);
            return { message: msg };
          }
          const paused: GoalFile = { ...current, goalState: 'paused' };
          await saveGoal(goalPath, paused, opts.events);
          const msg = `${color.cyan('Goal paused.')} Current iteration will finish, then the loop stops. Use /goal resume to continue.`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        case 'resume': {
          const current = await loadGoal(goalPath, opts.events);
          if (!current) {
            const msg = 'No goal set — cannot resume.';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          if (current.goalState !== 'paused') {
            const msg = `${color.dim('Not paused.')} Use /goal set <text> to create or update a goal first.`;
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          const resumed: GoalFile = { ...current, goalState: 'active' };
          await saveGoal(goalPath, resumed, opts.events);
          const msg = `${color.green('Goal resumed.')} Loop will continue from the next iteration.`;
          opts.renderer.write(msg);
          return { message: msg };
        }

        default: {
          const msg = `Unknown subcommand "${verb}". Try: show | set <text> | refine | clear | journal [N]`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      }
    },
  };
}
