import { describe, it, expect } from 'vitest';
import {
  normalizeKeys,
  writeKeysBack,
  maskedKey,
  upsertKey,
  deleteKey,
  setActiveKey,
  addProvider,
  removeProvider,
} from '../src/server/provider-keys.js';

describe('provider-keys', () => {
  describe('normalizeKeys', () => {
    it('returns copies of existing apiKeys array', () => {
      const cfg = { type: 'openai', apiKeys: [{ label: 'default', apiKey: 'sk-123', createdAt: '' }] };
      const keys = normalizeKeys(cfg);
      expect(keys).toEqual([{ label: 'default', apiKey: 'sk-123', createdAt: '' }]);
      // Should be a copy
      expect(keys[0]).not.toBe(cfg.apiKeys[0]);
    });

    it('wraps legacy apiKey string to array form', () => {
      const cfg = { type: 'openai', apiKey: 'sk-legacy' };
      const keys = normalizeKeys(cfg);
      expect(keys).toEqual([{ label: 'default', apiKey: 'sk-legacy', createdAt: '' }]);
    });

    it('returns empty array when no keys exist', () => {
      const cfg = { type: 'openai' };
      expect(normalizeKeys(cfg)).toEqual([]);
    });

    it('returns empty array when apiKeys is empty', () => {
      const cfg = { type: 'openai', apiKeys: [] };
      expect(normalizeKeys(cfg)).toEqual([]);
    });

    it('returns empty when apiKey is empty string', () => {
      const cfg = { type: 'openai', apiKey: '' };
      expect(normalizeKeys(cfg)).toEqual([]);
    });
  });

  describe('writeKeysBack', () => {
    it('clears all key fields when keys is empty', () => {
      const cfg: any = { type: 'openai', apiKeys: [{ label: 'default', apiKey: 'sk' }], apiKey: 'sk', activeKey: 'default' };
      writeKeysBack(cfg, []);
      expect(cfg.apiKeys).toBeUndefined();
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.activeKey).toBeUndefined();
    });

    it('writes keys and sets activeKey to first key when unset', () => {
      const cfg: any = { type: 'openai' };
      writeKeysBack(cfg, [{ label: 'mykey', apiKey: 'sk-abc', createdAt: '' }]);
      expect(cfg.apiKeys).toEqual([{ label: 'mykey', apiKey: 'sk-abc', createdAt: '' }]);
      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.activeKey).toBe('mykey');
    });

    it('preserves activeKey when it still matches a key', () => {
      const cfg: any = { type: 'openai', activeKey: 'key1' };
      writeKeysBack(cfg, [
        { label: 'key1', apiKey: 'sk-1', createdAt: '' },
        { label: 'key2', apiKey: 'sk-2', createdAt: '' },
      ]);
      expect(cfg.activeKey).toBe('key1');
    });
  });

  describe('maskedKey', () => {
    it('returns em-dash for undefined key', () => {
      expect(maskedKey(undefined)).toBe('—');
    });

    it('returns em-dash for empty key', () => {
      expect(maskedKey('')).toBe('—');
    });

    it('returns full-width bullet string for keys <= 8 chars', () => {
      expect(maskedKey('short')).toBe('•••••');
      expect(maskedKey('12345678')).toBe('••••••••');
    });

    it('shows first 4 and last 4 chars for longer keys', () => {
      expect(maskedKey('abcdefghijklmnop')).toBe('abcd…mnop');
    });
  });

  describe('upsertKey', () => {
    it('adds a new key to an existing provider', () => {
      const providers: any = { openai: { type: 'openai', apiKeys: [] } };
      const result = upsertKey(providers, 'openai', 'default', 'sk-new', '2024-01-01');
      expect(result.ok).toBe(true);
      expect(providers.openai.apiKeys).toHaveLength(1);
      expect(providers.openai.apiKeys[0].apiKey).toBe('sk-new');
    });

    it('replaces an existing key with same label', () => {
      const providers: any = { openai: { type: 'openai', apiKeys: [{ label: 'default', apiKey: 'sk-old', createdAt: '' }] } };
      upsertKey(providers, 'openai', 'default', 'sk-new', '2024-01-01');
      expect(providers.openai.apiKeys[0].apiKey).toBe('sk-new');
      expect(providers.openai.apiKeys[0].createdAt).toBe('2024-01-01');
    });

    it('creates a new provider when it does not exist', () => {
      const providers: any = {};
      upsertKey(providers, 'anthropic', 'default', 'sk-ant', '2024-01-01');
      expect(providers.anthropic).toBeDefined();
      expect(providers.anthropic.apiKeys[0].apiKey).toBe('sk-ant');
    });

    it('sets activeKey to new label when provider has no activeKey', () => {
      const providers: any = {};
      upsertKey(providers, 'test', 'mykey', 'sk-xxx', '2024-01-01');
      expect(providers.test.activeKey).toBe('mykey');
    });
  });

  describe('deleteKey', () => {
    it('removes a key from a provider', () => {
      const providers: any = {
        openai: { type: 'openai', apiKeys: [{ label: 'default', apiKey: 'sk-1', createdAt: '' }] },
      };
      const result = deleteKey(providers, 'openai', 'default');
      expect(result.ok).toBe(true);
      expect(providers.openai).toBeUndefined();
    });

    it('returns error when provider not found', () => {
      const result = deleteKey({}, 'nonexistent', 'default');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('updates activeKey when deleting the active key', () => {
      const providers: any = {
        test: { type: 'test', activeKey: 'key1', apiKeys: [
          { label: 'key1', apiKey: 'sk-1', createdAt: '' },
          { label: 'key2', apiKey: 'sk-2', createdAt: '' },
        ]},
      };
      deleteKey(providers, 'test', 'key1');
      expect(providers.test.activeKey).toBe('key2');
    });

    it('removes provider when last key is deleted', () => {
      const providers: any = { test: { type: 'test', apiKeys: [{ label: 'key1', apiKey: 'sk-1', createdAt: '' }] } };
      deleteKey(providers, 'test', 'key1');
      expect(providers.test).toBeUndefined();
    });
  });

  describe('setActiveKey', () => {
    it('sets the active key on a provider', () => {
      const providers: any = { test: { type: 'test', apiKeys: [{ label: 'k1', apiKey: 'sk', createdAt: '' }] } };
      const result = setActiveKey(providers, 'test', 'k1');
      expect(result.ok).toBe(true);
      expect(providers.test.activeKey).toBe('k1');
    });

    it('returns error when provider not found', () => {
      const result = setActiveKey({}, 'missing', 'k1');
      expect(result.ok).toBe(false);
    });
  });

  describe('addProvider', () => {
    it('adds a new provider without a key', () => {
      const providers: any = {};
      const result = addProvider(providers, { id: 'test', family: 'openai' }, '2024-01-01');
      expect(result.ok).toBe(true);
      expect(providers.test.type).toBe('test');
      expect(providers.test.family).toBe('openai');
    });

    it('adds a new provider with an initial apiKey', () => {
      const providers: any = {};
      addProvider(providers, { id: 'test', family: 'openai', apiKey: 'sk-init' }, '2024-01-01');
      expect(providers.test.apiKeys).toHaveLength(1);
      expect(providers.test.apiKeys[0].apiKey).toBe('sk-init');
      expect(providers.test.activeKey).toBe('default');
    });

    it('returns error when provider already exists', () => {
      const providers: any = { existing: { type: 'existing' } };
      const result = addProvider(providers, { id: 'existing', family: 'openai' }, '2024-01-01');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('already exists');
    });
  });

  describe('removeProvider', () => {
    it('removes an existing provider', () => {
      const providers: any = { test: { type: 'test' } };
      const result = removeProvider(providers, 'test');
      expect(result.ok).toBe(true);
      expect(providers.test).toBeUndefined();
    });

    it('returns error when provider not found', () => {
      const result = removeProvider({}, 'missing');
      expect(result.ok).toBe(false);
    });
  });
});
