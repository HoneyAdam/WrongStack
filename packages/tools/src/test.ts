import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Tool } from '@wrongstack/core';
import { safeResolve } from './_util.js';

interface TestInput {
  files?: string | string[];
  runner?: 'vitest' | 'jest' | 'mocha' | 'auto';
  watch?: boolean;
  coverage?: boolean;
  cwd?: string;
  grep?: string;
  timeout?: number;
}

interface TestOutput {
  runner: string;
  exit_code: number;
  tests_run: number;
  passed: number;
  failed: number;
  duration_ms: number;
  output: string;
  truncated: boolean;
}

export const testTool: Tool<TestInput, TestOutput> = {
  name: 'test',
  description:
    'Run tests with vitest, jest, or mocha. Returns pass/fail counts and output.',
  usageHint:
    'Set `files` for specific tests. `watch` enables watch mode. `coverage` generates coverage report. `grep` filters by name.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 120_000,
  inputSchema: {
    type: 'object',
    properties: {
      files: {
        type: 'string',
        description: 'Test files: single path, comma-separated list, or glob (e.g. "**/*.test.ts")',
      },
      runner: {
        type: 'string',
        enum: ['vitest', 'jest', 'mocha', 'auto'],
        description: 'Test runner (default: auto-detect)',
      },
      watch: {
        type: 'boolean',
        description: 'Run in watch mode (default: false)',
      },
      coverage: {
        type: 'boolean',
        description: 'Generate coverage report (default: false)',
      },
      cwd: { type: 'string', description: 'Working directory (default: cwd)' },
      grep: {
        type: 'string',
        description: 'Filter tests by name pattern (default: none)',
      },
      timeout: {
        type: 'integer',
        description: 'Test timeout in ms (default: 30000)',
      },
    },
  },
  async execute(input, ctx, opts) {
    const cwd = input.cwd ? safeResolve(input.cwd, ctx) : ctx.cwd;
    const runner = input.runner ?? 'auto';

    const detected = runner === 'auto' ? await detectRunner(cwd) : runner;
    if (!detected) {
      return {
        runner: 'none',
        exit_code: 1,
        tests_run: 0,
        passed: 0,
        failed: 0,
        duration_ms: 0,
        output: 'No test runner found (vitest.config.ts, jest.config.js, .mocharc.json)',
        truncated: false,
      };
    }

    return await runTests(detected, input, cwd, opts.signal);
  },
};

async function detectRunner(cwd: string): Promise<string | null> {
  const { stat } = require('node:fs/promises');
  const candidates = ['vitest.config.ts', 'jest.config.js', '.mocharc.json'];
  for (const f of candidates) {
    try {
      await stat(path.join(cwd, f));
      if (f.includes('vitest')) return 'vitest';
      if (f.includes('jest')) return 'jest';
      if (f.includes('mocha')) return 'mocha';
    } catch {
      // continue
    }
  }
  return 'vitest';
}

async function runTests(
  runner: string,
  input: TestInput,
  cwd: string,
  signal: AbortSignal,
): Promise<TestOutput> {
  const start = Date.now();
  const args = buildArgs(runner, input);

  const result = await runCommand(runner, args, cwd, signal);
  const duration = Date.now() - start;

  return parseResult(runner, result, duration);
}

function buildArgs(runner: string, input: TestInput): string[] {
  const args: string[] = [];
  const timeout = input.timeout ?? 30000;

  switch (runner) {
    case 'vitest':
      args.push('run', '--reporter=verbose');
      if (input.watch) { args[1] = ''; args.push('watch'); }
      if (input.coverage) args.push('--coverage');
      if (input.grep) args.push('--testNamePattern', input.grep);
      args.push('--testTimeout', String(timeout));
      break;
    case 'jest':
      args.push('--verbose');
      if (input.watch) args.push('--watch');
      if (input.coverage) args.push('--coverage');
      if (input.grep) args.push('--testPathPattern', input.grep);
      args.push('--testTimeout', String(timeout));
      break;
    case 'mocha':
      args.push('--reporter', 'spec');
      if (input.grep) args.push('--grep', input.grep);
      args.push('--timeout', String(timeout));
      break;
  }

  if (input.files) {
    const files = Array.isArray(input.files) ? input.files : input.files.split(',');
    args.push('--', ...files.map((f) => f.trim()));
  }

  return args;
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
    const MAX = 200_000;

    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c) => { if (stdout.length < MAX) stdout += c.toString(); });
    child.stderr?.on('data', (c) => { if (stderr.length < MAX) stderr += c.toString(); });
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 0, truncated: stdout.length >= MAX }));
    child.on('error', (e) => resolve({ stdout: '', stderr: e.message, exitCode: 1, truncated: false }));
  });
}

function parseResult(runner: string, result: { stdout: string; stderr: string; exitCode: number; truncated: boolean }, duration: number): TestOutput {
  const out = result.stdout + result.stderr;

  let tests_run = 0;
  let passed = 0;
  let failed = 0;

  if (runner === 'vitest') {
    const passedMatch = out.match(/(\d+) passed/);
    const failedMatch = out.match(/(\d+) failed/);
    if (passedMatch?.[1]) passed = parseInt(passedMatch[1], 10);
    if (failedMatch?.[1]) failed = parseInt(failedMatch[1], 10);
    tests_run = passed + failed;
  } else if (runner === 'jest') {
    const suitesMatch = out.match(/Test Suites:\s+(\d+)\s+total/);
    const passedMatch = out.match(/Tests:\s+(\d+)\s+passed/);
    const failedMatch = out.match(/Tests:\s+(\d+)\s+failed/);
    tests_run = parseInt(suitesMatch?.[1] ?? '0', 10);
    passed = parseInt(passedMatch?.[1] ?? '0', 10);
    failed = parseInt(failedMatch?.[1] ?? '0', 10);
  }

  return {
    runner,
    exit_code: result.exitCode,
    tests_run,
    passed,
    failed,
    duration_ms: duration,
    output: result.stdout,
    truncated: result.truncated,
  };
}