import { describe, it, expect, vi } from 'vitest';
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
});
