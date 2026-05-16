import type { Tool, ToolStreamEvent } from '@wrongstack/core';
import { spawnStream } from './_spawn-stream.js';
import { safeResolve } from './_util.js';

interface AuditInput {
  cwd?: string;
  level?: 'low' | 'moderate' | 'high' | 'critical';
  fix?: boolean;
  packages?: string | string[];
}

interface AuditVulnerability {
  severity: string;
  package: string;
  title: string;
  url: string;
}

interface AuditOutput {
  exit_code: number;
  vulnerabilities: AuditVulnerability[];
  total: number;
  summary: string;
  output: string;
  truncated: boolean;
}

export const auditTool: Tool<AuditInput, AuditOutput> = {
  name: 'audit',
  category: 'Package Management',
  description: 'Run npm/pnpm security audit. Returns vulnerabilities sorted by severity.',
  usageHint:
    'Set `level` to filter minimum severity. `fix` attempts auto-fix. `packages` checks specific packages.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
      level: {
        type: 'string',
        enum: ['low', 'moderate', 'high', 'critical'],
        description: 'Minimum severity level to report',
      },
      fix: { type: 'boolean', description: 'Attempt to fix vulnerabilities (default: false)' },
      packages: { type: 'string', description: 'Specific package(s) to audit (comma-separated)' },
    },
  },
  async execute(input, ctx, opts) {
    let final: AuditOutput | undefined;
    for await (const ev of auditTool.executeStream!(input, ctx, opts)) {
      if (ev.type === 'final') final = ev.output;
    }
    if (!final) throw new Error('audit: stream ended without final event');
    return final;
  },
  async *executeStream(input, ctx, opts): AsyncGenerator<ToolStreamEvent<AuditOutput>> {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const manager = await detectManager(cwd);
    yield { type: 'log', text: `Auditing with ${manager}…`, data: { manager } };

    const args = ['audit', '--json'];
    if (input.fix) args.push('--fix');
    if (input.packages) {
      const pkgs = Array.isArray(input.packages) ? input.packages : input.packages.split(',');
      args.push(...pkgs.map((p: string) => p.trim()));
    }

    const result = yield* spawnStream({
      cmd: manager,
      args,
      cwd,
      signal: opts.signal,
      maxBytes: 100_000,
    });

    yield { type: 'final', output: parseAuditOutput(result.stdout, result.exitCode) };
  },
};

async function detectManager(cwd: string): Promise<string> {
  const { stat } = await import('node:fs/promises');
  try {
    await stat(`${cwd}/pnpm-lock.yaml`);
    return 'pnpm';
  } catch {
    /* */
  }
  try {
    await stat(`${cwd}/yarn.lock`);
    return 'yarn';
  } catch {
    /* */
  }
  return 'npm';
}

function parseAuditOutput(json: string, exitCode: number): AuditOutput {
  if (!json) {
    return {
      exit_code: exitCode,
      vulnerabilities: [],
      total: 0,
      summary: exitCode === 0 ? 'No vulnerabilities found' : 'Audit failed',
      output: '',
      truncated: false,
    };
  }

  try {
    const data = JSON.parse(json);
    const advisories: AuditVulnerability[] = [];
    const ads = data.advisories ?? {};
    for (const id of Object.keys(ads)) {
      const adv = ads[id];
      advisories.push({
        severity: adv.severity ?? 'unknown',
        package: adv.module_name ?? id,
        title: adv.title ?? 'Unknown vulnerability',
        url: adv.url ?? '',
      });
    }

    const total = advisories.length;
    const summary =
      total === 0
        ? 'No vulnerabilities found'
        : `Found ${total} vulnerabilities: ${advisories.filter((a) => a.severity === 'critical').length} critical, ${advisories.filter((a) => a.severity === 'high').length} high`;

    return {
      exit_code: exitCode,
      vulnerabilities: advisories,
      total,
      summary,
      output: json,
      truncated: json.length >= 100_000,
    };
  } catch {
    return {
      exit_code: exitCode,
      vulnerabilities: [],
      total: 0,
      summary: 'Could not parse audit output',
      output: json,
      truncated: false,
    };
  }
}
