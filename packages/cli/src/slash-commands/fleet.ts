import { color } from '@wrongstack/core';
import { type SlashCommand, type CoordinatorStatus, type FleetUsage } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

/**
 * /fleet — live fleet observability and control.
 *
 * Requires a FleetManager or Director instance to be wired into SlashCommandContext.
 * Works during /autonomy parallel mode (when the engine is running) and for
 * any standalone director session.
 *
 * Usage:
 *   /fleet              — status table: subagent id / name / role / status / current task
 *   /fleet status       — same as /fleet (verbose)
 *   /fleet spawn <role> [count]  — spawn N subagents of a given role (default 1)
 *   /fleet terminate <subagentId>  — stop a specific subagent
 *   /fleet kill         — stop all running subagents
 *   /fleet usage        — token and cost breakdown across the fleet
 *   /fleet journal      — show recent journal entries from goal.json
 */
export function buildFleetCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'fleet',
    description: 'Inspect and control the agent fleet (subagents, parallel slots).',
    help: [
      'Usage:',
      '  /fleet              Show fleet status (default)',
      '  /fleet status       Same as /fleet (verbose status)',
      '  /fleet spawn <role> [count]  Spawn N subagents of a role (default 1)',
      '  /fleet terminate <subagentId>  Stop a specific subagent by id',
      '  /fleet kill         Stop all running subagents',
      '  /fleet usage        Token and cost breakdown across the fleet',
      '  /fleet journal      Show recent journal entries from /goal journal',
      '',
      'Works during /autonomy parallel mode and standalone director sessions.',
    ].join('\n'),
    async run(args) {
      const parts = args.trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const subargs = parts.slice(1);

      // ── /fleet (status / manifest) ────────────────────────────────────────
      if (!cmd || cmd === 'status' || cmd === 'info' || cmd === 'manifest') {
        if (opts.onFleetStatus) {
          const status = opts.onFleetStatus();
          if (!status) {
            const msg = `${color.amber('⚠ No fleet active.')} Start /autonomy parallel first, or pass --director to a session.`;
            opts.renderer.write(msg);
            return { message: msg };
          }
          const lines: string[] = [];
          lines.push(`${color.bold('Fleet Status')}`);
          lines.push(
            color.dim(
              `  coordinator: ${status.coordinatorId}  ·  pending: ${status.pendingTasks}  ·  done: ${status.completedTasks}`,
            ),
          );
          if (status.subagents.length === 0) {
            lines.push(color.dim('  No active subagents.'));
          } else {
            lines.push('');
            lines.push(
              `  ${color.bold('ID').padEnd(36)} ${color.bold('NAME').padEnd(16)} ${color.bold('STATUS').padEnd(10)} ${color.bold('TASK')}`,
            );
            lines.push(color.dim('  ' + '─'.repeat(80)));
            for (const sa of status.subagents) {
              const id = sa.id?.padEnd(36) ?? ''.padEnd(36);
              const name = (sa.name ?? 'worker').padEnd(16);
              const statusColor =
                sa.status === 'running'
                  ? color.green(sa.status.padEnd(10))
                  : sa.status === 'idle'
                    ? color.dim(sa.status.padEnd(10))
                    : color.dim(sa.status.padEnd(10));
              const task = sa.currentTask ?? color.dim('—');
              lines.push(`  ${id} ${name} ${statusColor} ${task}`);
            }
          }
          const msg = lines.join('\n');
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (opts.onFleet) {
          const msg = await opts.onFleet((cmd || 'status') as 'status' | 'usage' | 'kill' | 'manifest' | 'concurrency' | 'retry' | 'log', undefined);
          return { message: msg };
        }
        const msg = `${color.amber('⚠ No fleet active.')} Start /autonomy parallel first, or pass --director to a session.`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      // ── /fleet usage ─────────────────────────────────────────────────────
      if (cmd === 'usage' || cmd === 'cost' || cmd === 'tokens') {
        if (opts.onFleetUsage) {
          const usage = opts.onFleetUsage();
          if (!usage) {
            const msg = `${color.amber('⚠ No fleet usage data.')} Start /autonomy parallel first.`;
            opts.renderer.write(msg);
            return { message: msg };
          }

          const totalCost = usage.total?.cost ?? 0;
          const totalIn = usage.total?.input ?? 0;
          const totalOut = usage.total?.output ?? 0;

          const lines: string[] = [];
          lines.push(`${color.bold('Fleet Usage')}`);
          lines.push(
            `  ${color.dim('Total:')} ${color.green(`${totalCost.toFixed(4)}`)} · ${color.cyan(totalIn.toLocaleString())} in · ${color.cyan(totalOut.toLocaleString())} out`,
          );

          const subagents = Object.values(usage.perSubagent);
          if (subagents.length > 0) {
            lines.push('');
            for (const sa of subagents) {
              const name = (sa.subagentId ?? '?').padEnd(20);
              const cost = `${(sa.cost ?? 0).toFixed(4)}`.padStart(10);
              const tokens = `${sa.input ?? 0} in / ${sa.output ?? 0} out`.padEnd(30);
              lines.push(`  ${color.dim(name)} ${color.cyan(cost)} ${color.dim(tokens)}`);
            }
          }

          const msg = lines.join('\n');
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (opts.onFleet) {
          const msg = await opts.onFleet('usage', undefined);
          return { message: msg };
        }
        const msg = `${color.amber('⚠ No fleet usage data.')} Start /autonomy parallel first.`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      // ── /fleet retry ───────────────────────────────────────────────────────
      if (cmd === 'retry') {
        if (opts.onFleetRetry) {
          const targetId = subargs[0];
          const msg = await opts.onFleetRetry(targetId);
          return { message: msg };
        }
        if (opts.onFleet) {
          const msg = await opts.onFleet('retry', subargs[0]);
          return { message: msg };
        }
        const msg = `Retry is only available when director mode is active.`;
        opts.renderer.writeWarning(msg);
        return { message: msg };
      }

      // ── /fleet journal / log ────────────────────────────────────────────────
      if (cmd === 'journal' || cmd === 'log') {
        if (opts.onFleetLog) {
          const subagentId = subargs[0];
          const mode = subargs[1] === 'raw' ? 'raw' : 'summary';
          const msg = await opts.onFleetLog(subagentId, mode);
          return { message: msg };
        }
        if (opts.onFleet) {
          const msg = await opts.onFleet('log', subargs[0]);
          return { message: msg };
        }
        // Fall through to unknown command when no handlers and no goal
        const msg = `${color.dim('No journal entries yet.')}`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      // ── /fleet kill ──────────────────────────────────────────────────────
      if (cmd === 'kill' || cmd === 'stop-all') {
        const targetId = subargs[0];
        if (!targetId) {
          const msg = `Usage: /fleet kill <subagent-id>`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        if (opts.onFleetKill) {
          const killed = opts.onFleetKill();
          const msg = `${color.red('✗ Killed')} ${killed} subagent(s).`;
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (opts.onFleet) {
          const msg = await opts.onFleet('kill', targetId);
          return { message: msg };
        }
        const msg = `${color.amber('⚠ /fleet kill is not wired in this session.')}`;
        opts.renderer.writeWarning(msg);
        return { message: msg };
      }

      // ── /fleet terminate <subagentId> ────────────────────────────────────
      if (cmd === 'terminate' || cmd === 'stop') {
        const targetId = subargs[0];
        if (!targetId) {
          const msg = `${color.amber('⚠ /fleet terminate requires a subagentId.')} Use /fleet to see active ids.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        if (!opts.onFleetTerminate) {
          const msg = `${color.amber('⚠ /fleet terminate is not wired in this session.')}`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const ok = opts.onFleetTerminate(targetId);
        if (ok) {
          const msg = `${color.green('✓ Terminated')} subagent ${color.bold(targetId)}.`;
          opts.renderer.write(msg);
          return { message: msg };
        } else {
          const msg = `${color.red('✗ Failed')} to terminate ${color.bold(targetId)}. Subagent may already be stopped.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      }

      // ── /fleet spawn <role> [count] ──────────────────────────────────────
      if (cmd === 'spawn' || cmd === 'add') {
        const role = subargs[0] ?? 'worker';
        const count = Math.min(16, Math.max(1, parseInt(subargs[1] ?? '1', 10) || 1));
        if (!opts.onFleetSpawn) {
          const msg = `${color.amber('⚠ /fleet spawn is not wired in this session.')}`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const spawned: string[] = [];
        let msg: string;
        for (let i = 0; i < count; i++) {
          try {
            const id = await opts.onFleetSpawn(role);
            spawned.push(id);
          } catch (err) {
            const msg = `${color.red('✗ Spawn failed')} for slot ${i + 1}: ${err instanceof Error ? err.message : String(err)}`;
            opts.renderer.writeWarning(msg);
          }
        }
        if (spawned.length === count) {
          msg = `${color.green('✓ Spawned')} ${count} subagent(s) of role ${color.bold(role)}.`;
          opts.renderer.write(msg);
        } else {
          msg = `${color.amber('⚠ Spawned')} ${spawned.length}/${count} subagent(s). Check /fleet for details.`;
          opts.renderer.writeWarning(msg);
        }
        return { message: msg };
      }

      // ── /fleet help ───────────────────────────────────────────────────────
      if (cmd === 'help' || cmd === '?') {
        const msg = [
          `${color.bold('Fleet Commands')}`,
          `  ${color.dim('/fleet')}              Show fleet status (default)`,
          `  ${color.dim('/fleet status')}       Same as /fleet (verbose status)`,
          `  ${color.dim('/fleet spawn <role> [count]')}  Spawn N subagents of a role (default 1)`,
          `  ${color.dim('/fleet terminate <subagentId>')}  Stop a specific subagent by id`,
          `  ${color.dim('/fleet kill')}         Stop all running subagents`,
          `  ${color.dim('/fleet usage')}        Token and cost breakdown across the fleet`,
          `  ${color.dim('/fleet journal')}      Show recent journal entries from /goal journal`,
        ].join('\n');
        opts.renderer.write(msg);
        return { message: msg };
      }

      // ── Unknown command ───────────────────────────────────────────────────
      const valid = ['status', 'usage', 'spawn', 'terminate', 'kill', 'retry', 'journal'];
      const msg = `Unknown subcommand "${cmd}". Valid subcommands: ${valid.join(', ')}. Run /fleet with no args to see status, or /fleet help for usage.`;
      opts.renderer.writeWarning(msg);
      return { message: msg };
    },
  };
}