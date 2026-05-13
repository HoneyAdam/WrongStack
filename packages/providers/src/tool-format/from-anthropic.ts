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
  source?: {
    type?: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface FromAnthropicOptions {
  /**
   * Called once for each block whose `type` the converter doesn't recognize.
   * The block is still dropped — this hook only exists so callers can wire
   * it into observability (event bus, logger) instead of silently losing
   * data. Anthropic ships new block types over time (`thinking`,
   * `server_tool_use`, etc.) and we want a way to find out without
   * inflating the conversion logic itself.
   */
  onUnsupported?: (type: string, block: AnthropicBlock) => void;
}

export function contentFromAnthropic(
  blocks: AnthropicBlock[],
  opts: FromAnthropicOptions = {},
): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'tool_use' && b.id && b.name) {
      const input = isPlainObject(b.input)
        ? (b.input as Record<string, unknown>)
        : {};
      out.push({ type: 'tool_use', id: b.id, name: b.name, input });
    } else if (b.type === 'tool_result' && b.tool_use_id) {
      out.push({
        type: 'tool_result',
        tool_use_id: b.tool_use_id,
        content: normalizeToolResultContent(b.content, opts),
        is_error: b.is_error,
      });
    } else if (b.type === 'image' && b.source) {
      const src = b.source;
      const kind = src.type === 'url' ? 'url' : 'base64';
      out.push({
        type: 'image',
        source: {
          type: kind,
          ...(src.media_type ? { media_type: src.media_type } : {}),
          ...(src.data ? { data: src.data } : {}),
          ...(src.url ? { url: src.url } : {}),
        },
      });
    } else if (b.type) {
      opts.onUnsupported?.(b.type, b);
    }
  }
  return out;
}

/**
 * Anthropic's tool_result `content` may be a plain string OR an array of
 * `{ type: 'text', text }` / `{ type: 'image', source }` sub-blocks. Keep
 * the array shape when present — flattening it to a string would lose
 * embedded images and structure that downstream code may want to preserve.
 */
function normalizeToolResultContent(
  raw: unknown,
  opts: FromAnthropicOptions,
): string | ContentBlock[] {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return contentFromAnthropic(raw as AnthropicBlock[], opts);
  if (raw === undefined || raw === null) return '';
  // Unknown shape — stringify to avoid silent loss, but keep it salvageable.
  return JSON.stringify(raw);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
