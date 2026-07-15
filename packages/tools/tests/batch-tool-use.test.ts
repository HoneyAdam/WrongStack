import { describe, expect, it, vi } from 'vitest';
import {
  GOVERNED_TOOL_EXECUTOR_META_KEY,
  type GovernedToolExecutor,
} from '@wrongstack/core';
import { ToolExecutor } from '../../core/src/execution/tool-executor.js';
import { batchToolUseTool } from '../src/batch-tool-use.js';

const makeCtx = (tools: any[] = []) => {
  const governedExecute: GovernedToolExecutor = async (toolName, input) => {
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) return { success: false, error: `tool "${toolName}" not found` };
    try {
      return { success: true, result: await tool.execute(input, ctx, makeOpts()) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
  const ctx = {
    cwd: '/fake',
    tools,
    projectRoot: '/fake',
    meta: { [GOVERNED_TOOL_EXECUTOR_META_KEY]: governedExecute },
  } as any;
  return ctx;
};
const makeOpts = () => ({ signal: new AbortController().signal });

describe('batchToolUseTool', () => {
  it('has correct metadata', () => {
    expect(batchToolUseTool.name).toBe('batch_tool_use');
    expect(batchToolUseTool.permission).toBe('confirm');
    expect(batchToolUseTool.mutating).toBe(true);
    expect(batchToolUseTool.timeoutMs).toBe(120_000);
  });

  it('returns empty result for empty calls', async () => {
    const ctx = makeCtx();
    const result = await batchToolUseTool.execute({ calls: [] }, ctx, makeOpts());
    expect(result.total).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });

  it('returns empty result for null/undefined calls', async () => {
    const ctx = makeCtx();
    const result = await batchToolUseTool.execute({ calls: undefined as any }, ctx, makeOpts());
    expect(result.total).toBe(0);
  });

  it('runs tools in parallel by default', async () => {
    let _resolve: (v: any) => void;
    const _promise = new Promise((r) => {
      _resolve = r;
    });
    const fakeTool = {
      name: 'test',
      execute: vi.fn().mockReturnValue(Promise.resolve({ value: 1 })),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'test', input: {} }] },
      ctx,
      makeOpts(),
    );

    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.results[0].success).toBe(true);
  });

  it('reports tool not found', async () => {
    const ctx = makeCtx([]);
    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'nonexistent', input: {} }] },
      ctx,
      makeOpts(),
    );
    expect(result.total).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toContain('not found');
  });

  it('fails closed when no governed executor bridge is installed', async () => {
    const directExecute = vi.fn().mockResolvedValue({ unsafe: true });
    const ctx = makeCtx([{ name: 'write-like', execute: directExecute }]);
    delete ctx.meta[GOVERNED_TOOL_EXECUTOR_META_KEY];

    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'write-like', input: {} }] },
      ctx,
      makeOpts(),
    );

    expect(result.results[0]).toMatchObject({ success: false });
    expect(result.results[0].error).toContain('governed nested execution is unavailable');
    expect(directExecute).not.toHaveBeenCalled();
  });

  it('re-evaluates every nested tool through ToolExecutor and blocks a denied subcall', async () => {
    const deniedExecute = vi.fn().mockResolvedValue({ unsafe: true });
    const deniedTool = {
      name: 'denied-inner',
      description: 'denied inner tool',
      inputSchema: { type: 'object' },
      permission: 'confirm' as const,
      mutating: true,
      capabilities: ['fs.write'],
      execute: deniedExecute,
    };
    const tools = [batchToolUseTool, deniedTool];
    const ctx = makeCtx(tools);
    delete ctx.meta[GOVERNED_TOOL_EXECUTOR_META_KEY];
    Object.assign(ctx, {
      signal: new AbortController().signal,
      session: { id: 'batch-policy-test' },
      agentId: 'leader',
    });
    const evaluate = vi.fn(async (tool: { name: string }) =>
      tool.name === 'denied-inner'
        ? { permission: 'deny' as const, source: 'deny' as const, reason: 'capability not granted' }
        : { permission: 'confirm' as const, source: 'default' as const },
    );
    const executor = new ToolExecutor(
      {
        get: (name) => tools.find((tool) => tool.name === name),
        list: () => tools,
      },
      {
        permissionPolicy: { evaluate } as never,
        confirmAwaiter: vi.fn(async () => 'yes'),
        secretScrubber: { scrub: (text: string) => text } as never,
      },
    );

    const execution = await executor.executeBatch(
      [
        {
          type: 'tool_use',
          id: 'outer-batch',
          name: 'batch_tool_use',
          input: { calls: [{ tool: 'denied-inner', input: {} }], parallel: false },
        },
      ],
      ctx,
      'sequential',
    );

    expect(evaluate.mock.calls.map(([tool]) => tool.name)).toEqual([
      'batch_tool_use',
      'denied-inner',
    ]);
    expect(String(execution.outputs[0]?.result.type === 'tool_result' ? execution.outputs[0].result.content : '')).toContain(
      'capability not granted',
    );
    expect(deniedExecute).not.toHaveBeenCalled();
  });

  it('handles parallel=false (sequential)', async () => {
    const fakeTool = {
      name: 'test',
      execute: vi.fn().mockResolvedValue({ value: 1 }),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'test', input: {} }], parallel: false },
      ctx,
      makeOpts(),
    );
    expect(result.total).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('stops on error when stop_on_error=true', async () => {
    const fakeTool = {
      name: 'test',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      {
        calls: [
          { tool: 'test', input: {} },
          { tool: 'test', input: {} },
        ],
        stop_on_error: true,
        parallel: false,
      },
      ctx,
      makeOpts(),
    );
    // With stop_on_error + sequential, loop should break after first failure
    expect(result.results.length).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.stop_on_error).toBe(true);
  });

  it('continues when stop_on_error=false even after failure', async () => {
    const fakeTool = {
      name: 'test',
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      {
        calls: [
          { tool: 'test', input: {} },
          { tool: 'test', input: {} },
        ],
        stop_on_error: false,
      },
      ctx,
      makeOpts(),
    );
    expect(result.results.length).toBe(2);
    expect(result.failed).toBe(2);
  });

  it('handles non-Error thrown values in executeSingle', async () => {
    const fakeTool = {
      name: 'throws-string',
      execute: vi.fn().mockRejectedValue('string error value'),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'throws-string', input: {} }] },
      ctx,
      makeOpts(),
    );
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].error).toBe('string error value');
  });

  it('reports execution time', async () => {
    const fakeTool = {
      name: 'test',
      execute: vi.fn().mockResolvedValue({ value: 1 }),
    };
    const ctx = makeCtx([fakeTool]);

    const result = await batchToolUseTool.execute(
      { calls: [{ tool: 'test', input: {} }] },
      ctx,
      makeOpts(),
    );
    expect(result.results[0].executionMs).toBeGreaterThanOrEqual(0);
  });
});
