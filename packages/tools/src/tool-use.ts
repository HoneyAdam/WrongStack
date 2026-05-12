import type { Tool } from '@wrongstack/core';

interface ToolUseInput {
  tool: string;
  input: Record<string, unknown>;
}

interface ToolUseOutput {
  tool: string;
  success: boolean;
  result?: unknown;
  error?: string;
  executionMs: number;
}

export const toolUseTool: Tool<ToolUseInput, ToolUseOutput> = {
  name: 'tool_use',
  description:
    'Execute a specific tool by name with given input. Useful when the agent knows exactly which tool to call.',
  usageHint:
    'Set `tool` with exact tool name and `input` with the tool parameters. Returns result or error.',
  permission: 'confirm',
  mutating: false,
  timeoutMs: 60_000,
  inputSchema: {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        description: 'Exact name of the tool to execute',
      },
      input: {
        type: 'object',
        description: 'Input parameters for the tool',
      },
    },
    required: ['tool'],
  },
  async execute(input, ctx, opts) {
    const start = Date.now();

    if (!input?.tool) {
      return {
        tool: 'unknown',
        success: false,
        error: 'tool_use: tool name is required',
        executionMs: 0,
      };
    }

    const tool = ctx.tools.find((t: Tool) => t.name === input.tool);
    if (!tool) {
      return {
        tool: input.tool,
        success: false,
        error: `tool_use: tool "${input.tool}" not found`,
        executionMs: Date.now() - start,
      };
    }

    if (tool.permission === 'deny') {
      return {
        tool: input.tool,
        success: false,
        error: `tool_use: tool "${input.tool}" is denied by policy`,
        executionMs: Date.now() - start,
      };
    }

    if (tool.permission === 'confirm' && input.input) {
      return {
        tool: input.tool,
        success: false,
        error: `tool_use: tool "${input.tool}" requires confirmation`,
        executionMs: Date.now() - start,
      };
    }

    try {
      const result = await tool.execute(input.input, ctx, opts);
      return {
        tool: input.tool,
        success: true,
        result,
        executionMs: Date.now() - start,
      };
    } catch (e) {
      return {
        tool: input.tool,
        success: false,
        error: e instanceof Error ? e.message : String(e),
        executionMs: Date.now() - start,
      };
    }
  },
};