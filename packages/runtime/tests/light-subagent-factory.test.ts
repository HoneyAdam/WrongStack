import {
  type Config,
  Container,
  DefaultConfigStore,
  DefaultSecretScrubber,
  type Provider,
  ProviderError,
  ProviderRegistry,
  type SessionWriter,
  TOKENS,
  type Tool,
  ToolRegistry,
  type UserInputPayload,
} from '@wrongstack/core';
import { describe, expect, it } from 'vitest';
import { makeLightSubagentFactory } from '../src/index.js';

const reasoningCaps = {
  default: 'enabled',
  disableSupported: true,
  effortSupported: true,
  effortLevels: ['low', 'medium', 'high'],
  preserveThinking: 'optional',
} as const;

const noopProvider: Provider = {
  id: 'noop',
  capabilities: { streaming: false, tools: true, vision: false, reasoning: false },
  async complete() {
    return {
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
      usage: { input: 0, output: 0 },
      model: 'noop',
    };
  },
  async *stream() {
    yield {
      type: 'response',
      response: {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
        model: 'noop',
      },
    };
  },
};

function providerFor(id: string): Provider {
  return {
    ...noopProvider,
    id,
    async complete() {
      return {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
        model: id,
      };
    },
  };
}

const readTool: Tool = {
  name: 'read',
  description: 'read',
  inputSchema: { type: 'object', properties: {} },
  permission: 'auto',
  mutating: false,
  capabilities: ['fs.read'],
  async execute() {
    return 'ok';
  },
};
const writeTool: Tool = {
  name: 'write',
  description: 'write',
  inputSchema: { type: 'object', properties: {} },
  permission: 'auto',
  mutating: true,
  capabilities: ['fs.write'],
  async execute() {
    return 'ok';
  },
};

function stubLogger(): unknown {
  const l: Record<string, unknown> = {};
  for (const m of ['debug', 'info', 'warn', 'error', 'trace', 'fatal']) l[m] = () => {};
  l.child = () => l;
  return l;
}

function sessionShim(): SessionWriter {
  return {
    id: 'parent',
    transcriptPath: '/tmp/parent.jsonl',
    traceId: 'parent-trace',
    get pendingToolUses() {
      return [];
    },
    append: () => {},
    appendBatch: () => {},
    flush: () => {},
    close: async () => {},
    recordFileChange: () => {},
    recordSideEffect: () => {},
    writeCheckpoint: async () => {},
    writeFileSnapshot: async () => {},
    truncateToCheckpoint: async () => 0,
    clearSession: async () => {},
    writeInFlightMarker: async () => {},
    clearInFlightMarker: async () => {},
  } satisfies SessionWriter;
}

function makeDeps(providerRegistered = true, configOverride: Partial<Config> = {}) {
  const config = {
    provider: 'noop',
    model: 'noop',
    providers: { noop: { type: 'noop' } },
    features: {},
    tools: {},
    ...configOverride,
  } as never as Config;

  const container = new Container();
  container.bind(TOKENS.Logger, () => stubLogger() as never);
  container.bind(TOKENS.ConfigStore, () => new DefaultConfigStore(config));
  container.bind(TOKENS.SecretScrubber, () => new DefaultSecretScrubber());
  container.bind(
    TOKENS.TokenCounter,
    () =>
      ({
        count: () => 0,
        countMessages: () => 0,
        add: () => {},
        total: () => ({ input: 0, output: 0 }),
        estimateCost: () => ({ total: 0 }),
        reset: () => {},
      }) as never,
  );
  container.bind(
    TOKENS.SystemPromptBuilder,
    () =>
      ({
        build: async () => [{ type: 'text', text: 'system' }],
      }) as never,
  );

  const providerRegistry = new ProviderRegistry();
  if (providerRegistered) {
    for (const type of ['noop', 'alt', 'openai', 'anthropic']) {
      providerRegistry.register({ type, create: () => providerFor(type) });
    }
  }

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(readTool);
  toolRegistry.register(writeTool);

  return {
    container,
    providerRegistry,
    toolRegistry,
    session: sessionShim(),
    projectRoot: '/proj',
    modelsRegistry: {
      getModel: async () => ({
        capabilities: { reasoningConfig: reasoningCaps },
      }),
    } as never,
  };
}

describe('makeLightSubagentFactory', () => {
  it('builds a fresh isolated Agent with its own EventBus', async () => {
    const factory = makeLightSubagentFactory(makeDeps());
    const a = await factory({ id: 's1', role: 'executor' });
    const b = await factory({ id: 's2', role: 'executor' });
    expect(a.agent).toBeDefined();
    expect(a.events).toBeDefined();
    // Isolation: each subagent gets a distinct bus + context.
    expect(a.events).not.toBe(b.events);
    expect(a.agent).not.toBe(b.agent);
  });

  it('honours per-task cwd (worktree isolation)', async () => {
    const factory = makeLightSubagentFactory(makeDeps());
    const r = await factory({ id: 's1', cwd: '/proj/.wt/task-1' });
    expect(r.agent.ctx.cwd).toBe('/proj/.wt/task-1');
  });

  it('defaults cwd to the deps cwd/projectRoot when unset', async () => {
    const factory = makeLightSubagentFactory(makeDeps());
    const r = await factory({ id: 's1' });
    expect(r.agent.ctx.cwd).toBe('/proj');
  });

  it('scopes tools to the SubagentConfig allowlist (isolated registry)', async () => {
    const deps = makeDeps();
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({ id: 's1', tools: ['read'] });
    const names = r.agent.tools.list().map((t) => t.name);
    expect(names).toEqual(['read']);
    // The shared parent registry is untouched.
    expect(
      deps.toolRegistry
        .list()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['read', 'write']);
  });

  it('throws a clear error when the provider is not registered', async () => {
    const factory = makeLightSubagentFactory(makeDeps(false));
    await expect(factory({ id: 's1' })).rejects.toThrow(/No provider factory registered/);
  });

  it('forwards traceId between the subagent session shim and the parent writer', async () => {
    const deps = makeDeps();
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({ id: 's1' });
    expect(r.agent.ctx.session.traceId).toBe('parent-trace');
    r.agent.ctx.session.traceId = 'child-trace';
    expect(deps.session.traceId).toBe('child-trace');
  });

  it('applies role-specific reasoning runtime from the model matrix', async () => {
    const deps = makeDeps(true, {
      modelRuntime: { reasoning: { mode: 'auto', effort: 'high' } },
      modelMatrix: {
        executor: { modelRuntime: { reasoning: { effort: 'low' } } },
      },
    } as never);
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({ id: 's1', role: 'executor' });

    const req = await r.agent.pipelines.request.run({ model: 'noop' } as never);

    expect(req.reasoning).toEqual({ effort: 'low' });
  });

  it('diversifies reviewer away from the implementation lane when no reviewer route is pinned', async () => {
    const deps = makeDeps(true, {
      provider: 'anthropic',
      model: 'anthropic-test-model',
      providers: {
        anthropic: {
          type: 'anthropic',
          apiKey: 'sk-ant',
          models: ['anthropic-test-model'],
        },
        openai: {
          type: 'openai',
          apiKey: 'sk-oai',
          models: ['gpt-5'],
        },
      },
      modelMatrix: {
        '*': { provider: 'anthropic', model: 'anthropic-test-model' },
      },
    } as never);
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({ id: 's1', role: 'reviewer' });

    expect(r.agent.ctx.model).toBe('gpt-5');
    expect(r.agent.ctx.provider.id).toBe('openai');
  });

  it('preserves an explicit reviewer model route', async () => {
    const deps = makeDeps(true, {
      provider: 'anthropic',
      model: 'anthropic-test-model',
      providers: {
        anthropic: {
          type: 'anthropic',
          apiKey: 'sk-ant',
          models: ['anthropic-test-model'],
        },
        openai: {
          type: 'openai',
          apiKey: 'sk-oai',
          models: ['gpt-5'],
        },
      },
      modelMatrix: {
        reviewer: { provider: 'anthropic', model: 'anthropic-test-model' },
      },
    } as never);
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({ id: 's1', role: 'reviewer' });

    expect(r.agent.ctx.model).toBe('anthropic-test-model');
    expect(r.agent.ctx.provider.id).toBe('anthropic');
  });

  // ── fallback must not drift the worker onto the leader's model ──────────
  // getConfig() must pin provider/model to the worker's target so the
  // extension restores the worker, never the leader, after any hop.
  it('restores a worker to its OWN model after a hop, never the leaders', async () => {
    // Pin `now` so the 60s primary cooldown does NOT short-circuit `beforeRun`
    // — we want the half-open probe to actually read `cfg.provider`/`cfg.model`.
    // The mock advances by 70 s on every call: `markPrimaryFailure` fires first
    // (during the hop) and sets `primaryBlockedUntil = now + 60 s`; the next
    // `now()` (during `runBeforeRun`) must clear that gate so the restore path
    // actually runs.
    const deps = makeDeps(true, {
      provider: 'noop',
      model: 'leader-m',
      providers: { noop: { type: 'noop' }, alt: { type: 'alt' } },
    } as never);
    let mockNow = 1000;
    (deps as typeof deps & { now?: () => number }).now = () => {
      mockNow += 70_000;
      return mockNow;
    };
    const factory = makeLightSubagentFactory(deps);
    const r = await factory({
      id: 's1',
      provider: 'alt',
      model: 'worker-m',
      fallbackModels: ['noop/backup-m'],
    } as never);

    expect(r.agent.ctx.model).toBe('worker-m');

    // Drive one hop: the worker's own model fails with a capacity error, so
    // the chain runs and lands on some other candidate.
    let call = 0;
    const runner = r.agent.extensions.wrapProviderRunner(async () => {
      call += 1;
      if (call === 1) throw new ProviderError('rate limited', 429, true, 'alt');
      return {
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'end_turn',
        usage: { input: 0, output: 0 },
        // Return ctx.model (post-hop target), not request.model: the wrapper
        // rebinds request.model internally to the fallback it selected.
        model: r.agent.ctx.model,
      } as never;
    });
    await runner(r.agent.ctx as never, { model: 'worker-m', messages: [] } as never);

    // The chain must land on the worker's OWN configured fallback. When the
    // extension was handed the leader's config, `primaryTarget` put the
    // leader's pair in the chain AHEAD of the explicit `fallbackModels`, so
    // this landed on 'leader-m' instead.
    expect(r.agent.ctx.model).toBe('backup-m');
    expect(r.agent.ctx.provider.id).toBe('noop');

    // beforeRun is the half-open probe back to the primary. With `now` pinned
    // past the cooldown, it ACTUALLY reads `cfg.provider`/`cfg.model` and
    // restores them — those must be the WORKER's pinned pair (`worker-m`/`alt`),
    // never the leader's (`leader-m`/`noop`). This is the independent regression
    // check for the worker-vs-leader-pin bug.
    await r.agent.extensions.runBeforeRun(
      r.agent.ctx as never,
      { content: [], text: '', ctx: r.agent.ctx } as unknown as UserInputPayload,
    );
    expect(r.agent.ctx.model).toBe('worker-m');
    expect(r.agent.ctx.provider.id).toBe('alt');
  });
});
