import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface FormatInput {
  files?: string | string[];
  fixer?: 'biome' | 'prettier' | 'auto';
  check?: boolean;
  cwd?: string;
}

interface FormatOutput {
  fixer: string;
  files_checked: number;
  files_changed: number;
  output: string;
  truncated: boolean;
}

export const formatTool: Tool<FormatInput, FormatOutput> = {
  name: 'format',
  description:
    'Format files with biome or prettier. Use `check` to verify without modifying.',
  usageHint:
    'Set `files` (glob or comma-separated). `check` only validates. `fixer` forces tool.',
  permission: 'confirm',
  mutating: true,
  timeoutMs: 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'string',
        description: 'Files/patterns: single path, comma-separated list, or glob',
      },
      fixer: {
        type: 'string',
        enum: ['biome', 'prettier', 'auto'],
        description: 'Formatter to use (default: auto-detect)',
      },
      check: {
        type: 'boolean',
        description: 'Verify only, do not modify files (default: false)',
      },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const fixer = input.fixer ?? 'auto';

    const detected = fixer === 'auto' ? await detectFixer(cwd) : fixer;
    if (!detected) {
      return {
        fixer: 'none',
        files_checked: 0,
        files_changed: 0,
        output: 'No formatter found (biome.json, .prettierrc)',
        truncated: false,
      };
    }

    return await runFormatter(detected, input, cwd, opts.signal);
  },
};

async function detectFixer(cwd: string): Promise<string | null> {
  const { stat } = require('node:fs/promises');
  try {
    await stat(`${cwd}/biome.json`);
    return 'biome';
  } catch {
    try {
      await stat(`${cwd}/.prettierrc`);
      return 'prettier';
    } catch {
      return 'biome';
    }
  }
}

async function runFormatter(
  fixer: string,
  input: FormatInput,
  cwd: string,
  signal: AbortSignal,
): Promise<FormatOutput> {
  const args: string[] = ['format', '--write'];
  if (input.check) args[args.length - 1] = '--check';
  if (input.files) {
    const files = Array.isArray(input.files) ? input.files : input.files.split(',');
    args.push('--', ...files.map((f) => f.trim()));
  }

  return runCommand(fixer, args, cwd, signal);
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<FormatOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const MAX = 100_000;

    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => {
      const changed = (stdout.match(/changed/g) || []).length;
      resolve({
        fixer: cmd,
        files_checked: 0,
        files_changed: changed,
        output: stdout || stderr,
        truncated: stdout.length >= MAX,
      });
    });
    child.on('error', (e) => resolve({
      fixer: cmd,
      files_checked: 0,
      files_changed: 0,
      output: e.message,
      truncated: false,
    }));
  });
}