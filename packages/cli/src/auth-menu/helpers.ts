import type { ProviderConfig } from '@wrongstack/core';
import { loadConfigProviders, mutateConfigProviders } from '../provider-config-utils.js';
import type { AuthMenuDeps } from './types.js';

/** Thin wrapper — delegates to the shared config provider loader. */
export async function loadProviders(
  deps: AuthMenuDeps,
): Promise<Record<string, ProviderConfig>> {
  return loadConfigProviders(deps.globalConfigPath, deps.vault, {
    warn: (msg: string) => deps.renderer.writeWarning(msg),
  });
}

/** Thin wrapper — delegates to the shared atomic config mutator. */
export async function mutateProviders(
  deps: AuthMenuDeps,
  mutator: (providers: Record<string, ProviderConfig>) => void,
): Promise<void> {
  return mutateConfigProviders(deps.globalConfigPath, deps.vault, mutator);
}
