import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type SubcommandDeps, subcommands } from '../../src/subcommands/index.js';

class CapStream extends Writable {
  buf = '';
  _write(c: Buffer | string, _e: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.buf += typeof c === 'string' ? c : c.toString('utf8');
    cb();
  }
}

function mkRig() {
  const out = new CapStream();
  const err = new CapStream();
  return { out, err };
}

function fakeRegistry() {
  return {
    load: async () => ({}),
    refresh: async () => ({}),
    listProviders: async () => [],
    getProvider: async () => undefined,
    getModel: async () => undefined,
    suggestModel: async () => undefined,
    ageSeconds: async () => 60,
  };
}

function mkDeps(rig: ReturnType<typeof mkRig>) {
  return {
    config: { providers: {}, log: { level: 'error' } } as never,
    renderer: {
      writeInfo: (msg: string) => { rig.out.buf += msg + '\n'; },
      write: (msg: string) => { rig.out.buf += msg; },
    },
    reader: { readLine: vi.fn(async () => ''), readKey: vi.fn(async () => ''), close: vi.fn(async () => {}) } as never,
    modelsRegistry: fakeRegistry() as never,
    paths: { globalRoot: '/tmp/g' } as never,
    cwd: '/tmp',
    projectRoot: '/tmp',
    userHome: '/tmp',
  } as unknown as SubcommandDeps;
}

describe('update subcommand', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const cacheDir = path.join(os.homedir(), '.wrongstack');
    await fs.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns 0 and reports up-to-date when on latest', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.5.2' }),
    } as unknown as Response);

    const rig = mkRig();
    const code = await subcommands['update']!([], mkDeps(rig));

    expect(code).toBe(0);
    expect(rig.out.buf).toContain('latest version');
  });

  it('--check-only prints available update without installing', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '999.0.0' }),
    } as unknown as Response);

    const rig = mkRig();
    const code = await subcommands['update'](['--check-only'], mkDeps(rig));

    expect(code).toBe(0);
    expect(rig.out.buf).toContain('Update available:');
    expect(rig.out.buf).toContain('v999.0.0');
    expect(rig.out.buf).not.toContain('Updating');
  });

  it('--check-only prints up-to-date when already latest', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.5.2' }),
    } as unknown as Response);

    const rig = mkRig();
    const code = await subcommands['update'](['--check-only'], mkDeps(rig));

    expect(code).toBe(0);
    expect(rig.out.buf).toContain('latest version');
  });

  it('-c is an alias for --check-only', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '999.0.0' }),
    } as unknown as Response);

    const rig = mkRig();
    const code = await subcommands['update'](['-c'], mkDeps(rig));

    expect(code).toBe(0);
    expect(rig.out.buf).toContain('Update available:');
    expect(rig.out.buf).toContain('v999.0.0');
  });

  it('handles network error gracefully and exits 0', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const rig = mkRig();
    const code = await subcommands['update']!([], mkDeps(rig));

    // Graceful degradation: reports as "latest" when check fails
    expect(code).toBe(0);
    expect(rig.out.buf).toContain('latest version');
  });

  it('skips update when not outdated', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.5.2' }),
    } as unknown as Response);

    const rig = mkRig();
    const code = await subcommands['update']!([], mkDeps(rig));

    expect(code).toBe(0);
    expect(rig.out.buf).not.toContain('Updating');
    expect(rig.out.buf).toContain('already on');
  });
});