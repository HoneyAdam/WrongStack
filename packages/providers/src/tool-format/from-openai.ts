import type { ContentBlock, ToolUseBlock } from '@wrongstack/core';
import { sanitizeJsonString } from '@wrongstack/core';
import type { OpenAIToolCall } from './to-openai.js';

export interface OpenAIChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string | null;
}

export interface FromOpenAIOptions {
  jsonArgumentsBuggy?: boolean;
}

export function contentFromOpenAI(
  choice: OpenAIChoice,
  opts: FromOpenAIOptions = {},
): ContentBlock[] {
  const out: ContentBlock[] = [];
  const text = choice.message.content;
  if (text && text.trim().length > 0) {
    out.push({ type: 'text', text });
  }
  for (const tc of choice.message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    const raw = tc.function.arguments ?? '{}';
    try {
      input = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      if (opts.jsonArgumentsBuggy) {
        try {
          input = JSON.parse(sanitizeJsonString(raw)) as Record<string, unknown>;
        } catch {
          input = { __raw_arguments: raw };
        }
      } else {
        input = { __raw_arguments: raw };
      }
    }
    const block: ToolUseBlock = {
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input,
    };
    out.push(block);
  }
  if (out.length === 0) {
    out.push({ type: 'text', text: '' });
  }
  return out;
}
