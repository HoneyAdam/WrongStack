import { describe, expect, it } from 'vitest';
import { createPrefsSeeding } from '../../src/webui-server/prefs-seeding.js';

describe('createPrefsSeeding', () => {
  it('updates live app config prefs without mutating a frozen config object', async () => {
    const frozenConfig = Object.freeze({});
    const opts = {
      agent: { ctx: { meta: {} } },
      appConfig: frozenConfig,
    } as never;

    const { persistPrefs } = createPrefsSeeding(opts);

    await expect(
      persistPrefs({
        fallbackProfiles: { default: ['anthropic/claude-sonnet-4'] },
      }),
    ).resolves.toBeUndefined();
    expect((opts as { appConfig: unknown }).appConfig).not.toBe(frozenConfig);
    expect((opts as { appConfig: { fallbackProfiles?: unknown } }).appConfig.fallbackProfiles).toEqual({
      default: ['anthropic/claude-sonnet-4'],
    });
    expect(Object.isExtensible(frozenConfig)).toBe(false);
  });
});
