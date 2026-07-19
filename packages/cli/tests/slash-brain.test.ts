import type {
  BrainArbiter,
  BrainConfigPatch,
  BrainConfigSnapshot,
  BrainDecisionRequest,
  BrainRuntime,
} from '@wrongstack/core';
import { describe, expect, it, vi } from 'vitest';
import { buildBrainCommand } from '../src/slash-commands/brain.js';
import type { SlashCommandContext } from '../src/slash-commands/index.js';

// Strip ANSI escapes so message assertions match regardless of color.
const stripAnsi = (s: string): string => s.replace(/\[[0-9;]*m/g, '');

const makeCtx = (overrides: Partial<SlashCommandContext> = {}): SlashCommandContext => {
  const write = vi.fn();
  const writeWarning = vi.fn();
  return {
    renderer: { write, writeWarning } as never as SlashCommandContext['renderer'],
    ...overrides,
  } as never as SlashCommandContext;
};

describe('/brain slash command', () => {
  it('reports name, category and help text', () => {
    const cmd = buildBrainCommand(makeCtx());
    expect(cmd.name).toBe('brain');
    expect(cmd.category).toBe('Agent');
    expect(cmd.help).toContain('/brain risk');
    expect(cmd.help).toContain('/brain ask');
  });

  describe('status', () => {
    it('shows the current ceiling and an empty-log hint', async () => {
      const ctx = makeCtx({
        brainSettings: { maxAutoRisk: 'medium' },
        getBrainLog: () => [],
      });
      const result = await buildBrainCommand(ctx).run!('');
      const message = stripAnsi(result!.message!);
      expect(message).toContain('autonomy ceiling: medium');
      expect(message).toContain('no decisions recorded');
    });

    it('lists recent decisions newest-last', async () => {
      const now = Date.now();
      const ctx = makeCtx({
        brainSettings: { maxAutoRisk: 'high' },
        getBrainLog: () => [
          { at: now - 5_000, kind: 'answered', question: 'Continue phase 2?', outcome: 'continue' },
          {
            at: now - 1_000,
            kind: 'intervention',
            question: 'Tool edit failing',
            outcome: 'steered the agent',
          },
        ],
      });
      const result = await buildBrainCommand(ctx).run!('status');
      const message = stripAnsi(result!.message!);
      expect(message).toContain('recent decisions (2)');
      expect(message).toContain('Continue phase 2?');
      expect(message).toContain('steered the agent');
    });
  });

  describe('risk', () => {
    it('shows the current ceiling when no level is given', async () => {
      const ctx = makeCtx({ brainSettings: { maxAutoRisk: 'low' } });
      const result = await buildBrainCommand(ctx).run!('risk');
      expect(stripAnsi(result!.message!)).toContain('Brain autonomy ceiling: low');
    });

    it.each([
      'off',
      'low',
      'medium',
      'high',
      'all',
    ] as const)('sets the ceiling to %s in place', async (level) => {
      const settings = { maxAutoRisk: 'medium' as const } as { maxAutoRisk: string };
      const ctx = makeCtx({
        brainSettings: settings as SlashCommandContext['brainSettings'],
      });
      const result = await buildBrainCommand(ctx).run!(`risk ${level}`);
      expect(settings.maxAutoRisk).toBe(level);
      expect(stripAnsi(result!.message!)).toContain(`set to ${level}`);
    });

    it('rejects unknown levels without mutating settings', async () => {
      const settings = { maxAutoRisk: 'medium' as const };
      const ctx = makeCtx({ brainSettings: settings });
      const result = await buildBrainCommand(ctx).run!('risk extreme');
      expect(settings.maxAutoRisk).toBe('medium');
      expect(result?.message).toMatch(/Unknown risk level/);
      expect(ctx.renderer.writeWarning).toHaveBeenCalled();
    });

    it('warns when brainSettings is not wired', async () => {
      const ctx = makeCtx();
      const result = await buildBrainCommand(ctx).run!('risk high');
      expect(result?.message).toMatch(/not available/);
    });
  });

  describe('ask', () => {
    it('consults the brain and returns its answer', async () => {
      const decide = vi.fn(async () => ({
        type: 'answer' as const,
        text: 'Ship it.',
        rationale: 'Tests pass and scope is small.',
      }));
      const ctx = makeCtx({ brain: { decide } as BrainArbiter });
      const result = await buildBrainCommand(ctx).run!('ask should we ship?');
      const message = stripAnsi(result!.message!);
      expect(message).toContain('Ship it.');
      expect(message).toContain('Tests pass and scope is small.');
      const request = decide.mock.calls[0]?.[0] as BrainDecisionRequest;
      expect(request.source).toBe('user');
      expect(request.question).toBe('should we ship?');
      expect(request.fallback).toBe('ask_human');
    });

    it('surfaces denials', async () => {
      const ctx = makeCtx({
        brain: {
          decide: async () => ({ type: 'deny' as const, reason: 'risk too high' }),
        } as BrainArbiter,
      });
      const result = await buildBrainCommand(ctx).run!('ask delete prod db?');
      expect(stripAnsi(result!.message!)).toContain('Denied: risk too high');
    });

    it('explains when the brain escalates back to the human', async () => {
      const ctx = makeCtx({
        brain: {
          decide: async () => ({ type: 'ask_human' as const, prompt: 'You decide.' }),
        } as BrainArbiter,
      });
      const result = await buildBrainCommand(ctx).run!('ask migrate the schema?');
      expect(stripAnsi(result!.message!)).toContain('escalated this question back to you');
    });

    it('requires a question', async () => {
      const ctx = makeCtx({ brain: { decide: vi.fn() } as never as BrainArbiter });
      const result = await buildBrainCommand(ctx).run!('ask');
      expect(result?.message).toMatch(/Usage/);
    });

    it('warns when the brain is not wired', async () => {
      const ctx = makeCtx();
      const result = await buildBrainCommand(ctx).run!('ask anything');
      expect(result?.message).toMatch(/not available/);
    });

    it('reports consultation failures instead of throwing', async () => {
      const ctx = makeCtx({
        brain: {
          decide: async () => {
            throw new Error('provider offline');
          },
        } as BrainArbiter,
      });
      const result = await buildBrainCommand(ctx).run!('ask anything');
      expect(result?.message).toContain('provider offline');
    });
  });

  it('rejects unknown subcommands', async () => {
    const ctx = makeCtx();
    const result = await buildBrainCommand(ctx).run!('frobnicate');
    expect(result?.message).toMatch(/Unknown subcommand/);
  });

  describe('runtime setters', () => {
    const makeFakeRuntime = (over: Partial<BrainConfigSnapshot> = {}) => {
      const patches: BrainConfigPatch[] = [];
      let persistOk = true;
      const snapshot: BrainConfigSnapshot = {
        mode: 'interactive',
        maxAutoRisk: 'medium',
        models: [],
        strategy: 'fallback',
        decisionTimeoutMs: undefined,
        humanTimeoutMs: undefined,
        council: {
          enabled: false,
          configured: undefined,
          minRisk: 'high',
          voters: [],
          quorum: undefined,
          approval: undefined,
          judge: undefined,
        },
        ledger: { enabled: true, autoDenyAfterFailures: undefined, path: 'C:/x/brain-ledger.jsonl' },
        poolLabels: [],
        councilLabels: [],
        usingSessionModel: true,
        ...over,
      };
      const runtime = {
        arbiter: { decide: vi.fn() },
        getMode: () => snapshot.mode,
        getMaxAutoRisk: () => snapshot.maxAutoRisk,
        getHumanTimeoutMs: () => snapshot.humanTimeoutMs,
        getSnapshot: () => snapshot,
        getConfig: () => ({}),
        apply: vi.fn((patch: BrainConfigPatch) => {
          patches.push(patch);
          return {
            snapshot,
            persisted: Promise.resolve(
              persistOk ? { ok: true } : { ok: false, error: 'disk full' },
            ),
          };
        }),
      } as unknown as BrainRuntime;
      return {
        runtime,
        patches,
        setPersistOk: (v: boolean) => {
          persistOk = v;
        },
      };
    };

    it('/brain model <ref> replaces the pool with one entry and reports persistence', async () => {
      const { runtime, patches } = makeFakeRuntime({ poolLabels: ['prov/x'] });
      const ctx = makeCtx({ brainRuntime: runtime });
      const result = await buildBrainCommand(ctx).run!('model prov/x');
      expect(patches).toEqual([{ models: ['prov/x'] }]);
      const message = stripAnsi(result!.message!);
      expect(message).toContain('prov/x');
      expect(message).toContain('saved to the active profile config');
    });

    it('/brain model session clears the pool', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('model session');
      expect(patches).toEqual([{ models: null }]);
    });

    it('/brain models <refs> replaces the ordered pool', async () => {
      const { runtime, patches } = makeFakeRuntime({ poolLabels: ['a/x', 'b/y'] });
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('models a/x b/y');
      expect(patches).toEqual([{ models: ['a/x', 'b/y'] }]);
    });

    it('/brain models add appends to the current pool', async () => {
      const { runtime, patches } = makeFakeRuntime({
        models: [{ provider: 'a', model: 'x' }],
        poolLabels: ['a/x'],
      });
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('models add new/z');
      expect(patches).toEqual([{ models: ['a/x', 'new/z'] }]);
    });

    it('/brain models remove <index> drops the 1-based entry', async () => {
      const { runtime, patches } = makeFakeRuntime({
        models: [
          { provider: 'a', model: 'x' },
          { provider: 'b', model: 'y' },
        ],
        poolLabels: ['a/x', 'b/y'],
      });
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('models remove 1');
      expect(patches).toEqual([{ models: ['b/y'] }]);
    });

    it('/brain strategy round-robin patches the strategy', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('strategy round-robin');
      expect(patches).toEqual([{ strategy: 'round-robin' }]);
    });

    it('/brain timeout + human-timeout handle numeric and clearing forms', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({ brainRuntime: runtime });
      const cmd = buildBrainCommand(ctx);
      await cmd.run!('timeout 20000');
      await cmd.run!('timeout default');
      await cmd.run!('human-timeout 60000');
      await cmd.run!('human-timeout off');
      expect(patches).toEqual([
        { decisionTimeoutMs: 20000 },
        { decisionTimeoutMs: null },
        { humanTimeoutMs: 60000 },
        { humanTimeoutMs: null },
      ]);
    });

    it('/brain council subcommands build the right patches', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({ brainRuntime: runtime });
      const cmd = buildBrainCommand(ctx);
      await cmd.run!('council on');
      await cmd.run!('council minrisk medium');
      await cmd.run!('council voters a/x:skeptic:veto:w=2 b/y');
      await cmd.run!('council judge auto');
      await cmd.run!('council quorum 0.6');
      expect(patches).toEqual([
        { council: { enabled: true } },
        { council: { minRisk: 'medium' } },
        {
          council: {
            voters: [
              { provider: 'a', model: 'x', persona: 'skeptic', veto: true, weight: 2 },
              { provider: 'b', model: 'y' },
            ],
          },
        },
        { council: { judge: null } },
        { council: { quorum: 0.6 } },
      ]);
    });

    it('/brain ledger on|off and autodeny are setters; bare numeric stays a view', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({
        brainRuntime: runtime,
        brainSettings: { maxAutoRisk: 'medium', ledgerPath: 'Z:/definitely/missing/ledger.jsonl' },
      });
      const cmd = buildBrainCommand(ctx);
      await cmd.run!('ledger off');
      await cmd.run!('ledger autodeny 4');
      const view = await cmd.run!('ledger 15');
      expect(patches).toEqual([
        { ledger: { enabled: false } },
        { ledger: { autoDenyAfterFailures: 4 } },
      ]);
      expect(stripAnsi(view!.message!)).toContain('No ledger entries yet');
    });

    it('/brain save re-persists with an empty patch', async () => {
      const { runtime, patches } = makeFakeRuntime();
      const ctx = makeCtx({ brainRuntime: runtime });
      await buildBrainCommand(ctx).run!('save');
      expect(patches).toEqual([{}]);
    });

    it('reports persist failures while keeping the live change', async () => {
      const { runtime, setPersistOk } = makeFakeRuntime();
      setPersistOk(false);
      const ctx = makeCtx({ brainRuntime: runtime });
      const result = await buildBrainCommand(ctx).run!('strategy fallback');
      const message = stripAnsi(result!.message!);
      expect(message).toContain('NOT saved: disk full');
      expect(ctx.renderer.writeWarning).toHaveBeenCalled();
    });

    it('setters warn when the runtime is not wired', async () => {
      const ctx = makeCtx();
      const result = await buildBrainCommand(ctx).run!('model prov/x');
      expect(result?.message).toMatch(/not available/);
    });
  });
});
