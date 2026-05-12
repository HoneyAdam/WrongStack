import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface TypecheckInput {
  project?: string;
  cwd?: string;
  strict?: boolean;
  all?: boolean;
}

interface TypecheckOutput {
  project: string;
  exit_code: number;
  errors: number;
  warnings: number;
  output: string;
  truncated: boolean;
}

export const typecheckTool: Tool<TypecheckInput, TypecheckOutput> = {
  name: 'typecheck',
  description:
    'Run TypeScript type checking with `tsc --noEmit`. Checks for type errors without compiling.',
  usageHint:
    'Set `project` for tsconfig path (default: nearest). `strict` enables strictest flags. `all` checks all projects in workspace.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 120_000,
  inputSchema: {
    type: 'object',
    properties: {
      project: { type: 'string', description: 'Path to tsconfig.json (default: auto-detect)' },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
      strict: {
        type: 'boolean',
        description: 'Add --strict flag for maximum type checking (default: false)',
      },
      all: {
        type: 'boolean',
        description: 'Type-check all projects (pnpm -r) (default: false)',
      },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;

    if (input.all) {
      return runTsc(['--noEmit'], cwd, opts.signal, 'workspace');
    }

    const tsconfig = input.project
      ? safeResolve(input.project, ctx)
      : await findTsConfig(cwd);

    const args = ['--noEmit'];
    if (input.strict) args.push('--strict');
    if (tsconfig) args.push('--project', tsconfig);

    return runTsc(args, cwd, opts.signal, tsconfig ?? 'default');
  },
};

async function findTsConfig(cwd: string): Promise<string | null> {
  const { stat } = require('node:fs/promises');
  const candidates = ['tsconfig.json', 'tsconfig.base.json'];
  for (const f of candidates) {
    try {
      const s = await stat(path.join(cwd, f));
      if (s.isFile()) return path.join(cwd, f);
    } catch {
      // continue
    }
  }
  return null;
}

function runTsc(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  project: string,
): Promise<TypecheckOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 200_000;

    const child = spawn('npx', ['tsc', ...args], { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });

    child.on('close', (code) => {
      const errors = (stdout.match(/error TS/g) || []).length;
      resolve({
        project,
        exit_code: code ?? 0,
        errors,
        warnings: (stdout.match(/warning/g) || []).length,
        output: stdout || stderr,
        truncated: stdout.length >= MAX,
      });
    });

    child.on('error', (e) => resolve({
      project,
      exit_code: 1,
      errors: 0,
      warnings: 0,
      output: e.message,
      truncated: false,
    }));
  });
}