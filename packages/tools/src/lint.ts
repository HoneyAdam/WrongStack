import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface LintInput {
  files?: string | string[];
  fix?: boolean;
  linter?: 'biome' | 'eslint' | 'tslint' | 'auto';
  cwd?: string;
}

interface LintOutput {
  linter: string;
  files_checked: number;
  errors: number;
  warnings: number;
  output: string;
  fix_applied: boolean;
  truncated: boolean;
}

export const lintTool: Tool<LintInput, LintOutput> = {
  name: 'lint',
  description:
    'Run a linter on files. Auto-detects biome, eslint, or tslint. Use `fix` to auto-fix issues.',
  usageHint:
    'Set `files` (glob or comma-separated). `fix` applies corrections. `linter` forces specific tool.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'string',
        description: 'Files/patterns: single path, comma-separated list, or glob (e.g. "src/**/*.ts")',
      },
      fix: { type: 'boolean', description: 'Auto-fix fixable issues (default: false)' },
      linter: {
        type: 'string',
        enum: ['biome', 'eslint', 'tslint', 'auto'],
        description: 'Linter to use (default: auto-detect)',
      },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const linter = input.linter ?? 'auto';

    const detected = linter === 'auto' ? await detectLinter(cwd) : linter;
    if (!detected) {
      return {
        linter: 'none',
        files_checked: 0,
        errors: 0,
        warnings: 0,
        output: 'No linter found (biome.json, .eslintrc, tslint.json)',
        fix_applied: false,
        truncated: false,
      };
    }

    return await runLinter(detected, input, cwd, opts.signal);
  },
};

async function detectLinter(cwd: string): Promise<string | null> {
  const { stat } = require('node:fs/promises');
  const checks = ['biome.json', '.eslintrc.json', 'tslint.json', '.eslintrc.js', 'tsconfig.json'];
  for (const f of checks) {
    try {
      await stat(`${cwd}/${f}`);
      if (f.includes('biome')) return 'biome';
      if (f.includes('eslint')) return 'eslint';
      if (f.includes('tslint')) return 'tslint';
    } catch {
      // continue
    }
  }
  return 'biome';
}

async function runLinter(
  linter: string,
  input: LintInput,
  cwd: string,
  signal: AbortSignal,
): Promise<LintOutput> {
  const args: string[] = ['lint'];
  if (input.fix) args.push('--write');
  if (input.files) {
    const files = Array.isArray(input.files) ? input.files : input.files.split(',');
    args.push('--', ...files.map((f) => f.trim()));
  }

  const result = await runCommand(linter === 'biome' ? 'biome' : linter, args, cwd, signal);

  const errors = (result.stdout.match(/error/g) || []).length;
  const warnings = (result.stdout.match(/warning/g) || []).length;

  return {
    linter,
    files_checked: input.files ? (Array.isArray(input.files) ? input.files.length : input.files.split(',').length) : 0,
    errors,
    warnings,
    output: result.stdout,
    fix_applied: input.fix ?? false,
    truncated: result.truncated,
  };
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string; exitCode: number; truncated: boolean }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 100_000;

    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0, truncated: stdout.length >= MAX }));
    child.on('error', (e) => resolve({ stdout: '', stderr: e.message, exitCode: 1, truncated: false }));
  });
}