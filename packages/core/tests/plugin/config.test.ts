import { describe, expect, it } from 'vitest';
import {
  diffPluginConfig,
  redactPluginConfig,
  resolvePluginConfig,
  validatePluginConfigMetadata,
} from '../../src/plugin/config.js';

describe('canonical plugin configuration', () => {
  it('uses one deterministic precedence order across legacy, entries, aliases, and extensions', () => {
    const result = resolvePluginConfig({
      name: 'telegram',
      aliases: ['@wrongstack/telegram'],
      defaults: { source: 'default', retained: true },
      config: {
        plugins: [{ name: '@wrongstack/telegram', options: { source: 'entry', entryOnly: true } }],
        extensions: {
          '@wrongstack/telegram': { source: 'alias-extension', aliasOnly: true },
          telegram: { source: 'canonical-extension', canonicalOnly: true },
        },
      },
      explicitOptions: { source: 'explicit' },
    });

    expect(result).toEqual({
      configured: true,
      sources: ['plugin-entry', 'extension', 'explicit-options'],
      options: {
        source: 'explicit',
        retained: true,
        entryOnly: true,
        aliasOnly: true,
        canonicalOnly: true,
      },
    });
  });

  it('keeps the legacy object-map input as a migration source', () => {
    const result = resolvePluginConfig({
      name: 'telegram',
      config: { plugins: { telegram: { botToken: 'legacy' } } as never },
    });
    expect(result.options).toEqual({ botToken: 'legacy' });
    expect(result.sources).toEqual(['legacy-plugin-map']);
  });

  it('classifies changes and redacts secret values', () => {
    const fields = {
      token: { lifecycle: 'restart', secret: true },
      interval: { lifecycle: 'hot' },
    } as const;
    expect(
      diffPluginConfig(
        { token: 'old', interval: 1, undeclared: false },
        { token: 'new', interval: 2, undeclared: true },
        fields,
      ),
    ).toEqual([
      {
        key: 'token',
        lifecycle: 'restart',
        secret: true,
        previous: '[REDACTED]',
        next: '[REDACTED]',
      },
      { key: 'interval', lifecycle: 'hot', secret: false, previous: 1, next: 2 },
      { key: 'undeclared', lifecycle: 'immutable', secret: false, previous: false, next: true },
    ]);
    expect(redactPluginConfig({ token: 'secret', interval: 2 }, fields)).toEqual({
      token: '[REDACTED]',
      interval: 2,
    });
  });

  it('reports schema/default fields missing opted-in lifecycle metadata', () => {
    expect(
      validatePluginConfigMetadata({
        configSchema: { properties: { token: { type: 'string' }, interval: { type: 'number' } } },
        defaultConfig: { interval: 2, extra: true },
        configFields: { token: { lifecycle: 'restart', secret: true } },
      }),
    ).toEqual([
      'missing configFields metadata for "interval"',
      'missing configFields metadata for "extra"',
    ]);
  });
});
