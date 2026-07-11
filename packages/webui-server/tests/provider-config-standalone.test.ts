import { describe, it, expect, vi } from 'vitest';

const mockLoadSaved = vi.hoisted(() => vi.fn());
const mockSaveProviders = vi.hoisted(() => vi.fn());

vi.mock('../src/server/provider-config-io.js', () => ({
  loadSavedProviders: mockLoadSaved,
  saveProviders: mockSaveProviders,
}));

import { createProviderConfigIO } from '../src/server/provider-config-standalone.js';

describe('provider-config-standalone', () => {
  describe('createProviderConfigIO', () => {
    it('returns load/save functions that delegate to provider-config-io', () => {
      const io = createProviderConfigIO('/tmp/.wrongstack/config.json');
      expect(io).toHaveProperty('load');
      expect(io).toHaveProperty('save');
      expect(typeof io.load).toBe('function');
      expect(typeof io.save).toBe('function');
    });

    it('load delegates to loadSavedProviders', async () => {
      mockLoadSaved.mockResolvedValue({ test: { type: 'test' } });
      const io = createProviderConfigIO('/tmp/.wrongstack/config.json');
      const result = await io.load();
      expect(mockLoadSaved).toHaveBeenCalled();
      expect(result).toEqual({ test: { type: 'test' } });
    });

    it('save delegates to saveProviders', async () => {
      mockSaveProviders.mockResolvedValue(undefined);
      const io = createProviderConfigIO('/tmp/.wrongstack/config.json');
      const providers = { test: { type: 'test' } };
      await io.save(providers);
      expect(mockSaveProviders).toHaveBeenCalledWith(
        '/tmp/.wrongstack/config.json',
        expect.any(Object),
        providers,
      );
    });
  });
});
