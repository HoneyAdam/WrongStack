import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Tool } from '@wrongstack/core';
import { compileGlob } from '@wrongstack/core';
import { isBinaryBuffer, safeResolve } from './_util.js';

interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  output_mode?: 'content' | 'files_with_matches' | 'count';
  context_lines?: number;
  case_insensitive?: boolean;
  limit?: number;
}

interface GrepOutput {
  matches: string[];
  count: number;
  truncated: boolean;
  used: 'rg' | 'native';
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage'];

export const grepTool: Tool<GrepInput, GrepOutput> = {
  name: 'grep',
  description: 'Search file contents with a regex. Uses ripgrep when available.',
  usageHint:
    'Pattern is regex. Use `output_mode: "content"` for matched lines, `"files_with_matches"` for paths, `"count"` for tallies. `glob` filters files (e.g. `*.ts`).',
  permission: 'auto',
  mutating: false,
  maxOutputBytes: 131_072,
  timeoutMs: 10_000,
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      glob: { type: 'string' },
      output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'] },
      context_lines: { type: 'integer' },
      case_insensitive: { type: 'boolean' },
      limit: { type: 'integer' },
    },
    required: ['pattern'],
  },
  async execute(input, ctx, opts) {
    if (!input?.pattern) throw new Error('grep: pattern is required');
    const base = input.path ? safeResolve(input.path, ctx) : ctx.cwd;
    const mode = input.output_mode ?? 'content';
    const limit = Math.max(1, Math.min(input.limit ?? 200, 2000));

    const rgAvailable = await detectRg(opts.signal);

    if (rgAvailable) {
      try {
        return await runRg(input, base, mode, limit, opts.signal);
      } catch {
        // fall through to native
      }
    }
    return await runNative(input, base, mode, limit, opts.signal);
  },
};

async function detectRg(signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn('rg', ['--version'], { stdio: 'ignore', signal });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

function runRg(
  input: GrepInput,
  base: string,
  mode: 'content' | 'files_with_matches' | 'count',
  limit: number,
  signal: AbortSignal,
): Promise<GrepOutput> {
  return new Promise((resolve, reject) => {
    const args: string[] = ['--no-heading'];
    if (input.case_insensitive) args.push('-i');
    if (mode === 'files_with_matches') args.push('-l');
    if (mode === 'count') args.push('-c');
    if (mode === 'content') {
      args.push('-n');
      if (input.context_lines) args.push('-C', String(input.context_lines));
    }
    if (input.glob) args.push('--glob', input.glob);
    args.push('--', input.pattern, base);

    const child = spawn('rg', args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout?.on('data', (chunk) => {
      buf += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      const lines = buf.split('\n').filter(Boolean);
      const sliced = lines.slice(0, limit);
      resolve({
        matches: sliced,
        count: lines.length,
        truncated: lines.length > limit,
        used: 'rg',
      });
    });
  });
}

async function runNative(
  input: GrepInput,
  base: string,
  mode: 'content' | 'files_with_matches' | 'count',
  limit: number,
  signal: AbortSignal,
): Promise<GrepOutput> {
  const flags = input.case_insensitive ? 'i' : '';
  const re = new RegExp(input.pattern, flags);
  const globRe = input.glob ? compileGlob(input.glob) : null;
  const matches: string[] = [];
  const fileMatches = new Map<string, number>();
  let total = 0;
  let stopped = false;

  const walk = async (dir: string): Promise<void> => {
    if (stopped || signal.aborted) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (stopped) return;
      if (DEFAULT_IGNORE.includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        if (globRe && !globRe.test(e.name) && !globRe.test(full)) continue;
        if (globRe) globRe.lastIndex = 0;
        try {
          const stat = await fs.stat(full);
          if (stat.size > 1_000_000) continue;
          const head = await fs.readFile(full);
          if (isBinaryBuffer(head)) continue;
          const text = head.toString('utf8');
          const lines = text.split(/\r?\n/);
          let fileHits = 0;
          for (let i = 0; i < lines.length; i++) {
            const ln = lines[i] ?? '';
            re.lastIndex = 0;
            if (re.test(ln)) {
              fileHits++;
              total++;
              if (mode === 'content' && matches.length < limit) {
                matches.push(`${full}:${i + 1}:${ln}`);
              }
            }
          }
          if (fileHits > 0) {
            fileMatches.set(full, fileHits);
            if (mode === 'files_with_matches' && matches.length < limit) {
              matches.push(full);
            }
            if (mode === 'count' && matches.length < limit) {
              matches.push(`${full}:${fileHits}`);
            }
          }
          if (matches.length >= limit) stopped = true;
        } catch {
          // skip read errors
        }
      }
    }
  };
  await walk(base);

  return {
    matches,
    count: total,
    truncated: stopped,
    used: 'native',
  };
}
