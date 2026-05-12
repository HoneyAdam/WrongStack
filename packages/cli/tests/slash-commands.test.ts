import { describe, it, expect, vi } from 'vitest';
import {
  SlashCommandRegistry,
  ToolRegistry,
  DefaultTokenCounter,
  HybridCompactor,
  type Context,
} from '@wrongstack/core';
import { buildBuiltinSlashCommands } from '../src/slash-commands/index.js';

class FakeRenderer {
  output = '';
  warnings: string[] = [];
  errors: string[] = [];
  infos: string[] = [];
  write(s: unknown): void {
    this.output += typeof s === 'string' ? s : ((s as { text?: string }).text ?? '');
  }
  writeLine(s = ''): void {
    this.output += `${s}\n`;
  }
  writeBlock(): void {}
  writeToolCall(): void {}
  writeToolResult(): void {}
  writeDiff(): void {}
  writeWarning(s: string): void {
    this.warnings.push(s);
  }
  writeError(s: string): void {
    this.errors.push(s);
  }
  writeInfo(s: string): void {
    this.infos.push(s);
  }
  clear(): void {
    this.output = '';
  }
}

function makeRig() {
  const registry = new SlashCommandRegistry();
  const toolRegistry = new ToolRegistry();
  const renderer = new FakeRenderer();
  const tokenCounter = new DefaultTokenCounter();
  const compactor = new HybridCompactor({ preserveK: 5 });
  const cmds = buildBuiltinSlashCommands({
    registry,
    toolRegistry,
    compactor,
    tokenCounter,
    renderer: renderer as unknown as Parameters<typeof buildBuiltinSlashCommands>[0]['renderer'],
  });
  for (const c of cmds) registry.register(c);
  return { registry, renderer, toolRegistry, tokenCounter };
}

const fakeCtx = { messages: [], todos: [] } as unknown as Context;

describe('built-in slash commands', () => {
  it('/help lists all commands', async () => {
    const { registry, renderer } = makeRig();
    await registry.dispatch('/help', fakeCtx);
    expect(renderer.output).toContain('/help');
    expect(renderer.output).toContain('/exit');
  });

  it('/usage prints token totals', async () => {
    const { registry, renderer, tokenCounter } = makeRig();
    tokenCounter.account({ input: 100, output: 50 }, 'claude-sonnet-4-6');
    await registry.dispatch('/usage', fakeCtx);
    expect(renderer.output).toContain('100');
    expect(renderer.output).toContain('50');
  });

  it('/cost aliases /usage', async () => {
    const { registry, renderer } = makeRig();
    await registry.dispatch('/cost', fakeCtx);
    expect(renderer.output).toContain('Usage');
  });

  it('/tools lists registered tools', async () => {
    const { registry, renderer, toolRegistry } = makeRig();
    toolRegistry.register({
      name: 'echo',
      description: 'echo',
      inputSchema: { type: 'object' },
      permission: 'auto',
      mutating: false,
      async execute() {
        return '';
      },
    });
    await registry.dispatch('/tools', fakeCtx);
    expect(renderer.output).toContain('echo');
  });

  it('/exit signals exit', async () => {
    const { registry } = makeRig();
    const res = await registry.dispatch('/exit', fakeCtx);
    expect(res?.exit).toBe(true);
  });

  it('/quit aliases /exit', async () => {
    const { registry } = makeRig();
    const res = await registry.dispatch('/quit', fakeCtx);
    expect(res?.exit).toBe(true);
  });

  it('/clear triggers onClear and clears renderer', async () => {
    const onClear = vi.fn();
    const registry = new SlashCommandRegistry();
    const renderer = new FakeRenderer();
    renderer.output = 'something';
    const cmds = buildBuiltinSlashCommands({
      registry,
      toolRegistry: new ToolRegistry(),
      compactor: new HybridCompactor(),
      tokenCounter: new DefaultTokenCounter(),
      renderer: renderer as unknown as Parameters<typeof buildBuiltinSlashCommands>[0]['renderer'],
      onClear,
    });
    for (const c of cmds) registry.register(c);
    await registry.dispatch('/clear', fakeCtx);
    expect(onClear).toHaveBeenCalled();
  });

  it('/compact runs the compactor', async () => {
    const { registry, renderer } = makeRig();
    const ctx = { messages: [] } as unknown as Context;
    await registry.dispatch('/compact', ctx);
    expect(renderer.infos.some((i) => i.includes('Compaction'))).toBe(true);
  });
});
