/**
 * /brain — inspect and steer the session's global Brain.
 *
 * The Brain is the decision layer between the agents and the human:
 * policy arbiter first, LLM decision support second (within a live risk
 * ceiling), human escalation last. The BrainMonitor also engages it
 * proactively on tool-failure streaks and error storms.
 *
 *   /brain                  status — mode, ceiling, pool, recent decisions
 *   /brain status           same
 *   /brain risk <level>     set the autonomy ceiling (off|low|medium|high|all)
 *   /brain mode <m>         headless (never block on a human) | interactive
 *   /brain ask <question>   consult the Brain directly for a decision
 *   /brain ledger [n]       last n rows of the persistent decision ledger
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { BrainAutoRisk, BrainLedgerEntry, SlashCommand } from '@wrongstack/core';
import { color } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

const RISK_LEVELS: ReadonlySet<string> = new Set(['off', 'low', 'medium', 'high', 'all']);

function fmtAge(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function buildBrainCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'brain',
    category: 'Agent',
    argsHint: '[status|risk <level>|mode <m>|ask <question>|ledger [n]]',
    description:
      'Inspect the Brain, set its autonomy risk ceiling or escalation mode, or ask it for a decision.',
    help: [
      'Usage:',
      '  /brain                 Show Brain status (mode, risk ceiling, LLM pool, recent decisions)',
      '  /brain status          Same as /brain',
      '  /brain risk <level>    Set autonomy ceiling: off | low | medium | high | all',
      '  /brain mode <m>        headless (never block on a human) | interactive',
      '  /brain ask <question>  Consult the Brain directly for decision support',
      '  /brain ledger [n]      Show the last n rows (default 15) of the persistent decision ledger',
      '',
      'The Brain decides in tiers: deterministic policy → LLM pool / multi-LLM',
      'council (within the risk ceiling) → escalation. In headless mode the',
      'escalation tier resolves via the terminal policy instead of prompting',
      'you, so the Brain never blocks on a human. Configure the LLM pool and',
      'council in ~/.wrongstack/config.json under "brain". It also',
      'self-activates on tool failure streaks and error storms, steering',
      'agents via mailbox.',
    ].join('\n'),
    async run(args) {
      const trimmed = args.trim();
      const [sub, ...rest] = trimmed.split(/\s+/);
      const subcommand = (sub ?? '').toLowerCase();

      // TUI mode: bare /brain or /brain status opens the interactive panel.
      if ((subcommand === '' || subcommand === 'status') && opts.onPanelOpen?.current) {
        const opened = opts.onPanelOpen.current('brainOpen');
        if (opened) return { message: '' };
      }

      if (subcommand === 'risk') {
        if (!opts.brainSettings) {
          const msg = 'Brain settings are not available in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const level = (rest[0] ?? '').toLowerCase();
        if (!level) {
          const msg = `Brain autonomy ceiling: ${color.cyan(opts.brainSettings.maxAutoRisk)} ${color.dim('(set with /brain risk <off|low|medium|high|all>)')}`;
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (!RISK_LEVELS.has(level)) {
          const msg = `Unknown risk level: ${level}. Use off, low, medium, high, or all.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        opts.brainSettings.maxAutoRisk = level as BrainAutoRisk;
        const explain =
          level === 'off'
            ? 'LLM layer disabled — everything the policy cannot answer escalates to you'
            : level === 'all'
              ? 'the Brain auto-decides everything, including critical-risk questions'
              : `the Brain auto-decides questions up to ${level} risk; above that it asks you`;
        const msg = `Brain autonomy ceiling set to ${color.cyan(level)} — ${explain}.`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      if (subcommand === 'mode') {
        if (!opts.brainSettings) {
          const msg = 'Brain settings are not available in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const mode = (rest[0] ?? '').toLowerCase();
        if (!mode) {
          const msg = `Brain escalation mode: ${color.cyan(opts.brainSettings.mode ?? 'interactive')} ${color.dim('(set with /brain mode <headless|interactive>)')}`;
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (mode !== 'headless' && mode !== 'interactive') {
          const msg = `Unknown mode: ${mode}. Use headless or interactive.`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        opts.brainSettings.mode = mode;
        const explain =
          mode === 'headless'
            ? 'the Brain never blocks on you — escalations resolve via the terminal policy (safe default or deny)'
            : 'escalations above the risk ceiling prompt you in the TUI/WebUI';
        const msg = `Brain escalation mode set to ${color.cyan(mode)} — ${explain}.`;
        opts.renderer.write(msg);
        return { message: msg };
      }

      if (subcommand === 'ledger') {
        const ledgerPath = opts.brainSettings?.ledgerPath;
        if (!ledgerPath) {
          const msg = 'The Brain decision ledger is disabled in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const n = Math.max(1, Math.min(100, Number.parseInt(rest[0] ?? '15', 10) || 15));
        let raw: string;
        try {
          raw = await readFile(ledgerPath, 'utf8');
        } catch {
          const msg = `No ledger entries yet (${ledgerPath}).`;
          opts.renderer.write(msg);
          return { message: msg };
        }
        const rows = raw
          .split('\n')
          .filter((l) => l.trim().length > 0)
          .slice(-n)
          .map((l) => {
            try {
              return JSON.parse(l) as BrainLedgerEntry;
            } catch {
              return null;
            }
          })
          .filter((e): e is BrainLedgerEntry => e !== null);
        const lines = [
          `${color.bold('Brain ledger')} — ${color.dim(ledgerPath)}`,
          ...rows.map((e) => {
            const what =
              e.kind === 'outcome'
                ? `outcome:${e.outcome}`
                : e.kind === 'answered' && e.optionId
                  ? `answered [${e.optionId}]`
                  : e.kind;
            const detail = e.question ?? e.detail ?? '';
            const trimmed = detail.length > 70 ? `${detail.slice(0, 67)}…` : detail;
            return `  ${color.dim(fmtAge(e.at).padEnd(8))} ${what.padEnd(20)} ${trimmed}`;
          }),
        ];
        if (rows.length === 0) lines.push(color.dim('  (empty)'));
        const msg = lines.join('\n');
        opts.renderer.write(msg);
        return { message: msg };
      }

      if (subcommand === 'ask') {
        const question = rest.join(' ').trim();
        if (!question) {
          const msg = 'Usage: /brain ask <question>';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        if (!opts.brain) {
          const msg = 'The Brain is not available in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        try {
          const decision = await opts.brain.decide({
            id: `brain-ask-${randomUUID()}`,
            sessionId: opts.context?.session.id,
            source: 'user',
            question,
            risk: 'medium',
            fallback: 'ask_human',
          });
          let msg: string;
          if (decision.type === 'answer') {
            msg = `🧠 ${decision.text}${decision.rationale && decision.rationale !== decision.text ? `\n${color.dim(decision.rationale)}` : ''}`;
          } else if (decision.type === 'deny') {
            msg = `🧠 Denied: ${decision.reason}`;
          } else {
            msg = '🧠 The Brain escalated this question back to you — it needs human judgement.';
          }
          opts.renderer.write(msg);
          return { message: msg };
        } catch (err) {
          const msg = `Brain consultation failed: ${err instanceof Error ? err.message : String(err)}`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      }

      if (subcommand === '' || subcommand === 'status') {
        const lines: string[] = [];
        const ceiling = opts.brainSettings?.maxAutoRisk ?? 'unknown';
        const mode = opts.brainSettings?.mode ?? 'interactive';
        lines.push(`${color.bold('Brain')} — policy → LLM/council → escalation decision chain`);
        lines.push(
          `  escalation mode:  ${color.cyan(mode)} ${color.dim(mode === 'headless' ? '(never blocks on a human — /brain mode interactive to change)' : '(/brain mode headless for fully unattended)')}`,
        );
        lines.push(
          `  autonomy ceiling: ${color.cyan(ceiling)} ${color.dim('(/brain risk <level> to change)')}`,
        );
        const pool = opts.brainSettings?.poolLabels ?? [];
        lines.push(
          `  LLM pool:         ${pool.length > 0 ? color.cyan(pool.join(' → ')) : color.dim('session model (configure "brain.models" for a fallback pool)')}`,
        );
        const councilSeats = opts.brainSettings?.councilLabels ?? [];
        if (councilSeats.length > 0) {
          lines.push(`  council:          ${color.cyan(councilSeats.join(', '))}`);
        }
        if (opts.brainSettings?.ledgerPath) {
          lines.push(
            `  ledger:           ${color.dim(`${opts.brainSettings.ledgerPath} (/brain ledger to view)`)}`,
          );
        }
        const log = opts.getBrainLog?.() ?? [];
        if (log.length === 0) {
          lines.push(color.dim('  no decisions recorded yet this session'));
        } else {
          lines.push(`  recent decisions (${log.length}):`);
          for (const entry of log.slice(-10)) {
            const q =
              entry.question.length > 70 ? `${entry.question.slice(0, 67)}…` : entry.question;
            lines.push(
              `  ${color.dim(fmtAge(entry.at).padEnd(8))} ${entry.kind.padEnd(12)} ${q}${entry.outcome ? color.dim(` → ${entry.outcome}`) : ''}`,
            );
          }
        }
        const msg = lines.join('\n');
        opts.renderer.write(msg);
        return { message: msg };
      }

      const msg = `Unknown subcommand: ${subcommand}. Use /brain, /brain risk <level>, /brain mode <m>, /brain ask <question>, or /brain ledger [n].`;
      opts.renderer.writeWarning(msg);
      return { message: msg };
    },
  };
}
