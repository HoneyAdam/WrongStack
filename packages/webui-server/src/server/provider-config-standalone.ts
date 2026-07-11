/**
 * Standalone WebUI server helper (boot phase — not WS-connected), split out
 * of provider-config-io.ts so chunks that only need the pure load/save I/O
 * don't bundle the AES-GCM `DefaultSecretVault`.
 */
import * as path from 'node:path';
import { DefaultSecretVault, type ProviderConfig } from '@wrongstack/core';
import { loadSavedProviders, saveProviders } from './provider-config-io.js';

/**
 * Small helper for the standalone WebUI entry point: create a
 * `{ load, save }` pair from a config path alone (uses the
 * config-directory-relative `.key` file for the vault). The `--webui`
 * CLI mode and the standalone server both need to read/write the
 * `providers` map identically.
 */
export function createProviderConfigIO(configPath: string) {
  const keyFile = path.join(path.dirname(configPath), '.key');
  const vault = new DefaultSecretVault({ keyFile });

  return {
    load: () => loadSavedProviders(configPath, vault),
    save: (providers: Record<string, ProviderConfig>) =>
      saveProviders(configPath, vault, providers),
  };
}
