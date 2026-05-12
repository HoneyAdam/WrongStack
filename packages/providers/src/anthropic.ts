import type {
  Capabilities,
  Message,
  Provider,
  Request,
  Response,
  StopReason,
  StreamEvent,
  Usage,
} from '@wrongstack/core';
import { ProviderError, safeParse } from '@wrongstack/core';
import { toolsToAnthropic } from './tool-format/to-anthropic.js';
import { normalizeAnthropic } from './stop-reason.js';
import { parseSSE } from './sse.js';
import { aggregateStream } from './aggregate.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  apiVersion?: string;
  beta?: string[];
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = 'https://api.anthropic.com';
const DEFAULT_VERSION = '2023-06-01';

export class AnthropicProvider implements Provider {
  readonly id = 'anthropic';
  readonly capabilities: Capabilities = {
    tools: true,
    parallelTools: true,
    vision: true,
    streaming: true,
    promptCache: true,
    systemPrompt: true,
    jsonMode: false,
    maxContext: 200_000,
    cacheControl: 'native',
  };
  private readonly opts: AnthropicProviderOptions;

  constructor(opts: AnthropicProviderOptions) {
    if (!opts.apiKey) throw new Error('AnthropicProvider: apiKey required');
    this.opts = opts;
  }

  async complete(req: Request, opts: { signal: AbortSignal }): Promise<Response> {
    return aggregateStream(this.stream(req, opts));
  }

  async *stream(req: Request, opts: { signal: AbortSignal }): AsyncIterable<StreamEvent> {
    const url = this.endpoint();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-api-key': this.opts.apiKey,
      'anthropic-version': this.opts.apiVersion ?? DEFAULT_VERSION,
    };
    if (this.opts.beta && this.opts.beta.length > 0) {
      headers['anthropic-beta'] = this.opts.beta.join(',');
    }

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: req.messages.map((m) => this.normalizeMessage(m)),
      stream: true,
    };
    if (req.system && req.system.length > 0) body['system'] = req.system;
    if (req.tools && req.tools.length > 0) body['tools'] = toolsToAnthropic(req.tools);
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.topP !== undefined) body['top_p'] = req.topP;
    if (req.stopSequences) body['stop_sequences'] = req.stopSequences;
    if (req.toolChoice) body['tool_choice'] = req.toolChoice;

    const f = this.opts.fetchImpl ?? fetch;
    let httpRes: Response2;
    try {
      httpRes = (await f(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      })) as unknown as Response2;
    } catch (err) {
      if (opts.signal.aborted) throw err;
      throw new ProviderError(
        err instanceof Error ? err.message : String(err),
        0,
        true,
        this.id,
        err,
      );
    }

    if (!httpRes.ok) {
      const text = await safeText(httpRes);
      throw new ProviderError(
        `Anthropic HTTP ${httpRes.status}: ${text.slice(0, 500)}`,
        httpRes.status,
        httpRes.status === 429 ||
          httpRes.status === 529 ||
          (httpRes.status >= 500 && httpRes.status < 600),
        this.id,
      );
    }

    yield* parseAnthropicStream(httpRes.body, req.model);
  }

  /**
   * Resolve the /messages endpoint. Tolerates baseUrls that already include
   * the version segment — e.g. proxies surfaced via models.dev like
   * `https://api.minimax.io/anthropic/v1` — so we don't end up with `/v1/v1/messages`.
   */
  private endpoint(): string {
    const base = (this.opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    if (/\/v\d+\/messages$/.test(base)) return base;
    if (/\/v\d+$/.test(base)) return `${base}/messages`;
    return `${base}/v1/messages`;
  }

  private normalizeMessage(m: Message): Record<string, unknown> {
    return {
      role: m.role === 'system' ? 'user' : m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    };
  }
}

// Avoid name conflict with the canonical Response type
type Response2 = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  body: ReadableStream<Uint8Array> | NodeJS.ReadableStream | null;
};

async function safeText(res: Response2): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * Translate Anthropic's SSE wire format into canonical StreamEvent[].
 *
 * Block indices ↔ canonical event ids:
 *   - text blocks emit text_delta with no id
 *   - tool_use blocks: content_block_start carries the toolu_xxx id, and
 *     subsequent input_json_delta chunks accumulate the JSON arg string.
 *
 * usage.input_tokens arrives in message_start; output_tokens lands in
 * message_delta.usage.
 */
async function* parseAnthropicStream(
  body: Response2['body'],
  fallbackModel: string,
): AsyncIterable<StreamEvent> {
  type BlockKind = 'text' | 'tool_use' | 'unknown';
  const blocks = new Map<number, { kind: BlockKind; id?: string; name?: string; partial: string }>();
  let model = fallbackModel;
  let usage: Usage = { input: 0, output: 0 };
  let stopReason: StopReason = 'end_turn';
  let started = false;

  for await (const msg of parseSSE(body)) {
    if (!msg.data || msg.data === '[DONE]') continue;
    const parsed = safeParse<Record<string, unknown>>(msg.data);
    if (!parsed.ok || !parsed.value) continue;
    const ev = parsed.value;
    const type = String(ev['type'] ?? msg.event);

    switch (type) {
      case 'message_start': {
        const message = ev['message'] as
          | { model?: string; usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }
          | undefined;
        if (message?.model) model = message.model;
        usage = {
          input: message?.usage?.input_tokens ?? 0,
          output: 0,
          cacheRead: message?.usage?.cache_read_input_tokens,
          cacheWrite: message?.usage?.cache_creation_input_tokens,
        };
        if (!started) {
          started = true;
          yield { type: 'message_start', model };
        }
        break;
      }
      case 'content_block_start': {
        const index = Number(ev['index'] ?? 0);
        const cb = ev['content_block'] as { type?: string; id?: string; name?: string } | undefined;
        if (cb?.type === 'tool_use') {
          blocks.set(index, { kind: 'tool_use', id: cb.id, name: cb.name, partial: '' });
          if (cb.id && cb.name) {
            yield { type: 'tool_use_start', id: cb.id, name: cb.name };
          }
        } else if (cb?.type === 'text') {
          blocks.set(index, { kind: 'text', partial: '' });
        } else {
          blocks.set(index, { kind: 'unknown', partial: '' });
        }
        break;
      }
      case 'content_block_delta': {
        const index = Number(ev['index'] ?? 0);
        const delta = ev['delta'] as { type?: string; text?: string; partial_json?: string } | undefined;
        const block = blocks.get(index);
        if (!block || !delta) break;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          if (block.id) {
            block.partial += delta.partial_json;
            yield { type: 'tool_use_input_delta', id: block.id, partial: delta.partial_json };
          }
        }
        break;
      }
      case 'content_block_stop': {
        const index = Number(ev['index'] ?? 0);
        const block = blocks.get(index);
        if (block?.kind === 'tool_use' && block.id) {
          const input = block.partial
            ? (safeParse<unknown>(block.partial).value ?? {})
            : {};
          yield { type: 'tool_use_stop', id: block.id, input };
        }
        break;
      }
      case 'message_delta': {
        const delta = ev['delta'] as { stop_reason?: string | null } | undefined;
        const u = ev['usage'] as { output_tokens?: number } | undefined;
        if (delta?.stop_reason !== undefined) {
          stopReason = normalizeAnthropic(delta.stop_reason);
        }
        if (u?.output_tokens !== undefined) usage = { ...usage, output: u.output_tokens };
        break;
      }
      case 'message_stop':
        yield { type: 'message_stop', stopReason, usage };
        break;
      case 'error': {
        const err = ev['error'] as { message?: string; type?: string } | undefined;
        throw new ProviderError(
          err?.message ?? 'Anthropic stream error',
          0,
          false,
          'anthropic',
        );
      }
    }
  }
  // Guarantee a message_stop in case the upstream omitted it.
  if (started) {
    yield { type: 'message_stop', stopReason, usage };
  }
}
