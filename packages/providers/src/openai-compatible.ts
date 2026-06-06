import type { Request } from '@wrongstack/core';
import type { Capabilities } from '@wrongstack/core';
import { capabilitiesForFamily } from './family-capabilities.js';
import { OpenAIProvider } from './openai.js';

export interface CompatibilityQuirks {
  stripCacheControl?: boolean | undefined;
  systemAsMessage?: boolean | undefined;
  flattenContentToString?: boolean | undefined;
  preserveToolCallIds?: boolean | undefined;
  parallelToolsDisabled?: boolean | undefined;
  jsonArgumentsBuggy?: boolean | undefined;
  emptyToolCallContent?: 'null' | 'empty_string' | undefined;
}

const VALID_QUIRK_KEYS = new Set<keyof CompatibilityQuirks>([
  'stripCacheControl',
  'systemAsMessage',
  'flattenContentToString',
  'preserveToolCallIds',
  'parallelToolsDisabled',
  'jsonArgumentsBuggy',
  'emptyToolCallContent',
]);

export function isCompatibilityQuirks(value: unknown): value is CompatibilityQuirks {
  if (value === undefined) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

  const obj = value as Record<string, unknown>;
  for (const [key, v] of Object.entries(obj)) {
    if (!VALID_QUIRK_KEYS.has(key as keyof CompatibilityQuirks)) return false;
    if (key === 'emptyToolCallContent') {
      if (v !== 'null' && v !== 'empty_string') return false;
    } else if (typeof v !== 'boolean') {
      return false;
    }
  }
  return true;
}

export interface OpenAICompatibleOptions {
  id: string;
  apiKey: string;
  baseUrl: string;
  headers?: Record<string, string> | undefined;
  quirks?: CompatibilityQuirks | undefined;
  capabilities?: Partial<Capabilities> | undefined;
  fetchImpl?: typeof fetch | undefined;
  /**
   * Optional override for URL construction. Receives the base URL and request,
   * returns the full URL to use. Allows custom providers with non-standard
   * URL structures (e.g. Google with model-in-path, Anthropic with /v1/messages).
   */
  urlOverride?: ((baseUrl: string, req: Request) => string) | undefined;
}

export class OpenAICompatibleProvider extends OpenAIProvider {
  private readonly extraHeaders?: Record<string, string> | undefined;
  private readonly urlOverride?: ((baseUrl: string, req: Request) => string) | undefined;

  constructor(opts: OpenAICompatibleOptions) {
    super({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      id: opts.id,
      capabilities: capabilitiesForFamily('openai-compatible', {
        parallelTools: !opts.quirks?.parallelToolsDisabled,
        systemPrompt: !opts.quirks?.systemAsMessage,
        ...opts.capabilities,
      }),
      quirks: opts.quirks,
    });
    this.extraHeaders = opts.headers;
    this.urlOverride = opts.urlOverride;
  }

  protected override buildUrl(req: Request): string {
    if (this.urlOverride) {
      return this.urlOverride(this.baseUrl, req);
    }
    return super.buildUrl(req);
  }

  /**
   * Compatible endpoints (Groq, Together, Mistral, local servers, …) follow the
   * classic Chat Completions contract and accept `max_tokens`; many reject
   * OpenAI's newer `max_completion_tokens`. Keep the legacy field here. See #10.
   */
  protected override tokenLimitParam(): string {
    return 'max_tokens';
  }

  protected override buildHeaders(req: Request): Record<string, string> {
    return {
      ...super.buildHeaders(req),
      ...this.extraHeaders,
    };
  }
}
