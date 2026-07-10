import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { HQ_AUTH_FILE_VERSION, resolveHqConfigFromEnv, writeHqAuthFile, writeHqRuntimeFile } from '../../src/hq/index.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hq-factory-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('HQ publisher factory env config', () => {
  it('uses WRONGSTACK_HQ_TOKEN when explicitly provided', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'auth-file-token', createdAt: new Date().toISOString() }],
      });

      const config = resolveHqConfigFromEnv({
        WRONGSTACK_HQ_URL: 'http://127.0.0.1:3499',
        WRONGSTACK_HQ_TOKEN: 'explicit-token',
        WRONGSTACK_HQ_DATA_DIR: dir,
      });

      expect(config).toMatchObject({ url: 'http://127.0.0.1:3499', token: 'explicit-token' });
    });
  });

  it('auto-loads the first client token from auth.json when HQ is enabled', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });

      const config = resolveHqConfigFromEnv({
        WRONGSTACK_HQ_ENABLED: '1',
        WRONGSTACK_HQ_DATA_DIR: dir,
      });

      expect(config).toMatchObject({
        url: 'http://127.0.0.1:3499',
        enabled: true,
        discover: true,
        dataDir: dir,
        token: 'client-token-from-auth',
      });
    });
  });

  it('auto-loads the first client token from auth.json when only URL is provided', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        browserTokens: [{ id: 'bt-1', token: 'browser-token-ignored', createdAt: new Date().toISOString() }],
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });

      const config = resolveHqConfigFromEnv({
        WRONGSTACK_HQ_URL: 'http://127.0.0.1:3499',
        WRONGSTACK_HQ_DATA_DIR: dir,
      });

      expect(config).toMatchObject({ url: 'http://127.0.0.1:3499', token: 'client-token-from-auth' });
    });
  });

  it('does NOT fall back to the local auth.json token for a remote URL', async () => {
    // A remote HQ has its own auth.json — sending the LOCAL client token
    // would put the publisher into a silent 401 reconnect loop. Without an
    // explicit token the config must carry none, so the operator sees an
    // honest auth failure instead of a wrong-token mystery.
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'local-only-token', createdAt: new Date().toISOString() }],
      });

      const config = resolveHqConfigFromEnv({
        WRONGSTACK_HQ_URL: 'http://192.168.1.50:3499',
        WRONGSTACK_HQ_DATA_DIR: dir,
      });

      expect(config?.url).toBe('http://192.168.1.50:3499');
      expect(config?.token).toBeUndefined();
    });
  });

  it('uses the explicit WRONGSTACK_HQ_TOKEN for a remote URL', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'local-only-token', createdAt: new Date().toISOString() }],
      });

      const config = resolveHqConfigFromEnv({
        WRONGSTACK_HQ_URL: 'http://hq.example.com:3499',
        WRONGSTACK_HQ_TOKEN: 'remote-token',
        WRONGSTACK_HQ_DATA_DIR: dir,
      });

      expect(config).toMatchObject({ url: 'http://hq.example.com:3499', token: 'remote-token' });
    });
  });

  it('auto-enables same-machine HQ when auth.json has a client token', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });

      expect(resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir })).toMatchObject({
        url: 'http://127.0.0.1:3499',
        enabled: true,
        discover: true,
        token: 'client-token-from-auth',
      });
    });
  });

  it('auto-enables open-mode same-machine HQ when only a runtime URL exists', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        browserTokens: [],
        clientTokens: [],
      });
      await writeHqRuntimeFile(dir, { url: 'http://127.0.0.1:45123', pid: process.pid });

      expect(resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir })).toMatchObject({
        url: 'http://127.0.0.1:45123',
        enabled: true,
        discover: true,
      });
    });
  });

  it('prefers the runtime HQ URL when the server bound a non-default port', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });
      await writeHqRuntimeFile(dir, { url: 'http://127.0.0.1:45123', pid: process.pid });

      expect(resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir })).toMatchObject({
        url: 'http://127.0.0.1:45123',
        enabled: true,
        discover: true,
        token: 'client-token-from-auth',
      });
    });
  });

  it('ignores a runtime HQ URL whose recorded process is no longer alive', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });
      await writeHqRuntimeFile(dir, { url: 'http://127.0.0.1:45123', pid: 999_999_999 });

      expect(resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir })).toMatchObject({
        url: 'http://127.0.0.1:3499',
        enabled: true,
        discover: true,
        token: 'client-token-from-auth',
      });
    });
  });

  it('enters discovery mode even when nothing is configured yet (HQ may start later)', async () => {
    await withTempDir(async (dir) => {
      // No auth.json, no runtime.json — a client booted before `wstack --hq`
      // ever ran. It must still get a (dormant) discovery config so it can
      // attach the moment an HQ starts on this machine.
      const config = resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir });
      expect(config).toMatchObject({
        url: 'http://127.0.0.1:3499',
        enabled: true,
        discover: true,
        dataDir: dir,
      });
      expect(config?.token).toBeUndefined();
    });
  });

  it('does not auto-enable local HQ when explicitly disabled', async () => {
    await withTempDir(async (dir) => {
      await writeHqAuthFile(dir, {
        version: HQ_AUTH_FILE_VERSION,
        updatedAt: new Date().toISOString(),
        clientTokens: [{ id: 'ct-1', token: 'client-token-from-auth', createdAt: new Date().toISOString() }],
      });

      expect(resolveHqConfigFromEnv({ WRONGSTACK_HQ_DATA_DIR: dir, WRONGSTACK_HQ_ENABLED: '0' })).toBeUndefined();
    });
  });
});
