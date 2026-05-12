import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { grepTool } from '../src/grep.js';
import { mkSandbox, newSignal, type Sandbox } from './fixtures.js';

describe('grep tool', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await mkSandbox();
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('finds matches in content mode', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.txt'), 'hello world\nfoo bar\nhello again\n');
    const out = await grepTool.execute(
      { pattern: 'hello', output_mode: 'content' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.count).toBeGreaterThanOrEqual(2);
  });

  it('files_with_matches mode', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.txt'), 'pattern here');
    await fs.writeFile(path.join(sb.dir, 'b.txt'), 'nothing');
    const out = await grepTool.execute(
      { pattern: 'pattern', output_mode: 'files_with_matches' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.matches.length).toBeGreaterThanOrEqual(1);
  });

  it('respects case_insensitive flag', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.txt'), 'Hello');
    const out = await grepTool.execute(
      { pattern: 'hello', case_insensitive: true, output_mode: 'content' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.count).toBeGreaterThanOrEqual(1);
  });

  it('rejects when pattern is missing', async () => {
    await expect(
      grepTool.execute({ pattern: '' }, sb.ctx, { signal: newSignal() }),
    ).rejects.toThrow();
  });

  it('count mode reports per-file tallies', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.txt'), 'hello\nhello\nworld\n');
    await fs.writeFile(path.join(sb.dir, 'b.txt'), 'hello\n');
    const out = await grepTool.execute(
      { pattern: 'hello', output_mode: 'count' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.count).toBeGreaterThanOrEqual(3);
  });

  it('filters with glob', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.ts'), 'match');
    await fs.writeFile(path.join(sb.dir, 'a.md'), 'match');
    const out = await grepTool.execute(
      { pattern: 'match', glob: '*.ts', output_mode: 'files_with_matches' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.matches.some((m) => m.endsWith('.ts'))).toBe(true);
    expect(out.matches.every((m) => !m.endsWith('.md'))).toBe(true);
  });

  it('skips binary files', async () => {
    await fs.writeFile(path.join(sb.dir, 'a.bin'), Buffer.from([0, 1, 2, 3, 0, 0, 5]));
    await fs.writeFile(path.join(sb.dir, 'b.txt'), 'real match');
    const out = await grepTool.execute(
      { pattern: 'match', output_mode: 'content' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.matches.some((m) => m.includes('b.txt'))).toBe(true);
    expect(out.matches.some((m) => m.includes('a.bin'))).toBe(false);
  });

  it('skips default-ignored directories', async () => {
    await fs.mkdir(path.join(sb.dir, 'node_modules', 'pkg'), { recursive: true });
    await fs.writeFile(path.join(sb.dir, 'node_modules', 'pkg', 'x.txt'), 'hello');
    await fs.writeFile(path.join(sb.dir, 'top.txt'), 'hello');
    const out = await grepTool.execute(
      { pattern: 'hello', output_mode: 'files_with_matches' },
      sb.ctx,
      { signal: newSignal() },
    );
    expect(out.matches.some((m) => m.includes('node_modules'))).toBe(false);
    expect(out.matches.some((m) => m.includes('top.txt'))).toBe(true);
  });

  it('hits limit and truncates in native mode', async () => {
    // Write enough files to potentially hit limit
    for (let i = 0; i < 50; i++) {
      await fs.writeFile(path.join(sb.dir, `f${i}.txt`), 'match');
    }
    const out = await grepTool.execute(
      { pattern: 'match', output_mode: 'files_with_matches', limit: 5 },
      sb.ctx,
      { signal: newSignal() },
    );
    // native mode truncates at limit
    expect(out.truncated).toBe(true);
  });
});
