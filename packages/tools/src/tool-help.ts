import type { Tool } from '@wrongstack/core';

interface ToolHelpInput {
  tool?: string;
  format?: 'short' | 'full' | 'markdown';
  include_examples?: boolean;
}

interface ToolHelpOutput {
  tool?: string;
  help: string;
  tools: {
    name: string;
    description: string;
    usageHint: string;
    inputSchema: unknown;
    permission: string;
    mutating: boolean;
  }[];
  total: number;
}

export const toolHelpTool: Tool<ToolHelpInput, ToolHelpOutput> = {
  name: 'tool_help',
  category: 'Meta',
  description: 'Get help and usage information for a specific tool or list all available tools.',
  usageHint:
    'Set `tool` for specific help. Omit to list all tools. `format`: short (one-liner), full (schema), markdown (formatted).',
  permission: 'auto',
  mutating: false,
  timeoutMs: 5_000,
  inputSchema: {
    type: 'object',
    properties: {
      tool: {
        type: 'string',
        description: 'Tool name to get help for (omit for all tools)',
      },
      format: {
        type: 'string',
        enum: ['short', 'full', 'markdown'],
        description: 'Output format (default: short)',
      },
      include_examples: {
        type: 'boolean',
        description: 'Include usage examples in output (default: false)',
      },
    },
  },
  async execute(input, ctx) {
    const format = input.format ?? 'short';
    const includeExamples = input.include_examples ?? false;

    if (input.tool) {
      const tool = ctx.tools.find((t: Tool) => t.name === input.tool);
      if (!tool) {
        return {
          tool: input.tool,
          help: `No tool found with name "${input.tool}"`,
          tools: [],
          total: 0,
        };
      }

      return {
        tool: tool.name,
        help: formatToolHelp(tool, format, includeExamples),
        tools: [
          {
            name: tool.name,
            description: tool.description,
            usageHint: tool.usageHint ?? '',
            inputSchema: tool.inputSchema,
            permission: tool.permission,
            mutating: tool.mutating,
          },
        ],
        total: 1,
      };
    }

    const allTools = ctx.tools.map((t: Tool) => ({
      name: t.name,
      description: t.description,
      usageHint: t.usageHint ?? '',
      inputSchema: format === 'full' ? t.inputSchema : undefined,
      permission: t.permission,
      mutating: t.mutating,
    }));

    return {
      help:
        format === 'markdown' ? formatAllToolsMarkdown(allTools) : formatAllToolsShort(allTools),
      tools: allTools,
      total: allTools.length,
    };
  },
};

function formatToolHelp(tool: Tool, format: string, includeExamples: boolean): string {
  const lines: string[] = [];

  if (format === 'short') {
    lines.push(`${tool.name}: ${tool.description}`);
    if (tool.usageHint) lines.push(`Hint: ${tool.usageHint}`);
    return lines.join('\n');
  }

  if (format === 'markdown') {
    lines.push(`## ${tool.name}`);
    lines.push('');
    lines.push(tool.description);
    lines.push('');
    lines.push('**Permission:** ' + tool.permission);
    lines.push('**Mutating:** ' + (tool.mutating ? 'yes' : 'no'));
    if (tool.usageHint) {
      lines.push('');
      lines.push('### Usage Hint');
      lines.push(tool.usageHint);
    }
    if (includeExamples && tool.inputSchema) {
      lines.push('');
      lines.push('### Input Schema');
      lines.push('```json');
      lines.push(JSON.stringify(tool.inputSchema, null, 2));
      lines.push('```');
    }
    return lines.join('\n');
  }

  lines.push(`Tool: ${tool.name}`);
  lines.push(`Description: ${tool.description}`);
  lines.push(`Permission: ${tool.permission}`);
  lines.push(`Mutating: ${tool.mutating}`);
  if (tool.usageHint) lines.push(`Usage: ${tool.usageHint}`);
  if (format === 'full' && tool.inputSchema) {
    lines.push('Schema: ' + JSON.stringify(tool.inputSchema, null, 2));
  }
  return lines.join('\n');
}

function formatAllToolsShort(tools: { name: string; description: string }[]): string {
  return tools.map((t) => `  ${t.name.padEnd(16)} ${t.description}`).join('\n');
}

function formatAllToolsMarkdown(
  tools: { name: string; description: string; usageHint: string }[],
): string {
  const lines: string[] = ['## Available Tools', ''];
  lines.push('| Tool | Description |');
  lines.push('|------|-------------|');
  for (const t of tools) {
    lines.push(`| \`${t.name}\` | ${t.description} |`);
  }
  return lines.join('\n');
}
