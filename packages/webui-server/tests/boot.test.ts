import { describe, it, expect, vi } from 'vitest';

const mockBootConfig = vi.hoisted(() => vi.fn());
vi.mock('@wrongstack/core', () => ({
  bootConfig: mockBootConfig,
}));

import { bootConfig, patchConfig } from '../src/server/boot.js';

describe('boot', () => {
  describe('bootConfig', () => {
    it('calls core bootConfig with WebUI label and returns result', async () => {
      const mockResult = {
        config: { yolo: false },
        vault: {} as any,
        globalConfigPath: '/tmp/config.json',
        projectRoot: '/tmp/project',
        wpaths: {} as any,
        logger: {} as any,
      };
      mockBootConfig.mockResolvedValue(mockResult);

      const result = await bootConfig();

      expect(mockBootConfig).toHaveBeenCalledWith({ appLabel: 'WebUI' });
      expect(result).toEqual(mockResult);
    });
  });

  describe('patchConfig', () => {
    it('returns a frozen merged config', () => {
      const config = { yolo: false, autonomy: { defaultMode: 'off' } };
      const patched = patchConfig(config as any, { yolo: true } as any);

      expect(patched.yolo).toBe(true);
      expect(patched.autonomy).toEqual({ defaultMode: 'off' });
      expect(Object.isFrozen(patched)).toBe(true);
    });

    it('does not mutate the original config', () => {
      const config = { yolo: false };
      const patched = patchConfig(config as any, { yolo: true } as any);

      expect(config.yolo).toBe(false);
      expect(patched.yolo).toBe(true);
    });
  });
});
