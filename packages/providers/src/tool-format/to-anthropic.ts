import type { Tool } from '@wrongstack/core';

export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toolsToAnthropic(tools: Tool[]): AnthropicToolSchema[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.inputSchema as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
  }));
}
