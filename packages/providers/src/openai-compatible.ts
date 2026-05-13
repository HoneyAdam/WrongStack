import type { Request } from '@wrongstack/core';
import { OpenAIProvider, type OpenAIProviderOptions } from './openai.js';
import type { Capabilities } from '@wrongstack/core';

export interface CompatibilityQuirks {
  stripCacheControl?: boolean;
  systemAsMessage?: boolean;
  flattenContentToString?: boolean;
  preserveToolCallIds?: boolean;
  parallelToolsDisabled?: boolean;
  jsonArgumentsBuggy?: boolean;
  emptyToolCallContent?: 'null' | 'empty_string';
}

export interface OpenAICompatibleOptions {
  id: string;
  apiKey: string;
  baseUrl: string;
  headers?: Record<string, string>;
  quirks?: CompatibilityQuirks;
  capabilities?: Partial<Capabilities>;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleProvider extends OpenAIProvider {
  private readonly extraHeaders?: Record<string, string>;

  constructor(opts: OpenAICompatibleOptions) {
    super({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      id: opts.id,
      capabilities: opts.capabilities,
      quirks: {
        ...opts.quirks,
        parallelToolsDisabled: opts.quirks?.parallelToolsDisabled,
        jsonArgumentsBuggy: opts.quirks?.jsonArgumentsBuggy,
      },
    });
    this.extraHeaders = opts.headers;
  }

  protected override buildHeaders(req: Request): Record<string, string> {
    return {
      ...super.buildHeaders(req),
      ...this.extraHeaders,
    };
  }
}
