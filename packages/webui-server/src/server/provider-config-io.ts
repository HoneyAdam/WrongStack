/**
 * Shared config I/O helpers for the `providers` map inside the global config.
 *
 * Extracted from both `packages/webui/src/server/index.ts` and
 * `packages/cli/src/webui-server.ts` so the CLI's `--webui` mode doesn't
 * duplicate the read-merge-decrypt / encrypt-write cycle. Callers supply
 * their own vault (already booted) and config path — this module is pure I/O
 * with no side-channel state.
 */
import * as fs from 'node:fs/promises';
import { ConfigError, type ProviderConfig, type SecretVault, atomicWrite } from '@wrongstack/core';
import { decryptConfigSecrets, encryptConfigSecrets } from '@wrongstack/core/security';

/**
 * Read the `providers` section from the global config, decrypting
 * secret-bearing fields. Returns an empty record when the config file
 * doesn't exist or has no `providers` key.
 */
export async function loadSavedProviders(
  configPath: string,
  vault: SecretVault,
): Promise<Record<string, ProviderConfig>> {
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch {
    return {};
  }
  let parsed: { providers?: Record<string, ProviderConfig> } = {};
  try {
    parsed = JSON.parse(raw) as { providers?: Record<string, ProviderConfig> };
  } catch {
    return {};
  }
  if (!parsed.providers) return {};
  return decryptConfigSecrets(parsed.providers, vault);
}

/**
 * Write `providers` back into the global config, encrypting secrets first.
 * Also writes to the profile config when `profileConfigPath` is provided.
 * Refuses to overwrite a corrupt-but-existing config file (the operator
 * should fix it manually). When the config file is missing (ENOENT), starts
 * from an empty object.
 */
export async function saveProviders(
  configPath: string,
  vault: SecretVault,
  providers: Record<string, ProviderConfig>,
  profileConfigPath?: string | undefined,
): Promise<void> {
  let raw: string;
  let fileExists = true;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigError({
        message: `Refusing to mutate ${configPath}: ${(err as Error).message}`,
        code: 'CONFIG_PARSE_FAILED',
        context: { filePath: configPath },
        cause: err,
      });
    }
    fileExists = false;
    raw = '{}';
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if (fileExists) {
      throw new ConfigError({
        message:
          `Refusing to overwrite corrupt config at ${configPath} ` +
          `(${(err as Error).message}). Fix or move the file aside before retrying.`,
        code: 'CONFIG_PARSE_FAILED',
        context: { filePath: configPath },
        cause: err,
      });
    }
    parsed = {};
  }
  parsed.providers = providers;
  const encrypted = encryptConfigSecrets(parsed, vault);
  await atomicWrite(configPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });

  // Also write providers to the profile config when available, so the data
  // survives the next ensureGlobalDefaults() bootstrap trim.
  if (profileConfigPath && profileConfigPath !== configPath) {
    let profileRaw: string;
    try {
      profileRaw = await fs.readFile(profileConfigPath, 'utf8');
    } catch {
      profileRaw = '{}';
    }
    let profileParsed: Record<string, unknown>;
    try {
      profileParsed = JSON.parse(profileRaw) as Record<string, unknown>;
    } catch {
      return; // Refuse to overwrite corrupt profile config
    }
    profileParsed.providers = providers;
    const profileEncrypted = encryptConfigSecrets(profileParsed, vault);
    await atomicWrite(profileConfigPath, JSON.stringify(profileEncrypted, null, 2), { mode: 0o600 });
  }
}

// createProviderConfigIO (the standalone boot-phase helper) lives in
// provider-config-standalone.ts so this module stays vault-free.
