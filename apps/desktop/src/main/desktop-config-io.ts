/**
 * Desktop-shell read/write of the shared display language (`Config.uiLocale`).
 *
 * The desktop main process can't use the WebUI's localStorage-backed i18n, and
 * it isn't a WS client, so it touches `~/.wrongstack/config.json` directly to
 * (a) read the language at boot and (b) persist a change made in the shell —
 * using the SAME read → decrypt → mutate → encrypt → atomicWrite cycle as the
 * WebUI server (`pref-helpers.updateGlobalConfig`) so encrypted secrets in the
 * file are preserved byte-for-byte.
 *
 * The standalone WebUI's `watchProviderConfig` (now surfacing `uiLocale`) lets
 * a running shell follow a language change written by any other process.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DefaultSecretVault } from '@wrongstack/core';
import { decryptConfigSecrets, encryptConfigSecrets } from '@wrongstack/core/security';
import { atomicWrite, wstackGlobalRoot } from '@wrongstack/core/utils';
import type { SecretVault } from '@wrongstack/core';

const globalConfigPath = path.join(wstackGlobalRoot(), 'config.json');
const vault: SecretVault = new DefaultSecretVault({
  keyFile: path.join(wstackGlobalRoot(), '.key'),
});

/** Read the persisted display language, or undefined when unset/unreadable. */
export async function readUiLocale(): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(globalConfigPath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const decrypted = decryptConfigSecrets(
      JSON.parse(raw) as Record<string, unknown>,
      vault,
    ) as { uiLocale?: string };
    const value = decrypted.uiLocale;
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The global config path + vault, for the live watcher in main.ts. */
export const desktopConfigPaths = { globalConfigPath, vault } as const;

/**
 * Persist a display-language change. Refuses to overwrite a corrupt config
 * (the operator should fix it). Best-effort: never throws to the caller.
 */
export async function writeUiLocale(code: string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(globalConfigPath, 'utf8');
  } catch {
    raw = '{}';
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return; // corrupt config — don't clobber
  }
  const decrypted = decryptConfigSecrets(parsed, vault) as Record<string, unknown>;
  decrypted.uiLocale = code;
  const encrypted = encryptConfigSecrets(decrypted, vault);
  await atomicWrite(globalConfigPath, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}
