import type {
  Capabilities,
  Provider,
  ReasoningEffort,
  Request,
  Response,
  StreamEvent,
} from '@wrongstack/core';
import { AnthropicProvider } from './anthropic.js';
import { capabilitiesForFamily } from './family-capabilities.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go/v1';

/** Models documented by OpenCode Go as using its Anthropic Messages surface. */
export const OPENCODE_GO_ANTHROPIC_MODELS = new Set([
  'minimax-m3',
  'minimax-m2.7',
  'minimax-m2.5',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-plus',
]);

const OPENCODE_GO_FIXED_ANTHROPIC_REASONING = new Set(['minimax-m2.7', 'minimax-m2.5']);
const OPENCODE_GO_QWEN_MODELS = new Set(['qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus']);

const OPENCODE_GO_EFFORTS: Readonly<Record<string, ReadonlySet<ReasoningEffort>>> = {
  'grok-4.5': new Set(['low', 'medium', 'high']),
  'glm-5.2': new Set(['high', 'max']),
  'kimi-k3': new Set(['max']),
  'deepseek-v4-pro': new Set(['high', 'max']),
  'deepseek-v4-flash': new Set(['high', 'max']),
};

export interface OpenCodeGoProviderOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  id?: string | undefined;
  headers?: Record<string, string> | undefined;
  fetchImpl?: typeof fetch | undefined;
}

/**
 * OpenCode Go exposes one account/key behind two protocol surfaces. The public
 * provider remains a single WrongStack provider, while each request is routed
 * by model to either Chat Completions or Anthropic Messages.
 */
export class OpenCodeGoProvider implements Provider {
  readonly id: string;
  readonly capabilities: Capabilities = capabilitiesForFamily('openai-compatible', {
    reasoning: true,
    tools: true,
  });

  private readonly chat: OpenCodeGoChatProvider;
  private readonly messages: OpenCodeGoMessagesProvider;

  constructor(opts: OpenCodeGoProviderOptions) {
    this.id = opts.id ?? 'opencode-go';
    const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.chat = new OpenCodeGoChatProvider({
      id: this.id,
      apiKey: opts.apiKey,
      baseUrl,
      headers: opts.headers,
      fetchImpl: opts.fetchImpl,
    });
    this.messages = new OpenCodeGoMessagesProvider({
      id: this.id,
      apiKey: opts.apiKey,
      baseUrl,
      fetchImpl: opts.fetchImpl,
    });
  }

  stream(req: Request, opts: { signal: AbortSignal }): AsyncIterable<StreamEvent> {
    const delegate = this.delegate(req.model);
    this.syncCapabilities(delegate);
    return delegate.stream(req, opts);
  }

  complete(req: Request, opts: { signal: AbortSignal }): Promise<Response> {
    const delegate = this.delegate(req.model);
    this.syncCapabilities(delegate);
    return delegate.complete(req, opts);
  }

  private delegate(model: string): Provider {
    return OPENCODE_GO_ANTHROPIC_MODELS.has(model) ? this.messages : this.chat;
  }

  private syncCapabilities(delegate: Provider): void {
    Object.defineProperty(delegate, 'capabilities', {
      value: this.capabilities,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
}

class OpenCodeGoChatProvider extends OpenAICompatibleProvider {
  protected override buildBody(
    req: Request,
    ctx: { capabilities: Capabilities },
  ): Record<string, unknown> {
    const body = super.buildBody(req, ctx);

    // The generic adapter cannot know a gateway model's effort enum. Go's
    // catalog can: remove the generic value (especially literal `none`) and
    // restore only an exact value advertised for this model. Tools do not
    // suppress a model-supported effort on this provider.
    delete body['reasoning_effort'];
    const effort = req.reasoning?.enabled === false ? undefined : req.reasoning?.effort;
    if (effort && OPENCODE_GO_EFFORTS[req.model]?.has(effort)) {
      body['reasoning_effort'] = effort;
    }
    return body;
  }
}

class OpenCodeGoMessagesProvider extends AnthropicProvider {
  protected override buildBody(
    req: Request,
    ctx: { capabilities: Capabilities },
  ): Record<string, unknown> {
    let normalized = req;

    // M2.7/M2.5 expose fixed reasoning without a toggle or effort control.
    if (OPENCODE_GO_FIXED_ANTHROPIC_REASONING.has(req.model) && req.reasoning) {
      normalized = { ...req, reasoning: undefined };
    } else if (
      OPENCODE_GO_QWEN_MODELS.has(req.model) &&
      req.reasoning?.effort !== undefined &&
      req.reasoning.enabled === undefined
    ) {
      // Qwen's Go metadata exposes a thinking budget. An effort-only runtime
      // request therefore needs to enable thinking so the Anthropic adapter
      // can translate that effort into budget_tokens.
      normalized = { ...req, reasoning: { ...req.reasoning, enabled: true } };
    }

    const body = super.buildBody(normalized, ctx);
    if (req.model === 'minimax-m3') {
      // MiniMax's Anthropic surface defaults thinking off; OpenCode enables
      // adaptive reasoning for M3 unless the caller explicitly disables it.
      body['thinking'] =
        req.reasoning?.enabled === false ? { type: 'disabled' } : { type: 'adaptive' };
    }
    return body;
  }
}
