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
  /**
   * Deprecated: the sanitizer fallback is now always attempted. Kept for
   * backward compatibility; the value is ignored.
   */
  jsonArgumentsBuggy?: boolean;
  /**
   * Called when a tool call's `arguments` field can't be parsed even after
   * the sanitizer pass. Callers can use this to emit a structured event,
   * log it, or surface it in a UI. The block is still appended with
   * `{ __raw_arguments }` so the tool gets *something* to fail on, but
   * silently producing garbage input is the kind of bug that wastes
   * debugging hours — this is the hook to find out.
   */
  onParseFailure?: (info: { toolName: string; toolCallId: string; raw: string }) => void;
}

export function contentFromOpenAI(
  choice: OpenAIChoice,
  opts: FromOpenAIOptions = {},
): ContentBlock[] {
  const out: ContentBlock[] = [];
  const text = choice.message.content;
  // Preserve any non-empty text, including whitespace-only — model output
  // sometimes legitimately starts with a newline or padding spaces. Only
  // skip the truly empty case to avoid duplicate empty blocks.
  if (typeof text === 'string' && text.length > 0) {
    out.push({ type: 'text', text });
  }
  for (const tc of choice.message.tool_calls ?? []) {
    const raw = tc.function.arguments ?? '{}';
    const input = parseToolArguments(raw, tc.function.name, tc.id, opts);
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

function parseToolArguments(
  raw: string,
  toolName: string,
  toolCallId: string,
  opts: FromOpenAIOptions,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // JSON parsed but is a scalar/array — wrap so the tool gets a stable
    // object shape, but flag it as a parse anomaly so callers can detect.
    opts.onParseFailure?.({ toolName, toolCallId, raw });
    return { __raw_arguments: raw };
  } catch {
    // First-pass failed — try the sanitizer (handles trailing commas,
    // JS-style comments, smart quotes the model sometimes emits).
    try {
      const sanitized = JSON.parse(sanitizeJsonString(raw)) as unknown;
      if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
        return sanitized as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
    opts.onParseFailure?.({ toolName, toolCallId, raw });
    return { __raw_arguments: raw };
  }
}
