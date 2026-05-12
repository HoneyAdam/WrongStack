import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface InstallInput {
  packages?: string | string[];
  save?: 'dependency' | 'dev' | 'optional';
  cwd?: string;
  dry_run?: boolean;
  global?: boolean;
}

interface InstallOutput {
  packages: string[];
  exit_code: number;
  output: string;
  dry_run: boolean;
  truncated: boolean;
}

export const installTool: Tool<InstallInput, InstallOutput> = {
  name: 'install',
  description:
    'Install npm packages. Detects pnpm/npm/yarn and uses the right package manager.',
  usageHint:
    'Set `packages` to install. `save` as dependency type. `global` for global install. `dry_run` to preview.',
  permission: 'confirm',
  mutating: true,
  timeoutMs: 120_000,
  inputSchema: {
    type: 'object',
    properties: {
      packages: {
        type: 'string',
        description: 'Package(s) to install: single name, comma-separated list, or empty for all deps',
      },
      save: {
        type: 'string',
        enum: ['dependency', 'dev', 'optional'],
        description: 'Save as regular, dev, or optional dependency',
      },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
      dry_run: { type: 'boolean', description: 'Preview install without modifying (default: false)' },
      global: { type: 'boolean', description: 'Install globally (default: false)' },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const pkgManager = await detectPackageManager(cwd);
    const save = input.save === 'dev' ? '-D' : input.save === 'optional' ? '-O' : '';
    const globalFlag = input.global ? ['-g'] : [];

    const args: string[] = [];
    if (input.dry_run) args.push('--dry-run');
    if (pkgManager === 'pnpm') {
      if (save) args.push(save);
      args.push('add', ...globalFlag);
    } else if (pkgManager === 'yarn') {
      args.push('add', ...globalFlag);
    } else {
      args.push('install', ...globalFlag);
    }

    if (input.packages) {
      const pkgs = Array.isArray(input.packages) ? input.packages : input.packages.split(',');
      args.push(...pkgs.map((p) => p.trim()));
    }

    return runInstall(pkgManager, args, cwd, opts.signal, input.packages ? (Array.isArray(input.packages) ? input.packages : input.packages.split(',')).map((p: string) => p.trim()) : []);
  },
};

async function detectPackageManager(cwd: string): Promise<string> {
  const { stat } = require('node:fs/promises');
  try {
    await stat(`${cwd}/pnpm-lock.yaml`);
    return 'pnpm';
  } catch {
    try {
      await stat(`${cwd}/yarn.lock`);
      return 'yarn';
    } catch {
      return 'npm';
    }
  }
}

function runInstall(
  manager: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  packages: string[],
): Promise<InstallOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 100_000;

    const child = spawn(manager, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => resolve({
      packages,
      exit_code: code ?? 0,
      output: stdout || stderr,
      dry_run: args.includes('--dry-run'),
      truncated: stdout.length >= MAX,
    }));
    child.on('error', (e) => resolve({
      packages,
      exit_code: 1,
      output: e.message,
      dry_run: false,
      truncated: false,
    }));
  });
}