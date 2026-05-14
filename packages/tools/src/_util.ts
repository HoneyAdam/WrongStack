import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Context, ToolProgressEvent } from '@wrongstack/core';

export function resolvePath(input: string, ctx: Context): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(ctx.cwd, input);
}

export function ensureInsideRoot(absPath: string, ctx: Context): string {
  const root = path.resolve(ctx.projectRoot);
  const target = path.resolve(absPath);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path "${absPath}" is outside project root "${root}"`);
  }
  return target;
}

export function safeResolve(input: string, ctx: Context): string {
  return ensureInsideRoot(resolvePath(input, ctx), ctx);
}

export function truncateMiddle(s: string, max: number): string {
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  const half = Math.floor(max / 2);
  return (
    s.slice(0, half) +
    `\n…[truncated ${Buffer.byteLength(s, 'utf8') - max} bytes from middle]…\n` +
    s.slice(-half)
  );
}

export function isBinaryBuffer(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export interface SpawnStreamResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  error?: string;
}

export interface SpawnStreamOptions {
  cmd: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  maxBytes?: number;
  /** Bytes of new stdout/stderr to accumulate before yielding a `partial_output` event. */
  flushBytes?: number;
}

/**
 * Spawn a child process and yield `partial_output` progress events as
 * stdout/stderr arrive (batched by byte threshold), then return the full
 * buffered result. Shared between install/lint/format/typecheck/test/audit
 * so the TUI live tail sees consistent progress regardless of which tool
 * is running.
 */
export async function* spawnStream(
  opts: SpawnStreamOptions,
): AsyncGenerator<ToolProgressEvent, SpawnStreamResult> {
  const max = opts.maxBytes ?? 200_000;
  const flushAt = opts.flushBytes ?? 4 * 1024;
  let stdout = '';
  let stderr = '';
  let pending = '';
  let error: string | undefined;

  const child = spawn(opts.cmd, opts.args, {
    cwd: opts.cwd,
    signal: opts.signal,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  type Chunk = { kind: 'out' | 'err' | 'close' | 'error'; data: string; code?: number };
  const queue: Chunk[] = [];
  let waiter: (() => void) | undefined;
  const wake = () => {
    if (waiter) {
      const w = waiter;
      waiter = undefined;
      w();
    }
  };

  child.stdout?.on('data', (c) => {
    const s = c.toString();
    if (stdout.length < max) stdout += s;
    queue.push({ kind: 'out', data: s });
    wake();
  });
  child.stderr?.on('data', (c) => {
    const s = c.toString();
    if (stderr.length < max) stderr += s;
    queue.push({ kind: 'err', data: s });
    wake();
  });
  child.on('error', (e) => {
    error = e.message;
    queue.push({ kind: 'error', data: e.message });
    wake();
  });
  child.on('close', (code) => {
    queue.push({ kind: 'close', data: '', code: code ?? 0 });
    wake();
  });

  let exitCode = 0;
  let spawnFailed = false;
  for (;;) {
    while (queue.length === 0) {
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    const chunk = queue.shift()!;
    if (chunk.kind === 'close') {
      // If we already saw a spawn error (ENOENT etc.), keep exitCode=1
      // rather than the negative platform code Node fabricates.
      if (!spawnFailed) exitCode = chunk.code ?? 0;
      break;
    }
    if (chunk.kind === 'error') {
      spawnFailed = true;
      exitCode = 1;
      // close usually follows
      continue;
    }
    pending += chunk.data;
    if (pending.length >= flushAt) {
      yield { type: 'partial_output', text: pending };
      pending = '';
    }
  }
  if (pending.length > 0) {
    yield { type: 'partial_output', text: pending };
  }

  return {
    stdout,
    stderr,
    exitCode,
    truncated: stdout.length >= max || stderr.length >= max,
    error,
  };
}
