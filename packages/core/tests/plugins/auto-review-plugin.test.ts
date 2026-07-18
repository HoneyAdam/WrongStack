import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChimeraReviewNeededPayload, SlashCommand } from '../../src/index.js';
import {
  createAutoReviewPlugin,
  DEFAULT_REVIEW_FALLBACK_MODELS,
  resolveAutoReviewConfig,
} from '../../src/plugins/auto-review-plugin.js';
import type { Config } from '../../src/types/config.js';

let tmp: string;

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir });
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
    // The primary session model is never listed as its own fallback.
    expect(resolved.fallbackModels).not.toContain('session-provider/session-model');
    // The injected chain is exactly the shared default set.
    expect(resolved.fallbackModels).toEqual([...DEFAULT_REVIEW_FALLBACK_MODELS]);
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
