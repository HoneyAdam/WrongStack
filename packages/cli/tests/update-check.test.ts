import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkForUpdate,
  currentVersion,
  getUpdateNotification,
} from '../src/update-check.js';

// Re-export the private cachePath for test injection
// We need to test the cache logic, so we expose a test hook
vi.mock('../src/update-check.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/update-check.js')>();
  return {
    ...mod,
    // Override readCache to inject test data
    __testable: mod,
  };
});

describe('update-check', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-upd-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    // Clean up any leftover cache
    await fs.rm(path.join(os.homedir(), '.wrongstack'), { recursive: true, force: true }).catch(() => {});
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────── currentVersion

  describe('currentVersion()', () => {
    it('returns a semver string from package.json', () => {
      const v = currentVersion();
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('returns truthy value (either semver or "dev")', () => {
      // currentVersion always returns something valid — either semver or 'dev'
      expect(currentVersion()).toBeTruthy();
      expect(typeof currentVersion()).toBe('string');
    });
  });

  // ─────────────────────────────────────────────────────────────── checkForUpdate

  describe('checkForUpdate()', () => {
    it('returns outdated:false when already on latest (mocked fetch)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: currentVersion() }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = await checkForUpdate();
      expect(info.outdated).toBe(false);
      expect(info.checkFailed).toBe(false);
      expect(info.current).toBe(currentVersion());
      expect(info.latest).toBe(currentVersion());
    });

    it('returns outdated:true when npm has newer version', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '999.999.999' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = await checkForUpdate();
      expect(info.outdated).toBe(true);
      expect(info.latest).toBe('999.999.999');
      expect(info.checkFailed).toBe(false);
    });

    it('returns checkFailed:true when network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
      vi.stubGlobal('fetch', mockFetch);

      const info = await checkForUpdate();
      expect(info.checkFailed).toBe(true);
      expect(info.outdated).toBe(false);
    });

    it('aborts when signal is already aborted', async () => {
      const ac = new AbortController();
      ac.abort();
      const info = await checkForUpdate(ac.signal);
      expect(info.outdated).toBe(false);
      expect(info.checkFailed).toBe(true);
    });

    it('returns checkFailed:true when npm returns non-ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);
      vi.stubGlobal('fetch', mockFetch);

      const info = await checkForUpdate();
      expect(info.checkFailed).toBe(true);
      expect(info.outdated).toBe(false);
    });
  });

  // ──────────────────────────────────────────── cache-layer (indirect via fetch)

  describe('cache behavior', () => {
    it('uses cache on second call without network when fetch fails', async () => {
      // First call — network succeeds and caches result
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '1.0.0' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const info1 = await checkForUpdate();
      expect(info1.latest).toBe('1.0.0');
      expect(info1.checkFailed).toBe(false);

      // Second call — fetch fails, but cache should be used
      const failingFetch = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', failingFetch);

      const info2 = await checkForUpdate();
      // Cache hit — no network call, checkFailed=false
      expect(info2.checkFailed).toBe(false);
      expect(info2.latest).toBe('1.0.0');
    });
  });

  // ───────────────────────────────────────────────────────────── getUpdateNotification

  describe('getUpdateNotification()', () => {
    it('returns null when on latest version', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: currentVersion() }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const note = await getUpdateNotification();
      expect(note).toBeNull();
    });

    it('returns notification string when outdated', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '999.0.0' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const note = await getUpdateNotification();
      expect(note).toContain('Update available:');
      expect(note).toContain('v999.0.0');
    });
  });

  // ──────────────────────────────────────────────────── semver edge cases (internal)

  describe('semver comparison', () => {
    it('handles versions with v prefix from npm', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: 'v1.0.0' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = await checkForUpdate();
      expect(info.latest).toBe('v1.0.0');
    });
  });
});