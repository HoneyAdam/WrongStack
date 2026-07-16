import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OffsetStore, offsetPathForToken } from '../../src/offset-store.js';

describe('offsetPathForToken', () => {
  it('derives a token-hash-scoped path that never contains the raw token', () => {
    const token = '123456:super-secret-token';
    const root = join('root', 'wstack');
    const path = offsetPathForToken(token, root);
    expect(path).toContain(root);
    expect(path).toContain('telegram');
    expect(path).toMatch(/offset-[a-f0-9]{12}\.json$/);
    expect(path).not.toContain(token);
    expect(path).not.toContain('super-secret');
  });

  it('produces stable paths for the same token and distinct paths for different tokens', () => {
    expect(offsetPathForToken('a', '/r')).toBe(offsetPathForToken('a', '/r'));
    expect(offsetPathForToken('a', '/r')).not.toBe(offsetPathForToken('b', '/r'));
  });
});

describe('OffsetStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'offset-store-'));
    filePath = join(dir, 'nested', 'offset.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null on a cold start when no file exists', () => {
    const store = new OffsetStore({ path: filePath });
    expect(store.read()).toBeNull();
  });

  it('round-trips a written offset', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(42);
    expect(store.read()).toBe(42);
  });

  it('creates the parent directory on first write', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(7);
    expect(readFileSync(filePath, 'utf8')).toBe('7');
  });

  it('overwrites a previous value', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(1);
    store.write(2);
    store.write(999);
    expect(store.read()).toBe(999);
  });

  it('writes atomically and leaves no temp files behind', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(100);
    const files = readdirSync(join(dir, 'nested'));
    expect(files).toEqual(['offset.json']);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('returns null for an empty file', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(5);
    writeFileSync(filePath, '', 'utf8');
    expect(store.read()).toBeNull();
  });

  it('returns null for a corrupt (non-JSON) file', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(5);
    writeFileSync(filePath, 'not-json{{{', 'utf8');
    expect(store.read()).toBeNull();
  });

  it('rejects negative, fractional, and non-number persisted values', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(0); // ensure the parent directory exists
    for (const bad of ['-1', '3.5', '"12"', 'true', 'null']) {
      writeFileSync(filePath, bad, 'utf8');
      expect(store.read()).toBeNull();
    }
  });

  it('ignores a negative write and keeps any prior value', () => {
    const store = new OffsetStore({ path: filePath });
    store.write(10);
    store.write(-4);
    expect(store.read()).toBe(10);
  });

  it('is a no-op when neither token nor path is provided', () => {
    const store = new OffsetStore();
    expect(store.storePath).toBe('');
    expect(store.read()).toBeNull();
    expect(() => store.write(3)).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it('derives a token-scoped path when constructed with a token', () => {
    const store = new OffsetStore({ token: '123456:token', globalRoot: dir });
    expect(store.storePath).toBe(offsetPathForToken('123456:token', dir));
    store.write(55);
    expect(store.read()).toBe(55);
  });
});
