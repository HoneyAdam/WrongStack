import { describe, expect, it } from 'vitest';
import { FallbackProfileManager } from '../src/core/fallback-profile-manager.js';
import type { Config } from '../src/types/config.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    provider: 'openai',
    model: 'gpt-4o',
    providers: {
      openai: {
        apiKey: 'sk-test',
        models: ['gpt-4o', 'gpt-4o-mini'],
      },
      anthropic: {
        apiKey: 'sk-ant-test',
        models: ['claude-opus-4-8', 'claude-sonnet-4-8'],
      },
      unkeyed: {
        models: ['some-model'],
      },
    },
    fallbackProfiles: {
      'primary-failover': [
        'anthropic/claude-opus-4-8',
        'openai/gpt-4o-mini',
      ],
      'cross-provider': [
        'anthropic/claude-sonnet-4-8',
        '/gpt-4o-mini',
      ],
      'empty-chain': [],
      'self-ref': [
        'openai/gpt-4o',
        'anthropic/claude-opus-4-8',
      ],
    },
    ...overrides,
  } as unknown as Config;
}

describe('FallbackProfileManager', () => {
  it('resolves a named profile to resolved entries', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    const chain = mgr.resolve('primary-failover');

    expect(chain).toHaveLength(2);
    expect(chain[0]?.providerId).toBe('anthropic');
    expect(chain[0]?.model).toBe('claude-opus-4-8');
    expect(chain[0]?.providerSwitched).toBe(true);
    expect(chain[1]?.providerId).toBe('openai');
    expect(chain[1]?.model).toBe('gpt-4o-mini');
  });

  it('resolves entries regardless of provider API key (key check is caller responsibility)', () => {
    const mgr = new FallbackProfileManager(
      makeConfig({
        fallbackProfiles: {
          'no-key-test': ['unkeyed/some-model', 'anthropic/claude-opus-4-8'],
        },
      }),
    );
    const chain = mgr.resolve('no-key-test');
    // Both entries included — resolve() does NOT filter by API key
    // (matching fallbackProfileChain() behavior); key gating is the
    // caller's responsibility via buildProvider.
    expect(chain).toHaveLength(2);
  });

  it('filters out self-reference exclude', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    const chain = mgr.resolve('self-ref', {
      exclude: { providerId: 'openai', model: 'gpt-4o' },
    });
    // openai/gpt-4o is excluded → only anthropic remains
    expect(chain).toHaveLength(1);
    expect(chain[0]?.providerId).toBe('anthropic');
  });

  it('deduplicates entries in a profile', () => {
    const mgr = new FallbackProfileManager(
      makeConfig({
        fallbackProfiles: {
          'dupes': ['anthropic/claude-opus-4-8', 'anthropic/claude-opus-4-8'],
        },
      }),
    );
    const chain = mgr.resolve('dupes');
    expect(chain).toHaveLength(1);
  });

  it('returns empty chain for unknown profile', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    expect(mgr.resolve('does-not-exist')).toHaveLength(0);
  });

  it('returns empty chain for empty profile', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    expect(mgr.resolve('empty-chain')).toHaveLength(0);
  });

  it('lists known profile names', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    const names = mgr.listProfiles();
    expect(names).toContain('primary-failover');
    expect(names).toContain('cross-provider');
    expect(names).not.toContain('does-not-exist');
  });

  it('reload returns a new instance with updated config', () => {
    const oldCfg = makeConfig({ fallbackProfiles: { old: ['anthropic/claude-opus-4-8'] } });
    const newCfg = makeConfig({ fallbackProfiles: { new: ['openai/gpt-4o-mini'] } });
    const mgr = new FallbackProfileManager(oldCfg);
    expect(mgr.hasProfile('old')).toBe(true);
    expect(mgr.hasProfile('new')).toBe(false);

    const reloaded = mgr.reload(newCfg);
    expect(reloaded.hasProfile('old')).toBe(false);
    expect(reloaded.hasProfile('new')).toBe(true);
    // Original is unchanged
    expect(mgr.hasProfile('old')).toBe(true);
  });

  it('checks provider availability', () => {
    const mgr = new FallbackProfileManager(makeConfig());
    const openai = mgr.checkProvider('openai');
    expect(openai.hasKey).toBe(true);
    expect(openai.hasModels).toBe(true);

    const unknown = mgr.checkProvider('does-not-exist');
    expect(unknown.hasKey).toBe(false);

    const unkeyed = mgr.checkProvider('unkeyed');
    expect(unkeyed.hasKey).toBe(false);
    expect(unkeyed.hasModels).toBe(true);
  });

  describe('resolveEffective', () => {
    it('uses explicit fallbackModels first', () => {
      const mgr = new FallbackProfileManager(makeConfig());
      const chain = mgr.resolveEffective({
        fallbackModels: ['anthropic/claude-opus-4-8'],
        fallbackProfile: 'primary-failover',
      });
      expect(chain).toHaveLength(1);
      expect(chain[0]?.providerId).toBe('anthropic');
    });

    it('falls back to named profile when no explicit models', () => {
      const mgr = new FallbackProfileManager(makeConfig());
      const chain = mgr.resolveEffective({
        fallbackProfile: 'primary-failover',
      });
      expect(chain).toHaveLength(2);
    });

    it('returns smart default when nothing explicit set', () => {
      const mgr = new FallbackProfileManager(makeConfig());
      const chain = mgr.resolveEffective({});
      // openai/gpt-4o-mini (same provider) + anthropic entries (cross-provider)
      // leader openai has gpt-4o-mini as alternative
      // anthropic has claude-opus-4-8 and claude-sonnet-4-8
      expect(chain.length).toBeGreaterThanOrEqual(1);
      // First should be same-provider
      expect(chain[0]?.providerId).toBe('openai');
    });

    it('returns empty when fallbackAuto is false and nothing explicit', () => {
      const mgr = new FallbackProfileManager(makeConfig());
      const chain = mgr.resolveEffective({ fallbackAuto: false });
      expect(chain).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('handles empty config with no providers', () => {
      const mgr = new FallbackProfileManager({} as Config);
      expect(mgr.resolve('anything')).toHaveLength(0);
      expect(mgr.listProfiles()).toHaveLength(0);
      expect(mgr.checkProvider('x').hasKey).toBe(false);
    });

    it('handles provider with env var key', () => {
      process.env['FALLBACK_TEST_KEY'] = 'sk-test';
      try {
        const cfg = makeConfig({
          providers: {
            envProvider: {
              envVars: ['FALLBACK_TEST_KEY'],
              models: ['test-model'],
            },
          } as Record<string, unknown>,
        });
        // Re-craft to avoid TS strictness
        cfg.providers = {
          openai: { apiKey: 'sk-test', models: ['gpt-4o'] },
          envProvider: { envVars: ['FALLBACK_TEST_KEY'], models: ['test-model'] } as any,
        };
        const mgr = new FallbackProfileManager(cfg);
        const avail = mgr.checkProvider('envProvider');
        expect(avail.hasKey).toBe(true);
      } finally {
        delete process.env['FALLBACK_TEST_KEY'];
      }
    });

    it('excludes models not in provider allow-list', () => {
      const cfg = makeConfig({
        providers: {
          limited: { apiKey: 'sk-test', models: ['allowed-model'] },
        },
        fallbackProfiles: {
          'restricted': ['limited/allowed-model', 'limited/blocked-model'],
        },
      });
      const mgr = new FallbackProfileManager(cfg);
      const chain = mgr.resolve('restricted');
      expect(chain).toHaveLength(1);
      expect(chain[0]?.model).toBe('allowed-model');
    });
  });
});
