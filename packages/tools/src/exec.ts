import { spawn } from 'node:child_process';
import * as path from 'node:path';
import type { Tool } from '@wrongstack/core';

const ALLOWED_COMMANDS: Record<string, string[]> = {
  node: ['--version', '-e', '-p', '-r', '--input-type=module'],
  npm: ['--version', 'init', 'install', 'test', 'run', 'list', 'pkg', 'doctor'],
  pnpm: ['--version', 'init', 'install', 'add', 'remove', 'exec', 'list', 'run', 'dlx'],
  npx: ['--version'],
  git: ['--version', 'status', 'log', 'diff', 'branch', 'checkout', 'stash', 'add', 'commit', 'push', 'pull'],
  ls: ['-la', '-l', '-a'],
  cat: [],
  head: ['-n'],
  tail: ['-n'],
  wc: ['-l', '-w', '-c'],
  grep: [],
  find: [],
  echo: [],
  mkdir: ['-p'],
  cp: ['-r'],
  mv: [],
  rm: ['-rf'],
  touch: [],
  bun: ['--version', 'run', 'add', 'init'],
  tsc: ['--version', '--noEmit', '--project'],
  vitest: ['--version', 'run', '--coverage'],
  biome: ['--version', 'lint', 'format', 'check'],
  cargo: ['--version', 'build', 'test', 'check'],
  rustc: ['--version'],
  go: ['version', 'run', 'build', 'test'],
  python: ['--version', '-c'],
  pip: ['--version', 'install', 'list'],
  docker: ['--version', 'ps', 'images', 'build'],
  kubectl: ['version', 'get', 'describe', 'logs'],
};

const FORBIDDEN_PATTERNS = [
  /;\s*rm\s+-rf/i,
  /\|\s*rm\s/i,
  /\&\&\s*rm/i,
  /\$\(.*rm/s,
  /`.*rm/s,
  /eval\s*\(/i,
  /exec\s+/i,
  /nc\s+-e/i,
  /bash\s+-i/i,
  /\/dev\/tcp\//i,
  /curl\s+.*\|/i,
  /wget\s+.*\|/i,
  /chmod\s+777/i,
  /chmod\s+4755/i,
  />\s*\/dev\//i,
  /2>\s*\/dev\//i,
  /tee\s+/i,
];

const MAX_ARGS = 20;
const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 30_000;

interface ExecInput {
  command: string;
  args?: string[];
  cwd?: string;
  timeout?: number;
  allow_unknown?: boolean;
}

interface ExecOutput {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  allowed: boolean;
}

export const execTool: Tool<ExecInput, ExecOutput> = {
  name: 'exec',
  description:
    'Restricted shell that only runs pre-approved commands with constrained arguments. Safer alternative to `bash`.',
  usageHint:
    'Set `command` (must be in allowlist). `args` passed through. Unknown commands require `allow_unknown: true`. Blocks dangerous patterns.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: TIMEOUT_MS,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run (must be in allowlist)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments' },
      cwd: { type: 'string', description: 'Working directory' },
      timeout: { type: 'integer', description: 'Timeout in ms (default: 30000)' },
      allow_unknown: {
        type: 'boolean',
        description: 'Allow commands not in allowlist (DANGEROUS, use with caution)',
      },
    },
    required: ['command'],
  },
  async execute(input, ctx, opts) {
    const cmd = input.command.trim();
    if (!cmd) return { command: cmd, args: [], stdout: '', stderr: 'Empty command', exitCode: 1, truncated: false, allowed: false };

    if (FORBIDDEN_PATTERNS.some((re) => re.test(cmd))) {
      return {
        command: cmd,
        args: input.args ?? [],
        stdout: '',
        stderr: `Command blocked: dangerous pattern detected`,
        exitCode: 1,
        truncated: false,
        allowed: false,
      };
    }

    const allowedCommands = { ...ALLOWED_COMMANDS };
    if (input.allow_unknown) {
      allowedCommands[cmd] = [];
    }

    if (!(cmd in allowedCommands)) {
      return {
        command: cmd,
        args: input.args ?? [],
        stdout: '',
        stderr: `Command "${cmd}" not in allowlist. Set allow_unknown: true to bypass.`,
        exitCode: 1,
        truncated: false,
        allowed: false,
      };
    }

    const args = (input.args ?? []).slice(0, MAX_ARGS);
    const timeout = Math.min(input.timeout ?? TIMEOUT_MS, TIMEOUT_MS);

    const cwd = input.cwd ?? ctx.cwd;
    const signal = opts.signal;

    return runCommand(cmd, args, cwd, timeout, signal);
  },
};

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
  signal: AbortSignal,
): Promise<ExecOutput> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn(cmd, args, { cwd, signal, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        command: cmd,
        args,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        exitCode: killed ? 124 : (code ?? 1),
        truncated: stdout.length >= MAX_OUTPUT || stderr.length >= MAX_OUTPUT,
        allowed: true,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        command: cmd,
        args,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: err.message,
        exitCode: 1,
        truncated: false,
        allowed: true,
      });
    });
  });
}