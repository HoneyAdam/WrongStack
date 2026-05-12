import type {
  Capabilities,
  Provider,
  Request,
  Response,
  StopReason,
  StreamEvent,
  Usage,
} from '@wrongstack/core';
import { ProviderError, safeParse } from '@wrongstack/core';
import {
  messagesToOpenAI,
  toolsToOpenAI,
  type ConvertOptions,
} from './tool-format/to-openai.js';
import { normalizeOpenAI } from './stop-reason.js';
import { parseSSE } from './sse.js';
import { aggregateStream } from './aggregate.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  fetchImpl?: typeof fetch;
  quirks?: ConvertOptions & {
    parallelToolsDisabled?: boolean;
    jsonArgumentsBuggy?: boolean;
  };
  id?: string;
  capabilities?: Partial<Capabilities>;
}

const DEFAULT_BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements Provider {
  readonly id: string;
  readonly capabilities: Capabilities;
  protected readonly opts: OpenAIProviderOptions;

  constructor(opts: OpenAIProviderOptions) {
    if (!opts.apiKey) throw new Error('OpenAIProvider: apiKey required');
    this.opts = opts;
    this.id = opts.id ?? 'openai';
    this.capabilities = {
      tools: true,
      parallelTools: !opts.quirks?.parallelToolsDisabled,
      vision: true,
      streaming: true,
      promptCache: false,
      systemPrompt: !opts.quirks?.systemAsMessage,
      jsonMode: true,
      maxContext: 128_000,
      cacheControl: 'auto',
      ...opts.capabilities,
    };
  }

  async complete(req: Request, opts: { signal: AbortSignal }): Promise<Response> {
    return aggregateStream(this.stream(req, opts));
  }

  async *stream(req: Request, opts: { signal: AbortSignal }): AsyncIterable<StreamEvent> {
    const url = this.endpoint();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${this.opts.apiKey}`,
    };
    if (this.opts.organization) headers['openai-organization'] = this.opts.organization;

    const messages = messagesToOpenAI(this.stripCacheControl(req), req.messages, {
      ...this.opts.quirks,
    });

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.tools && req.tools.length > 0) {
      body['tools'] = toolsToOpenAI(req.tools);
      if (req.toolChoice) {
        if (typeof req.toolChoice === 'string') {
          body['tool_choice'] = req.toolChoice === 'required' ? 'required' : req.toolChoice;
        } else {
          body['tool_choice'] = {
            type: 'function',
            function: { name: req.toolChoice.name },
          };
        }
      }
    }
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.topP !== undefined) body['top_p'] = req.topP;
    if (req.stopSequences) body['stop'] = req.stopSequences;

    const f = this.opts.fetchImpl ?? fetch;
    let httpRes: Awaited<ReturnType<typeof fetch>>;
    try {
      httpRes = await f(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
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
      const text = await httpRes.text().catch(() => '');
      throw new ProviderError(
        `OpenAI HTTP ${httpRes.status}: ${text.slice(0, 500)}`,
        httpRes.status,
        httpRes.status === 429 || (httpRes.status >= 500 && httpRes.status < 600),
        this.id,
      );
    }

    yield* parseOpenAIStream(httpRes.body, req.model);
  }

  /**
   * Resolve the /chat/completions endpoint. Tolerates baseUrls that already end
   * with a versioned segment (`/v1`, `/v4`, `/paas/v4`, …) — what models.dev
   * returns for OpenAI-compatible vendors like z.ai. If a caller passes the
   * full path with `/chat/completions` already, use it as-is.
   */
  protected endpoint(): string {
    const base = (this.opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
    if (/\/chat\/completions$/.test(base)) return base;
    if (/\/v\d+(\/[a-z0-9_-]+)*$/i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }

  private stripCacheControl(req: Request): typeof req.system {
    if (!req.system) return undefined;
    return req.system.map((b) => {
      const copy = { ...b };
      delete (copy as { cache_control?: unknown }).cache_control;
      return copy;
    });
  }
}

/**
 * Translate an OpenAI /chat/completions SSE stream into canonical StreamEvent[].
 *
 * Wire format per chunk:
 *   data: {"id":"...","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}
 *   data: {"id":"...","choices":[{"index":0,"delta":{"tool_calls":[
 *           {"index":0,"id":"call_x","function":{"name":"echo","arguments":"{\"text\":"}}]},"finish_reason":null}]}
 *   data: {"id":"...","choices":[{...,"finish_reason":"stop"}],"usage":{"prompt_tokens":12,...}}
 *   data: [DONE]
 *
 * Tool calls stream as a sequence of partial fragments keyed by their
 * `index` in the delta array; we map index → canonical tool_use id from
 * the first chunk that carries one.
 */
async function* parseOpenAIStream(
  body: Awaited<ReturnType<typeof fetch>>['body'],
  fallbackModel: string,
): AsyncIterable<StreamEvent> {
  let model = fallbackModel;
  let usage: Usage = { input: 0, output: 0 };
  let stopReason: StopReason = 'end_turn';
  let started = false;
  let textOpen = false;
  // Tool call streams: keyed by the delta's `index` (not the SSE event).
  const toolByIndex = new Map<number, { id: string; name: string; argBuf: string }>();

  for await (const msg of parseSSE(body)) {
    if (!msg.data || msg.data === '[DONE]') continue;
    const parsed = safeParse<Record<string, unknown>>(msg.data);
    if (!parsed.ok || !parsed.value) continue;
    const obj = parsed.value;

    if (typeof obj['model'] === 'string') model = obj['model'];
    if (!started) {
      started = true;
      yield { type: 'message_start', model };
    }

    const choices = obj['choices'] as Array<{
      delta?: {
        content?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }> | undefined;
    const choice = choices?.[0];

    if (choice?.delta?.content) {
      if (!textOpen) textOpen = true;
      yield { type: 'text_delta', text: choice.delta.content };
    }

    if (choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index ?? 0;
        let entry = toolByIndex.get(idx);
        if (!entry && tc.id && tc.function?.name) {
          entry = { id: tc.id, name: tc.function.name, argBuf: '' };
          toolByIndex.set(idx, entry);
          textOpen = false;
          yield { type: 'tool_use_start', id: entry.id, name: entry.name };
        }
        if (entry && tc.function?.arguments) {
          entry.argBuf += tc.function.arguments;
          yield {
            type: 'tool_use_input_delta',
            id: entry.id,
            partial: tc.function.arguments,
          };
        }
      }
    }

    if (choice?.finish_reason) {
      stopReason = normalizeOpenAI(choice.finish_reason);
    }

    const u = obj['usage'] as
      | { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      | undefined;
    if (u) {
      usage = {
        input: u.prompt_tokens ?? usage.input,
        output: u.completion_tokens ?? usage.output,
        cacheRead: u.prompt_tokens_details?.cached_tokens ?? usage.cacheRead,
      };
    }
  }

  // Close out any open tool calls.
  for (const entry of toolByIndex.values()) {
    const input = entry.argBuf
      ? (safeParse<unknown>(entry.argBuf).value ?? { _raw: entry.argBuf })
      : {};
    yield { type: 'tool_use_stop', id: entry.id, input };
  }
  if (started) {
    yield { type: 'message_stop', stopReason, usage };
  }
}
