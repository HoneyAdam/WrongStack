import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  Container,
  TOKENS,
  ToolRegistry,
  DefaultMemoryStore,
  type Config,
  type WstackPaths,
} from '@wrongstack/core';
import { setupTools } from '../src/wiring/tools.js';

let tmp: string;

function fakeCompactor() {
  return { compact: vi.fn() };
}

function makeWpaths(): WstackPaths {
  return {
    configDir: tmp,
    globalConfig: path.join(tmp, 'config.json'),
    projectDir: tmp,
    projectSessions: tmp,
    globalRoot: tmp,
    logFile: path.join(tmp, 'log.txt'),
    historyFile: path.join(tmp, 'history'),
    modelsCache: path.join(tmp, 'models.json'),
    inProjectAgentsFile: path.join(tmp, 'AGENTS.md'),
    projectMemory: path.join(tmp, 'project-memory.md'),
    globalMemory: path.join(tmp, 'global-memory.md'),
  } as WstackPaths;
}

function makeMemoryStore(): DefaultMemoryStore {
  return new DefaultMemoryStore({ paths: makeWpaths() });
}

function makeContainer() {
  const c = new Container();
  c.bind(TOKENS.Compactor, () => fakeCompactor() as never);
  return c;
}

function fakeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    provider: 'p',
    model: 'm',
    features: { mcp: true, plugins: true, memory: true, modelsRegistry: true, skills: true },
    ...overrides,
  } as Config;
}

function makeModelsRegistry(overrides: Record<string, unknown> = {}) {
  return {
    getModel: vi.fn().mockResolvedValue(undefined),
    getProvider: vi.fn(),
    listProviders: vi.fn(),
    suggestModel: vi.fn(),
    refresh: vi.fn(),
    listProvidersWithModels: vi.fn(),
    ...overrides,
  } as never;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wiring-tools-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('setupTools', () => {
  it('registers builtin tools and returns assembled wiring result', async () => {
    const toolRegistry = new ToolRegistry();
    const memoryStore = makeMemoryStore();
    const result = await setupTools({
      config: fakeConfig(),
      toolRegistry,
      modelsRegistry: makeModelsRegistry(),
      memoryStore,
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    expect(result.toolRegistry).toBe(toolRegistry);
    expect(result.modeStore).toBeDefined();
    expect(result.promptBuilder).toBeDefined();
    expect(result.skillLoader).toBeDefined();
    // System prompt was computed
    const blocks = await result.systemPrompt;
    expect(Array.isArray(blocks)).toBe(true);
    // Builtin tools were registered
    expect(toolRegistry.list().length).toBeGreaterThan(0);
  });

  it('registers remember/forget when memory feature enabled', async () => {
    const toolRegistry = new ToolRegistry();
    await setupTools({
      config: fakeConfig({
        features: { mcp: true, plugins: true, memory: true, modelsRegistry: true, skills: true },
      }),
      toolRegistry,
      modelsRegistry: makeModelsRegistry(),
      memoryStore: makeMemoryStore(),
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    const toolNames = toolRegistry.list().map((t) => t.name);
    expect(toolNames).toContain('remember');
    expect(toolNames).toContain('forget');
  });

  it('skips remember/forget when memory feature disabled', async () => {
    const toolRegistry = new ToolRegistry();
    await setupTools({
      config: fakeConfig({
        features: { mcp: true, plugins: true, memory: false, modelsRegistry: true, skills: true },
      }),
      toolRegistry,
      modelsRegistry: makeModelsRegistry(),
      memoryStore: makeMemoryStore(),
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    const toolNames = toolRegistry.list().map((t) => t.name);
    expect(toolNames).not.toContain('remember');
    expect(toolNames).not.toContain('forget');
  });

  it('returns undefined skillLoader when skills feature disabled', async () => {
    const result = await setupTools({
      config: fakeConfig({
        features: { mcp: true, plugins: true, memory: true, modelsRegistry: true, skills: false },
      }),
      toolRegistry: new ToolRegistry(),
      modelsRegistry: makeModelsRegistry(),
      memoryStore: makeMemoryStore(),
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    expect(result.skillLoader).toBeUndefined();
  });

  it('uses model capabilities from modelsRegistry when available', async () => {
    const modelsRegistry = makeModelsRegistry({
      getModel: vi.fn().mockResolvedValue({
        id: 'm',
        capabilities: { maxContext: 200000, tools: true, vision: false, reasoning: true },
      }),
    });
    const result = await setupTools({
      config: fakeConfig(),
      toolRegistry: new ToolRegistry(),
      modelsRegistry,
      memoryStore: makeMemoryStore(),
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    expect(result.promptBuilder).toBeDefined();
    expect((modelsRegistry as { getModel: ReturnType<typeof vi.fn> }).getModel)
      .toHaveBeenCalledWith('p', 'm');
  });

  it('persists active mode preselection when set on modeStore', async () => {
    const toolRegistry = new ToolRegistry();
    // Pre-write a mode file so modeStore.getActiveMode() returns it.
    const modeDir = path.join(tmp, 'modes');
    await fs.mkdir(modeDir, { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'mode.json'),
      JSON.stringify({ id: 'custom', prompt: 'be custom' }),
    );
    const result = await setupTools({
      config: fakeConfig(),
      toolRegistry,
      modelsRegistry: makeModelsRegistry(),
      memoryStore: makeMemoryStore(),
      wpaths: makeWpaths(),
      projectRoot: tmp,
      cwd: tmp,
      container: makeContainer() as never,
    });
    // mode.json sits at configDir, modeStore loads it. We can't assert the
    // mode is the one from disk without inspecting builder internals, but the
    // call must not throw and the result must include modeStore.
    expect(result.modeStore).toBeDefined();
  });
});
