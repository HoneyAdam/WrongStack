import { describe, expect, it, vi } from 'vitest';
import type { BrainDecisionRequest } from '../../src/coordination/brain.js';
import {
  type BrainRuntimeLedgerHost,
  type BrainRuntimeOptions,
  createBrainRuntime,
  resolveBrainConfigDefaults,
} from '../../src/execution/brain-runtime.js';
import type { BrainConfig } from '../../src/types/config.js';
import type { Provider } from '../../src/types/provider.js';

const req = (over: Partial<BrainDecisionRequest> = {}): BrainDecisionRequest => ({
  id: 'r1',
  source: 'system',
  question: 'Should we continue?',
  risk: 'medium',
  fallback: 'ask_human',
  ...over,
});

function fakeProvider(text: string): Provider {
  return {
    id: 'fake',
    capabilities: {},
    stream: vi.fn(),
    complete: vi.fn(async () => ({ content: [{ type: 'text', text }] })),
  } as never as Provider;
}

function baseOpts(
  initialConfig: BrainConfig | undefined,
  over: Partial<BrainRuntimeOptions> = {},
): BrainRuntimeOptions {
  return {
    initialConfig,
    defaultProviderId: 'session-prov',
    sessionProvider: () => fakeProvider('session says: Continue.'),
    sessionModel: () => 'session-model',
    resolveProvider: () => fakeProvider('pool says: Continue.'),
    ...over,
  };
}

describe('createBrainRuntime', () => {
  it('starts on the session model and switches to a new pool via apply() without replacing the arbiter handle', async () => {
    const session = fakeProvider('Continue execution.');
    const poolProvider = fakeProvider('Pool model answer: continue.');
    const resolveProvider = vi.fn(() => poolProvider);
    const rt = createBrainRuntime(
      baseOpts(undefined, { sessionProvider: () => session, resolveProvider }),
    );
    const arbiterBefore = rt.arbiter;

    expect(rt.getSnapshot().usingSessionModel).toBe(true);
    await rt.arbiter.decide(req());
    expect(session.complete).toHaveBeenCalled();

    const { snapshot } = rt.apply({ models: ['prov-a/model-a'] }, { persist: false });
    expect(rt.arbiter).toBe(arbiterBefore);
    expect(snapshot.usingSessionModel).toBe(false);
    expect(snapshot.poolLabels).toEqual(['prov-a/model-a']);

    await rt.arbiter.decide(req({ id: 'r2' }));
    expect(poolProvider.complete).toHaveBeenCalled();
  });

  it('normalizes string refs and reports resolved pool labels', () => {
    const rt = createBrainRuntime(baseOpts(undefined));
    const { snapshot } = rt.apply(
      { models: ['prov-a/model-a', 'bare-model', { provider: 'prov-b', model: 'model-b' }] },
      { persist: false },
    );
    expect(snapshot.models).toEqual([
      { provider: 'prov-a', model: 'model-a' },
      { model: 'bare-model' },
      { provider: 'prov-b', model: 'model-b' },
    ]);
    expect(snapshot.poolLabels).toEqual([
      'prov-a/model-a',
      'session-prov/bare-model',
      'prov-b/model-b',
    ]);
  });

  it('rejects invalid patches atomically (state unchanged, error thrown)', () => {
    const rt = createBrainRuntime(baseOpts({ maxAutoRisk: 'high' }));
    expect(() => rt.apply({ models: ['   '] }, { persist: false })).toThrow(/Invalid model ref/);
    expect(() => rt.apply({ council: { quorum: 3 } }, { persist: false })).toThrow(/quorum/);
    expect(() => rt.apply({ maxAutoRisk: 'extreme' as never }, { persist: false })).toThrow(
      /Invalid maxAutoRisk/,
    );
    const snap = rt.getSnapshot();
    expect(snap.maxAutoRisk).toBe('high');
    expect(snap.models).toEqual([]);
  });

  it('council convenes/dissolves via apply and snapshot reports EFFECTIVE enablement', () => {
    const rt = createBrainRuntime(baseOpts(undefined));
    expect(rt.getSnapshot().council.enabled).toBe(false);

    // 2+ pool models → council auto-derives.
    let snap = rt.apply({ models: ['a/x', 'b/y'] }, { persist: false }).snapshot;
    expect(snap.council.enabled).toBe(true);
    expect(snap.council.configured).toBeUndefined();
    expect(snap.councilLabels).toEqual(['a/x (executor)', 'b/y (skeptic, veto)']);

    // Explicit disable pins it off despite the pool.
    snap = rt.apply({ council: { enabled: false } }, { persist: false }).snapshot;
    expect(snap.council.enabled).toBe(false);
    expect(snap.council.configured).toBe(false);

    // Explicit voters with persona/veto/weight survive normalization.
    snap = rt.apply(
      {
        council: {
          enabled: true,
          voters: ['a/x', { provider: 'b', model: 'y', persona: 'auditor', veto: true, weight: 2 }],
          minRisk: 'medium',
        },
      },
      { persist: false },
    ).snapshot;
    expect(snap.council.enabled).toBe(true);
    expect(snap.council.minRisk).toBe('medium');
    expect(snap.council.voters[1]).toEqual({
      provider: 'b',
      model: 'y',
      persona: 'auditor',
      veto: true,
      weight: 2,
    });
  });

  it('fast-path keys (mode/maxAutoRisk/humanTimeoutMs) do not rebuild the chain', () => {
    const resolveProvider = vi.fn(() => fakeProvider('p'));
    const rt = createBrainRuntime(baseOpts({ models: ['a/x'] }, { resolveProvider }));
    const callsAfterBoot = resolveProvider.mock.calls.length;
    expect(callsAfterBoot).toBeGreaterThan(0);

    rt.apply({ mode: 'headless' }, { persist: false });
    rt.apply({ maxAutoRisk: 'all' }, { persist: false });
    rt.apply({ humanTimeoutMs: 60_000 }, { persist: false });
    expect(resolveProvider.mock.calls.length).toBe(callsAfterBoot);
    expect(rt.getMode()).toBe('headless');
    expect(rt.getMaxAutoRisk()).toBe('all');
    expect(rt.getHumanTimeoutMs()).toBe(60_000);

    // A structural key DOES rebuild.
    rt.apply({ strategy: 'round-robin' }, { persist: false });
    expect(resolveProvider.mock.calls.length).toBeGreaterThan(callsAfterBoot);
  });

  it('persists the canonical compact config by default and reports persist failures without rollback', async () => {
    const persist = vi.fn(async () => {});
    const rt = createBrainRuntime(baseOpts(undefined, { persist }));

    const { persisted } = rt.apply({
      models: ['prov-a/model-a', 'bare-model'],
      council: { voters: [{ provider: 'b', model: 'y', veto: true }], judge: 'prov-a/model-a' },
      decisionTimeoutMs: 20_000,
    });
    expect(await persisted).toEqual({ ok: true });
    expect(persist).toHaveBeenCalledTimes(1);
    const written = persist.mock.calls[0]?.[0] as BrainConfig;
    expect(written.models).toEqual(['prov-a/model-a', 'bare-model']);
    expect(written.council?.voters).toEqual([{ provider: 'b', model: 'y', veto: true }]);
    expect(written.council?.judge).toBe('prov-a/model-a');
    expect(written.decisionTimeoutMs).toBe(20_000);

    persist.mockRejectedValueOnce(new Error('disk full'));
    const second = rt.apply({ maxAutoRisk: 'high' });
    expect(await second.persisted).toEqual({ ok: false, error: 'disk full' });
    // Live state kept despite persist failure.
    expect(rt.getMaxAutoRisk()).toBe('high');
  });

  it('skips persistence when persist:false or no callback is wired', async () => {
    const persist = vi.fn(async () => {});
    const rt = createBrainRuntime(baseOpts(undefined, { persist }));
    expect(await rt.apply({ mode: 'headless' }, { persist: false }).persisted).toEqual({
      ok: true,
    });
    expect(persist).not.toHaveBeenCalled();

    const noCb = createBrainRuntime(baseOpts(undefined));
    expect(await noCb.apply({ mode: 'headless' }).persisted).toEqual({ ok: true });
  });

  it('gates ledger guard and digest injection on the host ledger enablement', async () => {
    let enabled = true;
    const digest = vi.fn(() => 'past outcomes digest');
    const ledger: BrainRuntimeLedgerHost = {
      getPath: () => 'C:/tmp/brain-ledger.jsonl',
      isEnabled: () => enabled,
      setEnabled: vi.fn((on: boolean) => {
        enabled = on;
      }),
      failureStreakFor: () => 5,
      getDecisionDigest: digest,
    };
    const rt = createBrainRuntime(baseOpts({ ledger: { autoDenyAfterFailures: 3 } }, { ledger }));

    // Streak 5 >= denyAfter 3 → deterministic deny, no LLM.
    const denied = await rt.arbiter.decide(req());
    expect(denied).toMatchObject({ type: 'deny' });
    expect((denied as { reason: string }).reason).toMatch(/Ledger guard/);

    // Disable via apply → host toggled, guard dropped from the chain.
    const { snapshot } = rt.apply({ ledger: { enabled: false } }, { persist: false });
    expect(ledger.setEnabled).toHaveBeenCalledWith(false);
    expect(snapshot.ledger.enabled).toBe(false);
    const after = await rt.arbiter.decide(
      req({ id: 'r3', fallback: 'continue', question: 'plain continue?' }),
    );
    expect(after.type).not.toBe('deny');
  });

  it('onApplied fires with the fresh snapshot after every apply', () => {
    const onApplied = vi.fn();
    const rt = createBrainRuntime(baseOpts(undefined, { onApplied }));
    rt.apply({ humanTimeoutMs: 5_000 }, { persist: false });
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied.mock.calls[0]?.[0]).toMatchObject({ humanTimeoutMs: 5_000 });
  });

  it('drops invalid boot-config entries leniently instead of failing construction', () => {
    const rt = createBrainRuntime(
      baseOpts({
        models: ['good/x', '   ', { model: '' } as never],
        council: { judge: '  ' },
      }),
    );
    const snap = rt.getSnapshot();
    expect(snap.models).toEqual([{ provider: 'good', model: 'x' }]);
    expect(snap.council.judge).toBeUndefined();
  });
});

describe('resolveBrainConfigDefaults', () => {
  it('fills minimum-human defaults on an empty config (no pool → conservative ceiling)', () => {
    const cfg = resolveBrainConfigDefaults(undefined);
    expect(cfg.mode).toBe('headless');
    expect(cfg.maxAutoRisk).toBe('high');
    expect(cfg.humanTimeoutMs).toBe(120_000);
    expect(cfg.models).toBeUndefined();
  });

  it('seeds the pool from fallbackModels and raises the ceiling when a council can convene', () => {
    const cfg = resolveBrainConfigDefaults(undefined, {
      fallbackModels: ['prov-a/model-a', 'prov-b/model-b'],
    });
    expect(cfg.models).toEqual(['prov-a/model-a', 'prov-b/model-b']);
    // 2 pool models → council auto-derives → critical goes to the panel.
    expect(cfg.maxAutoRisk).toBe('all');
  });

  it('keeps the ceiling at high with a single fallback model (no council possible)', () => {
    const cfg = resolveBrainConfigDefaults(undefined, { fallbackModels: ['prov-a/model-a'] });
    expect(cfg.models).toEqual(['prov-a/model-a']);
    expect(cfg.maxAutoRisk).toBe('high');
  });

  it('never overrides explicit values', () => {
    const cfg = resolveBrainConfigDefaults(
      {
        mode: 'interactive',
        maxAutoRisk: 'medium',
        models: [],
        humanTimeoutMs: 0,
      },
      { fallbackModels: ['prov-a/model-a', 'prov-b/model-b'] },
    );
    expect(cfg.mode).toBe('interactive');
    expect(cfg.maxAutoRisk).toBe('medium');
    // Explicit empty pool is respected (session model), not reseeded.
    expect(cfg.models).toEqual([]);
    // Explicit 0 = legacy wait-indefinitely escape hatch.
    expect(cfg.humanTimeoutMs).toBe(0);
  });

  it('respects explicit council toggles when picking the adaptive ceiling', () => {
    // Big pool but council pinned OFF → conservative ceiling.
    const off = resolveBrainConfigDefaults(
      { council: { enabled: false } },
      { fallbackModels: ['a/x', 'b/y', 'c/z'] },
    );
    expect(off.maxAutoRisk).toBe('high');
    // No pool but explicit voters → council convenes → full ceiling.
    const voters = resolveBrainConfigDefaults({
      council: { voters: ['a/x', 'b/y'] },
    });
    expect(voters.maxAutoRisk).toBe('all');
  });

  it('feeds createBrainRuntime: fallback-seeded pool resolves and derives the council', () => {
    const resolveProvider = vi.fn(() => fakeProvider('ok'));
    const rt = createBrainRuntime(
      baseOpts(
        resolveBrainConfigDefaults(undefined, {
          fallbackModels: ['prov-a/model-a', 'prov-b/model-b'],
        }),
        { resolveProvider },
      ),
    );
    const snap = rt.getSnapshot();
    expect(snap.mode).toBe('headless');
    expect(snap.maxAutoRisk).toBe('all');
    expect(snap.poolLabels).toEqual(['prov-a/model-a', 'prov-b/model-b']);
    expect(snap.council.enabled).toBe(true);
    expect(snap.councilLabels).toEqual([
      'prov-a/model-a (executor)',
      'prov-b/model-b (skeptic, veto)',
    ]);
  });
});
