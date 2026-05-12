import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { atomicWrite } from '../../src/utils/atomic-write.js';

describe('atomicWrite', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-aw-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes a new file', async () => {
    const file = path.join(dir, 'a.txt');
    await atomicWrite(file, 'hello');
    expect(await fs.readFile(file, 'utf8')).toBe('hello');
  });

  it('overwrites existing file', async () => {
    const file = path.join(dir, 'b.txt');
    await fs.writeFile(file, 'old');
    await atomicWrite(file, 'new');
    expect(await fs.readFile(file, 'utf8')).toBe('new');
  });

  it('leaves no orphan tmp file on success', async () => {
    const file = path.join(dir, 'c.txt');
    await atomicWrite(file, 'x');
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('creates parent directories', async () => {
    const file = path.join(dir, 'nested', 'deep', 'd.txt');
    await atomicWrite(file, 'ok');
    expect(await fs.readFile(file, 'utf8')).toBe('ok');
  });
});
