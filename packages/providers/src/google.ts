import type { Capabilities, ProviderError } from '@wrongstack/core';
import { parseProviderHttpError } from './error-parse.js';
import type { GoogleStreamState } from './presets/google.js';
import { googleWireFormat } from './presets/google.js';
import type { WireAdapterStreamOptions } from './wire-adapter.js';
import { WireFormatProvider } from './wire-format.js';

export interface GoogleProviderOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
  id?: string | undefined;
  capabilities?: Partial<Capabilities> | undefined;
  /** Raw stream debugging and hang-detection options. */
  streamOpts?: WireAdapterStreamOptions | undefined;
}

export class GoogleProvider extends WireFormatProvider<GoogleStreamState> {
  override readonly id: string;
  override readonly capabilities: Capabilities;

  constructor(opts: GoogleProviderOptions) {
    super(googleWireFormat, {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      streamOpts: opts.streamOpts,
    });
    this.id = opts.id ?? 'google';
    this.capabilities = {
      ...googleWireFormat.capabilities,
      ...opts.capabilities,
    };
  }

  protected override translateError(status: number, text: string): ProviderError {
    return parseProviderHttpError(this.id, status, text);
  }
}
