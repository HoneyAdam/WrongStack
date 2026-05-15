/**
 * Pure helpers for ProviderConfig shape normalisation, key masking, and
 * timestamp generation. Shared between auth-menu.ts, webui-server.ts, and
 * any future code that touches the config `providers` map.
 *
 * These are intentionally side-effect-free — config I/O (vault encrypt/decrypt,
 * atomic writes) lives closer to the call sites where the vault is available.
 */
import type { ProviderApiKey, ProviderConfig } from '@wrongstack/core';
import { color } from '@wrongstack/core';

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
 * Write a normalized key list back into a ProviderConfig. Keeps the
 * legacy `apiKey` field mirrored to the active entry so code that
 * bypasses the config loader still sees a usable key.
 */
export function writeKeysBack(cfg: ProviderConfig, keys: ProviderApiKey[]): void {
  if (keys.length === 0) {
    delete cfg.apiKeys;
    delete cfg.apiKey;
    delete cfg.activeKey;
    return;
  }
  cfg.apiKeys = keys;
  const active = keys.find((k) => k.label === cfg.activeKey) ?? keys[0]!;
  cfg.apiKey = active.apiKey;
  if (!cfg.activeKey || !keys.some((k) => k.label === cfg.activeKey)) {
    cfg.activeKey = active.label;
  }
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
