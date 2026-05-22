import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type Context,
  DefaultTokenCounter,
  HybridCompactor,
  SlashCommandRegistry,
  ToolRegistry,
  appendJournal,
  emptyGoal,
  goalFilePath,
  saveGoal,
} from '@wrongstack/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAutonomyCommand, type AutonomyMode } from '../src/slash-commands/autonomy.js';
import type { SlashCommandContext } from '../src/slash-commands/index.js';

class FakeRenderer {
  output = '';
  warnings: string[] = [];
  write(s: unknown): void {
    this.output += typeof s === 'string' ? s : '';
  }
  writeLine(s = ''): void { this.output += `${s}\n`; }
  writeBlock(): void {}
  writeToolCall(): void {}
  writeToolResult(): void {}
  writeDiff(): void {}
  writeWarning(s: string): void { this.warnings.push(s); }
  writeError(): void {}
  writeInfo(): void {}
  clear(): void { this.output = ''; }
}

function rig(projectRoot: string) {
  const registry = new SlashCommandRegistry();
  const renderer = new FakeRenderer();
  let mode: AutonomyMode = 'off';
  const startSpy = vi.fn();
  const stopSpy = vi.fn();
  const yoloSpy = vi.fn((v?: boolean) => v ?? false);
  const ctx: Partial<SlashCommandContext> = {
    registry,
    toolRegistry: new ToolRegistry(),
    tokenCounter: new DefaultTokenCounter(),
    compactor: new HybridCompactor({ preserveK: 5 }),
    renderer: renderer as unknown as SlashCommandContext['renderer'],
    cwd: projectRoot,
    projectRoot,
    onAutonomy: (setTo?: AutonomyMode) => {
      if (setTo !== undefined) mode = setTo;
      return mode;
    },
    onEternalStart: startSpy,
    onEternalStop: stopSpy,
    onYolo: yoloSpy,
  };
  const cmd = buildAutonomyCommand(ctx as SlashCommandContext);
  registry.register(cmd);
  return {
    registry,
    renderer,
    ctx: ctx as SlashCommandContext,
    getMode: () => mode,
    startSpy,
    stopSpy,
    yoloSpy,
  };
}

const fakeCtx = {
  messages: [], todos: [], systemPrompt: [], readFiles: new Set(), fileMtimes: new Map(),
  model: 'test-model', cwd: '/tmp', projectRoot: '/proj',
} as unknown as Context;

describe('/autonomy slash command', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wstack-autonomy-cli-'));
    await fs.mkdir(path.join(tmp, '.wrongstack'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('reports current mode with no arg', async () => {
    const { registry } = rig(tmp);
    const result = await registry.dispatch('/autonomy', fakeCtx);
    expect(result?.message).toContain('OFF');
  });

  it('toggles through off → suggest → auto → eternal cycle', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission')); // eternal needs a goal
    const { registry, getMode } = rig(tmp);
    await registry.dispatch('/autonomy toggle', fakeCtx);
    expect(getMode()).toBe('suggest');
    await registry.dispatch('/autonomy toggle', fakeCtx);
    expect(getMode()).toBe('auto');
    await registry.dispatch('/autonomy toggle', fakeCtx);
    expect(getMode()).toBe('eternal');
    await registry.dispatch('/autonomy toggle', fakeCtx);
    expect(getMode()).toBe('off');
  });

  it('refuses /autonomy eternal without a goal', async () => {
    const { registry, getMode, startSpy } = rig(tmp);
    const result = await registry.dispatch('/autonomy eternal', fakeCtx);
    expect(result?.message).toMatch(/requires a goal/i);
    expect(getMode()).toBe('off');
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('forces YOLO on and calls onEternalStart when goal exists', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission'));
    const { registry, getMode, startSpy, yoloSpy } = rig(tmp);
    await registry.dispatch('/autonomy eternal', fakeCtx);
    expect(getMode()).toBe('eternal');
    expect(startSpy).toHaveBeenCalledOnce();
    expect(yoloSpy).toHaveBeenCalledWith(true);
  });

  it('/autonomy stop signals stop and resets mode to off', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission'));
    const { registry, getMode, stopSpy } = rig(tmp);
    await registry.dispatch('/autonomy eternal', fakeCtx);
    await registry.dispatch('/autonomy stop', fakeCtx);
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(getMode()).toBe('off');
  });

  it('/autonomy stop includes spend summary when telemetry exists', async () => {
    let seed = emptyGoal('paid mission');
    seed = appendJournal(seed, {
      source: 'todo',
      task: 'cost-tracking iteration',
      status: 'success',
      tokens: { input: 1000, output: 500 },
      costUsd: 0.0123,
    });
    await saveGoal(goalFilePath(tmp), seed);

    const { registry } = rig(tmp);
    const result = await registry.dispatch('/autonomy stop', fakeCtx);
    expect(result?.message).toContain('$0.0123');
    expect(result?.message).toContain('1000 in / 500 out');
  });

  it('switching out of eternal stops the engine', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission'));
    const { registry, stopSpy } = rig(tmp);
    await registry.dispatch('/autonomy eternal', fakeCtx);
    stopSpy.mockClear();
    await registry.dispatch('/autonomy off', fakeCtx);
    expect(stopSpy).toHaveBeenCalledOnce();
  });

  it('rejects unknown args without crashing', async () => {
    const { registry, getMode } = rig(tmp);
    const result = await registry.dispatch('/autonomy nope', fakeCtx);
    expect(result?.message).toMatch(/Unknown argument/);
    expect(getMode()).toBe('off');
  });

  it('accepts "suggest" / "suggestions" aliases', async () => {
    const { registry, getMode } = rig(tmp);
    await registry.dispatch('/autonomy suggest', fakeCtx);
    expect(getMode()).toBe('suggest');
    await registry.dispatch('/autonomy off', fakeCtx);
    await registry.dispatch('/autonomy suggestions', fakeCtx);
    expect(getMode()).toBe('suggest');
  });

  it('accepts "on" / "enable" / "true" / "auto" all mapping to auto', async () => {
    const { registry, getMode } = rig(tmp);
    for (const arg of ['on', 'enable', 'true', 'auto']) {
      await registry.dispatch('/autonomy off', fakeCtx);
      await registry.dispatch(`/autonomy ${arg}`, fakeCtx);
      expect(getMode()).toBe('auto');
    }
  });

  it('accepts "false" / "disable" aliases for off', async () => {
    const { registry, getMode } = rig(tmp);
    await registry.dispatch('/autonomy on', fakeCtx);
    await registry.dispatch('/autonomy disable', fakeCtx);
    expect(getMode()).toBe('off');
    await registry.dispatch('/autonomy on', fakeCtx);
    await registry.dispatch('/autonomy false', fakeCtx);
    expect(getMode()).toBe('off');
  });

  it('accepts "forever" / "infinite" / "sittinsene" aliases for eternal', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission'));
    for (const arg of ['forever', 'infinite', 'sittinsene']) {
      const { registry, getMode } = rig(tmp);
      await registry.dispatch(`/autonomy ${arg}`, fakeCtx);
      expect(getMode()).toBe('eternal');
    }
  });

  it('reports an error when onEternalStart callback is missing', async () => {
    await saveGoal(goalFilePath(tmp), emptyGoal('mission'));
    // Build a rig but strip the onEternalStart hook
    const reg = rig(tmp);
    (reg.ctx as { onEternalStart?: unknown }).onEternalStart = undefined;
    const result = await reg.registry.dispatch('/autonomy eternal', fakeCtx);
    expect(result?.message).toMatch(/controller is not wired/i);
  });

  it('reports unavailable when onAutonomy callback is missing entirely', async () => {
    const reg = rig(tmp);
    (reg.ctx as { onAutonomy?: unknown }).onAutonomy = undefined;
    const result = await reg.registry.dispatch('/autonomy', fakeCtx);
    expect(result?.message).toMatch(/not available/i);
  });

  it('show-mode renders goal, engine state, spend, and failure pulse when goal has telemetry and failures', async () => {
    // Seed a goal with spending and several failures so the show-mode path
    // exercises summarizeUsage + the "Recent failures" branch.
    let seed = emptyGoal('mission with spend');
    seed = appendJournal(seed, {
      source: 'todo',
      task: 'paid iter',
      status: 'success',
      tokens: { input: 100, output: 50 },
      costUsd: 0.01,
    });
    for (let i = 0; i < 3; i++) {
      seed = appendJournal(seed, { source: 'todo', task: `flaky-${i}`, status: 'failure' });
    }
    await saveGoal(goalFilePath(tmp), seed);
    const { registry } = rig(tmp);
    const result = await registry.dispatch('/autonomy', fakeCtx);
    expect(result?.message).toMatch(/Goal:/);
    expect(result?.message).toMatch(/Engine state:/);
    expect(result?.message).toContain('$0.0100');
    expect(result?.message).toMatch(/Recent failures:/);
  });

  it('show-mode truncates a very long goal description with an ellipsis', async () => {
    const longText = 'X'.repeat(120);
    const seed = emptyGoal(longText);
    await saveGoal(goalFilePath(tmp), seed);
    const { registry } = rig(tmp);
    const result = await registry.dispatch('/autonomy', fakeCtx);
    expect(result?.message).toMatch(/…/);
  });

  it('/autonomy stop without onEternalStop wired warns the user', async () => {
    const reg = rig(tmp);
    (reg.ctx as { onEternalStop?: unknown }).onEternalStop = undefined;
    const result = await reg.registry.dispatch('/autonomy stop', fakeCtx);
    expect(result?.message).toMatch(/no eternal-mode controller wired/i);
  });
});
