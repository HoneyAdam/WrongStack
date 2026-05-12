import { spawn } from 'node:child_process';
import * as os from 'node:os';
import type { Tool } from '@wrongstack/core';
import { stripAnsi } from '@wrongstack/core';
import { truncateMiddle } from './_util.js';

interface BashInput {
  command: string;
  timeout_ms?: number;
  background?: boolean;
}

interface BashOutput {
  output: string;
  exit_code: number | null;
  timed_out: boolean;
  pid?: number;
}

const MAX_OUTPUT = 32_768;
const DEFAULT_TIMEOUT = 30_000;

export const bashTool: Tool<BashInput, BashOutput> = {
  name: 'bash',
  description: 'Run a shell command. stdout and stderr are merged.',
  usageHint:
    'Runs via `bash -c` (or `cmd /c` on Windows). Cwd is the project root. Default timeout 30s. Output truncated from the middle if oversized. Use for git, npm, builds, tests.',
  permission: 'confirm',
  mutating: true,
  timeoutMs: 30_000,
  maxOutputBytes: MAX_OUTPUT,
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      timeout_ms: { type: 'integer' },
      background: { type: 'boolean' },
    },
    required: ['command'],
  },
  async execute(input, ctx, opts) {
    if (!input?.command) throw new Error('bash: command is required');
    const timeoutMs = Math.min(input.timeout_ms ?? DEFAULT_TIMEOUT, 600_000);

    const isWin = os.platform() === 'win32';
    const shell = isWin
      ? process.env['COMSPEC'] ?? 'cmd.exe'
      : process.env['SHELL'] ?? '/bin/bash';
    const args = isWin ? ['/c', input.command] : ['-c', input.command];

    const env: NodeJS.ProcessEnv = { ...process.env };
    env['WRONGSTACK_SESSION_ID'] = ctx.session.id;

    return new Promise<BashOutput>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(shell, args, {
          cwd: ctx.projectRoot,
          env,
          stdio: input.background ? 'ignore' : ['ignore', 'pipe', 'pipe'],
          detached: input.background,
          signal: opts.signal,
        });
      } catch (err) {
        return reject(err);
      }

      if (input.background) {
        const pid = child.pid;
        if (typeof pid === 'number') child.unref();
        return resolve({
          output: `[background] pid=${pid ?? 'unknown'}`,
          exit_code: null,
          timed_out: false,
          pid,
        });
      }

      let buf = '';
      let timedOut = false;
      const timers: NodeJS.Timeout[] = [];
      const timer = setTimeout(() => {
        timedOut = true;
        if (isWin) {
          try { child.kill(); } catch { /* ignore */ }
        } else {
          try {
            child.kill('SIGTERM');
            const killTimer = setTimeout(() => {
              try { child.kill('SIGKILL'); } catch { /* ignore */ }
            }, 2000);
            timers.push(killTimer);
          } catch { /* ignore */ }
        }
      }, timeoutMs);
      timers.push(timer);
      timer.unref?.();

      child.stdout?.on('data', (chunk) => {
        buf += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        buf += chunk.toString();
      });
      child.on('error', (err) => {
        for (const t of timers) clearTimeout(t);
        reject(err);
      });
      child.on('close', (code) => {
        for (const t of timers) clearTimeout(t);
        const cleaned = stripAnsi(buf).replace(/\r\n?/g, '\n');
        resolve({
          output: truncateMiddle(cleaned, MAX_OUTPUT),
          exit_code: code,
          timed_out: timedOut,
        });
      });
    });
  },
};
