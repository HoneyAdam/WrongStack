import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChimeraReviewNeededPayload, SlashCommand } from '../../src/index.js';
import {
  createAutoReviewPlugin,
  type AutoReviewConfig,
  DEFAULT_REVIEW_FALLBACK_MODELS,
  resolveAutoReviewConfig,
} from '../../src/plugins/auto-review-plugin.js';
import type { Config } from '../../src/types/config.js';

let tmp: string;

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'auto-review@example.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'auto-review test'], { cwd: dir });
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

function makeApi(autoReviewConfig: Record<string, unknown> = {}) {
  const events: Record<string, (payload?: { ctx?: { todos?: never[] } }) => Promise<void>> = {};
  const registered: SlashCommand[] = [];
  const emitCustom = vi.fn();
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const api = {
    config: {
      provider: 'test-provider',
      model: 'test-model',
      cwd: tmp,
      extensions: {
        'wstack-auto-review': {
          enabled: true,
          debounceMs: 0,
          maxConcurrentReviews: 10,
          ...autoReviewConfig,
        },
      },
    },
    onConfigChange: vi.fn(),
    onEvent: (type: string, handler: (payload?: { ctx?: { todos?: never[] } }) => Promise<void>) => {
      events[type] = handler;
    },
    onPattern: vi.fn(),
    emitCustom,
    slashCommands: {
      register: (command: SlashCommand) => registered.push(command),
      unregister: vi.fn(),
    },
    log,
  } as never;

  return { api, events, emitCustom, log, registered };
}

function reviewPayloads(emitCustom: ReturnType<typeof vi.fn>): ChimeraReviewNeededPayload[] {
  return emitCustom.mock.calls
    .filter(([event]) => event === 'chimera.review_needed')
    .map(([, payload]) => payload as ChimeraReviewNeededPayload);
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-review-'));
  gitInit(tmp);
  await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 1;\n');
  commitAll(tmp, 'initial');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('auto-review change detection', () => {
  it('reviews later content edits even when the porcelain status remains modified', async () => {
    const { api, events, emitCustom } = makeApi();
    createAutoReviewPlugin().setup!(api);
    await events['agent.run.started']!();

    await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 2;\n');
    await events['iteration.completed']!();
    await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 3;\n');
    await events['iteration.completed']!();

    const payloads = reviewPayloads(emitCustom);
    expect(payloads).toHaveLength(2);
    expect(payloads[0]!.files[0]).toMatchObject({
      path: 'tracked.ts',
      status: 'modified',
      content: 'export const value = 2;\n',
    });
    expect(payloads[1]!.files[0]).toMatchObject({
      path: 'tracked.ts',
      status: 'modified',
      content: 'export const value = 3;\n',
    });
  });

  it('retains the latest debounced snapshot until a later eligible iteration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { api, events, emitCustom, log } = makeApi({ debounceMs: 5_000 });
    createAutoReviewPlugin().setup!(api);
    await events['agent.run.started']!();

    await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 2;\n');
    await events['iteration.completed']!();

    vi.setSystemTime(101_000);
    await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 3;\n');
    await events['iteration.completed']!();
    expect(reviewPayloads(emitCustom)).toHaveLength(1);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('retaining 1 pending file'));

    vi.setSystemTime(106_000);
    await events['iteration.completed']!();

    const payloads = reviewPayloads(emitCustom);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]!.files[0]?.content).toBe('export const value = 3;\n');
  });

  it('never reads or includes untracked files in a review bundle', async () => {
    const { api, events, emitCustom } = makeApi();
    createAutoReviewPlugin().setup!(api);
    await events['agent.run.started']!();

    await fs.writeFile(path.join(tmp, 'tracked.ts'), 'export const value = 2;\n');
    await fs.writeFile(path.join(tmp, '.env.local'), 'PRIVATE_TOKEN=do-not-send\n');
    await events['iteration.completed']!();

    const [payload] = reviewPayloads(emitCustom);
    expect(payload?.files.map((file) => file.path)).toEqual(['tracked.ts']);
    expect(payload?.allChangedFiles?.map((file) => file.path)).not.toContain('.env.local');
    expect(JSON.stringify(payload)).not.toContain('PRIVATE_TOKEN');
  });
});

describe('resolveAutoReviewConfig — empty/unknown fallbackProfile', () => {
  // A minimal session Config with a healthy session provider/model but NO
  // fallbackProfiles map, so any profile name resolves to an empty chain.
  function sessionConfig(overrides: Partial<Config> = {}): Config {
    return {
      provider: 'session-provider',
      model: 'session-model',
      ...overrides,
    } as Config;
  }

  it('falls through to the session provider/model when the profile does not exist', () => {
    // An unknown profile name → FallbackProfileManager.resolve returns an empty
    // chain (no throw, no default), so the reviewer inherits the session model.
    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'does-not-exist' },
      sessionConfig(),
    );

    expect(resolved.provider).toBe('session-provider');
    expect(resolved.model).toBe('session-model');
  });

  it('injects the default rotation chain (never empty) for an unknown profile', () => {
    // Root-cause guard for chimera-review `provider_auth` (1 iter / 0 tools)
    // failures: the resolver now injects DEFAULT_REVIEW_FALLBACK_MODELS when the
    // profile resolves empty, so the reviewer is never spawned against the bare
    // session model with nothing to fall back to. The safety net lives at the
    // resolver level so no downstream spawn path can bypass it.
    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'does-not-exist' },
      sessionConfig(),
    );

    expect(resolved.fallbackModels.length).toBeGreaterThan(0);
    // The shared defaults rotate first, followed by the known-working session
    // model as the absolute last resort.
    expect(resolved.fallbackModels).toEqual([
      ...DEFAULT_REVIEW_FALLBACK_MODELS,
      'session-provider/session-model',
    ]);
  });

  it('never emits a blank model string that a provider would 401 as "Model is not supported"', () => {
    // Shadow Agent observed opencode-go returning 401 "Model is not supported"
    // for an empty model string. Guard that resolveAutoReviewConfig never yields
    // an empty/whitespace model even on the empty-profile fallthrough path.
    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: '' },
      sessionConfig(),
    );

    expect(resolved.model.trim().length).toBeGreaterThan(0);
    expect(resolved.provider.trim().length).toBeGreaterThan(0);
  });

  it('honors an explicit provider/model override even when the profile is unknown', () => {
    // When the config sets provider/model directly, the empty profile must not
    // override them — this is the safe configuration path.
    const resolved = resolveAutoReviewConfig(
      {
        enabled: true,
        provider: 'explicit-provider',
        model: 'explicit-model',
        fallbackProfile: 'does-not-exist',
      },
      sessionConfig(),
    );

    expect(resolved.provider).toBe('explicit-provider');
    expect(resolved.model).toBe('explicit-model');
  });
});

describe('resolveAutoReviewConfig — session last-resort fallback', () => {
  function sessionConfig(overrides: Partial<Config> = {}): Config {
    return {
      provider: 'session-provider',
      model: 'session-model',
      ...overrides,
    } as Config;
  }

  it('appends the session provider/model as the last fallback when profile is empty', () => {
    // When no fallbackProfile is set and resolveEffective returns [], the
    // DEFAULT_REVIEW_FALLBACK_MODELS safety net kicks in. The session's own
    // provider/model must be the FINAL entry so the reviewer always has a
    // known-working target as absolute last resort.
    const resolved = resolveAutoReviewConfig(
      { enabled: true },
      sessionConfig(),
    );

    const fallbacks = resolved.fallbackModels;
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[fallbacks.length - 1]).toBe('session-provider/session-model');
  });

  it('appends the session provider/model as the last fallback when profile is unknown', () => {
    // Same as above but triggered by an unknown profile name.
    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'does-not-exist' },
      sessionConfig(),
    );

    const fallbacks = resolved.fallbackModels;
    expect(fallbacks.length).toBeGreaterThan(0);
    expect(fallbacks[fallbacks.length - 1]).toBe('session-provider/session-model');
  });

  it('does not duplicate the session ref when it is already in the fallback chain', () => {
    // When a valid profile resolves a chain that already includes the session's
    // provider/model, the dedup check must prevent appending it again.
    const cfg: Config = {
      provider: 'profile-p1',
      model: 'profile-m1',
      fallbackProfiles: {
        good: ['alt-provider/alt-model', 'session-provider/session-model'],
      },
      providers: {
        'alt-provider': { baseUrl: 'http://alt.test', models: ['alt-model'] },
        'session-provider': {
          baseUrl: 'http://session.test',
          models: ['session-model'],
        },
      },
    } as Config;

    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'good' },
      cfg,
    );

    const fallbacks = resolved.fallbackModels;
    expect(fallbacks.filter((ref) => ref === 'session-provider/session-model')).toHaveLength(1);
  });

  it('appends the session ref when the profile chain has entries but none match the session', () => {
    // Profile resolves to models that don't include the session's own
    // provider/model → the session ref must be appended as last entry.
    const cfg: Config = {
      provider: 'session-provider',
      model: 'session-model',
      fallbackProfiles: {
        alt: ['alt-provider/alt-model'],
      },
      providers: {
        'alt-provider': { baseUrl: 'http://alt.test', models: ['alt-model'] },
      },
    } as Config;

    const resolved = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'alt' },
      cfg,
    );

    const fallbacks = resolved.fallbackModels;
    expect(fallbacks[fallbacks.length - 1]).toBe('session-provider/session-model');
  });

  it('never allows an empty fallbackModels array', () => {
    // Every code path must guarantee at least one fallback entry, ensuring
    // the reviewer always has a rotation target.
    const emptyConfig: Config = { provider: 'p', model: 'm' } as Config;
    const resolved = resolveAutoReviewConfig({ enabled: true }, emptyConfig);
    expect(resolved.fallbackModels.length).toBeGreaterThan(0);

    const unknownProfile = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: '' },
      emptyConfig,
    );
    expect(unknownProfile.fallbackModels.length).toBeGreaterThan(0);

    const withProfile = resolveAutoReviewConfig(
      { enabled: true, fallbackProfile: 'nonexistent' },
      emptyConfig,
    );
    expect(withProfile.fallbackModels.length).toBeGreaterThan(0);
  });

  it('fallback chain always ends with the session provider/model regardless of config', () => {
    // Comprehensive: test multiple config combinations and verify the session
    // ref is always the last entry in fallbackModels.
    const configs: Array<{ cfg: AutoReviewConfig; session: Config; label: string }> = [
      {
        cfg: { enabled: true },
        session: { provider: 'p1', model: 'm1' } as Config,
        label: 'bare session',
      },
      {
        cfg: { enabled: true, provider: 'explicit-p', model: 'explicit-m' },
        session: { provider: 'p2', model: 'm2' } as Config,
        label: 'explicit provider/model',
      },
      {
        cfg: { enabled: true, fallbackProfile: 'unknown' },
        session: { provider: 'p3', model: 'm3' } as Config,
        label: 'unknown profile',
      },
      {
        cfg: { enabled: true, provider: 'ep', model: 'em', fallbackProfile: 'u' },
        session: { provider: 'p4', model: 'm4' } as Config,
        label: 'explicit + unknown profile',
      },
    ];

    for (const { cfg, session, label } of configs) {
      const resolved = resolveAutoReviewConfig(cfg, session);
      const fallbacks = resolved.fallbackModels;
      expect(
        fallbacks[fallbacks.length - 1],
        `[${label}] last fallback should be the session provider/model`,
      ).toBe(`${session.provider}/${session.model}`);
    }
  });
});
