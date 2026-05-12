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
  constructor(opts: OpenAICompatibleOptions) {
    const oaOpts: OpenAIProviderOptions = {
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
    };
    super(oaOpts);
    if (opts.headers) {
      // Wrap fetch to inject extra headers
      const base = oaOpts.fetchImpl ?? fetch;
      this.opts.fetchImpl = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const merged = {
          ...((init?.headers as Record<string, string>) ?? {}),
          ...opts.headers,
        };
        return base(input, { ...init, headers: merged });
      }) as typeof fetch;
    }
  }
}
