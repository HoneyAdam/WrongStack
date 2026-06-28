import { expectDefined, FsError } from '@wrongstack/core';

export { expectDefined };

/**
 * Pure helpers for ProviderConfig shape normalisation, key masking, and
 * timestamp generation — plus config file I/O (load/mutate providers).
 * Shared between auth-menu.ts, webui-server.ts, and any future code that
 * touches the config `providers` map.
 */
import * as fs from 'node:fs/promises';
import type { ProviderApiKey, ProviderConfig, SecretVault } from '@wrongstack/core';
import { atomicWrite, color } from '@wrongstack/core';
import { decryptConfigSecrets, encryptConfigSecrets } from '@wrongstack/core/security';
/**
 * Normalize a ProviderConfig to the canonical `apiKeys[]` form.
 * Migrates the legacy single-key `apiKey` field on the fly so every
 * consumer sees a uniform shape. Does NOT mutate the input.
 */
export function normalizeKeys(cfg: ProviderConfig): ProviderApiKey[] {
  if (Array.isArray(cfg.apiKeys) && cfg.apiKeys.length > 0) {
    return cfg.apiKeys.map((k) => ({ ...k }));
  }
  if (typeof cfg.apiKey === 'string' && cfg.apiKey.length > 0) {
    return [{ label: 'default', apiKey: cfg.apiKey, createdAt: '' }];
  }
  return [];
}

/**
 * Write a normalized key list back into a ProviderConfig. Does NOT mirror
 * the plaintext key to the legacy `apiKey` field — that would leak the
 * secret on any accidental JSON.stringify of the config. Consumers that
 * need the real key must call {@link resolveActiveApiKey}.
 */
export function writeKeysBack(cfg: ProviderConfig, keys: ProviderApiKey[]): void {
  if (keys.length === 0) {
    delete cfg.apiKeys;
    delete cfg.apiKey;
    delete cfg.activeKey;
    return;
  }
  cfg.apiKeys = keys;
  const active = keys.find((k) => k.label === cfg.activeKey) ?? expectDefined(keys[0]);
  // Do NOT mirror plaintext to cfg.apiKey — the legacy field is cleared so
  // that accidental serialization (logging, error messages, WS payloads)
  // cannot leak the active key. Use resolveActiveApiKey() to read the real key.
  delete cfg.apiKey;
  if (!cfg.activeKey || !keys.some((k) => k.label === cfg.activeKey)) {
    cfg.activeKey = active.label;
  }
}

/**
 * Extract the active (decrypted) API key from a ProviderConfig.
 *
 * Resolution order:
 *   1. `apiKeys[]` — pick the entry matching `activeKey`, or the first one
 *   2. Legacy `apiKey` field — only for configs not yet migrated to multi-key
 *
 * This is the **preferred** way to read the API key. Never read `cfg.apiKey`
 * directly in new code — after {@link writeKeysBack} it is cleared, and even
 * when present on a freshly-loaded config it may contain a masked value.
 */
export function resolveActiveApiKey(cfg: ProviderConfig): string | undefined {
  if (Array.isArray(cfg.apiKeys) && cfg.apiKeys.length > 0) {
    const active = cfg.activeKey
      ? cfg.apiKeys.find((k) => k.label === cfg.activeKey)
      : undefined;
    return (active ?? cfg.apiKeys[0])?.apiKey;
  }
  return cfg.apiKey && cfg.apiKey.length > 0 ? cfg.apiKey : undefined;
}

/**
 * Return the label of the active key, or the first key's label if no
 * active is pinned. Returns `undefined` when there are no keys at all.
 */
export function activeLabel(cfg: ProviderConfig, keys: ProviderApiKey[]): string | undefined {
  if (cfg.activeKey && keys.some((k) => k.label === cfg.activeKey)) return cfg.activeKey;
  return keys[0]?.label;
}

/** Mask an API key for display: show first 4 + last 4 chars. */
export function maskedKey(key: string): string {
  if (!key) return color.dim('—');
  if (key.length <= 8) return color.dim('•'.repeat(key.length));
  const head = key.slice(0, 4);
  const tail = key.slice(-4);
  return `${color.dim(head + '…')}${tail}`;
}

/** ISO-8601 timestamp for key `createdAt` fields. */
export function nowIso(): string {
  return new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/*  Config file I/O — load / mutate `providers` atomically            */
/* ------------------------------------------------------------------ */

/**
 * Read the on-disk config file and return its `providers` map, fully
 * decrypted. Returns `{}` on ENOENT or corrupt JSON (surfacing the error
 * via the optional `warn` callback when provided).
 */
export async function loadConfigProviders(
  configPath: string,
  vault: SecretVault,
  opts?: { warn?: (msg: string) => void },
): Promise<Record<string, ProviderConfig>> {
  const warn = opts?.warn;
  let raw: string;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn?.(`Could not read ${configPath}: ${(err as Error).message}. Treating as empty.`);
    }
    return {};
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    warn?.(`Config at ${configPath} is not valid JSON: ${(err as Error).message}`);
    return {};
  }
  const decrypted = decryptConfigSecrets(parsed, vault);
  return (decrypted as { providers?: Record<string, ProviderConfig> }).providers ?? {};
}

/**
 * Load → mutate → encrypt → atomic-write. Operates on the FULL config file
 * so non-provider keys are preserved. Refuses to overwrite a corrupt-but-
 * existing config (the user may still have salvageable data).
 */
export async function mutateConfigProviders(
  configPath: string,
  vault: SecretVault,
  mutator: (providers: Record<string, ProviderConfig>) => void,
): Promise<void> {
  let raw: string;
  let fileExists = true;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new FsError({
        message: `Refusing to mutate ${configPath}: ${(err as Error).message}`,
        code: 'FS_READ_FAILED',
        path: configPath,
        context: { operation: 'mutateConfigProviders', phase: 'read' },
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
      throw new FsError({
        message:
          `Refusing to overwrite corrupt config at ${configPath} ` +
          `(${(err as Error).message}). Fix or move the file aside before retrying.`,
        code: 'FS_READ_FAILED',
        path: configPath,
        context: { operation: 'mutateConfigProviders', phase: 'parse' },
        cause: err,
      });
    }
    parsed = {};
  }
  const decrypted = decryptConfigSecrets(parsed, vault) as Record<string, unknown>;
  const providers = (decrypted.providers as Record<string, ProviderConfig>) ?? {};
  mutator(providers);
  decrypted.providers = providers;
  const encrypted = encryptConfigSecrets(decrypted, vault);
  await atomicWrite(configPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}
