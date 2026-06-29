/**
 * First-run setup + active-provider resolution.
 *
 * Phase 1b of the god-module split (issue: God-modules >1500 lines).
 * `startWebUI` in `./index.ts` previously inlined the provider-resolution
 * ladder (configured provider → first saved provider → stub provider +
 * `needsSetup` flag). This module lifts that ladder into a single pure-ish
 * function so `index.ts` reads as orchestration, not branching.
 *
 * No behaviour change: the three branches, the structured error logs, the
 * `needsSetup` flag, and the stub provider's exact shape are preserved
 * verbatim. The function throws on the same failures the inline code did.
 */
import type { Provider, ProviderConfig, ProviderRegistry } from '@wrongstack/core';
import { expectDefined } from '@wrongstack/core';
import { toErrorMessage } from '@wrongstack/core/utils';
import type { Config } from '@wrongstack/core/types';
import { makeProviderFromConfig } from '@wrongstack/providers';

export interface ResolveSetupProviderOptions {
  config: Config;
  /** True when neither provider nor model is set in config. */
  needsProvider: boolean;
  providerRegistry: ProviderRegistry;
}

export interface ResolvedSetupProvider {
  provider: Provider;
  /**
   * True when no provider could be resolved and a stub was created — the
   * frontend should show the onboarding/setup screen. False otherwise.
   * (The caller merges this into its existing `needsSetup` flag.)
   */
  needsSetup: boolean;
}

function logCreateFailure(event: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      event,
      message: toErrorMessage(err),
      timestamp: new Date().toISOString(),
    }),
  );
}

/**
 * Resolve the active provider from config, mirroring the inline ladder that
 * used to live in `startWebUI`:
 *
 *   1. provider + model configured → build from the configured provider.
 *   2. no active provider but saved providers exist → build from the first
 *      saved provider (vault already decrypted its key).
 *   3. no providers at all → boot with a stub anthropic provider and signal
 *      `needsSetup` so the frontend shows the onboarding screen.
 *
 * Throws on provider-construction failure (same as the inline code).
 */
export function resolveSetupProvider(
  opts: ResolveSetupProviderOptions,
): ResolvedSetupProvider {
  const { config, needsProvider, providerRegistry } = opts;

  // Branch 1 — configured provider.
  if (!needsProvider) {
    const providerConfig: ProviderConfig | Record<string, unknown> =
      config.providers?.[config.provider] ?? {
        type: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      };
    try {
      const cfgWithType = { ...providerConfig, type: config.provider };
      const provider: Provider =
        config.features.modelsRegistry && providerRegistry.has(config.provider)
          ? providerRegistry.create(cfgWithType)
          : makeProviderFromConfig(config.provider, cfgWithType);
      return { provider, needsSetup: false };
    } catch (err) {
      logCreateFailure('webui.provider_create_failed', err);
      throw err;
    }
  }

  // Branch 2 — fall back to the first saved provider (usable encrypted key).
  const savedProviders = config.providers ?? {};
  const firstKey = Object.keys(savedProviders)[0];
  if (firstKey) {
    const firstProvider = expectDefined(savedProviders[firstKey]);
    try {
      const provider = makeProviderFromConfig(firstKey, {
        ...firstProvider,
        type: firstKey,
        family: firstProvider.family,
        apiKey: firstProvider.apiKey,
      });
      console.log('[WebUI] Using saved provider:', firstKey);
      return { provider, needsSetup: false };
    } catch (err) {
      logCreateFailure('webui.provider_stub_create_failed', err);
      throw err;
    }
  }

  // Branch 3 — no providers at all. Boot with a stub so the agent
  // initializes; the frontend shows the setup screen until the user
  // picks a real provider/model.
  console.log('[WebUI] No providers configured — showing setup screen');
  const provider = makeProviderFromConfig('anthropic', {
    type: 'anthropic',
    family: 'anthropic',
    apiKey: 'stub-key-replaced-on-setup',
  });
  return { provider, needsSetup: true };
}
