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
 *   /brain model <ref>      single decision model ("session" = session model)
 *   /brain models ...       ordered LLM pool (set/add/remove/clear)
 *   /brain strategy <s>     pool strategy: fallback | round-robin
 *   /brain timeout <ms>     per-LLM-call decision timeout
 *   /brain human-timeout    interactive escalation timeout (ms | off)
 *   /brain council ...      multi-LLM council (on/off/minrisk/voters/judge/…)
 *   /brain ledger ...       view rows | on|off | autodeny <n>
 *   /brain ask <question>   consult the Brain directly for a decision
 *   /brain save             re-persist the current settings
 *
 * Every setter applies LIVE and persists to ~/.wrongstack/config.json
 * (config.brain is denied in project scope by design).
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type {
  BrainAutoRisk,
  BrainConfigPatch,
  BrainConfigSnapshot,
  BrainCouncilVoterConfig,
  BrainLedgerEntry,
  SlashCommand,
} from '@wrongstack/core';
import { color, parseModelRef } from '@wrongstack/core';
import type { SlashCommandContext } from './index.js';

const RISK_LEVELS: ReadonlySet<string> = new Set(['off', 'low', 'medium', 'high', 'all']);
const COUNCIL_RISKS: ReadonlySet<string> = new Set(['medium', 'high', 'critical']);
const PERSONA_SHORTHANDS: ReadonlySet<string> = new Set(['executor', 'skeptic', 'auditor']);

function parseRefEntry(ref: string): { provider?: string; model: string } | null {
  const parsed = parseModelRef(ref);
  const model = parsed.model?.trim();
  if (!model) return null;
  return parsed.provider ? { provider: parsed.provider, model } : { model };
}

function compactEntry(entry: { provider?: string | undefined; model: string }): string {
  return entry.provider ? `${entry.provider}/${entry.model}` : entry.model;
}

/**
 * Council seat grammar: `<ref>[:executor|:skeptic|:auditor][:persona=NAME][:veto][:w=N]`.
 * Modifiers are stripped from the RIGHT so model ids containing `:`
 * (e.g. ollama tags) survive as part of the ref.
 */
function parseSeat(token: string): BrainCouncilVoterConfig | null {
  const parts = token.split(':');
  const mods: string[] = [];
  while (parts.length > 1) {
    const tail = (parts[parts.length - 1] ?? '').toLowerCase();
    const isMod =
      tail === 'veto' ||
      /^w(eight)?=\d+(\.\d+)?$/.test(tail) ||
      tail.startsWith('persona=') ||
      PERSONA_SHORTHANDS.has(tail);
    if (!isMod) break;
    mods.push(parts.pop() as string);
  }
  const entry = parseRefEntry(parts.join(':'));
  if (!entry) return null;
  const voter: BrainCouncilVoterConfig = { ...entry };
  for (const raw of mods) {
    const mod = raw.toLowerCase();
    if (mod === 'veto') voter.veto = true;
    else if (mod.startsWith('w=') || mod.startsWith('weight=')) {
      voter.weight = Number(raw.slice(raw.indexOf('=') + 1));
    } else if (mod.startsWith('persona=')) {
      voter.persona = raw.slice(raw.indexOf('=') + 1);
    } else voter.persona = mod;
  }
  return voter;
}

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
    argsHint: '[status|risk|mode|model|models|strategy|timeout|human-timeout|council|ledger|ask|save]',
    description:
      'Inspect and configure the Brain: risk ceiling, escalation mode, LLM pool, council, timeouts, ledger. Setters apply live and persist globally.',
    help: [
      'Usage:',
      '  /brain                 Show Brain status (mode, risk ceiling, LLM pool, recent decisions)',
      '  /brain status          Same as /brain',
      '  /brain risk <level>    Set autonomy ceiling: off | low | medium | high | all',
      '  /brain mode <m>        headless (never block on a human) | interactive',
      '  /brain model <ref>     Use ONE decision model (provider/model), or "session" for the session model',
      '  /brain models <ref> [<ref> ...]   Replace the ordered LLM pool',
      '  /brain models add <ref> | remove <n|ref> | clear',
      '  /brain strategy <s>    Pool strategy: fallback | round-robin',
      '  /brain timeout <ms|default>       Per-LLM-call decision timeout',
      '  /brain human-timeout <ms|off>     Interactive escalation wait before terminal policy',
      '  /brain council on|off             Enable/disable the multi-LLM council',
      '  /brain council minrisk <medium|high|critical>',
      '  /brain council voters <seat> [<seat> ...]   seat = <ref>[:executor|:skeptic|:auditor][:veto][:w=N]',
      '  /brain council judge <ref|auto> | quorum <0..1> | approval <0..1>',
      '  /brain ledger [n]      Show the last n rows (default 15) of the persistent decision ledger',
      '  /brain ledger on|off | autodeny <n>',
      '  /brain ask <question>  Consult the Brain directly for decision support',
      '  /brain save            Re-persist the current Brain settings',
      '',
      'The Brain decides in tiers: deterministic policy → LLM pool / multi-LLM',
      'council (within the risk ceiling) → escalation. In headless mode the',
      'escalation tier resolves via the terminal policy instead of prompting',
      'you, so the Brain never blocks on a human. Model refs use the',
      '"provider/model" grammar (bare "model" = session provider). Every',
      'setter applies live AND persists to ~/.wrongstack/config.json. The',
      'Brain also self-activates on tool failure streaks and error storms,',
      'steering agents via mailbox.',
    ].join('\n'),
    async run(args) {
      const trimmed = args.trim();
      const [sub, ...rest] = trimmed.split(/\s+/);
      const subcommand = (sub ?? '').toLowerCase();

      /** Apply a live+persist patch through the BrainRuntime and report the outcome. */
      const applyPatch = async (
        patch: BrainConfigPatch,
        describe: (snapshot: BrainConfigSnapshot) => string,
      ): Promise<{ message: string }> => {
        if (!opts.brainRuntime) {
          const msg = 'The Brain runtime is not available in this session.';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        try {
          const { snapshot, persisted } = opts.brainRuntime.apply(patch);
          const result = await persisted;
          const note = result.ok
            ? color.dim(' — saved to ~/.wrongstack/config.json')
            : ` — applied live but NOT saved: ${result.error ?? 'unknown error'}`;
          const msg = `${describe(snapshot)}${note}`;
          if (result.ok) opts.renderer.write(msg);
          else opts.renderer.writeWarning(msg);
          return { message: msg };
        } catch (err) {
          const msg = `Invalid Brain setting: ${err instanceof Error ? err.message : String(err)}`;
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
      };

      const poolSummary = (snapshot: BrainConfigSnapshot): string =>
        snapshot.poolLabels.length > 0
          ? snapshot.poolLabels.join(' → ')
          : 'session model';

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

      if (subcommand === 'model') {
        const ref = rest[0] ?? '';
        if (!ref) {
          const msg = 'Usage: /brain model <provider/model | session>';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        if (ref.toLowerCase() === 'session') {
          return applyPatch({ models: null }, (s) => `Brain decision model: ${color.cyan('session model')} (pool cleared)${s.councilLabels.length === 0 ? '' : ' — council dissolved'}`);
        }
        return applyPatch({ models: [ref] }, (s) =>
          s.poolLabels.length > 0
            ? `Brain decision model set to ${color.cyan(s.poolLabels.join(', '))}`
            : `Brain decision model set to ${color.cyan(ref)} (WARNING: unresolved provider — falling back to the session model)`,
        );
      }

      if (subcommand === 'models') {
        const op = (rest[0] ?? '').toLowerCase();
        const snapshot = opts.brainRuntime?.getSnapshot();
        if (!rest.length || op === 'list') {
          const msg = snapshot
            ? `Brain LLM pool: ${snapshot.poolLabels.length > 0 ? color.cyan(snapshot.poolLabels.join(' → ')) : color.dim('session model')} ${color.dim(`(strategy: ${snapshot.strategy})`)}`
            : 'The Brain runtime is not available in this session.';
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (op === 'clear') {
          return applyPatch({ models: null }, () => `Brain LLM pool cleared — using the ${color.cyan('session model')}`);
        }
        if (op === 'add') {
          const ref = rest[1];
          if (!ref) {
            const msg = 'Usage: /brain models add <provider/model>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          const current = (snapshot?.models ?? []).map(compactEntry);
          return applyPatch({ models: [...current, ref] }, (s) => `Brain LLM pool: ${color.cyan(poolSummary(s))}`);
        }
        if (op === 'remove') {
          const target = rest[1];
          if (!target || !snapshot) {
            const msg = 'Usage: /brain models remove <index|provider/model>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          const current = snapshot.models.map(compactEntry);
          const idx = /^\d+$/.test(target)
            ? Number.parseInt(target, 10) - 1
            : current.findIndex((c) => c === target || c.endsWith(`/${target}`) || c === parseRefEntry(target)?.model);
          if (idx < 0 || idx >= current.length) {
            const msg = `No pool entry matches "${target}". Current pool: ${current.join(', ') || '(empty)'}`;
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          const next = current.filter((_, i) => i !== idx);
          return applyPatch({ models: next.length > 0 ? next : null }, (s) => `Brain LLM pool: ${color.cyan(poolSummary(s))}`);
        }
        return applyPatch({ models: rest }, (s) => `Brain LLM pool: ${color.cyan(poolSummary(s))} ${color.dim(`(${s.poolLabels.length}/${rest.length} resolved)`)}`);
      }

      if (subcommand === 'strategy') {
        const strategy = (rest[0] ?? '').toLowerCase();
        if (strategy !== 'fallback' && strategy !== 'round-robin') {
          const msg = 'Usage: /brain strategy <fallback|round-robin>';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        return applyPatch({ strategy }, () =>
          `Brain pool strategy set to ${color.cyan(strategy)} — ${strategy === 'fallback' ? 'first model is primary, the rest are tried in order on failure' : 'decisions rotate across the pool'}`,
        );
      }

      if (subcommand === 'timeout') {
        const raw = (rest[0] ?? '').toLowerCase();
        if (!raw) {
          const msg = 'Usage: /brain timeout <ms|default>';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const patch: BrainConfigPatch =
          raw === 'default' ? { decisionTimeoutMs: null } : { decisionTimeoutMs: Number(raw) };
        return applyPatch(patch, (s) =>
          `Brain decision timeout: ${color.cyan(s.decisionTimeoutMs ? `${s.decisionTimeoutMs}ms` : 'default (15000ms)')}`,
        );
      }

      if (subcommand === 'human-timeout') {
        const raw = (rest[0] ?? '').toLowerCase();
        if (!raw) {
          const msg = 'Usage: /brain human-timeout <ms|off>';
          opts.renderer.writeWarning(msg);
          return { message: msg };
        }
        const patch: BrainConfigPatch =
          raw === 'off' ? { humanTimeoutMs: null } : { humanTimeoutMs: Number(raw) };
        return applyPatch(patch, (s) =>
          `Brain human-escalation timeout: ${color.cyan(s.humanTimeoutMs ? `${s.humanTimeoutMs}ms — unanswered prompts then resolve via the terminal policy` : 'off (wait indefinitely)')}`,
        );
      }

      if (subcommand === 'council') {
        const op = (rest[0] ?? '').toLowerCase();
        const councilSummary = (s: BrainConfigSnapshot): string =>
          s.council.enabled
            ? `council ${color.cyan('convened')}: ${s.councilLabels.join(', ')} ${color.dim(`(minRisk: ${s.council.minRisk}${s.council.judge ? `, judge: ${compactEntry(s.council.judge)}` : ''})`)}`
            : `council ${color.dim('disabled')}`;
        if (!op) {
          const snapshot = opts.brainRuntime?.getSnapshot();
          const msg = snapshot ? `Brain ${councilSummary(snapshot)}` : 'The Brain runtime is not available in this session.';
          opts.renderer.write(msg);
          return { message: msg };
        }
        if (op === 'on' || op === 'off') {
          return applyPatch({ council: { enabled: op === 'on' } }, (s) => `Brain ${councilSummary(s)}${op === 'on' && !s.council.enabled ? ' — needs ≥2 resolvable voters (set /brain council voters or a ≥2-model pool)' : ''}`);
        }
        if (op === 'minrisk') {
          const level = (rest[1] ?? '').toLowerCase();
          if (!COUNCIL_RISKS.has(level)) {
            const msg = 'Usage: /brain council minrisk <medium|high|critical>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          return applyPatch({ council: { minRisk: level as 'medium' | 'high' | 'critical' } }, (s) => `Brain council risk floor set to ${color.cyan(s.council.minRisk)} — questions at/above it convene the council`);
        }
        if (op === 'voters') {
          const seats = rest.slice(1).map(parseSeat);
          if (seats.length === 0 || seats.some((s) => s === null)) {
            const msg = 'Usage: /brain council voters <ref[:executor|:skeptic|:auditor][:veto][:w=N]> [...]';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          return applyPatch({ council: { voters: seats as BrainCouncilVoterConfig[] } }, councilSummary);
        }
        if (op === 'judge') {
          const ref = rest[1];
          if (!ref) {
            const msg = 'Usage: /brain council judge <provider/model | auto>';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          return applyPatch({ council: { judge: ref.toLowerCase() === 'auto' ? null : ref } }, (s) => `Brain council judge: ${color.cyan(s.council.judge ? compactEntry(s.council.judge) : 'auto (first pool/voter model)')}`);
        }
        if (op === 'quorum' || op === 'approval') {
          const value = Number(rest[1]);
          return applyPatch(
            op === 'quorum' ? { council: { quorum: value } } : { council: { approval: value } },
            (s) => `Brain council ${op} set to ${color.cyan(String(op === 'quorum' ? (s.council.quorum ?? 0.5) : (s.council.approval ?? 0.5)))}`,
          );
        }
        const msg = `Unknown council subcommand: ${op}. Use on, off, minrisk, voters, judge, quorum, or approval.`;
        opts.renderer.writeWarning(msg);
        return { message: msg };
      }

      if (subcommand === 'save') {
        return applyPatch({}, () => 'Brain settings re-persisted');
      }

      if (subcommand === 'ledger') {
        const ledgerOp = (rest[0] ?? '').toLowerCase();
        if (ledgerOp === 'on' || ledgerOp === 'off') {
          return applyPatch({ ledger: { enabled: ledgerOp === 'on' } }, (s) =>
            `Brain decision ledger ${color.cyan(s.ledger.enabled ? 'enabled' : 'disabled')}${s.ledger.enabled && s.ledger.path ? ` — ${s.ledger.path}` : ''}`,
          );
        }
        if (ledgerOp === 'autodeny') {
          const n = Number.parseInt(rest[1] ?? '', 10);
          if (!Number.isInteger(n) || n < 0) {
            const msg = 'Usage: /brain ledger autodeny <n>  (0 disables the deterministic deny guard)';
            opts.renderer.writeWarning(msg);
            return { message: msg };
          }
          return applyPatch({ ledger: { autoDenyAfterFailures: n } }, () =>
            n === 0
              ? 'Brain ledger auto-deny guard disabled'
              : `Brain ledger auto-deny guard: deny after ${color.cyan(String(n))} consecutive observed failures`,
          );
        }
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
        const snapshot = opts.brainRuntime?.getSnapshot();
        const pool = opts.brainSettings?.poolLabels ?? [];
        lines.push(
          `  LLM pool:         ${pool.length > 0 ? color.cyan(pool.join(' → ')) : color.dim('session model (/brain model <ref> or /brain models <refs>)')}${snapshot && pool.length > 1 ? color.dim(` (strategy: ${snapshot.strategy})`) : ''}`,
        );
        if (snapshot?.decisionTimeoutMs) {
          lines.push(`  decision timeout: ${color.cyan(`${snapshot.decisionTimeoutMs}ms`)}`);
        }
        if (snapshot?.humanTimeoutMs) {
          lines.push(`  human timeout:    ${color.cyan(`${snapshot.humanTimeoutMs}ms`)} ${color.dim('(then terminal policy)')}`);
        }
        const councilSeats = opts.brainSettings?.councilLabels ?? [];
        if (councilSeats.length > 0) {
          lines.push(
            `  council:          ${color.cyan(councilSeats.join(', '))}${snapshot ? color.dim(` (minRisk: ${snapshot.council.minRisk}${snapshot.council.judge ? `, judge: ${compactEntry(snapshot.council.judge)}` : ''})`) : ''}`,
          );
        } else if (snapshot) {
          lines.push(`  council:          ${color.dim('disabled (/brain council on + voters)')}`);
        }
        if (opts.brainSettings?.ledgerPath) {
          lines.push(
            `  ledger:           ${color.dim(`${opts.brainSettings.ledgerPath} (/brain ledger to view)`)}`,
          );
        }
        if (opts.brainRuntime) {
          lines.push(color.dim('  setters apply live and persist to ~/.wrongstack/config.json'));
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

      const msg = `Unknown subcommand: ${subcommand}. Use /brain, risk, mode, model, models, strategy, timeout, human-timeout, council, ledger, ask, or save (see /brain help).`;
      opts.renderer.writeWarning(msg);
      return { message: msg };
    },
  };
}
