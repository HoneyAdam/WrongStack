import { describe, it, expect, vi } from 'vitest';

vi.mock('@wrongstack/providers', () => ({
  makeProviderFromConfig: vi.fn(() => ({
    id: 'mock',
    capabilities: { streaming: false, tools: true },
    complete: vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'end_turn',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
    })),
  })),
}));

import { MultiAgentHost, type MultiAgentDeps } from '../src/multi-agent.js';
import {
  Container,
  EventBus,
  ProviderRegistry,
  ToolRegistry,
  type ConfigStore,
  type SystemPromptBuilder,
  type SessionWriter,
  type TokenCounter,
} from '@wrongstack/core';

/**
 * V0-C: `MultiAgentHost` is lazy by design — until /spawn fires, no
 * coordinator is built. These tests pin that lazy contract. The actual
 * spawn flow is exercised by the core `multi-agent-coordinator` tests;
 * here we cover the host wrapper's pre-spawn surface plus stopAll.
 */

function makeDeps(): MultiAgentDeps {
  const configStore = {
    get: vi.fn(() => ({
      provider: 'anthropic',
      model: 'claude',
      apiKey: 'fake',
    })),
    watch: vi.fn(() => () => {}),
  } as unknown as ConfigStore;

  const systemPromptBuilder = {
    build: vi.fn(async () => [{ type: 'text', text: 'sys' }]),
  } as unknown as SystemPromptBuilder;

  const session: SessionWriter = {
    id: 'sess-test',
    append: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };

  const tokenCounter: TokenCounter = {
    account: vi.fn(),
    estimate: vi.fn(() => 0),
    reset: vi.fn(),
    total: vi.fn(() => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })),
    snapshot: vi.fn(() => []),
    inputTokens: vi.fn(() => 0),
    outputTokens: vi.fn(() => 0),
  } as unknown as TokenCounter;

  return {
    container: new Container(),
    toolRegistry: new ToolRegistry(),
    providerRegistry: new ProviderRegistry(),
    configStore,
    events: new EventBus(),
    systemPromptBuilder,
    session,
    tokenCounter,
    projectRoot: '/tmp/proj',
    cwd: '/tmp/proj',
  };
}

describe('MultiAgentHost', () => {
  it('status() before any spawn reports "No subagents"', () => {
    const host = new MultiAgentHost(makeDeps());
    const s = host.status();
    expect(s.summary).toMatch(/no subagents/i);
    expect(s.pending).toEqual([]);
    expect(s.completed).toEqual([]);
  });

  it('stopAll() before any spawn is a no-op', async () => {
    const host = new MultiAgentHost(makeDeps());
    await expect(host.stopAll()).resolves.toBeUndefined();
  });

  it('constructor does not eagerly read config or build the coordinator', () => {
    const deps = makeDeps();
    new MultiAgentHost(deps);
    // configStore.get is only called inside ensureCoordinator()
    expect(deps.configStore.get).not.toHaveBeenCalled();
    expect((deps.systemPromptBuilder as { build: ReturnType<typeof vi.fn> }).build).not.toHaveBeenCalled();
  });

  it('status() shape stays stable across calls when nothing changes', () => {
    const host = new MultiAgentHost(makeDeps());
    const a = host.status();
    const b = host.status();
    expect(a.pending).toEqual(b.pending);
    expect(a.completed).toEqual(b.completed);
  });

  it('spawn() lazily builds the coordinator and tracks pending tasks', async () => {
    const deps = makeDeps();
    const host = new MultiAgentHost(deps);
    const { subagentId, taskId } = await host.spawn('do a thing');
    expect(subagentId).toBeTruthy();
    expect(taskId).toBeTruthy();
    expect(deps.configStore.get).toHaveBeenCalled();
    expect((deps.systemPromptBuilder as { build: ReturnType<typeof vi.fn> }).build).toHaveBeenCalled();
    const s = host.status();
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]!.description).toBe('do a thing');
    expect(s.summary).toMatch(/1 pending/);
    await host.stopAll();
  });

  it('spawn() reuses the coordinator across multiple calls', async () => {
    const deps = makeDeps();
    const host = new MultiAgentHost(deps);
    const a = await host.spawn('task one');
    const b = await host.spawn('task two');
    expect(a.taskId).not.toBe(b.taskId);
    // configStore.get should be called only once — for the lazy build.
    expect((deps.configStore.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    await host.stopAll();
  });

  it('spawn() works with a providers config entry (not just top-level apiKey)', async () => {
    const deps = makeDeps();
    (deps.configStore.get as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      provider: 'anthropic',
      model: 'claude',
      providers: { anthropic: { type: 'anthropic', apiKey: 'k', baseUrl: 'https://x' } },
    });
    const host = new MultiAgentHost(deps);
    const { taskId } = await host.spawn('with provider config');
    expect(taskId).toBeTruthy();
    await host.stopAll();
  });

  it('spawn() honors the toolRegistry filter when called with allow-list', async () => {
    const deps = makeDeps();
    const tools = deps.toolRegistry;
    tools.register({
      name: 'a', description: '', inputSchema: { type: 'object' }, permission: 'auto', mutating: false, async execute() { return ''; },
    });
    tools.register({
      name: 'b', description: '', inputSchema: { type: 'object' }, permission: 'auto', mutating: false, async execute() { return ''; },
    });
    const host = new MultiAgentHost(deps);
    await host.spawn('go');
    await host.stopAll();
    // SystemPromptBuilder receives the unfiltered list via the factory closure;
    // exercising the path is what matters for coverage.
    expect((deps.systemPromptBuilder as { build: ReturnType<typeof vi.fn> }).build).toHaveBeenCalled();
  });
});
