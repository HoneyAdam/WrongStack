import type { ContentBlock } from '@wrongstack/core';

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  source?: unknown;
}

export function contentFromAnthropic(blocks: AnthropicBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' && b.id && b.name) {
      out.push({
        type: 'tool_use',
        id: b.id,
        name: b.name,
        input: (b.input as Record<string, unknown>) ?? {},
      });
    } else if (b.type === 'tool_result' && b.tool_use_id) {
      out.push({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: (b.content as string) ?? '',
        is_error: b.is_error,
      });
    }
  }
  return out;
}
