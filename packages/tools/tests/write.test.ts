import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTool } from '../src/read.js';
import { writeTool } from '../src/write.js';
import { type Sandbox, mkSandbox, newSignal } from './fixtures.js';

describe('write tool', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await mkSandbox();
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('requires a path', async () => {
    await expect(
      writeTool.execute({ path: '', content: 'x' }, sb.ctx, { signal: newSignal() }),
    ).rejects.toThrow(/path is required/);
  });

  it('requires content', async () => {
    await expect(
      writeTool.execute({ path: 'a.txt', content: undefined as never }, sb.ctx, {
        signal: newSignal(),
      }),
    ).rejects.toThrow(/content is required/);
  });

  it('creates a new file', async () => {
    const out = await writeTool.execute({ path: 'new.txt', content: 'hello' }, sb.ctx, {
      signal: newSignal(),
    });
    expect(out.created).toBe(true);
    expect(await fs.readFile(path.join(sb.dir, 'new.txt'), 'utf8')).toBe('hello');
  });

  it('aborted signal prevents the write from touching the filesystem', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      writeTool.execute({ path: 'aborted.txt', content: 'never' }, sb.ctx, {
        signal: ctrl.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await expect(fs.access(path.join(sb.dir, 'aborted.txt'))).rejects.toThrow();
  });

  it('streams each line before finalizing a new file write', async () => {
    const events = [];
    for await (const event of writeTool.executeStream!(
      { path: 'streamed.txt', content: 'one\ntwo\nthree' },
      sb.ctx,
      { signal: newSignal() },
    )) {
      events.push(event);
    }

    expect(events.slice(0, 3)).toEqual([
      { type: 'partial_output', text: 'one\n', data: { livePreview: true } },
      { type: 'partial_output', text: 'two\n', data: { livePreview: true } },
      { type: 'partial_output', text: 'three\n', data: { livePreview: true } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'final', output: { created: true } });
    expect(await fs.readFile(path.join(sb.dir, 'streamed.txt'), 'utf8')).toBe('one\ntwo\nthree');
  });

  it('does not stream overwritten file contents', async () => {
    await fs.writeFile(path.join(sb.dir, 'existing-stream.txt'), 'old');
    const events = [];
    for await (const event of writeTool.executeStream!(
      { path: 'existing-stream.txt', content: 'new' },
      sb.ctx,
      { signal: newSignal() },
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'final', output: { created: false } });
  });

  it('overwrites existing file without prior read (auto-reads internally)', async () => {
    await fs.writeFile(path.join(sb.dir, 'existing.txt'), 'old');
    // Write tool auto-reads the file internally when not already recorded as read.
    // This allows overwriting files the user approved via confirmation without
    // requiring an explicit read tool call first.
    const out = await writeTool.execute({ path: 'existing.txt', content: 'new' }, sb.ctx, {
      signal: newSignal(),
    });
    expect(out.created).toBe(false);
    expect(await fs.readFile(path.join(sb.dir, 'existing.txt'), 'utf8')).toBe('new');
  });

  it('overwrites after read', async () => {
    await fs.writeFile(path.join(sb.dir, 'existing.txt'), 'old');
    await readTool.execute({ path: 'existing.txt' }, sb.ctx, { signal: newSignal() });
    const out = await writeTool.execute({ path: 'existing.txt', content: 'new' }, sb.ctx, {
      signal: newSignal(),
    });
    expect(out.created).toBe(false);
    expect(await fs.readFile(path.join(sb.dir, 'existing.txt'), 'utf8')).toBe('new');
  });
});
