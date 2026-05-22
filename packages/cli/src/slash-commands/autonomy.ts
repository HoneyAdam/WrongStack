import { color } from '@wrongstack/core';
import { goalFilePath, loadGoal, summarizeUsage } from '@wrongstack/core';
import type { SlashCommand } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

export type AutonomyMode = 'off' | 'suggest' | 'auto' | 'eternal';

export function buildAutonomyCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'autonomy',
    description: 'Toggle or query autonomy mode (self-driving agent).',
    help: [
      'Usage:',
      '  /autonomy            Show current autonomy status',
      '  /autonomy off        Disabled — agent stops after each turn (default)',
      '  /autonomy suggest    Show next-step suggestions after each turn',
      '  /autonomy on         Auto-continue — agent picks next step and proceeds',
      '  /autonomy eternal    Sittin-sene mode — runs forever against /goal',
      '  /autonomy stop       Stop eternal mode (no-op for other modes)',
      '  /autonomy toggle     Cycle: off → suggest → auto → eternal → off',
      '',
      'Modes:',
      '  off      — Normal interactive mode. Agent stops and waits.',
      '  suggest  — After each turn, agent suggests next steps. You pick.',
      '  auto     — After each turn, agent picks the best next step and continues.',
      '             Runs indefinitely until you press Esc or Ctrl+C.',
      '  eternal  — Goal-driven sense/decide/execute/reflect loop. Requires /goal.',
      '             Force-enables YOLO. Runs until /autonomy stop or Ctrl+C twice.',
      '',
      'In auto/eternal modes the agent works autonomously. Press Esc to redirect,',
      'Ctrl+C to stop the active iteration. /autonomy stop ends the eternal loop.',
    ].join('\n'),
    async run(args) {
      const arg = args.trim().toLowerCase();

      if (!opts.onAutonomy) {
        const msg = 'Autonomy mode is not available in this session.';
        opts.renderer.writeWarning(msg);
        return { message: msg };
      }

      // No argument — show current status (mode + engine + goal snapshot)
      if (!arg || arg === 'status') {
        const current = opts.onAutonomy();
        const labels: Record<AutonomyMode, string> = {
          off: `${color.green('OFF')} ${color.dim('(agent stops after each turn)')}`,
          suggest: `${color.cyan('SUGGEST')} ${color.dim('(shows next-step suggestions)')}`,
          auto: `${color.yellow('AUTO')} ${color.dim('(self-driving — Esc to redirect, Ctrl+C to stop)')}`,
          eternal: `${color.red('ETERNAL')} ${color.dim('(sittin-sene — goal-driven, YOLO, until /autonomy stop)')}`,
        };
        const lines: string[] = [`Autonomy mode: ${labels[current]}`];
        // Surface engine + goal context when relevant — when current mode
        // is eternal, or when a goal exists (so the user sees the state
        // even after a /autonomy stop without re-typing /goal status).
        try {
          const goal = await loadGoal(goalFilePath(opts.projectRoot));
          if (goal) {
            const u = summarizeUsage(goal);
            lines.push(color.dim(`  Goal: ${goal.goal.length > 80 ? `${goal.goal.slice(0, 77)}…` : goal.goal}`));
            lines.push(color.dim(`  Engine state: ${goal.engineState}  ·  iterations: ${goal.iterations}  ·  journal: ${goal.journal.length}`));
            if (u.iterationsWithUsage > 0) {
              lines.push(
                color.dim(
                  `  Spent: $${u.totalCostUsd.toFixed(4)}  ·  ${u.totalInputTokens} in / ${u.totalOutputTokens} out tokens`,
                ),
              );
            }
            // Recent failure pulse — useful to see if the loop is stuck.
            const recent = goal.journal.slice(-10);
            const failed = recent.filter((e) => e.status === 'failure').length;
            if (failed > 0) {
              lines.push(color.amber(`  Recent failures: ${failed} of last ${recent.length} iterations`));
            }
          }
        } catch {
          // best-effort; suppress
        }
        const msg = lines.join('\n');
        opts.renderer.write(msg);
        return { message: msg };
      }

      // Stop is a separate action, not a mode set.
      if (arg === 'stop' || arg === 'halt' || arg === 'kill') {
        if (!opts.onEternalStop) {
          const msg = 'No eternal-mode controller wired in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        opts.onEternalStop();
        opts.onAutonomy('off');
        // Read the goal post-stop to compute a "what did this loop spend"
        // summary. The engine's last in-flight iteration may still write
        // one more journal entry after this returns, but the user wants
        // an immediate readout — better a slightly stale summary than no
        // summary. Failures here are non-fatal; the stop signal already
        // landed regardless of whether the summary renders.
        let summaryLine = '';
        try {
          const goal = await loadGoal(goalFilePath(opts.projectRoot));
          if (goal) {
            const u = summarizeUsage(goal);
            if (u.iterationsWithUsage > 0) {
              summaryLine =
                '\n' +
                color.dim(
                  `  Spent so far: $${u.totalCostUsd.toFixed(4)} · ${u.totalInputTokens} in / ${u.totalOutputTokens} out tokens · ${goal.iterations} total iterations.`,
                );
            } else if (goal.iterations > 0) {
              summaryLine = '\n' + color.dim(`  Total iterations: ${goal.iterations}.`);
            }
          }
        } catch {
          // best-effort summary; suppress
        }
        const msg = `${color.amber('Eternal mode stop requested.')} The current iteration will finish, then the loop exits.${summaryLine}`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      // Explicit set
      let newMode: AutonomyMode;
      if (arg === 'on' || arg === 'enable' || arg === 'true' || arg === 'auto') {
        newMode = 'auto';
      } else if (arg === 'off' || arg === 'disable' || arg === 'false') {
        newMode = 'off';
      } else if (arg === 'suggest' || arg === 'suggestions') {
        newMode = 'suggest';
      } else if (arg === 'eternal' || arg === 'forever' || arg === 'infinite' || arg === 'sittinsene') {
        newMode = 'eternal';
      } else if (arg === 'toggle' || arg === 'cycle') {
        const current = opts.onAutonomy() ?? 'off';
        const cycle: AutonomyMode[] = ['off', 'suggest', 'auto', 'eternal'];
        newMode = cycle[(cycle.indexOf(current) + 1) % cycle.length] ?? 'off';
      } else {
        const msg = `Unknown argument: ${arg}. Use /autonomy on, off, suggest, eternal, stop, or toggle.`;
        opts.renderer.writeWarning(msg);
        return { message: msg };
      }

      // Eternal mode requires a goal — fail loudly before flipping the switch.
      if (newMode === 'eternal') {
        const goal = await loadGoal(goalFilePath(opts.projectRoot));
        if (!goal) {
          const msg = `${color.red('Eternal mode requires a goal.')} Run \`/goal set <mission>\` first.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        if (!opts.onEternalStart) {
          const msg = 'Eternal mode controller is not wired in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        // Force YOLO on for destructive ops (push, delete, etc.) — user opted into "sittin sene".
        if (opts.onYolo) opts.onYolo(true);
        opts.onAutonomy(newMode);
        opts.onEternalStart();
        const msg =
          `${color.red('Autonomy mode: ETERNAL')} — engine launching against goal: ${color.bold(goal.goal)}\n` +
          `${color.dim('YOLO forced ON. Use /autonomy stop to end. Journal at /goal journal.')}`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      // Leaving eternal mode (or switching modes) should stop a running engine.
      // Cast through AutonomyMode — circular type resolution between this file
      // and ./index.js (which references AutonomyMode) can mask the 'eternal'
      // arm during typecheck. The runtime value is always correct.
      const previous = opts.onAutonomy() as AutonomyMode;
      if (previous === 'eternal' && opts.onEternalStop) {
        opts.onEternalStop();
      }

      opts.onAutonomy(newMode);
      const labels: Record<AutonomyMode, string> = {
        off: `${color.green('OFF')} — agent stops after each turn`,
        suggest: `${color.cyan('SUGGEST')} — shows next-step suggestions after each turn`,
        auto: `${color.yellow('AUTO')} — self-driving, agent continues automatically`,
        eternal: `${color.red('ETERNAL')} — goal-driven sittin-sene loop`,
      };
      const msg = `Autonomy mode: ${labels[newMode]}`;
      opts.renderer.write(msg);
      return { message: msg };
    },
  };
}
