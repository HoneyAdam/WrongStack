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
});
