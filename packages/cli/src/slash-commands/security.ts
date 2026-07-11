// /security — interactive security diagnostics for the current project.
//
// Three subcommands, all synchronous from the user's perspective:
//
//   /security audit-deps    run `pnpm audit` against project dependencies
//   /security scan          print valid ways to dispatch a bug-hunter
//                           subagent to scan the cwd from a director-capable
//                           surface
//   /security redact-test   run DefaultSecretScrubber over a sample payload
//                           and print which fields were redacted (proves the
//                           log redaction pipeline works end-to-end)
//
// The CLI's slash-command handlers are synchronous UI surfaces — they cannot
// host a full subagent themselves. `scan` therefore goes through the project
// mailbox (when a director is registered) or prints the one-liner you can run
// in a separate terminal. This keeps `/security scan` useful without coupling
// the slash-command layer to the coordinator.

import { spawn } from 'node:child_process';
import type { SlashCommand } from '@wrongstack/core';
import { color } from '@wrongstack/core';
import { parseSubcommand, unknownSubcommand } from './helpers.js';
import type { SlashCommandContext } from './index.js';

const SUBCOMMANDS = ['audit-deps', 'scan', 'redact-test', 'help'] as const;

const SECURITY_HELP = [
  'Usage: /security [audit-deps|scan|redact-test|help] [--json]',
  '',
  '  audit-deps   Run pnpm audit and summarize vulnerability severities.',
  '  scan         Show safe bug-hunter dispatch options for this surface.',
  '  redact-test  Verify the DefaultSecretScrubber with synthetic values.',
  '  help         Show command help.',
  '',
  'Use --json for stable output and slash-command metadata.',
].join('\n');

function securityResult(
  message: string,
  payload: Record<string, unknown>,
  json: boolean,
): { message: string; metadata: Record<string, unknown> } {
  return {
    message: json ? JSON.stringify(payload, null, 2) : message,
    metadata: { security: payload },
  };
}

export function buildSecurityCommand(opts: SlashCommandContext): SlashCommand {
  return {
    name: 'security',
    category: 'Inspect',
    argsHint: '[audit-deps|scan|redact-test|help] [--json]',
    description: 'Security diagnostics (audit-deps / scan / redact-test).',
    help: SECURITY_HELP,
    async run(args) {
      const { cmd, rest } = parseSubcommand(args);
      const json = cmd === '--json' || rest.includes('--json');
      const sub = !cmd || cmd === '--json' ? 'help' : cmd;
      switch (sub) {
        case 'audit-deps':
          return auditDepsCommand(opts, json);
        case 'scan':
          return scanCommand(opts, json);
        case 'redact-test':
          return redactTestCommand(json);
        case 'help':
        case '--help':
        case '-h':
          return helpCommand(json);
        default:
          return securityResult(
            color.yellow(unknownSubcommand(sub, [...SUBCOMMANDS], 'security')),
            {
              ok: false,
              action: sub,
              error: {
                code: 'unknown_subcommand',
                message: unknownSubcommand(sub, [...SUBCOMMANDS], 'security'),
              },
            },
            json,
          );
      }
    },
  };
}

/** Run `pnpm audit` and stream a summary of vulnerabilities to the user. */
function auditDepsCommand(
  opts: SlashCommandContext,
  json: boolean,
): Promise<{ message: string; metadata: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const cwd = opts.cwd;
    const child = spawn('pnpm', ['audit', '--json'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(60_000),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    child.on('error', (err) => {
      resolve(
        securityResult(
          color.red(`/security audit-deps: failed to spawn pnpm: ${err.message}`),
          {
            ok: false,
            action: 'audit-deps',
            error: { code: 'spawn_failed', message: 'Failed to start dependency audit.' },
          },
          json,
        ),
      );
    });
    child.on('close', (code) => {
      // pnpm audit exits non-zero when vulnerabilities are found. Parse JSON
      // from stdout regardless and summarise.
      let summary = color.dim('(no JSON output)');
      let vulnerabilities = {
        critical: 0,
        high: 0,
        moderate: 0,
        low: 0,
        info: 0,
        total: 0,
      };
      let parsed = false;
      try {
        const json = JSON.parse(stdout);
        const meta = json.metadata?.vulnerabilities ?? {};
        const total =
          (meta.critical ?? 0) +
          (meta.high ?? 0) +
          (meta.moderate ?? 0) +
          (meta.low ?? 0) +
          (meta.info ?? 0);
        vulnerabilities = {
          critical: meta.critical ?? 0,
          high: meta.high ?? 0,
          moderate: meta.moderate ?? 0,
          low: meta.low ?? 0,
          info: meta.info ?? 0,
          total,
        };
        parsed = true;
        summary = [
          color.bold('pnpm audit summary'),
          `  Total:    ${color.cyan(String(total))}`,
          `  Critical: ${color.red(String(meta.critical ?? 0))}`,
          `  High:     ${color.red(String(meta.high ?? 0))}`,
          `  Moderate: ${color.yellow(String(meta.moderate ?? 0))}`,
          `  Low:      ${color.dim(String(meta.low ?? 0))}`,
        ].join('\n');
      } catch {
        if (stderr.trim()) summary = color.dim(stderr.trim().slice(0, 200));
      }
      const exit = code === 0 ? color.green('clean') : color.yellow(`exit ${code}`);
      resolve(
        securityResult(
          `${summary}\n  pnpm audit ${exit}`,
          {
            ok: parsed,
            action: 'audit-deps',
            exitCode: code,
            clean: parsed && vulnerabilities.total === 0 && code === 0,
            vulnerabilities,
            ...(parsed
              ? {}
              : {
                  error: {
                    code: 'audit_output_unavailable',
                    message: 'Dependency audit did not return parseable JSON.',
                  },
                }),
          },
          json,
        ),
      );
    });
  });
}

/** Dispatch a bug-hunter subagent to scan the cwd. */
function scanCommand(
  opts: SlashCommandContext,
  json: boolean,
): { message: string; metadata: Record<string, unknown> } {
  const dispatch = {
    role: 'bug-hunter',
    cli: '/delegate --role=bug-hunter "Run a security scan of the current project"',
    fleet: '/fleet dispatch Run a security scan of the current project',
    hq: 'HQ Control → Spawn role → bug-hunter',
  };
  const lines: string[] = [
    color.bold('/security scan — dispatch bug-hunter subagent'),
    '',
    `  Project root: ${color.cyan(opts.projectRoot)}`,
    '',
  ];
  // Slash commands run synchronously in the TUI — we can't host a subagent
  // here. Print dispatch instructions that match currently wired director
  // surfaces instead of pointing at a non-existent package script.
  lines.push(color.dim('  The TUI is a synchronous surface and cannot host a subagent itself.'));
  lines.push(color.dim('  Start or use a director-capable session, then dispatch with:'));
  lines.push('');
  lines.push(color.cyan('    /director'));
  lines.push(
    color.cyan('    /delegate --role=bug-hunter "Run a security scan of the current project"'),
  );
  lines.push(color.cyan('    /fleet dispatch Run a security scan of the current project'));
  lines.push(color.cyan('    → HQ Control → Spawn role → bug-hunter'));
  lines.push('');
  lines.push(color.dim('  The subagent role is `bug-hunter`. Findings stream on the'));
  lines.push(color.dim('  FleetBus as `bug.found` events and land in the audit log.'));
  return securityResult(lines.join('\n'), { ok: true, action: 'scan', dispatch }, json);
}

/** Run DefaultSecretScrubber over a sample payload to prove the redaction
 *  pipeline works end-to-end. Useful after enabling secretRedaction in /settings. */
async function redactTestCommand(
  json: boolean,
): Promise<{ message: string; metadata: Record<string, unknown> }> {
  const { DefaultSecretScrubber } = await import('@wrongstack/core/security');
  const scrubber = new DefaultSecretScrubber();
  const sample = {
    apiKey: 'sk-1234567890abcdefghij',
    openaiKey: 'sk-abcdefghijklmnopqrstuvwxyz',
    githubToken: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    env: {
      ANTHROPIC_API_KEY: 'ant-1234567890abcdef',
      WRONGSTACK_HQ_TOKEN: 'a1b2c3d4e5f6a1b2c3d4e5f6',
    },
    url: 'mongodb+srv://user:p4ssw0rd@cluster.mongodb.net/db',
    nested: {
      auth: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
    },
    normal: 'this is not sensitive',
  };
  const scrubbed = scrubber.scrubObject(sample);
  // Walk both objects in parallel and report which fields changed.
  const lines: string[] = [
    color.bold('/security redact-test — DefaultSecretScrubber dry run'),
    '',
    '  Sent a sample payload containing known secret shapes. Result:',
  ];
  const redacted: string[] = [];
  const redactedFields: string[] = [];
  const passed: string[] = [];
  function walk(prefix: string, before: unknown, after: unknown): void {
    if (typeof before === 'string' && typeof after === 'string') {
      if (before !== after) {
        redacted.push(`${prefix}: ${color.red(before)} → ${after}`);
        redactedFields.push(prefix);
      } else passed.push(`${prefix}`);
    } else if (before && typeof before === 'object' && after && typeof after === 'object') {
      for (const key of Object.keys(before as Record<string, unknown>)) {
        const path = `${prefix}.${key}`;
        walk(
          path,
          (before as Record<string, unknown>)[key],
          (after as Record<string, unknown>)[key],
        );
      }
    }
  }
  walk('$', sample, scrubbed);
  if (redacted.length === 0) {
    lines.push(color.red('  ⚠ No fields were redacted. The scrubber may not be wired correctly.'));
  } else {
    lines.push(`  ${color.green('Redacted:')}`);
    for (const r of redacted) lines.push(`    ${r}`);
    lines.push('');
    lines.push(`  ${color.dim(`${passed.length} non-sensitive fields passed through unchanged.`)}`);
  }
  return securityResult(
    lines.join('\n'),
    {
      ok: redactedFields.length > 0,
      action: 'redact-test',
      redactedCount: redactedFields.length,
      redactedFields,
      unchangedCount: passed.length,
      unchangedFields: passed,
    },
    json,
  );
}

function helpCommand(json: boolean): { message: string; metadata: Record<string, unknown> } {
  const lines: string[] = [
    color.bold('/security — security diagnostics'),
    '',
    'Subcommands:',
    `  ${color.cyan('audit-deps')}     Run pnpm audit against the current project (JSON summary)`,
    `  ${color.cyan('scan')}           Dispatch a bug-hunter subagent over the cwd`,
    `  ${color.cyan('redact-test')}    Dry-run the DefaultSecretScrubber with a sample payload`,
    `  ${color.cyan('help')}           Show this help`,
    '',
    color.dim('  pnpm audit exits non-zero when vulnerabilities are found — that is normal.'),
    color.dim('  /security scan dispatches a subagent; the TUI is synchronous so the'),
    color.dim('  command prints dispatch instructions for HQ / webui / CLI subcommand.'),
  ];
  return securityResult(
    lines.join('\n'),
    { ok: true, action: 'help', subcommands: [...SUBCOMMANDS] },
    json,
  );
}
