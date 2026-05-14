import * as path from 'node:path';
import type { Context } from '@wrongstack/core';

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

