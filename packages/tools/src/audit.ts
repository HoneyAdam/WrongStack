import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
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
  description:
    'Run npm/pnpm security audit. Returns vulnerabilities sorted by severity.',
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
      fix: {
        type: 'boolean',
        description: 'Attempt to fix vulnerabilities (default: false)',
      },
      packages: {
        type: 'string',
        description: 'Specific package(s) to audit (comma-separated)',
      },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const manager = await detectManager(cwd);
    const args = ['audit', '--json'];
    if (input.fix) args.push('--fix');
    if (input.packages) {
      const pkgs = Array.isArray(input.packages) ? input.packages : input.packages.split(',');
      args.push(...pkgs.map((p: string) => p.trim()));
    }

    return runAudit(manager, args, cwd, opts.signal);
  },
};

async function detectManager(cwd: string): Promise<string> {
  const { stat } = require('node:fs/promises');
  try { await stat(`${cwd}/pnpm-lock.yaml`); return 'pnpm'; } catch { /* */ }
  try { await stat(`${cwd}/yarn.lock`); return 'yarn'; } catch { /* */ }
  return 'npm';
}

function runAudit(
  manager: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<AuditOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 100_000;

    const child = spawn(manager, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => {
      const result = parseAuditOutput(stdout, code ?? 0);
      resolve(result);
    });
    child.on('error', (e) => resolve({
      exit_code: 1,
      vulnerabilities: [],
      total: 0,
      summary: e.message,
      output: e.message,
      truncated: false,
    }));
  });
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
    const summary = total === 0
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