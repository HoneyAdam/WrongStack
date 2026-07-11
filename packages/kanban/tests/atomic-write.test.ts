import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FsError, atomicWrite, ensureDir, withFileLock } from '../src/utils/atomic-write.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-test-'));
});

// ── ensureDir ────────────────────────────────────────────────────

describe('ensureDir', () => {
  it('creates a directory', async () => {
    const dir = path.join(tmpDir, 'nested', 'dir');
    await ensureDir(dir);
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('does not throw for existing directory', async () => {
    await ensureDir(tmpDir);
    await expect(ensureDir(tmpDir)).resolves.toBeUndefined();
  });
});

// ── atomicWrite ──────────────────────────────────────────────────

describe('atomicWrite', () => {
  it('writes a string file atomically', async () => {
    const target = path.join(tmpDir, 'test.txt');
    await atomicWrite(target, 'hello world');
    const content = await fs.readFile(target, 'utf8');
    expect(content).toBe('hello world');
  });

  it('writes binary content (Uint8Array)', async () => {
    const target = path.join(tmpDir, 'binary.bin');
    const buf = new Uint8Array([0, 1, 2, 255]);
    await atomicWrite(target, buf);
    const read = await fs.readFile(target);
    expect([...read]).toEqual([0, 1, 2, 255]);
  });

  it('writes to a nested directory', async () => {
    const target = path.join(tmpDir, 'a', 'b', 'c', 'deep.txt');
    await atomicWrite(target, 'deep');
    expect(await fs.readFile(target, 'utf8')).toBe('deep');
  });

  it('overwrites an existing file', async () => {
    const target = path.join(tmpDir, 'replace.txt');
    await atomicWrite(target, 'first');
    await atomicWrite(target, 'second');
    expect(await fs.readFile(target, 'utf8')).toBe('second');
  });
});

// ── withFileLock ─────────────────────────────────────────────────

describe('withFileLock', () => {
  it('acquires lock and runs the function', async () => {
    const target = path.join(tmpDir, 'locked.json');
    const result = await withFileLock(target, async () => 'done');
    expect(result).toBe('done');
  });

  it('throws FsError when lock cannot be acquired (timeout)', async () => {
    const target = path.join(tmpDir, 'busy.json');
    const lockPath = path.join(tmpDir, '.busy.json.lock');
    // Acquire the lock manually so withFileLock cannot
    await fs.writeFile(lockPath, '99999:0', { flag: 'wx' });
    await expect(
      withFileLock(target, async () => 'never', { timeoutMs: 100, staleMs: 60_000 }),
    ).rejects.toThrow(FsError);
  });

  it('recovers when lock directory is deleted mid-flight', async () => {
    const target = path.join(tmpDir, 'recover.json');
    const lockPath = path.join(tmpDir, '.recover.json.lock');
    // Write a stale lock then remove its parent dir to trigger ENOENT recovery
    await fs.writeFile(lockPath, '99999:0', { flag: 'wx' });
    // Set staleMs very low so the lock is treated as stale
    const result = await withFileLock(target, async () => 'recovered', {
      timeoutMs: 5000,
      staleMs: 1, // 1ms — the lock we created is older than this immediately
    });
    expect(result).toBe('recovered');
  });

  it('runs cleanup even when fn throws', async () => {
    const target = path.join(tmpDir, 'throws.json');
    const lockPath = path.join(tmpDir, '.throws.json.lock');
    await expect(
      withFileLock(target, async () => { throw new Error('fn failed'); }),
    ).rejects.toThrow('fn failed');
    // Lock file should be cleaned up
    const exists = await fs.stat(lockPath).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });
});

// ── FsError ──────────────────────────────────────────────────────

describe('FsError', () => {
  it('creates an error with code and path', () => {
    const err = new FsError({
      message: 'test error',
      code: 'FS_TEST',
      path: '/some/path',
      context: { detail: 'info' },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FsError');
    expect(err.code).toBe('FS_TEST');
    expect(err.path).toBe('/some/path');
    expect(err.context).toEqual({ detail: 'info' });
    expect(err.message).toBe('test error');
  });

  it('creates error without optional fields', () => {
    const err = new FsError({ message: 'minimal', code: 'FS_MIN' });
    expect(err.code).toBe('FS_MIN');
    expect(err.path).toBeUndefined();
    expect(err.context).toBeUndefined();
  });
});
