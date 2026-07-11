import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDecrypt = vi.hoisted(() => vi.fn());
const mockEncrypt = vi.hoisted(() => vi.fn());
const mockAtomicWrite = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockExpectDefined = vi.hoisted(() => vi.fn((v: any) => v));

vi.mock('@wrongstack/core/security', () => ({
  decryptConfigSecrets: mockDecrypt,
  encryptConfigSecrets: mockEncrypt,
}));

vi.mock('@wrongstack/core', () => ({
  expectDefined: mockExpectDefined,
  atomicWrite: mockAtomicWrite,
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

import { createConfigWriteLock, createProviderStore } from '../src/server/provider-store.js';

describe('provider-store', () => {
  describe('createConfigWriteLock', () => {
    it('provides a serialization lock', async () => {
      const lock = createConfigWriteLock();
      expect(lock.current).toBeInstanceOf(Promise);

      const order: number[] = [];
      const { prev, release } = lock.acquire();
      // Simulate async work
      const work = prev.then(() => {
        order.push(1);
      });
      order.push(0);
      release();
      await work;
      expect(order).toEqual([0, 1]);
    });
  });

  describe('createProviderStore', () => {
    const deps = {
      globalConfigPath: '/fake/config.json',
      vault: {} as any,
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('load', () => {
      it('returns empty record when file is missing', async () => {
        mockReadFile.mockRejectedValue({ code: 'ENOENT' });
        const store = createProviderStore(deps);
        const result = await store.load();
        expect(result).toEqual({});
      });

      it('returns empty record when JSON is invalid', async () => {
        mockReadFile.mockResolvedValue('not json');
        const store = createProviderStore(deps);
        const result = await store.load();
        expect(result).toEqual({});
      });

      it('returns empty record when no providers field', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({}));
        const store = createProviderStore(deps);
        const result = await store.load();
        expect(result).toEqual({});
      });

      it('returns decrypted providers', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({ providers: { test: { type: 'test' } } }));
        mockDecrypt.mockReturnValue({ test: { type: 'test' } });
        const store = createProviderStore(deps);
        const result = await store.load();
        expect(result).toEqual({ test: { type: 'test' } });
      });
    });

    describe('save', () => {
      it('reads, encrypts, and writes providers', async () => {
        mockReadFile.mockResolvedValue(JSON.stringify({}));
        mockEncrypt.mockReturnValue({ providers: { test: { type: 'test' } } });
        mockAtomicWrite.mockResolvedValue(undefined);
        const store = createProviderStore(deps);

        await store.save({ test: { type: 'test' } });

        expect(mockEncrypt).toHaveBeenCalled();
        expect(mockAtomicWrite).toHaveBeenCalled();
      });

      it('starts from empty object when config missing', async () => {
        mockReadFile.mockRejectedValue({ code: 'ENOENT' });
        mockEncrypt.mockReturnValue({ providers: {} });
        mockAtomicWrite.mockResolvedValue(undefined);
        const store = createProviderStore(deps);

        await store.save({});

        expect(mockEncrypt).toHaveBeenCalledWith({ providers: {} }, deps.vault);
      });

      it('handles corrupt config during read', async () => {
        mockReadFile.mockResolvedValue('not json');
        mockEncrypt.mockReturnValue({ providers: {} });
        mockAtomicWrite.mockResolvedValue(undefined);
        const store = createProviderStore(deps);

        await store.save({});

        // Should start from empty parsed object and write successfully
        expect(mockEncrypt).toHaveBeenCalledWith({ providers: {} }, deps.vault);
      });
    });

    describe('normalizeKeys', () => {
      it('returns copies of apiKeys array', () => {
        const store = createProviderStore(deps);
        const cfg: any = { type: 'test', apiKeys: [{ label: 'default', apiKey: 'sk' }] };
        const keys = store.normalizeKeys(cfg);
        expect(keys).toEqual([{ label: 'default', apiKey: 'sk' }]);
        expect(keys[0]).not.toBe(cfg.apiKeys[0]);
      });

      it('wraps legacy apiKey string', () => {
        const store = createProviderStore(deps);
        const keys = store.normalizeKeys({ type: 'test', apiKey: 'sk-legacy' } as any);
        expect(keys).toEqual([{ label: 'default', apiKey: 'sk-legacy', createdAt: '' }]);
      });

      it('returns empty array when no keys', () => {
        const store = createProviderStore(deps);
        expect(store.normalizeKeys({ type: 'test' } as any)).toEqual([]);
      });
    });

    describe('writeKeysBack', () => {
      it('clears key fields when empty', () => {
        const store = createProviderStore(deps);
        const cfg: any = { type: 'test', apiKeys: [{ label: 'k' }], apiKey: 'sk' };
        store.writeKeysBack(cfg, []);
        expect(cfg.apiKeys).toBeUndefined();
        expect(cfg.apiKey).toBeUndefined();
        expect(cfg.activeKey).toBeUndefined();
      });

      it('sets activeKey when unset', () => {
        const store = createProviderStore(deps);
        mockExpectDefined.mockReturnValue({ label: 'first', apiKey: 'sk' });
        const cfg: any = { type: 'test' };
        store.writeKeysBack(cfg, [{ label: 'first', apiKey: 'sk', createdAt: '' }]);
        expect(cfg.apiKeys).toEqual([{ label: 'first', apiKey: 'sk', createdAt: '' }]);
        expect(cfg.activeKey).toBe('first');
      });
    });

    describe('maskedKey', () => {
      it('returns em-dash for undefined', () => {
        const store = createProviderStore(deps);
        expect(store.maskedKey(undefined)).toBe('—');
      });

      it('returns bullets for short keys', () => {
        const store = createProviderStore(deps);
        expect(store.maskedKey('abc')).toBe('•••');
      });

      it('shows first/last 4 for long keys', () => {
        const store = createProviderStore(deps);
        expect(store.maskedKey('abcdefghijklmnop')).toBe('abcd…mnop');
      });
    });
  });
});
